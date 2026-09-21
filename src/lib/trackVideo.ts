import u from "@/utils";
import { assetKey, resolveRefs, roleVoiceSample, storyboardKey, trackKey, type ResolvedRef } from "@/lib/canvas";
import { buildVideoPrompt, type ShotBrief, type StoryContext } from "@/lib/canvasVideoPrompt";

// ─── 片段（o_videoTrack）的视频参考 ─────────────────────────────
// 参考默认是「推导」出来的，不落库：组内各镜的分镜图 + 这些镜头在「画面描述」页素材板上
// 连入的资产。用户在素材板上加一个角色，视频这边的 <Picture N> 和 <Audio N> 立刻跟着变，
// 不需要再同步一次。只有当片段上真的存在 v: 入边时，才认为用户手动覆盖过，以入边为准。
// 角色音色同样是推导的，不进参考边：生成时按模型的 audioReference 上限现取。

/** 图槽优先级：分镜图（构图锚点，已含场景）→ 角色 → 道具 → 其它 → 场景 */
const GROUP_ORDER = ["role", "tool", "other", "scene"] as const;

/** 组内镜头（按 index） */
async function trackShots(projectId: number, trackId: number) {
  return u
    .db("o_storyboard")
    .where({ trackId, projectId })
    .orderBy([{ column: "index" }, { column: "id" }])
    .select("id", "index", "imageId");
}

/**
 * 还没出图的镜头不能当参考：resolveRefs 找不到文件会直接跳过它，
 * 而界面上照样列了一格，于是后面每个 <Picture N> 的编号都往前挪一位、全对不上。
 * 所以推导时就把它们滤掉，界面看到的编号 = 实际发出去的编号。
 */
async function framedShots(projectId: number, trackId: number) {
  const shots = await trackShots(projectId, trackId);
  const ids = shots.map((s) => s.imageId).filter((id): id is number => !!id);
  if (!ids.length) return [];
  const ready = new Set((await u.db("o_image").whereIn("id", ids).where("state", "已完成").whereNotNull("filePath").select("id")).map((i) => i.id));
  return shots.filter((s) => s.imageId && ready.has(s.imageId));
}

/**
 * 片段涉及的资产：取组内各镜的入边（也就是素材板上那些），按镜头顺序去重，
 * 再按角色 → 道具 → 其它 → 场景 分组。角色单独返回，音色要照这个顺序配。
 */
async function trackAssetRefs(projectId: number, trackId: number): Promise<{ keys: string[]; roleIds: number[] }> {
  const shots = await trackShots(projectId, trackId);
  if (!shots.length) return { keys: [], roleIds: [] };
  const shotKeys = shots.map((s) => storyboardKey(s.id!));
  const rank = new Map<string, number>(shotKeys.map((key, i) => [key, i]));
  const edges = (await u.db("o_canvasEdge").where("projectId", projectId).whereIn("targetKey", shotKeys as string[])).sort(
    (a, b) => (rank.get(String(a.targetKey)) ?? 0) - (rank.get(String(b.targetKey)) ?? 0) || (a.sort ?? 0) - (b.sort ?? 0) || (a.id ?? 0) - (b.id ?? 0),
  );
  // 一次问清所有资产的类型，别在循环里逐个查
  const assetIds = [...new Set(edges.map((e) => /^a:(\d+)$/.exec(String(e.sourceKey))?.[1]).filter(Boolean))].map(Number);
  const typeOf = new Map<number, string>(
    assetIds.length ? (await u.db("o_assets").whereIn("id", assetIds).select("id", "type")).map((a) => [a.id!, a.type ?? ""]) : [],
  );
  const grouped: Record<string, string[]> = { role: [], tool: [], other: [], scene: [] };
  const roleIds: number[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = String(edge.sourceKey);
    if (seen.has(key)) continue;
    seen.add(key);
    const assetId = Number(/^a:(\d+)$/.exec(key)?.[1] ?? 0);
    const type = assetId ? (typeOf.get(assetId) ?? "") : "";
    const group = type === "role" ? "role" : type === "scene" ? "scene" : type === "tool" ? "tool" : "other";
    grouped[group]!.push(key);
    if (group === "role" && assetId) roleIds.push(assetId);
  }
  return { keys: GROUP_ORDER.flatMap((g) => grouped[g]!), roleIds };
}

/** 片段的默认参考：已出图的分镜图在前（构图锚点），资产在后。超出模型上限时由 fitRefsToMode 从尾部截断 */
export async function deriveTrackRefs(projectId: number, trackId: number): Promise<string[]> {
  const shots = await framedShots(projectId, trackId);
  const { keys } = await trackAssetRefs(projectId, trackId);
  return [...shots.map((s) => storyboardKey(s.id!)), ...keys];
}

/**
 * 用户是否手动覆盖过这个片段的参考。
 * 用显式的 o_videoTrack.refMode 而不是「有没有 v: 入边」——老数据里每个片段都被播过边，
 * 而且「用户把参考删光了」和「从来没覆盖过」在边表里长得一模一样，区分不开。
 */
