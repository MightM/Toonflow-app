import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { syncStoryboardAssetLink } from "@/lib/storyboardImage";
const router = express.Router();

// 删除参考连线
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    id: z.number(),
  }),
  async (req, res) => {
    const { projectId, id } = req.body;
    const edge = await u.db("o_canvasEdge").where({ projectId, id }).first();
    await u.db("o_canvasEdge").where({ projectId, id }).delete();
    if (edge) await syncStoryboardAssetLink(String(edge.sourceKey), String(edge.targetKey), "remove");
    res.status(200).send(success({ message: "已删除" }));
  },
);
