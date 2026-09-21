import express from "express";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { expandTextRefs, incomingEdges, resolveOwner, resolveRefs } from "@/lib/canvas";
const router = express.Router();

// 文本节点的「AI 生成」：按指令 + 连入的参考（文本内容、图片）用通用 AI 写内容，直接写进节点，
// 返回旧内容供撤销一步。文本节点没有版本链，所以是同步接口。
const TEXT_SKILL = "canvas_text_generate.md";
const TEXT_SKILL_FALLBACK =
  "你是影视创作助手，在一张自由画布上帮用户写文本：灵感、台词、分镜大纲、画面描述都可能。严格按用户指令的体裁与长度写，参考资料只作依据不要复述，输出中文正文本身，不加标题、解释或 Markdown 代码块。";
const MAX_IMAGES = 5;

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    target: z.string(),
    instruction: z.string().optional().default(""),
  }),
  async (req, res) => {
    const { projectId, target } = req.body;
    const instruction = (req.body.instruction ?? "").trim();
    try {
      const owner = await resolveOwner(projectId, target);
      if (!owner.node || owner.node.kind !== "text") return res.status(400).send(error("只有文本节点可以 AI 生成文本"));
      const keys = (await incomingEdges(projectId, target)).map((e) => e.sourceKey as string);
      const { texts, refKeys } = await expandTextRefs(projectId, keys, "");
      const images = (await resolveRefs(projectId, refKeys)).filter((r) => r.kind === "image").slice(0, MAX_IMAGES);
      const previous = owner.node.prompt ?? "";

      const system = await loadSkill();
      const lines = [
        instruction ? `指令：${instruction}` : "指令：没有具体指令，请根据参考资料写一段最有用的内容（如大纲、画面描述或台词）",
        previous.trim() ? `这个便签当前的内容（可在此基础上改写）：\n${previous.trim()}` : "这个便签目前是空的",
        ...texts.filter((t) => t.content).map((t) => `参考文本「${t.name}」：\n${t.content}`),
        images.length ? `另附 ${images.length} 张参考图，写作时以画面内容为准` : "",
      ].filter(Boolean);
      const parts = images.map((r) => {
        // AI SDK 的 image 部件要裸 base64 + mediaType；data URL 会被当成 URL 解析
        const matched = /^data:([^;]+);base64,(.*)$/s.exec(r.base64);
        return matched ? { type: "image" as const, image: matched[2]!, mediaType: matched[1]! } : { type: "image" as const, image: r.base64 };
      });
      const invoke = async (withImages: boolean) => {
        const user = withImages && parts.length ? { role: "user" as const, content: [{ type: "text" as const, text: lines.join("\n\n") }, ...parts] } : { role: "user" as const, content: lines.join("\n\n") };
        const { text } = await u.Ai.Text("universalAi").invoke({ system, messages: [user] as never });
        return (text ?? "").trim().replace(/^```\w*\n?|\n?```$/g, "").trim();
      };
      let output = "";
      try {
        output = await invoke(true);
      } catch (e) {
        if (!parts.length) throw e;
        // 文本模型不支持看图：退回纯文本再试一次
        console.warn("[画布文本] 带图调用失败，回落纯文本：", u.error(e).message);
        output = await invoke(false);
      }
      if (!output) return res.status(500).send(error("生成结果为空"));
      await u.db("o_canvasNode").where("id", owner.id).update({ prompt: output });
      res.status(200).send(success({ text: output, previous }));
    } catch (e) {
      res.status(400).send(error(`生成失败：${u.error(e).message || "请检查「通用 AI」文本模型配置"}`));
    }
  },
);

async function loadSkill(): Promise<string> {
  try {
    return await fs.readFile(path.join(u.getPath(["skills"]), TEXT_SKILL), "utf-8");
  } catch {
    return TEXT_SKILL_FALLBACK;
  }
}
