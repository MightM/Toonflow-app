import express from "express";
import { z } from "zod";
import u from "@/utils";
import { db as knexDb } from "@/utils/db";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 调整某个节点的参考顺序（决定 @图N 编号与发给模型的参考图顺序）
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    targetKey: z.string(),
    ids: z.array(z.number()),
  }),
  async (req, res) => {
    const { projectId, targetKey, ids } = req.body;
    const rows = await u.db("o_canvasEdge").where({ projectId, targetKey }).select("id");
    const owned = new Set(rows.map((r) => r.id));
    if (ids.length !== owned.size || ids.some((id: number) => !owned.has(id))) return res.status(400).send(error("连线列表与当前参考不一致"));
    await knexDb.transaction(async (trx) => {
      for (const [sort, id] of ids.entries()) await trx("o_canvasEdge").where({ id }).update({ sort });
    });
    res.status(200).send(success({ message: "已调整顺序" }));
  },
);
