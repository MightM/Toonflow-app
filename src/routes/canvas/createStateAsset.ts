import express from "express";
import { z } from "zod";
import u from "@/utils";
import { db as knexDb } from "@/utils/db";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetKey, readLayout, resolveOwner, writeLayout } from "@/lib/canvas";
const router = express.Router();

// 新建状态资产（换装 / 时段 / 使用状态…）：一律挂在根资产下（assetsId 只有一层），
// 从某个状态再派生时，用参考连线记录「由谁派生」。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    parentKey: z.string(),
    name: z.string().min(1),
    describe: z.string().optional(),
    prompt: z.string().optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
  }),
  async (req, res) => {
    const { projectId, parentKey, name, describe, prompt, position } = req.body;
    let parent;
    try {
      parent = await resolveOwner(projectId, parentKey);
    } catch (e) {
      return res.status(400).send(error(u.error(e).message));
    }
    if (!parent.asset) return res.status(400).send(error("只能从资产节点派生状态"));
    const rootId = parent.asset.assetsId ?? parent.asset.id!;
    const root = await u.db("o_assets").where("id", rootId).first();
    if (!root) return res.status(400).send(error("根资产不存在"));

    const id = await knexDb.transaction(async (trx) => {
      const [newId] = await trx("o_assets").insert({
        name,
        describe: describe ?? "",
        prompt: prompt ?? "",
        type: root.type,
        projectId,
        assetsId: rootId,
        scriptId: root.scriptId,
        startTime: Date.now(),
      });
      const links = await trx("o_scriptAssets").where("assetId", rootId).select("scriptId");
      if (links.length) await trx("o_scriptAssets").insert(links.map((l) => ({ scriptId: l.scriptId, assetId: newId })));
      if (parent.asset!.id !== rootId) {
        await trx("o_canvasEdge").insert({ projectId, sourceKey: parentKey, targetKey: assetKey(newId), sort: 0, createTime: Date.now() });
      }
      return newId;
    });
    if (position) {
      const layout = await readLayout(projectId);
      await writeLayout(projectId, { ...layout, positions: { ...layout.positions, [assetKey(id)]: position } });
    }
    res.status(200).send(success({ key: assetKey(id), id, rootKey: assetKey(rootId) }));
  },
);
