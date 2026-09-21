import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { expandTextRefs, incomingEdges, isSceneFirstModel, nodeArtStyle, nodeAssetType, remapRefTokens, resolveOwner, resolveRefs, sceneFirst } from "@/lib/canvas";
import { styleLine } from "@/lib/artStyleWords";
import { enqueue } from "@/lib/genQueue";
import { assetReferencePath, prepareAssetStage, type PreparedStage } from "@/lib/assetGen";
import { prepareNodeImage } from "@/lib/canvasNodeImage";
import { prepareStoryboardImage } from "@/lib/storyboardImage";
import { getPreset, presetDefaultModels, renderPreset } from "@/lib/canvasPresets";
import { readLayout, writeLayout } from "@/lib/canvas";
import { autoImageModel } from "@/lib/autoModel";
const router = express.Router();

const PRESET_GROUP_TYPE: Record<string, "role" | "scene" | "tool"> = { 人物: "role", 场景: "scene", 道具: "tool" };

// 画布生图：立即返回 imageId，后台生成；只有成功才更新节点的当前图。
// 资产节点：按资产模型绑定生成（角色一步出多视图）；参考 = 显式 refs 或入边（按 sort），
// 有参考时角色走「有参考图」绑定，衍生资产没连线时自动带父资产。
// 自由图片节点：直接用所选模型生成。
// 模板带 pre（前置步骤）时是两步工作流：先生成中间图（只进历史），成功后作为参考生成最终图。
// 图1 单独占一位的工作流（双图 / 多图合成）：连了场景时生成前自动把它排到最前。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    target: z.string(),
    model: z.string().optional().nullable(),
    size: z.enum(["1K", "2K", "4K"]).optional().nullable(),
    aspectRatio: z
      .string()
      .regex(/^\d+:\d+$/)
      .optional()
      .nullable(),
    prompt: z.string().optional().nullable(),
    promptMode: z.enum(["raw", "template"]).optional().nullable(),
    refs: z.array(z.string()).optional().nullable(),
    presetId: z.string().optional().nullable(), // 目标模板：套模板正文、默认模型与比例
    artStyle: z.string().optional().nullable(), // 节点风格（视觉手册目录名）；不传时读节点 params.artStyle
  }),
  async (req, res) => {
    const { projectId, target, model, size, aspectRatio, prompt, promptMode, refs, presetId, artStyle } = req.body;
    try {
      const owner = await resolveOwner(projectId, target);
      if (owner.node && owner.node.kind !== "image") return res.status(400).send(error("视频节点请用生成视频"));
      if (owner.track) return res.status(400).send(error("片段请用生成视频"));
      const rawKeys: string[] = refs ?? (await incomingEdges(projectId, target)).map((e) => e.sourceKey as string);
      // 文本节点作参考：内容拼进提示词（@文本N 或追加段），不占参考图位
      const textExpanded = await expandTextRefs(projectId, rawKeys, prompt ?? "");
      const edgeKeys = textExpanded.refKeys;
      const edgeRefs = (await resolveRefs(projectId, edgeKeys)).filter((r) => r.kind === "image");

      // 目标模板：正文由模板渲染后原样发送；没指定模型时用模板默认（按有无参考）
      const preset = presetId ? getPreset(presetId) : undefined;
      if (presetId && !preset) return res.status(400).send(error("目标模板不存在"));
      // 衍生资产没连线时会自动以父资产当前图为参考，也算「有参考」
      const hasRefs = edgeRefs.length > 0 || (owner.asset?.assetsId != null && !!(await assetReferencePath(owner.asset.assetsId)));
      if (preset?.requiresRef && !hasRefs) return res.status(400).send(error(`「${preset.name}」需要先连入参考图`));
      const presetRatio = (aspectRatio ?? (preset?.ratio || undefined)) as string | undefined;
      // 模板显式声明的模型优先（四视图、定妆照这些写死是有道理的）；
      // shot / shot_variant / free 这三个没声明，presetDefaultModels 返回空串，才轮到按参考形状自动选
      const presetModel = preset && !model ? (await presetDefaultModels(projectId, preset))[hasRefs ? 1 : 0] || undefined : undefined;
      const autoModel = !model && !presetModel && owner.storyboard ? (await autoImageModel(projectId, owner.id))?.model : undefined;
      const project = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "videoRatio").first();
      // 场景排到图1 只针对真正吃这些参考的那一步的模型（两步工作流里是前置步骤）。
      // 判断要用「最终真正发给供应商的那个模型」：没传 model 时非资产节点会回落到项目分镜模型，
      // 照着空模型判断就会漏排序，krea2 的固定槽位会拿到人物当底图。
      // 资产的回落在 assetGen 里按资产模型绑定解析，这里拿不到，维持原行为。
      const effectiveModel = (stepModel: string | undefined) => stepModel || autoModel || (owner.asset ? undefined : (project?.imageModel ?? undefined));
      const sceneFirstKeys = await sceneFirst(projectId, edgeKeys);
      const refKeysFor = (stepModel: string | undefined) => (isSceneFirstModel(effectiveModel(stepModel)) ? sceneFirstKeys : edgeKeys);
      const refBase64For = (stepModel: string | undefined) => refKeysFor(stepModel).flatMap((key) => edgeRefs.filter((r) => r.key === key).map((r) => r.base64));
      const refKeys = refKeysFor(model ?? presetModel ?? autoModel);
      // 场景排图1 打乱了顺序时，把提示词里的 @图N 一起重编号（只改发出去的文本）
      const imageKeys = edgeRefs.map((r) => r.key);
      const remapped = remapRefTokens(
        textExpanded.prompt,
        imageKeys,
        refKeys.filter((k) => imageKeys.includes(k)),
      );
      // 自由节点选了风格：把手册的「风格基因」抽成一行追加在末尾（只改发出去的文本，界面上保存的仍是原文）
      const nodeStyle = owner.node ? (artStyle ?? nodeArtStyle(owner.node.params)) : null;
      const styleWords = nodeStyle ? styleLine(nodeStyle) : "";
      const sentPrompt = styleWords ? `${remapped.trim()}\n${styleWords}` : remapped;
      const presetPrompt = preset ? renderPreset(preset, sentPrompt, presetRatio ?? "16:9") : undefined;
      if (preset) await rememberPreset(projectId, target, preset.id);

      if (owner.asset && typeof prompt === "string") await u.db("o_assets").where("id", owner.id).update({ prompt });
      if (owner.storyboard && typeof prompt === "string") await u.db("o_storyboard").where("id", owner.id).update({ prompt });
      if (owner.node) {
        // 用人物 / 场景 / 道具模板生成的自由节点，没标注过类型时顺手打上对应标签
        const tag = PRESET_GROUP_TYPE[preset?.group ?? ""];
        const params = JSON.parse(owner.node.params || "{}");
        const tagged = tag && !nodeAssetType(owner.node.params) ? { params: JSON.stringify({ ...params, assetType: tag }) } : {};
        await u.db("o_canvasNode").where("id", owner.id).update({ prompt: prompt ?? owner.node.prompt ?? "", ...tagged });
      }

      // 资产节点 / 自由节点统一成同一种任务
      const makeJob = async (job: {
        model?: string;
        ratio?: string;
        text?: string; // 已渲染好的最终提示词（原样发送）
        refs?: string[];
        resolveReferences?: () => Promise<string[]>;
        stage?: string;
        setCurrent?: boolean;
      }): Promise<PreparedStage> => {
        const jobSize = (size ?? (preset?.size || undefined)) as "1K" | "2K" | "4K" | undefined;
        if (owner.asset) {
          return prepareAssetStage({
            projectId,
            assetId: owner.id,
            model: job.model,
            size: jobSize,
            aspectRatio: job.ratio as `${number}:${number}` | undefined,
            prompt: job.text ?? sentPrompt ?? undefined,
            rawPrompt: job.text !== undefined || promptMode === "raw",
            referenceBase64: job.refs,
            resolveReferences: job.resolveReferences,
            refKeys,
            stage: job.stage,
            setCurrent: job.setCurrent,
          });
        }
        const useModel = job.model || project?.imageModel;
        if (!useModel || !useModel.includes(":")) throw new Error("请选择生成模型");
        if (owner.storyboard) {
          return prepareStoryboardImage({
            projectId,
            scriptId: owner.storyboard.scriptId!,
            storyboardId: owner.id,
            model: useModel,
            size: jobSize ?? ((project?.imageQuality as "1K" | "2K" | "4K" | undefined) || "1K"),
            aspectRatio: (job.ratio ?? (project?.videoRatio as `${number}:${number}` | undefined) ?? "16:9") as `${number}:${number}`,
            prompt: job.text ?? sentPrompt ?? owner.storyboard.prompt ?? "",
            referenceBase64: job.refs,
            resolveReferences: job.resolveReferences,
            refKeys,
            setCurrent: job.setCurrent,
          });
        }
        return prepareNodeImage({
          projectId,
          nodeId: owner.id,
          nodeName: owner.node!.name ?? "",
          model: useModel,
          size: jobSize ?? ((project?.imageQuality as "1K" | "2K" | "4K" | undefined) || "1K"),
          aspectRatio: (job.ratio ?? "16:9") as `${number}:${number}`,
          prompt: job.text ?? sentPrompt ?? owner.node!.prompt ?? "",
          referenceBase64: job.refs,
          resolveReferences: job.resolveReferences,
          refKeys,
          stage: job.stage,
          setCurrent: job.setCurrent,
        });
      };

      // 两步工作流（如人物换装）：先按前置模板生成中间图（只进历史），成功后作为参考生成最终图
      const pre = preset?.pre ? getPreset(preset.pre) : undefined;
      if (preset?.pre && !pre) return res.status(400).send(error(`模板「${preset.name}」的前置步骤 ${preset.pre} 不存在`));
      if (pre) {
        const preRatio = pre.ratio || presetRatio || "9:16";
        const preModel = (await presetDefaultModels(projectId, pre))[1] || undefined;
        const step1 = await makeJob({
          model: preModel,
          ratio: preRatio,
          text: renderPreset(pre, prompt ?? "", preRatio),
          refs: refBase64For(preModel),
          stage: pre.id,
          setCurrent: false,
        });
        let step1File: string | undefined;
        const step2 = await makeJob({
          model: model ?? presetModel,
          ratio: presetRatio,
          text: presetPrompt,
          resolveReferences: async () => (step1File ? [await u.oss.getImageBase64(step1File)] : []),
        });
        // 两步作为一个任务排队（按最终图的 imageId 取消，前置步骤跟着一起停）
        enqueue(step2.imageId, "image", async () => {
          const first = await step1.run();
          if (!first.ok || !first.filePath) {
            await u
              .db("o_image")
              .where("id", step2.imageId)
              .update({ state: "生成失败", errorReason: `第一步「${pre.name}」失败：${first.error ?? "未知原因"}` });
            return;
          }
          step1File = first.filePath;
          await step2.run();
        });
        return res.status(200).send(success({ imageId: step2.imageId, steps: [step1.imageId, step2.imageId] }));
      }

      const job = await makeJob({
        model: model ?? presetModel ?? autoModel,
        ratio: presetRatio,
        text: presetPrompt,
        refs: refBase64For(model ?? presetModel ?? autoModel),
      });
      enqueue(job.imageId, "image", job.run);
      return res.status(200).send(success({ imageId: job.imageId }));
    } catch (e) {
      if (!res.headersSent) res.status(400).send(error(u.error(e).message));
    }
  },
);

/** 记住节点上次用的目标模板（layout.nodeMeta[key].presetId），下次打开默认选中 */
async function rememberPreset(projectId: number, key: string, presetId: string) {
  const layout = await readLayout(projectId);
  const meta = layout.nodeMeta[key] ?? {};
  if (meta.presetId === presetId) return;
  await writeLayout(projectId, { ...layout, nodeMeta: { ...layout.nodeMeta, [key]: { ...meta, presetId } } });
}
