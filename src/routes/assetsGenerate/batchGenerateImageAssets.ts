import express from "express";
import pLimit from "p-limit";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { AssetType, bindingKeyFor, getAssetModels, PreparedStage, prepareAssetStage } from "@/lib/assetGen";

const router = express.Router();

// 批量生成资产图片：先同步插入全部占位（旧前端靠 imageId 轮询），再后台并发执行。
// 角色一步生成多视图。已配置资产模型绑定的类型优先用绑定，未配置才用请求里的 model。
const requestSchema = {
  projectId: z.number(),
  model: z.string(),
  resolution: z.string(),
  concurrentCount: z.number().int().min(1).optional(),
  aspectRatio: z
    .string()
    .regex(/^\d+:\d+$/)
    .optional()
    .nullable(),
  items: z.array(
    z.object({
      id: z.number(),
      type: z.enum(["role", "scene", "tool", "storyboard"]),
      name: z.string(),
      prompt: z.string(),
      base64: z.string().optional().nullable(),
    }),
  ),
};

type Item = { id: number; type: string; name: string; prompt: string; base64?: string | null };

export default router.post("/", validateFields(requestSchema), async (req, res) => {
  const { projectId, model, resolution, concurrentCount, aspectRatio, items } = req.body as {
    projectId: number;
    model: string;
    resolution: string;
    concurrentCount?: number;
    aspectRatio?: `${number}:${number}` | null;
    items: Item[];
  };

  const project = await u.db("o_project").where("id", projectId).select("id").first();
  if (!project) return res.status(500).send(error("项目为空"));

  const size = resolution as "1K" | "2K" | "4K";
  const bindings = await getAssetModels(projectId);
  const modelFor = async (assetId: number, type: string, hasRefs: boolean) => {
    const asset = await u.db("o_assets").where("id", assetId).select("assetsId").first();
    const key = bindingKeyFor(type as AssetType, asset?.assetsId != null, hasRefs);
    return bindings[key].model || model;
  };
  const prepared: { item: Item; stage: PreparedStage }[] = [];
  const failed: { id: number; error: string }[] = [];
  for (const item of items) {
    if (item.type === "storyboard") continue;
    try {
      await u.db("o_assets").where("id", item.id).update({ prompt: item.prompt });
      const stage = await prepareAssetStage({
        projectId,
        assetId: item.id,
        model: await modelFor(item.id, item.type, !!item.base64),
        size,
        aspectRatio: aspectRatio ?? undefined,
        prompt: item.prompt,
        referenceBase64: item.base64 ? [item.base64] : [],
        earlyRepoint: true,
      });
      prepared.push({ item, stage });
    } catch (e) {
      failed.push({ id: item.id, error: u.error(e).message });
    }
  }

  const limit = pLimit(concurrentCount ?? 1);
  const tasks = prepared.map(({ stage }) =>
    limit(() => stage.run()),
  );
  Promise.all(tasks).catch((e) => console.error("[批量生成资产图片]", u.error(e).message));

  return res.status(200).send(success({ total: prepared.length, failed }));
});
