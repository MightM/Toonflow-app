import { v4 as uuidv4 } from "uuid";
import u from "@/utils";
import type { PreparedStage } from "@/lib/assetGen";
import type { TTSConfig } from "@/utils/ai";

// ─── 画布音频节点的文本转语音任务（与 canvasNodeImage 的 prepareNodeImage 同一套接口） ─────────

export interface NodeAudioInput {
  projectId: number;
  nodeId: number;
  nodeName: string;
  model: string; // "vendorId:modelName"
  text: string; // 最终朗读的文本（@文本N 已展开）
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceBase64?: string[]; // 音色参考（连入的音频节点）
  refKeys?: string[];
}

export async function prepareNodeAudio(input: NodeAudioInput): Promise<PreparedStage> {
  const [imageId] = await u.db("o_image").insert({
    type: "canvas",
    state: "生成中",
    canvasNodeId: input.nodeId,
    model: input.model.split(/:(.+)/)[1],
    prompt: input.text,
    kind: "audio",
    refs: input.refKeys?.length ? JSON.stringify(input.refKeys) : null,
    createTime: Date.now(),
  });
  const run = async () => {
    const filePath = `/${input.projectId}/canvas/${uuidv4()}.mp3`;
    try {
      const config: TTSConfig = {
        text: input.text,
        voice: input.voice,
        speechRate: input.speechRate,
        pitchRate: input.pitchRate,
        volume: input.volume,
        referenceList: (input.referenceBase64 ?? []).filter(Boolean).map((base64) => ({ type: "audio" as const, base64 })),
      };
      const ai = u.Ai.Audio(input.model as `${string}:${string}`);
      await ai.run(config, {
        taskClass: "画布语音生成",
        describe: `画布音频节点：${input.nodeName}`,
        projectId: input.projectId,
        relatedObjects: JSON.stringify({ projectId: input.projectId, canvasNodeId: input.nodeId }),
      });
      const current = await u.db("o_image").where("id", imageId).select("state").first();
      if (!current) return { ok: false, error: "节点已被删除" };
      if (current.state === "生成失败") return { ok: false, error: "已取消" };
      await ai.save(filePath);
      await u.db("o_image").where("id", imageId).update({ state: "已完成", filePath });
      await u.db("o_canvasNode").where("id", input.nodeId).update({ imageId });
      return { ok: true, filePath };
    } catch (e) {
      const message = u.error(e).message || "语音生成失败";
      await u.db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: message });
      return { ok: false, error: message };
    }
  };
  return { imageId, run };
}