export async function trackRefsOverridden(projectId: number, trackId: number): Promise<boolean> {
  const row = await u.db("o_videoTrack").where({ id: trackId, projectId }).select("refMode").first();
  return row?.refMode === "manual";
}

/**
 * 把当前推导结果落成真实的 v: 入边，之后这个片段不再跟随绘图参考。
 * 前端在视频页签上增删参考前先调它——removeEdge 要 edgeId，推导出来的没有；
 * 而且不先落库的话，加一条参考会让入边只剩那一条，把分镜图全挤掉。
 */
export async function materializeTrackRefs(projectId: number, trackId: number): Promise<void> {
  if (await trackRefsOverridden(projectId, trackId)) return;
  const keys = await deriveTrackRefs(projectId, trackId);
  await u.db("o_canvasEdge").where({ projectId, targetKey: trackKey(trackId) }).del();
  const now = Date.now();
  const rows = keys.map((sourceKey, sort) => ({ projectId, sourceKey, targetKey: trackKey(trackId), sort, createTime: now }));
  for (let i = 0; i < rows.length; i += 200) await u.db("o_canvasEdge").insert(rows.slice(i, i + 200));
  await u.db("o_videoTrack").where({ id: trackId, projectId }).update({ refMode: "manual" });
}

/** 丢掉手动覆盖，回到跟随各镜素材板 */
export async function resetTrackRefs(projectId: number, trackId: number): Promise<void> {
  await u.db("o_canvasEdge").where({ projectId, targetKey: trackKey(trackId) }).del();
  await u.db("o_videoTrack").where({ id: trackId, projectId }).update({ refMode: "auto" });
}

/**
 * 片段里出现的角色的音色样本（去重，顺序与角色图一致）。
 * H3 多参考模式下这些会作为 <Audio N> 传进去，让对白用对音色。
 * 覆盖态下按片段自己的入边取角色，推导态下按组内各镜的素材板取。
 */
export async function trackVoiceRefs(projectId: number, trackId: number): Promise<ResolvedRef[]> {
  const roleIds = (await trackRefsOverridden(projectId, trackId))
    ? await overriddenRoleIds(projectId, trackId)
    : (await trackAssetRefs(projectId, trackId)).roleIds;
  const refs: ResolvedRef[] = [];
  for (const roleId of roleIds) {
    const sample = await roleVoiceSample(roleId);
    if (!sample) continue;
    try {
      refs.push({ key: assetKey(roleId) + "#voice", kind: "audio", base64: await u.oss.getImageBase64(sample) });
    } catch {
      // 音色文件丢了就跳过，不该因此挡住整条视频
    }
  }
  return refs;
}

/**
 * 会作为 <Audio N> 传进去的角色名（不读文件，只给界面显示用）。
 * 音色不出现在参考列表里，用户看不到它们，所以镜头台要单独列一行。
 */
export async function trackVoiceNames(projectId: number, trackId: number): Promise<{ assetId: number; name: string }[]> {
  const roleIds = (await trackRefsOverridden(projectId, trackId))
    ? await overriddenRoleIds(projectId, trackId)
    : (await trackAssetRefs(projectId, trackId)).roleIds;
  const out: { assetId: number; name: string }[] = [];
  for (const roleId of roleIds) {
    if (!(await roleVoiceSample(roleId))) continue;
    const role = await u.db("o_assets").where("id", roleId).select("name").first();
    out.push({ assetId: roleId, name: role?.name ?? `资产 ${roleId}` });
  }
  return out;
}

/** 覆盖态：片段入边里挂着的角色资产 */
async function overriddenRoleIds(projectId: number, trackId: number): Promise<number[]> {
  const edges = await u.db("o_canvasEdge").where({ projectId, targetKey: trackKey(trackId) }).orderBy([{ column: "sort" }, { column: "id" }]);
  const ids = edges.map((e) => Number(/^a:(\d+)$/.exec(String(e.sourceKey))?.[1] ?? 0)).filter(Boolean);
  if (!ids.length) return [];
  const roles = new Set((await u.db("o_assets").whereIn("id", ids).where("type", "role").select("id")).map((a) => a.id!));
  return ids.filter((id) => roles.has(id));
}

/** 片段生成视频时的参考 key：覆盖态用入边，自动态按各镜素材板推导 */
export async function trackRefKeys(projectId: number, trackId: number): Promise<string[]> {
  if (!(await trackRefsOverridden(projectId, trackId))) return deriveTrackRefs(projectId, trackId);
  const edges = await u.db("o_canvasEdge").where({ projectId, targetKey: trackKey(trackId) }).orderBy([{ column: "sort" }, { column: "id" }]);
  return edges.map((e) => e.sourceKey as string);
}

/** 解析片段参考：图 / 视频 + 组内角色的音色 */
export async function resolveTrackRefs(projectId: number, trackId: number, keys?: string[]): Promise<ResolvedRef[]> {
  const refKeys = keys ?? (await trackRefKeys(projectId, trackId));
  const media = await resolveRefs(projectId, refKeys);
  return [...media, ...(await trackVoiceRefs(projectId, trackId))];
}

