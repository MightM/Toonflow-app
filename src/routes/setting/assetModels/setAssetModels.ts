import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ASSET_MODEL_KEYS, GLOBAL_DEFAULT_SETTING_KEY, getAssetModels, getGlobalAssetModels } from "@/lib/assetGen";
const router = express.Router();

const bindingSchema = z.object({
  model: z.string().refine((v) => v === "" || /^[^:]+:.+$/.test(v), "模型格式应为 vendorId:modelName"),
  aspectRatio: z.string().regex(/^\d+:\d+$/, "比例格式应为 W:H"),
});
const bindingsSchema = z.object(Object.fromEntries(ASSET_MODEL_KEYS.map((key) => [key, bindingSchema.optional()]))).strict();

// 保存资产模型绑定：不传 projectId 写全局默认（o_setting），传了写项目覆盖（o_project.assetModels）
export default router.post(
  "/",
  validateFields({
    projectId: z.number().optional().nullable(),
    models: bindingsSchema,
  }),
  async (req, res) => {
    const { projectId, models } = req.body;
    const value = JSON.stringify(models);
    if (!projectId) {
      const exists = await u.db("o_setting").where("key", GLOBAL_DEFAULT_SETTING_KEY).first();
      if (exists) await u.db("o_setting").where("key", GLOBAL_DEFAULT_SETTING_KEY).update({ value });
      else await u.db("o_setting").insert({ key: GLOBAL_DEFAULT_SETTING_KEY, value });
      return res.status(200).send(success({ global: await getGlobalAssetModels() }));
    }
    const updated = await u.db("o_project").where("id", projectId).update({ assetModels: value });
    if (!updated) return res.status(404).send(error("项目不存在"));
    return res.status(200).send(success({ effective: await getAssetModels(projectId) }));
  },
);
