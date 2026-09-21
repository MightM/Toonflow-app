import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { readLayout, writeLayout } from "@/lib/canvas";
const router = express.Router();

const point = z.object({ x: z.number(), y: z.number() });

// 保存画布布局：positions / nodeMeta 按 key 合并，pinned / hidden 传了就整体替换
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
    positions: z.record(z.string(), point).optional(),
    nodeMeta: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    pinned: z.array(z.string()).optional(),
    hidden: z.array(z.string()).optional(),
  }),
  async (req, res) => {
    const { projectId, viewport, positions, nodeMeta, pinned, hidden } = req.body;
    const layout = await readLayout(projectId);
    await writeLayout(
      projectId,
      {
        positions: { ...layout.positions, ...(positions ?? {}) },
        nodeMeta: { ...layout.nodeMeta, ...(nodeMeta ?? {}) },
        pinned: pinned ?? layout.pinned,
        hidden: hidden ?? layout.hidden,
      },
      viewport,
    );
    res.status(200).send(success({ message: "已保存" }));
  },
);
