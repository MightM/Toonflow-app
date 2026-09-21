import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { expandTextRefs, incomingEdges, resolveOwner } from "@/lib/canvas";
import { buildVideoPrompt } from "@/lib/canvasVideoPrompt";
import { shotBriefs, trackRefKeys, trackStoryContext, trackVoiceRefs } from "@/lib/trackVideo";
const router = express.Router();

// 视频「按官方模板扩写」：用视频模型绑定 / 匹配到的提示词规则（如 MiniMax H3 六字段模板）
// 把简短描述改写成完整提示词。参考素材按实际传入顺序编号，只返回文本，由用户确认后再生成。
// 目标可以是画布视频节点（n:）或镜头台的片段（v:）；片段会带上组内镜头的画面信息与音色。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    nodeKey: z.string(),
    model: z.string().regex(/^[^:]+:.+$/, "请选择视频模型"),
    text: z.string(),
    duration: z.number().int().min(1).max(60),
    aspectRatio: z.enum(["16:9", "9:16"]).optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, nodeKey, model, text, duration, aspectRatio } = req.body;
    try {
      const owner = await resolveOwner(projectId, nodeKey);
      const isTrack = owner.kind === "track";
      if (!isTrack && owner.node?.kind !== "video") return res.status(400).send(error("只有视频节点或片段可以按视频模板扩写"));
      const brief = isTrack ? await shotBriefs(owner.id) : { shots: [], images: [] };
      // 自由节点：连入的文本节点内容拼进用户描述，不占参考位
      const expanded = isTrack
        ? { prompt: text, refKeys: await trackRefKeys(projectId, owner.id) }
        : await expandTextRefs(projectId, (await incomingEdges(projectId, nodeKey)).map((e) => e.sourceKey as string), text);
      const result = await buildVideoPrompt({
        projectId,
        model,
        refKeys: expanded.refKeys,
        extraRefs: isTrack ? await trackVoiceRefs(projectId, owner.id) : [],
        text: expanded.prompt,
        duration,
        aspectRatio: aspectRatio ?? "16:9",
        shots: brief.shots,
        shotImages: brief.images,
        story: isTrack ? await trackStoryContext(projectId, owner.id) : undefined,
        segment: isTrack && (owner.track!.kind === "segment" || brief.shots.length > 1),
      });
      res.status(200).send(success({ text: result.text, rules: result.rules, framesSent: result.framesSent, frameError: result.frameError, refs: result.refs.map((r) => ({ tag: r.tag, name: r.name, type: r.type })) }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message || "扩写失败，请检查「通用 AI」文本模型配置"));
    }
  },
);
