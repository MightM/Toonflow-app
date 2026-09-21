import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { deriveTrackRefs, materializeTrackRefs, resetTrackRefs, trackRefsOverridden } from "@/lib/trackVideo";
const router = express.Router();

// 片段参考的两种状态：
//   推导态（默认）= 跟着组内各镜「画面描述」页素材板上的资产走，库里没有 v: 入边；
//   覆盖态        = 片段自己有 v: 入边，此后不再跟随。
// take：把当前推导结果落成真实的边（前端要删某一条参考前先调它，removeEdge 需要 edgeId）；
// reset：删光边，回到推导态。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    trackId: z.number(),
    action: z.enum(["take", "reset"]),
  }),
  async (req, res) => {
    const { projectId, trackId, action } = req.body;
    try {
      const track = await u.db("o_videoTrack").where({ id: trackId, projectId }).first();
      if (!track) return res.status(404).send(error("片段不存在"));
      if (action === "take") await materializeTrackRefs(projectId, trackId);
      else await resetTrackRefs(projectId, trackId);
      res.status(200).send(success({ overridden: await trackRefsOverridden(projectId, trackId), refs: await deriveTrackRefs(projectId, trackId) }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
