import u from "@/utils";
import { incomingEdges, storyboardKey } from "@/lib/canvas";
import { hasDialogue, pickModel, type RefShape } from "@/lib/modelLadder";

// ─── 自动选模型：查库拼出参考形状，再交给 modelLadder 的纯函数定夺 ─────────
// 规则本身在 lib/modelLadder.ts（纯函数、可单测），这里只负责取数。

const EMPTY: RefShape = { frames: 0, scenes: 0, subjects: 0, voices: 0, shots: 0 };

/** 这个供应商在这台机器上实际列出来的模型名（工作流缺失时不该选中它） */
async function availableModels(configured: string | null | undefined, type: "image" | "video"): Promise<string[]> {
  const vendorId = (configured ?? "").split(/:(.+)/)[0];
  if (!vendorId) return [];
  try {
    const models = await u.vendor.getModelList(vendorId);
    return models.filter((m: { type?: string }) => m.type === type).map((m: { modelName: string }) => m.modelName);
  } catch {
    return [];
  }
}

/** 一条镜头的参考形状：按入边上的资产类型分 */
export async function shotRefShape(projectId: number, storyboardId: number): Promise<RefShape> {
  const edges = await incomingEdges(projectId, storyboardKey(storyboardId));
  if (!edges.length) return { ...EMPTY };
  const assetIds = edges.map((e) => Number(/^a:(\d+)$/.exec(String(e.sourceKey))?.[1] ?? 0)).filter(Boolean);
  const types = new Map<number, string>(
    assetIds.length ? (await u.db("o_assets").whereIn("id", assetIds).select("id", "type")).map((a) => [a.id!, a.type ?? ""]) : [],
  );
  const shape: RefShape = { ...EMPTY };
  for (const edge of edges) {
    const key = String(edge.sourceKey);
    if (key.startsWith("s:")) shape.frames += 1;
    else if (types.get(Number(/^a:(\d+)$/.exec(key)?.[1] ?? 0)) === "scene") shape.scenes += 1;
    else shape.subjects += 1;
  }
  return shape;
}

/** 镜头出图用哪个模型；选不出来时返回 null，由调用方沿用原有回落 */
export async function autoImageModel(projectId: number, storyboardId: number): Promise<{ model: string; auto: boolean; reason: string } | null> {
  const project = await u.db("o_project").where("id", projectId).select("imageModel").first();
  const picked = pickModel("image", await shotRefShape(projectId, storyboardId), await availableModels(project?.imageModel, "image"), project?.imageModel);
  return picked.auto ? picked : null;
}

/**
 * 片段出视频用哪个模型。形状里真正起作用的是「有没有台词」和「是不是多镜」：
 * 有台词就必须走带 @audio 槽位的多参考模式，否则音色会被适配器静默丢掉。
 */
export async function trackRefShape(projectId: number, trackId: number, voiceCount: number): Promise<RefShape> {
  const shots = await u.db("o_storyboard").where({ trackId, projectId }).select("id", "videoDesc", "imageId");
  const frames = shots.filter((s) => !!s.imageId).length;
  return {
    frames,
    scenes: 0,
    subjects: 0,
    // 音色只有在这一段真有人说话时才有意义；没人说话就别为此升级模型
    voices: shots.some((s) => hasDialogue(s.videoDesc)) ? voiceCount : 0,
    shots: shots.length,
  };
}

export async function autoVideoModel(projectId: number, trackId: number, voiceCount: number): Promise<{ model: string; auto: boolean; reason: string } | null> {
  const project = await u.db("o_project").where("id", projectId).select("videoModel").first();
  const shape = await trackRefShape(projectId, trackId, voiceCount);
  const picked = pickModel("video", shape, await availableModels(project?.videoModel, "video"), project?.videoModel);
  return picked.auto ? picked : null;
}
