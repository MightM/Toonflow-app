import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { resolveOwner } from "@/lib/canvas";
import { assetFamilyIds, moveToTrash, purgeTrash } from "@/lib/canvasTrash";
const router = express.Router();

// 删除节点：自由节点连同版本与连线；资产连同状态资产、版本、连线（已被分镜引用时需 force）。
// 数据先进回收站（返回 trashId，可用 restoreNode 撤销），文件在回收站过期后才删。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    key: z.string(),
    force: z.boolean().optional(),
  }),
  async (req, res) => {
    const { projectId, key, force } = req.body;
    try {
      const owner = await resolveOwner(projectId, key);
      const assetIds = await assetFamilyIds(owner);
      if (assetIds.length && !force) {
        const used = await u.db("o_assets2Storyboard").whereIn("assetId", assetIds).count("assetId as n").first();
        if (Number((used as { n?: number } | undefined)?.n ?? 0) > 0) {
          return res.status(409).send(error("该资产（或其状态）已被分镜引用，确认删除请传 force"));
        }
      }
      const { trashId, keys } = await moveToTrash(projectId, key, owner);
      await purgeTrash(projectId);
      res.status(200).send(success({ removed: keys, trashId }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
