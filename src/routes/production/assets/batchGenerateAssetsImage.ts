import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { AssetType, getPolishManual, PreparedStage, prepareAssetStage } from "@/lib/assetGen";
const router = express.Router();

// 生产 Agent 的衍生资产生图：先按衍生视觉手册写提示词，再按「资产模型绑定」生成。
// 角色一步生成多视图；参考图 = 父资产当前图。
export default router.post(
  "/",
  validateFields({
    assetIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
    concurrentCount: z.number().min(1).optional(),
  }),
  async (req, res) => {
    const { assetIds, projectId, concurrentCount = 5 } = req.body;

    const project = await u.db("o_project").where("id", projectId).select("imageQuality", "artStyle").first();
    const artStyle = project?.artStyle ?? "";
    const size = (project?.imageQuality ?? "1K") as "1K" | "2K" | "4K";

    const assets = await u.db("o_assets").whereIn("id", assetIds).select("id", "describe", "name", "type", "assetsId");
    const parentIds = assets.map((item) => item.assetsId).filter((id): id is number => id != null);
    const parents = await u.db("o_assets").whereIn("id", parentIds).select("id", "describe");
    const parentDescribe = new Map(parents.map((p) => [p.id, p.describe]));

    const writePrompt = async (asset: (typeof assets)[number]) => {
      const isDerived = asset.assetsId != null;
      const { text } = await u.Ai.Text("universalAi").invoke({
        system: getPolishManual(artStyle, asset.type as AssetType, isDerived),
        messages: [
          {
            role: "user",
            content: `
            父级资产描述: ${(asset.assetsId && parentDescribe.get(asset.assetsId)) || "无详细描述"}
            当前资产描述: ${asset.describe || "无详细描述"}`,
          },
        ],
      });
      return text;
    };

    // 先同步插入占位（前端靠 imageId 轮询），提示词在执行时再让 LLM 写
    const prepared: { asset: (typeof assets)[number]; stage: PreparedStage }[] = [];
    for (const asset of assets) {
      try {
        const stage = await prepareAssetStage({
          projectId,
          assetId: asset.id!,
          size,
          // 角色：LLM 只写【人物需求】正文，由模板补上固定输出格式；场景 / 道具沿用原样发送
          rawPrompt: asset.type !== "role",
          earlyRepoint: true,
          resolvePrompt: () => writePrompt(asset),
        });
        prepared.push({ asset, stage });
      } catch (e) {
        console.error("[衍生资产生图] 准备失败", asset.id, u.error(e).message);
      }
    }
    res.status(200).send(success("开始生成资产图片"));

    const generateOne = ({ stage }: (typeof prepared)[number]) => stage.run();

    for (let i = 0; i < prepared.length; i += concurrentCount) {
      await Promise.all(prepared.slice(i, i + concurrentCount).map(generateOne));
    }
  },
);
