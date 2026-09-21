import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { expandTextRefs, incomingEdges, resolveOwner, resolveRefs } from "@/lib/canvas";
import { prepareNodeAudio } from "@/lib/canvasNodeAudio";
import { enqueue } from "@/lib/genQueue";
const router = express.Router();

// 音频节点：文本转语音。文本里的 @文本N 展开成连入文本节点的内容；
// 连入的音频节点作为音色参考（最多 1 条，模型不支持时由供应商脚本忽略）。
// 立即返回 imageId，后台生成，前端用 pollVersions 轮询。
const MAX_VOICE_REFS = 1;

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    target: z.string(),
    model: z.string().regex(/^[^:]+:.+$/, "请选择语音模型"),
    text: z.string().min(1, "请输入要朗读的文本"),
    voice: z.string().optional().default(""),
    speechRate: z.number().min(0.1).max(5).optional().default(1),
    pitchRate: z.number().min(0.1).max(5).optional().default(1),
    volume: z.number().min(0).max(5).optional().default(1),
  }),
  async (req, res) => {
    const { projectId, target, model, text } = req.body;
    const voice = req.body.voice ?? "";
    const speechRate = req.body.speechRate ?? 1;
    const pitchRate = req.body.pitchRate ?? 1;
    const volume = req.body.volume ?? 1;
    try {
      const owner = await resolveOwner(projectId, target);
      if (!owner.node || owner.node.kind !== "audio") return res.status(400).send(error("只有音频节点可以生成语音"));
      const keys = (await incomingEdges(projectId, target)).map((e) => e.sourceKey as string);
      const expanded = await expandTextRefs(projectId, keys, text);
      const voiceRefs = (await resolveRefs(projectId, expanded.refKeys)).filter((r) => r.kind === "audio").slice(0, MAX_VOICE_REFS);
      if (!expanded.prompt.trim()) return res.status(400).send(error("要朗读的文本是空的"));

      const params = JSON.stringify({ model, voice, speechRate, pitchRate, volume });
      await u.db("o_canvasNode").where("id", owner.id).update({ prompt: text, params });
      const job = await prepareNodeAudio({
        projectId,
        nodeId: owner.id,
        nodeName: owner.node.name ?? "音频",
        model,
        text: expanded.prompt,
        voice,
        speechRate,
        pitchRate,
        volume,
        referenceBase64: voiceRefs.map((r) => r.base64),
        refKeys: voiceRefs.map((r) => r.key),
      });
      res.status(200).send(success({ imageId: job.imageId, usedRefs: voiceRefs.map((r) => ({ key: r.key, kind: r.kind })) }));
      enqueue(job.imageId, "audio", job.run);
    } catch (e) {
      if (!res.headersSent) res.status(400).send(error(u.error(e).message));
    }
  },
);
