import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { prepareAssetStage } from "@/lib/assetGen";

const router = express.Router();

// ─── 生成资产图片（旧资产页，同步返回） ──────────────────────────
// 角色一步生成多视图；弹窗上传的参考图会作为身份参考（走「有参考图」的绑定）。
// stage 参数是上一版两步流程留下的，保留只为兼容旧前端，已忽略。

const requestSchema = {
  projectId: z.number(),
  model: z.string(),
  resolution: z.string(),
  id: z.number(),
  type: z.enum(["role", "scene", "tool", "storyboard"]),
  name: z.string(),
  prompt: z.string(),
  base64: z.string().optional().nullable(),
  stage: z.string().optional().nullable(),
  aspectRatio: z
    .string()
    .regex(/^\d+:\d+$/)
    .optional()
    .nullable(),
};

export default router.post("/", validateFields(requestSchema), async (req, res) => {
  const { projectId, model, resolution, id, type, prompt, base64, aspectRatio } = req.body;
  if (type === "storyboard") return res.status(400).send(error("不支持的类型"));

  const project = await u.db("o_project").where("id", projectId).select("id").first();
  if (!project) return res.status(500).send(error("项目为空"));
  await u.db("o_assets").where("id", id).update({ prompt });

  try {
    const prepared = await prepareAssetStage({
      projectId,
      assetId: id,
      model,
      size: resolution,
      aspectRatio: aspectRatio ?? undefined,
      prompt,
      referenceBase64: base64 ? [base64] : [],
      earlyRepoint: true,
    });
    const result = await prepared.run();
    if (!result.ok) return res.status(400).send(error(result.error || "图片生成失败"));
    const path = await u.oss.getSmallImageUrl(result.filePath!);
    return res.status(200).send(success({ path, assetsId: id, imageId: prepared.imageId }));
  } catch (e) {
    return res.status(400).send(error(u.error(e).message || "图片生成失败"));
  }
});
