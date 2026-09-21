import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { restoreFromTrash } from "@/lib/canvasTrash";
const router = express.Router();

// 撤销删除：按回收站快照写回节点、版本、连线、分镜 / 剧本 / 音色关联和布局
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    trashId: z.number(),
  }),
  async (req, res) => {
    const { projectId, trashId } = req.body;
    try {
      res.status(200).send(success(await restoreFromTrash(projectId, trashId)));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
