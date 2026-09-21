import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetKey, CANVAS_ASSET_TYPES, readLayout, writeLayout } from "@/lib/canvas";
const router = express.Router();

// 在画布上新建根资产（角色 / 场景 / 道具）。按集筛选时关联到当前集，保证新资产留在画布上。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    type: z.enum(CANVAS_ASSET_TYPES),
    name: z.string().min(1),
    describe: z.string().optional(),
    scriptId: z.number().optional().nullable(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
  }),
  async (req, res) => {
    const { projectId, type, name, describe, scriptId, position } = req.body;
    const [id] = await u.db("o_assets").insert({
      name,
      describe: describe ?? "",
      prompt: "",
      type,
      projectId,
      scriptId: scriptId ?? null,
      startTime: Date.now(),
    });
    if (scriptId) await u.db("o_scriptAssets").insert({ scriptId, assetId: id });
    if (position) {
      const layout = await readLayout(projectId);
      await writeLayout(projectId, { ...layout, positions: { ...layout.positions, [assetKey(id)]: position } });
    }
    res.status(200).send(success({ key: assetKey(id), id }));
  },
);
