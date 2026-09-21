import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { OWNER_IMAGE_COLUMN, resolveOwner } from "@/lib/canvas";
const router = express.Router();

// 切换当前版本（节点的当前图就是下游引用的那张）
// 镜头（s:）另外回写 o_storyboard.filePath / state，快速预览与剪辑台仍读它们。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    target: z.string(),
    imageId: z.number(),
  }),
  async (req, res) => {
    const { projectId, target, imageId } = req.body;
    try {
      const owner = await resolveOwner(projectId, target);
      const column = OWNER_IMAGE_COLUMN[owner.kind];
      const image = await u
        .db("o_image")
        .where({ id: imageId, [column]: owner.id, state: "已完成" })
        .first();
      if (!image) return res.status(400).send(error("版本不存在或未生成完成"));
      if (owner.kind === "asset") {
        await u.db("o_assets").where("id", owner.id).update({ imageId });
      } else if (owner.kind === "storyboard") {
        await u.db("o_storyboard").where("id", owner.id).update({ imageId, filePath: image.filePath, state: "已完成", reason: null });
      } else if (owner.kind === "track") {
        const video = await u.db("o_video").where({ imageId, videoTrackId: owner.id, state: "生成成功" }).first();
        if (!video) return res.status(400).send(error("这一条视频不可用"));
        await u.db("o_videoTrack").where("id", owner.id).update({ videoId: video.id });
      } else {
        await u.db("o_canvasNode").where("id", owner.id).update({ imageId });
      }
      res.status(200).send(success({ message: "已切换" }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
