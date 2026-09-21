import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { fileUrl, imageOwnerKey } from "@/lib/canvas";
import { queueInfo } from "@/lib/genQueue";
const router = express.Router();

// 轮询版本状态（画布生成中的 imageId 列表）
export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number()).max(200),
  }),
  async (req, res) => {
    const { ids } = req.body;
    const rows = await u.db("o_image").whereIn("id", ids).select("id", "state", "errorReason", "filePath", "stage", "kind", "assetsId", "canvasNodeId", "storyboardId", "videoTrackId");
    const data = await Promise.all(
      rows.map(async (r) => ({
        imageId: r.id,
        state: r.state,
        errorReason: r.errorReason,
        stage: r.stage,
        kind: r.kind ?? "image",
        owner: imageOwnerKey(r),
        src: r.state === "已完成" ? await fileUrl(r.filePath) : null,
        queue: r.state === "生成中" ? queueInfo(r.id!) : null,
      })),
    );
    res.status(200).send(success(data));
  },
);
