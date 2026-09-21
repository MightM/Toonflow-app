import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { incomingEdges, isSceneFirstModel, remapRefTokens, resolveRefs, sceneFirst, storyboardKey } from "@/lib/canvas";
import { ensureStoryboardEdges, prepareStoryboardImage } from "@/lib/storyboardImage";
const router = express.Router();

// 批量生成分镜图。与镜头台单张生成走同一条路径（prepareStoryboardImage + 参考边），
// 所以批量和单张的参考顺序、版本链、失败行为完全一致。
export default router.post(
  "/",
  validateFields({
    storyboardIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
    concurrentCount: z.number().min(1).optional(),
    compulsory: z.boolean().optional(),
  }),
  async (req, res) => {
    const { storyboardIds, projectId, scriptId, concurrentCount = 5, compulsory = false } = req.body;
    if (!storyboardIds?.length) return res.status(400).send(error("storyboardIds不能为空"));

    const storyboardData = await u.db("o_storyboard").where({ scriptId, projectId }).whereIn("id", storyboardIds);
    if (!storyboardData.length) return res.status(500).send(error("未查到分镜数据"));
    const storyIds = storyboardData.map((i) => i.id!);

    if (compulsory) {
      await u.db("o_storyboard").whereIn("id", storyIds).update({ shouldGenerateImage: 1 });
    } else {
      await u.db("o_storyboard").whereIn("id", storyIds).where("shouldGenerateImage", 0).update({ state: "未生成" });
    }
    await ensureStoryboardEdges(projectId, storyIds);

    const project = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "videoRatio").first();
    const model = project?.imageModel;
    if (!model || !model.includes(":")) return res.status(400).send(error("项目未配置分镜图模型"));

    const generateList = compulsory ? storyboardData : storyboardData.filter((item) => item.shouldGenerateImage !== 0);

    // 先把占位版本建好，前端拿到 imageId 就能轮询；参考读取失败在这一步就会暴露
    const jobs: { id: number; stage: Awaited<ReturnType<typeof prepareStoryboardImage>> }[] = [];
    const failed = new Map<number, string>();
    for (const item of generateList) {
      try {
        const edgeKeys = (await incomingEdges(projectId, storyboardKey(item.id!))).map((e) => e.sourceKey as string);
        const orderedKeys = isSceneFirstModel(model) ? await sceneFirst(projectId, edgeKeys) : edgeKeys;
        const refs = (await resolveRefs(projectId, orderedKeys)).filter((r) => r.kind === "image");
        // 场景排图1 打乱顺序时，提示词里的 @图N 要跟着重编号，否则「@图1 为某某」会指错图
        const originalImageKeys = (await resolveRefs(projectId, edgeKeys)).filter((r) => r.kind === "image").map((r) => r.key);
        const sentPrompt = remapRefTokens(item.prompt ?? "", originalImageKeys, refs.map((r) => r.key));
        const stage = await prepareStoryboardImage({
          projectId,
          scriptId,
          storyboardId: item.id!,
          model,
          size: (project?.imageQuality as "1K" | "2K" | "4K") || "1K",
          aspectRatio: (project?.videoRatio as `${number}:${number}`) || "16:9",
          prompt: sentPrompt,
          referenceBase64: refs.map((r) => r.base64),
          refKeys: orderedKeys,
        });
        jobs.push({ id: item.id!, stage });
      } catch (e) {
        const message = u.error(e).message;
        failed.set(item.id!, message);
        await u.db("o_storyboard").where("id", item.id).update({ state: "生成失败", reason: message });
      }
    }

    const assetRecord = await associatedAssets(storyIds);
    const current = await u.db("o_storyboard").where({ scriptId, projectId }).whereIn("id", storyIds);
    res.status(200).send(
      success(
        current.map((i) => ({
          id: i.id,
          prompt: i.prompt,
          associateAssetsIds: assetRecord[i.id!] ?? [],
          src: null,
          state: failed.has(i.id!) ? "生成失败" : i.state,
          reason: failed.get(i.id!) ?? i.reason,
          imageId: jobs.find((j) => j.id === i.id)?.stage.imageId ?? i.imageId,
          videoDesc: i.videoDesc,
          shouldGenerateImage: i.shouldGenerateImage,
        })),
      ),
    );

    for (let i = 0; i < jobs.length; i += concurrentCount) {
      await Promise.all(jobs.slice(i, i + concurrentCount).map((j) => j.stage.run()));
    }
  },
);

/** 关联资产的 imageId 列表（仅供前端展示，实际参考走参考边） */
async function associatedAssets(storyIds: number[]): Promise<Record<number, number[]>> {
  const links = await u.db("o_assets2Storyboard").whereIn("storyboardId", storyIds).orderBy("rowid").select("storyboardId", "assetId");
  if (!links.length) return {};
  const assets = await u
    .db("o_assets")
    .whereIn(
      "id",
      links.map((l) => l.assetId!),
    )
    .select("id", "imageId");
  const imageOf = new Map(assets.map((a) => [a.id, a.imageId]));
  const record: Record<number, number[]> = {};
  for (const link of links) {
    const imageId = imageOf.get(link.assetId!);
    if (imageId == null) continue;
    (record[link.storyboardId!] ??= []).push(imageId);
  }
  return record;
}
