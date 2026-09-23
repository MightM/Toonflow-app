import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetKey, fileUrl, nodeKey } from "@/lib/canvas";
import { purgeTrash, TRASH_TTL, type TrashSnapshot } from "@/lib/canvasTrash";
const router = express.Router();

// 画布回收站：最近 24 小时内删除的节点（先清理过期项），给「回收站」面板列出来，恢复走 restoreNode
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    const { projectId } = req.body;
    await purgeTrash(projectId);
    const rows = await u.db("o_canvasTrash").where("projectId", projectId).orderBy("createTime", "desc").select("id", "key", "createTime", "snapshot");
    const list = await Promise.all(
      rows.map(async (row) => {
        const snap = JSON.parse(row.snapshot) as TrashSnapshot;
        const asset = snap.assets.find((a) => assetKey(a.id!) === row.key) ?? snap.assets[0];
        const node = snap.nodes.find((n) => nodeKey(n.id!) === row.key) ?? snap.nodes[0];
        const done = snap.images.filter((i) => i.state === "已完成" && i.filePath);
        const current = done.find((i) => i.id === (asset?.imageId ?? node?.imageId)) ?? done[done.length - 1];
        return {
          trashId: row.id,
          key: row.key,
          name: asset?.name ?? node?.name ?? row.key,
          kind: asset ? "asset" : (node?.kind ?? "node"),
          assetType: asset?.type ?? null,
          states: snap.assets.filter((a) => a.assetsId != null).length,
          deletedAt: row.createTime,
          expiresAt: row.createTime + TRASH_TTL,
          src: current?.filePath ? await fileUrl(current.filePath) : null,
        };
      }),
    );
    res.status(200).send(success(list));
  },
);
