import express from "express";
import { z } from "zod";
import u from "@/utils";
import { db as knexDb } from "@/utils/db";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetKey, nodeKey, renameKey, resolveOwner } from "@/lib/canvas";
const router = express.Router();

// 存入资产库：把自由图片节点转成正式资产（可挂到某个根资产下作为状态），版本历史与连线一并迁移
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    nodeId: z.number(),
    type: z.enum(["role", "scene", "tool"]),
    name: z.string().min(1),
    describe: z.string().optional(),
    parentAssetId: z.number().optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, nodeId, type, name, describe, parentAssetId } = req.body;
    try {
      const owner = await resolveOwner(projectId, nodeKey(nodeId));
      if (owner.node!.kind !== "image") return res.status(400).send(error("只有图片节点可以存入资产库"));
      if (!owner.node!.imageId) return res.status(400).send(error("节点还没有图片"));
      let rootId: number | null = null;
      let assetType = type;
      if (parentAssetId) {
        const parent = await resolveOwner(projectId, assetKey(parentAssetId));
        rootId = parent.asset!.assetsId ?? parent.asset!.id!;
        const root = await u.db("o_assets").where("id", rootId).select("type").first();
        assetType = (root?.type as typeof type) ?? type;
      }
      const assetId = await knexDb.transaction(async (trx) => {
        const [id] = await trx("o_assets").insert({
          name,
          describe: describe ?? "",
          prompt: owner.node!.prompt ?? "",
          type: assetType,
          projectId,
          assetsId: rootId,
          imageId: owner.node!.imageId,
          startTime: Date.now(),
        });
        await trx("o_image").where("canvasNodeId", nodeId).update({ assetsId: id, canvasNodeId: null, type: assetType });
        if (rootId) {
          const links = await trx("o_scriptAssets").where("assetId", rootId).select("scriptId");
          if (links.length) await trx("o_scriptAssets").insert(links.map((l) => ({ scriptId: l.scriptId, assetId: id })));
        }
        await trx("o_canvasNode").where("id", nodeId).delete();
        return id;
      });
      await renameKey(projectId, nodeKey(nodeId), assetKey(assetId));
      res.status(200).send(success({ key: assetKey(assetId), id: assetId }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
