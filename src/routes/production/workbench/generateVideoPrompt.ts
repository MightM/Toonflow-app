import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { generateTrackPrompt } from "@/lib/trackVideo";
const router = express.Router();

// 老分镜台的「生成视频提示词」。逻辑已经收敛到 generateTrackPrompt（与镜头台、画布同一份），
// 这里只把工作台传来的素材列表（{id, sources}）映射成画布节点 key。
export default router.post(
  "/",
  validateFields({
    trackId: z.number(),
    projectId: z.number(),
    info: z.array(
      z.object({
        id: z.number(),
        sources: z.string(),
      }),
    ),
    model: z.string(),
    mode: z.string(),
  }),
  async (req, res) => {
    const { trackId, projectId, info, model } = req.body;
    try {
      const text = await generateTrackPrompt({ projectId, trackId, model, info });
      res.status(200).send(success(text));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
