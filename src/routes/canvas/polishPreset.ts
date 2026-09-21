import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import fs from "fs/promises";
import path from "path";
import { getPreset } from "@/lib/canvasPresets";
import { expandTextRefs, incomingEdges, nodeAssetType, resolveOwner } from "@/lib/canvas";
const router = express.Router();

// 项目没绑画风（无限画布可以不绑）时的通用优化规则，可直接改
const FREE_POLISH_SKILL = "canvas_free_polish.md";
const FREE_POLISH_FALLBACK =
  "你是资深的 AI 绘画提示词写手。把用户的简短需求写成一段完整、具体的画面描述：主体、动作、环境、光线、构图、氛围、画风质感，只写静止的一瞬间，不写运镜和台词，画面里不出现文字。保留用户提到的 @图N 引用声明，先声明每张参考图代表什么，再写画面。输出中文，不加解释。";
async function loadFreePolish(): Promise<string> {
  try {
    return await fs.readFile(path.join(u.getPath(["skills"]), FREE_POLISH_SKILL), "utf-8");
  } catch {
    return FREE_POLISH_FALLBACK;
  }
}

// 按目标模板优化：用项目画风的视觉手册（模板的 polish 字段）把简短描述写成完整需求正文
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    presetId: z.string(),
    text: z.string(),
    nodeKey: z.string().optional().nullable(),
    artStyle: z.string().optional().nullable(), // 节点自己选的风格，优先于项目画风
  }),
  async (req, res) => {
    const { projectId, presetId, text, nodeKey, artStyle } = req.body;
    const preset = getPreset(presetId);
    if (!preset) return res.status(404).send(error("模板不存在"));
    if (!preset.polish) return res.status(400).send(error("这个模板不需要优化"));
    const project = await u.db("o_project").where("id", projectId).select("artStyle").first();
    if (!project) return res.status(404).send(error("项目不存在"));
    // 绑了画风就按视觉手册润色；没绑（无限画布）或手册缺失时用通用规则，不再报错
    const useStyle = artStyle || project.artStyle || "";
    const manual = (useStyle && u.getArtPrompt(useStyle, "art_skills", preset.polish)) || (await loadFreePolish());

    // 资产节点带上资产本身和父资产的描述，优化更贴角色
    const context: string[] = [];
    if (nodeKey) {
      try {
        const owner = await resolveOwner(projectId, nodeKey);
        // 自由节点：连入的文本节点内容作为背景资料
        if (owner.node) {
          const keys = (await incomingEdges(projectId, nodeKey)).map((e) => e.sourceKey as string);
          const { texts } = await expandTextRefs(projectId, keys, "");
          texts.filter((t) => t.content).forEach((t) => context.push(`参考文本「${t.name}」：\n${t.content}`));
        }
        if (owner.asset) {
          context.push(`名称：${owner.asset.name ?? ""}`, `描述：${owner.asset.describe ?? "无"}`);
          if (owner.asset.assetsId) {
            const parent = await u.db("o_assets").where("id", owner.asset.assetsId).select("name", "describe").first();
            if (parent) context.push(`父级资产：${parent.name}，${parent.describe ?? "无详细描述"}`);
          }
        }
        // 镜头：把参考图的编号与身份、分镜表写的画面信息一并给出，
        // 不然模型写不出「@图1 为某某角色」这种必须与实际传图对上的声明
        if (owner.storyboard) {
          context.push(`镜头序号：第 ${(owner.storyboard.index ?? 0) + 1} 个镜头`, `建议时长：${owner.storyboard.duration ?? "未标注"} 秒`);
          const refs = await describeShotRefs(projectId, nodeKey);
          // 分镜信息里那串「关联资产ID: [...]」是 Agent 最初拆出来的，用户可以在素材板上增删，
          // 以实际连入的为准，不然模型会照着已经删掉的 ID 继续写人
          context.push(
            refs.length
              ? `连入的参考图（编号必须照此使用；分镜信息里的「关联资产ID」已过时，一律以这份为准）：\n${refs.join("\n")}`
              : "没有连入参考图（分镜信息里的「关联资产ID」已过时，不要照它写人物或场景）",
          );
          if (owner.storyboard.videoDesc) context.push(`分镜表写的这一镜信息：${owner.storyboard.videoDesc}`);
          // 整集剧本（一集一千多字）：让模型知道这一镜在故事里的位置，写得出前后呼应的画面
          const script = owner.storyboard.scriptId ? await u.db("o_script").where("id", owner.storyboard.scriptId).select("name", "content").first() : null;
          if (script?.content) context.push(`本集剧本《${script.name ?? ""}》全文（只作背景，不要把台词写进画面）：\n${script.content}`);
        }
      } catch {
        // 节点不存在就只用用户输入
      }
    }
    try {
      const { text: output } = await u.Ai.Text("universalAi").invoke({
        system: manual,
        messages: [
          {
            role: "user",
            content: [`目标：${preset.name}（${preset.desc}）`, ...context, `用户的简短需求：${text || "（未填写，请按资产描述生成）"}`].join("\n"),
          },
        ],
      });
      if (!output?.trim()) return res.status(500).send(error("优化结果为空"));
      res.status(200).send(success({ text: output.trim() }));
    } catch (e) {
      res.status(500).send(error(`优化失败：${u.error(e).message || "请检查「通用 AI」文本模型配置"}`));
    }
  },
);

/** 镜头连入的参考图：按实际传图顺序给出「图N = 名称（类型）」 */
async function describeShotRefs(projectId: number, targetKey: string): Promise<string[]> {
  const edges = await incomingEdges(projectId, targetKey);
  const lines: string[] = [];
  for (const edge of edges) {
    let name = String(edge.sourceKey);
    let type = "参考图";
    try {
      const src = await resolveOwner(projectId, edge.sourceKey as string);
      if (src.asset) {
        name = src.asset.name ?? name;
        type = TYPE_LABEL[src.asset.type ?? ""] ?? "参考图";
      } else if (src.storyboard) {
        name = `镜头 ${(src.storyboard.index ?? 0) + 1}`;
        type = "已生成的分镜图";
      } else if (src.node) {
        name = src.node.name ?? name;
        const tag = nodeAssetType(src.node.params);
        type = (tag && TYPE_LABEL[tag]) || "参考图";
      }
    } catch {
      type = "已失效的参考";
    }
    lines.push(`图${lines.length + 1} = ${name}（${type}）`);
  }
  return lines;
}

const TYPE_LABEL: Record<string, string> = { role: "角色", scene: "场景", tool: "道具" };
