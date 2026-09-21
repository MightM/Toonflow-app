import express from "express";
import u from "@/utils";
import pLimit from "p-limit";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { generateTrackPrompt } from "@/lib/trackVideo";
const router = express.Router();

// 批量生成视频提示词：立即返回，后台按并发跑。
// 单条逻辑与镜头台、画布共用 generateTrackPrompt（失败写回 o_videoTrack.state/reason，前端轮询 checkVideoPrompt）。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    trackData: z.array(
      z.object({
        trackId: z.number(),
        info: z.array(
          z.object({
            id: z.number(),
            sources: z.string(),
          }),
        ),
      }),
    ),
    mode: z.string(),
    model: z.string(),
    concurrentCount: z.number().optional(),
  }),
  async (req, res) => {
    const { trackData, projectId, model, concurrentCount = 5 } = req.body;
    try {
      await u
        .db("o_videoTrack")
        .whereIn(
          "id",
          trackData.map((t: { trackId: number }) => t.trackId),
        )
        .update({ state: "生成中", reason: null });
      res.status(200).send(success("开始生成提示词"));

      const limit = pLimit(concurrentCount);
      await Promise.all(
        trackData.map((track: { trackId: number; info: { id: number; sources: string }[] }) =>
          limit(() =>
            generateTrackPrompt({ projectId, trackId: track.trackId, model, info: track.info }).catch((e) =>
              console.warn("[批量视频提示词]", track.trackId, u.error(e).message),
            ),
          ),
        ),
      );
    } catch (e) {
      if (!res.headersSent) res.status(400).send(error(u.error(e).message));
    }
  },
);
