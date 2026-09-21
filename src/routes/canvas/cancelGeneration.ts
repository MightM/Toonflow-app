import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { imageOwnerKey, resolveOwner } from "@/lib/canvas";
import { cancel } from "@/lib/genQueue";
const router = express.Router();

// 终止一次生成（按 o_image.id）：排队中的直接移除，正在跑的发取消信号；版本标成「已取消」，
// 节点当前图不变。片段的 o_video 行一并标掉，剪辑台不会再等它。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    imageId: z.number(),
  }),
  async (req, res) => {
    const { projectId, imageId } = req.body;
    try {
      const row = await u.db("o_image").where("id", imageId).select("id", "state", "assetsId", "canvasNodeId", "storyboardId", "videoTrackId").first();
      if (!row) return res.status(404).send(error("版本不存在"));
      const key = imageOwnerKey(row);
      if (!key) return res.status(400).send(error("这个版本不属于画布节点"));
      await resolveOwner(projectId, key); // 不属于该项目会抛错
      if (row.state !== "生成中") return res.status(200).send(success({ cancelled: false, state: row.state }));
      const result = cancel(imageId);
      await u.db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: "已取消" });
      await u.db("o_video").where("imageId", imageId).where("state", "生成中").update({ state: "生成失败", errorReason: "已取消" });
      if (row.storyboardId) await u.db("o_storyboard").where("id", row.storyboardId).where("state", "生成中").update({ state: "生成失败", reason: "已取消" });
      res.status(200).send(success({ cancelled: true, queued: result.queued, tracked: result.found }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
