import { v4 as uuidv4 } from "uuid";
import u from "@/utils";
import type { PreparedStage } from "@/lib/assetGen";

// ─── 画布自由图片节点的生图任务（与资产节点的 prepareAssetStage 同一套接口） ─────────

export interface NodeImageInput {
  projectId: number;
  nodeId: number;
  nodeName: string;
  model: string; // "vendorId:modelName"
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
  prompt: string; // 最终发送的提示词
  referenceBase64?: string[];
  resolveReferences?: () => Promise<string[]>; // 执行时才取的参考图（如工作流上一步的产物）
  refKeys?: string[];
  stage?: string | null;
  setCurrent?: boolean; // false = 只留在历史里，不设为节点当前图
  outputExt?: "jpg" | "png"; // 落盘扩展名；透明结果（去背景）要 png，否则缩略图会丢 alpha、MIME 也会报成 jpeg
}

export async function prepareNodeImage(input: NodeImageInput): Promise<PreparedStage> {
  const [imageId] = await u.db("o_image").insert({
    type: "canvas",
    state: "生成中",
    canvasNodeId: input.nodeId,
    model: input.model.split(/:(.+)/)[1],
    resolution: input.size,
    aspectRatio: input.aspectRatio,
    prompt: input.prompt,
    kind: "image",
    stage: input.stage ?? null,
    refs: input.refKeys?.length ? JSON.stringify(input.refKeys) : null,
    createTime: Date.now(),
  });
  const run = async () => {
    const filePath = `/${input.projectId}/canvas/${uuidv4()}.${input.outputExt ?? "jpg"}`;
    try {
      const referenceList = [...(input.referenceBase64 ?? []), ...(input.resolveReferences ? await input.resolveReferences() : [])]
        .filter(Boolean)
        .map((base64) => ({ type: "image" as const, base64 }));
      const ai = u.Ai.Image(input.model as `${string}:${string}`);
      await ai.run(
        { prompt: input.prompt, referenceList, size: input.size, aspectRatio: input.aspectRatio },
        {
          taskClass: "画布图片生成",
          describe: `画布图片节点：${input.nodeName}`,
          projectId: input.projectId,
          relatedObjects: JSON.stringify({ projectId: input.projectId, canvasNodeId: input.nodeId }),
        },
      );
      const current = await u.db("o_image").where("id", imageId).select("state").first();
      if (!current) return { ok: false, error: "节点已被删除" };
      if (current.state === "生成失败") return { ok: false, error: "已取消" };
      await ai.save(filePath);
      await u.db("o_image").where("id", imageId).update({ state: "已完成", filePath });
      if (input.setCurrent !== false) await u.db("o_canvasNode").where("id", input.nodeId).update({ imageId });
      return { ok: true, filePath };
    } catch (e) {
      const message = u.error(e).message || "图片生成失败";
      await u.db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: message });
      return { ok: false, error: message };
    }
  };
  return { imageId, run };
}
