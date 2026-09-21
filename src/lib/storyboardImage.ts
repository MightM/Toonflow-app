import u from "@/utils";
import type { PreparedStage } from "@/lib/assetGen";

// ─── 镜头（分镜图）的生图任务 ──────────────────────────────────────
// 与 prepareAssetStage / prepareNodeImage 同一套接口：先插「生成中」占位 o_image，
// 调用方决定同步 await 还是丢后台。只有成功才改 o_storyboard.imageId，
// 所以重生成失败不会把上一版弄丢——这是分镜图原来「覆盖式生成」最大的坑。
// o_storyboard.filePath / state 继续双写，快速预览、宫格预览、剪辑台仍读它们。

export interface StoryboardImageInput {
  projectId: number;
  scriptId: number;
  storyboardId: number;
  model: string; // "vendorId:modelName"
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
  prompt: string;
  referenceBase64?: string[];
  resolveReferences?: () => Promise<string[]>;
  refKeys?: string[];
  setCurrent?: boolean; // false = 只进历史，不设为该镜当前图
}

export async function prepareStoryboardImage(input: StoryboardImageInput): Promise<PreparedStage> {
  const [imageId] = await u.db("o_image").insert({
    type: "storyboard",
    state: "生成中",
    storyboardId: input.storyboardId,
    model: input.model.split(/:(.+)/)[1],
    resolution: input.size,
    aspectRatio: input.aspectRatio,
    prompt: input.prompt,
    kind: "image",
    refs: input.refKeys?.length ? JSON.stringify(input.refKeys) : null,
    createTime: Date.now(),
  });
  const setCurrent = input.setCurrent !== false;
  if (setCurrent) await u.db("o_storyboard").where("id", input.storyboardId).update({ state: "生成中", reason: null });

  const run = async () => {
    const filePath = `/${input.projectId}/assets/${input.scriptId}/${u.uuid()}.jpg`;
    try {
      const referenceList = [...(input.referenceBase64 ?? []), ...(input.resolveReferences ? await input.resolveReferences() : [])]
        .filter(Boolean)
        .map((base64) => ({ type: "image" as const, base64 }));
      const ai = u.Ai.Image(input.model as `${string}:${string}`);
      await ai.run(
        { prompt: input.prompt, referenceList, size: input.size, aspectRatio: input.aspectRatio },
        {
          taskClass: "生成分镜图片",
          describe: `分镜图：${input.storyboardId}`,
          projectId: input.projectId,
          relatedObjects: JSON.stringify({ projectId: input.projectId, scriptId: input.scriptId, storyboardId: input.storyboardId }),
        },
      );
      const current = await u.db("o_image").where("id", imageId).select("state").first();
      if (!current) return { ok: false, error: "镜头已被删除" };
      if (current.state === "生成失败") return { ok: false, error: "已取消" };
      await ai.save(filePath);
      await u.db("o_image").where("id", imageId).update({ state: "已完成", filePath });
      if (setCurrent) await u.db("o_storyboard").where("id", input.storyboardId).update({ imageId, filePath, state: "已完成", reason: null });
      return { ok: true, filePath };
    } catch (e) {
      const message = u.error(e).message || "分镜图生成失败";
      await u.db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: message });
      // 上一版仍是当前图，只把镜头标成失败，不清空 filePath
      if (setCurrent) await u.db("o_storyboard").where("id", input.storyboardId).update({ state: "生成失败", reason: message });
      return { ok: false, error: message };
    }
  };
  return { imageId, run };
}

/**
 * 保证这些镜头有参考边：没有入边的，按 o_assets2Storyboard 的 rowid 顺序播种一次。
 * 分镜由 Agent 写入时就会播种（batchAddStoryboardInfo），这里是兜底与老数据补齐。
 * 播种后参考就归用户管了——删光也不会被重新塞回来。
 */
export async function ensureStoryboardEdges(projectId: number, storyboardIds: number[]): Promise<void> {
  if (!storyboardIds.length) return;
  const keys = storyboardIds.map((id) => `s:${id}`);
  const existing = new Set((await u.db("o_canvasEdge").where("projectId", projectId).whereIn("targetKey", keys).select("targetKey")).map((r) => r.targetKey));
  const missing = storyboardIds.filter((id) => !existing.has(`s:${id}`));
  if (!missing.length) return;
  await seedStoryboardEdges(projectId, missing);
}

/** 按关联资产顺序写入参考边（会先清掉该镜原有入边） */
export async function seedStoryboardEdges(projectId: number, storyboardIds: number[]): Promise<void> {
  if (!storyboardIds.length) return;
  const links = await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).orderBy("rowid").select("storyboardId", "assetId");
  if (!links.length) return;
  await u
    .db("o_canvasEdge")
    .where("projectId", projectId)
    .whereIn(
      "targetKey",
      storyboardIds.map((id) => `s:${id}`),
    )
    .del();
  const sortOf = new Map<number, number>();
  const rows = links.map((link) => {
    const sort = sortOf.get(link.storyboardId!) ?? 0;
    sortOf.set(link.storyboardId!, sort + 1);
    return { projectId, sourceKey: `a:${link.assetId}`, targetKey: `s:${link.storyboardId}`, sort, createTime: Date.now() };
  });
  for (let i = 0; i < rows.length; i += 200) await u.db("o_canvasEdge").insert(rows.slice(i, i + 200));
}

/** 删镜头时一并清掉版本记录和参考边（含别的镜头把它当参考的那些边） */
export async function cleanupStoryboards(storyboardIds: number[]): Promise<void> {
  if (!storyboardIds.length) return;
  const keys = storyboardIds.map((id) => `s:${id}`);
  await u.db("o_image").whereIn("storyboardId", storyboardIds).del();
  await u.db("o_canvasEdge").where((qb) => qb.whereIn("targetKey", keys).orWhereIn("sourceKey", keys)).del();
}

/**
 * 镜头的参考连线同时是「这一镜涉及哪些资产」的语义记录（o_assets2Storyboard）。
 * 片段视频的音色参考、分镜表里的关联资产清单都读它，不跟着同步的话，
 * 用户在素材板上加完人、删完人，音色和资产清单还停在 Agent 最初拆出来的那一版。
 */
export async function syncStoryboardAssetLink(sourceKey: string, targetKey: string, action: "add" | "remove"): Promise<void> {
  const shot = /^s:(\d+)$/.exec(String(targetKey));
  const asset = /^a:(\d+)$/.exec(String(sourceKey));
  if (!shot || !asset) return; // 只有「资产 → 镜头」这一种连线对应得上
  const storyboardId = Number(shot[1]);
  const assetId = Number(asset[1]);
  if (action === "remove") {
    await u.db("o_assets2Storyboard").where({ storyboardId, assetId }).del();
    return;
  }
  const exists = await u.db("o_assets2Storyboard").where({ storyboardId, assetId }).first();
  if (!exists) await u.db("o_assets2Storyboard").insert({ storyboardId, assetId });
}
