import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getAssetModels, getGlobalAssetModels } from "@/lib/assetGen";
const router = express.Router();

// 读取资产模型绑定：不传 projectId 返回全局默认；传了返回合并后的结果和项目自己的覆盖项
export default router.post(
  "/",
  validateFields({
    projectId: z.number().optional().nullable(),
  }),
  async (req, res) => {
    const { projectId } = req.body;
    const globalModels = await getGlobalAssetModels();
    if (!projectId) return res.status(200).send(success({ global: globalModels }));
    const project = await u.db("o_project").where("id", projectId).select("assetModels").first();
    let override: unknown = {};
    try {
      override = project?.assetModels ? JSON.parse(project.assetModels) : {};
    } catch {
      override = {};
    }
    return res.status(200).send(success({ global: globalModels, project: override, effective: await getAssetModels(projectId) }));
  },
);
