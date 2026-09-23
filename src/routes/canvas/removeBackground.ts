import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { resolveOwner } from "@/lib/canvas";
import { enqueue } from "@/lib/genQueue";
import { prepareAssetStage } from "@/lib/assetGen";
import { prepareNodeImage } from "@/lib/canvasNodeImage";
import { getModelList } from "@/utils/vendor";
const router = express.Router();

const RMBG_MODEL = "rmbg";

// 一键去背景：把节点当前图交给供应商的 rmbg 工作流（ComfyUI rembg，白底 + 透明 PNG），
// 结果按普通生成任务排队、轮询，成功后成为该节点的新版本，原图留在历史里。
// 不走 generateImage：它要求提示词 / 模板 / 参考边，这里参考就是节点自己，提示词为空。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    key: z.string(),
  }),
  async (req, res) => {
    const { projectId, key } = req.body;
    try {
      const owner = await resolveOwner(projectId, key);
      if (owner.storyboard || owner.track) return res.status(400).send(error("镜头 / 片段不支持去背景，先截帧或另存为图片节点"));
      if (owner.node && owner.node.kind !== "image") return res.status(400).send(error("只有图片节点能去背景"));
      const imageId = owner.node?.imageId ?? owner.asset?.imageId;
      const current = imageId ? await u.db("o_image").where({ id: imageId, state: "已完成" }).select("filePath", "aspectRatio").first() : undefined;
      if (!current?.filePath) return res.status(400).send(error("这个节点还没有图片"));

      const vendorId = await findRmbgVendor(projectId);
      if (!vendorId) return res.status(400).send(error("当前供应商没有去背景工作流（需要 ComfyUI 适配器 1.9+ 与 workflows/api/rmbg.json）"));
      const base64 = await u.oss.getImageBase64(current.filePath);
      const common = {
        projectId,
        model: `${vendorId}:${RMBG_MODEL}`,
        size: "1K" as const,
        aspectRatio: (current.aspectRatio ?? "1:1") as `${number}:${number}`,
        prompt: "",
        referenceBase64: [base64],
        refKeys: [key],
        stage: RMBG_MODEL,
        outputExt: "png" as const,
      };
      const job = owner.asset
        ? await prepareAssetStage({ ...common, assetId: owner.id, rawPrompt: true })
        : await prepareNodeImage({ ...common, nodeId: owner.id, nodeName: owner.node?.name ?? "" });
      enqueue(job.imageId, "image", job.run);
      return res.status(200).send(success({ imageId: job.imageId }));
    } catch (e) {
      if (!res.headersSent) res.status(400).send(error(u.error(e).message));
    }
  },
);

/** 找到声明了 rmbg 模型的已启用供应商：优先项目分镜模型所在的供应商，其次任意一个 */
async function findRmbgVendor(projectId: number): Promise<string | null> {
  const project = await u.db("o_project").where("id", projectId).select("imageModel").first();
  const preferred = project?.imageModel?.split(/:(.+)/)[0];
  const vendors = await u.db("o_vendorConfig").where("enable", 1).select("id");
  const ids = [...new Set([preferred, ...vendors.map((v) => v.id)].filter((id): id is string => !!id))];
  for (const id of ids) {
    try {
      const models = await getModelList(id);
      if (models.some((m) => m.modelName === RMBG_MODEL && m.type === "image")) return id;
    } catch (e) {
      console.warn("[去背景] 读取供应商模型列表失败", id, u.error(e).message);
    }
  }
  return null;
}
