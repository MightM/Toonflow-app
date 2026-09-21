import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { resolveOwner } from "@/lib/canvas";
import { syncStoryboardAssetLink } from "@/lib/storyboardImage";
const router = express.Router();

// 新增参考连线：source 作为 target 的参考素材，排在已有参考之后
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    sourceKey: z.string(),
    targetKey: z.string(),
  }),
  async (req, res) => {
    const { projectId, sourceKey, targetKey } = req.body;
    if (sourceKey === targetKey) return res.status(400).send(error("不能连接到自身"));
    try {
      const [source, target] = await Promise.all([resolveOwner(projectId, sourceKey), resolveOwner(projectId, targetKey)]);
      if (target.asset && target.asset.assetsId === source.id && source.kind === "asset") {
        return res.status(400).send(error("父资产已自动作为参考，无需连线"));
      }
    } catch (e) {
      return res.status(400).send(error(u.error(e).message));
    }
    const exists = await u.db("o_canvasEdge").where({ projectId, sourceKey, targetKey }).first();
    if (exists) return res.status(400).send(error("连线已存在"));
    const last = await u.db("o_canvasEdge").where({ projectId, targetKey }).max("sort as sort").first();
    const sort = Number((last as { sort?: number } | undefined)?.sort ?? -1) + 1;
    const [id] = await u.db("o_canvasEdge").insert({ projectId, sourceKey, targetKey, sort, createTime: Date.now() });
    await syncStoryboardAssetLink(sourceKey, targetKey, "add");
    res.status(200).send(success({ id, sourceKey, targetKey, sort }));
  },
);
