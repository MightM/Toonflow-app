import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { CANVAS_ASSET_TYPES, resolveOwner } from "@/lib/canvas";
const router = express.Router();

// 修改节点：名称 / 描述 / 提示词 / 自由节点参数 / 类型标签（人物、场景、道具）
// 资产改类型会连同它的状态一起改（状态必须和根资产同类型）；自由节点的标签存在 params.assetType
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    key: z.string(),
    name: z.string().trim().min(1, "名称不能为空").max(40).optional(),
    describe: z.string().optional(),
    prompt: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    assetType: z.enum(CANVAS_ASSET_TYPES).nullable().optional(),
  }),
  async (req, res) => {
    const { projectId, key, name, describe, prompt, params, assetType } = req.body;
    try {
      const owner = await resolveOwner(projectId, key);
      const pick = <T extends object>(obj: T) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
      if (owner.kind === "asset") {
        const patch = pick({ name, describe, prompt });
        if (Object.keys(patch).length) await u.db("o_assets").where("id", owner.id).update(patch);
        if (assetType === null) return res.status(400).send(error("资产必须有类型"));
        if (assetType) {
          const rootId = owner.asset!.assetsId ?? owner.id;
          await u
            .db("o_assets")
            .where("projectId", projectId)
            .where((qb) => qb.where("id", rootId).orWhere("assetsId", rootId))
            .update({ type: assetType });
        }
      } else {
        const merged = assetType !== undefined ? { ...(params ?? JSON.parse(owner.node!.params || "{}")), assetType } : params;
        const patch = pick({ name, prompt, params: merged ? JSON.stringify(merged) : undefined });
        if (Object.keys(patch).length) await u.db("o_canvasNode").where("id", owner.id).update(patch);
      }
      res.status(200).send(success({ message: "已保存" }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