/**
 * 片段里各镜的画面信息：videoDesc + 分镜图的图像提示词 + 分镜图本身（data URL）。
 * 语言模型原本只拿到 videoDesc 文本，看不到画面，这是第 4 期补上的那块。
 */
export async function shotBriefs(trackId: number): Promise<{ shots: ShotBrief[]; images: string[] }> {
  const rows = await u
    .db("o_storyboard")
    .where("trackId", trackId)
    .orderBy([{ column: "index" }, { column: "id" }])
    .select("id", "index", "videoDesc", "prompt", "duration", "imageId");
  const shots: ShotBrief[] = rows.map((r) => ({
    index: r.index,
    videoDesc: r.videoDesc,
    imagePrompt: r.prompt,
    duration: r.duration,
  }));
  const images: string[] = [];
  for (const row of rows) {
    if (!row.imageId) continue;
    const image = await u.db("o_image").where({ id: row.imageId, state: "已完成" }).select("filePath").first();
    if (!image?.filePath) continue;
    try {
      images.push(await u.oss.getImageBase64(image.filePath));
    } catch {
      // 图文件丢了就只发文字，不该因此挡住优化
    }
  }
  return { shots, images };
}

/**
 * 这一段戏在整集里的位置：整集剧本全文 + 是第几镜 + 前后各两镜的画面描述。
 * 语言模型原本只看得到这一镜的 videoDesc，不知道前因后果，写出来的分镜接不上戏。
 * 图像侧的 polishPreset 早就这么给了，这里补上视频侧。
 */
export async function trackStoryContext(projectId: number, trackId: number): Promise<StoryContext | undefined> {
  const shots = await trackShots(projectId, trackId);
  if (!shots.length) return undefined;
  const track = await u.db("o_videoTrack").where({ id: trackId, projectId }).select("scriptId").first();
  if (!track?.scriptId) return undefined;
  const all = await u
    .db("o_storyboard")
    .where({ scriptId: track.scriptId, projectId })
    .orderBy([{ column: "index" }, { column: "id" }])
    .select("id", "index", "videoDesc");
  const ids = new Set(shots.map((s) => s.id));
  const from = all.findIndex((s) => ids.has(s.id));
  if (from < 0) return undefined;
  const to = all.findLastIndex((s) => ids.has(s.id));
  const desc = (row: { videoDesc?: string | null; index?: number | null }, i: number) => `第 ${(row.index ?? i) + 1} 镜：${(row.videoDesc ?? "").trim().slice(0, 300)}`;
  const script = await u.db("o_script").where("id", track.scriptId).select("name", "content").first();
  return {
    scriptName: script?.name ?? null,
    scriptContent: script?.content ?? null,
    from: from + 1,
    to: to + 1,
    total: all.length,
    before: all.slice(Math.max(0, from - 2), from).map(desc),
    after: all.slice(to + 1, to + 3).map(desc),
  };
}

export interface TrackPromptInput {
  projectId: number;
  trackId: number;
  model: string;
  /** 老分镜台传来的素材列表；不传则用片段自己的参考边 */
  info?: { id: number; sources: string }[];
}

/**
 * 给一个片段生成视频提示词并写回 o_videoTrack.prompt。
 * 镜头台的「优化」走 canvas/polishVideoPrompt（只返回文本、用户确认后再生成），
 * 老分镜台的「生成提示词」走这里（直接落库）。两者用的是同一个 buildVideoPrompt。
 */
export async function generateTrackPrompt(input: TrackPromptInput): Promise<string> {
  const { projectId, trackId, model, info } = input;
  await u.db("o_videoTrack").where("id", trackId).update({ state: "生成中", reason: null });
  try {
    const track = await u.db("o_videoTrack").where({ id: trackId, projectId }).first();
    if (!track) throw new Error("片段不存在");
    // 工作台的 sources 就是节点 key 的另一种写法：storyboard → s:、assets → a:
    const fromInfo = (info ?? []).map((item) => (item.sources === "storyboard" ? storyboardKey(item.id) : assetKey(item.id)));
    const refKeys = fromInfo.length ? fromInfo : await trackRefKeys(projectId, trackId);
    const brief = await shotBriefs(trackId);
    const { text } = await buildVideoPrompt({
      projectId,
      model,
      refKeys,
      extraRefs: await trackVoiceRefs(projectId, trackId),
      text: "",
      duration: Number(track.duration ?? 5),
      aspectRatio: (await u.db("o_project").where("id", projectId).select("videoRatio").first())?.videoRatio ?? "16:9",
      shots: brief.shots,
      shotImages: brief.images,
      story: await trackStoryContext(projectId, trackId),
      segment: track.kind === "segment" || brief.shots.length > 1,
    });
    await u.db("o_videoTrack").where("id", trackId).update({ state: "已完成", prompt: text });
    return text;
  } catch (e) {
    await u.db("o_videoTrack").where("id", trackId).update({ state: "生成失败", reason: u.error(e).message });
    throw e;
  }
}
