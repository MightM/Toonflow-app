import u from "@/utils";
import type { ReferenceList } from "@/utils/ai";

// ─── 资产画布：节点 key、归属校验、参考图解析 ─────────────────────
// 节点 key：a:<o_assets.id>（资产 / 状态资产）、n:<o_canvasNode.id>（自由图片/视频节点）、
//          s:<o_storyboard.id>（镜头）、v:<o_videoTrack.id>（片段）
// 镜头与片段共用这套参考边、版本链与生成管线，所以镜头台直接调 /api/canvas/*。

export type NodeKey = `a:${number}` | `n:${number}` | `s:${number}` | `v:${number}`;
export type OwnerKind = "asset" | "node" | "storyboard" | "track";

export interface Owner {
  kind: OwnerKind;
  id: number;
  key: NodeKey;
}

export const CANVAS_ASSET_TYPES = ["role", "scene", "tool"] as const;
export type CanvasAssetType = (typeof CANVAS_ASSET_TYPES)[number];

/** 图1 单独占一位的工作流：krea2_dual / krea2_multi 的图1 走场景位，图2 起走主体位
 *  （multi 还会把图2~5 横向拼成一张）。有场景时排到图1 效果最好，没场景时任意图也能合 */
export const SCENE_FIRST_MODELS = ["krea2_dual", "krea2_multi"];
export const isSceneFirstModel = (model: string | null | undefined) => !!model && SCENE_FIRST_MODELS.includes(model.split(/:(.+)/)[1] ?? model);

/** 自由节点的类型标签存在 params.assetType（人物 / 场景 / 道具，未标注为 null） */
export function nodeAssetType(params: string | null | undefined): CanvasAssetType | null {
  try {
    const value = params ? JSON.parse(params).assetType : null;
    return (CANVAS_ASSET_TYPES as readonly string[]).includes(value) ? value : null;
  } catch {
    return null;
  }
}

/** 参考节点的类型：资产取 o_assets.type，自由节点取类型标签；镜头 / 片段没有类型 */
export async function refAssetType(projectId: number, key: string): Promise<CanvasAssetType | null> {
  const owner = await resolveOwner(projectId, key);
  if (owner.asset) return (CANVAS_ASSET_TYPES as readonly string[]).includes(owner.asset.type ?? "") ? (owner.asset.type as CanvasAssetType) : null;
  if (!owner.node) return null;
  return nodeAssetType(owner.node.params);
}

/** 场景参考排到最前（其余保持原顺序） */
export async function sceneFirst(projectId: number, keys: string[]): Promise<string[]> {
  const isScene = new Map<string, boolean>();
  for (const key of keys) isScene.set(key, (await refAssetType(projectId, key)) === "scene");
  return [...keys.filter((k) => isScene.get(k)), ...keys.filter((k) => !isScene.get(k))];
}

const KIND_BY_PREFIX: Record<string, OwnerKind> = { a: "asset", n: "node", s: "storyboard", v: "track" };

export function parseKey(key: string): Owner {
  const match = /^([ansv]):(\d+)$/.exec(String(key));
  if (!match) throw new Error(`无效的节点 key: ${key}`);
  const id = Number(match[2]);
  return { kind: KIND_BY_PREFIX[match[1]!]!, id, key: `${match[1]}:${id}` as NodeKey };
}

export const assetKey = (id: number): NodeKey => `a:${id}`;
export const nodeKey = (id: number): NodeKey => `n:${id}`;
export const storyboardKey = (id: number): NodeKey => `s:${id}`;
export const trackKey = (id: number): NodeKey => `v:${id}`;

/** 校验节点属于该项目，返回对应行 */
export async function resolveOwner(projectId: number, key: string) {
  const owner = parseKey(key);
  const empty = { asset: undefined, node: undefined, storyboard: undefined, track: undefined };
  if (owner.kind === "asset") {
    const row = await u.db("o_assets").where({ id: owner.id, projectId }).first();
    if (!row) throw new Error("资产不存在或不属于该项目");
    return { ...owner, ...empty, asset: row };
  }
  if (owner.kind === "storyboard") {
    const row = await u.db("o_storyboard").where({ id: owner.id, projectId }).first();
    if (!row) throw new Error("镜头不存在或不属于该项目");
    return { ...owner, ...empty, storyboard: row };
  }
  if (owner.kind === "track") {
    const row = await u.db("o_videoTrack").where({ id: owner.id, projectId }).first();
    if (!row) throw new Error("片段不存在或不属于该项目");
    return { ...owner, ...empty, track: row };
  }
  const row = await u.db("o_canvasNode").where({ id: owner.id, projectId }).first();
  if (!row) throw new Error("画布节点不存在或不属于该项目");
  return { ...owner, ...empty, node: row };
}

/** o_image 里标记版本归属的列 */
export const OWNER_IMAGE_COLUMN: Record<OwnerKind, "assetsId" | "canvasNodeId" | "storyboardId" | "videoTrackId"> = {
  asset: "assetsId",
  node: "canvasNodeId",
  storyboard: "storyboardId",
  track: "videoTrackId",
};

/** o_image 行 → 它属于哪个节点 key */
export function imageOwnerKey(row: { assetsId?: number | null; canvasNodeId?: number | null; storyboardId?: number | null; videoTrackId?: number | null }): NodeKey | null {
  if (row.assetsId) return assetKey(row.assetsId);
  if (row.canvasNodeId) return nodeKey(row.canvasNodeId);
  if (row.storyboardId) return storyboardKey(row.storyboardId);
  if (row.videoTrackId) return trackKey(row.videoTrackId);
  return null;
}

/** 一条 o_image 当前版本的文件，state 必须是「已完成」 */
async function currentImage(imageId: number | null | undefined, fallbackKind = "image") {
  if (!imageId) return null;
  const image = await u.db("o_image").where({ id: imageId, state: "已完成" }).select("filePath", "kind").first();
  return image?.filePath ? { filePath: image.filePath, kind: image.kind ?? fallbackKind } : null;
}

/** 节点当前可用作参考的文件：资产取当前图（角色即多视图）；自由节点 / 镜头取当前版本；片段取选中的成片 */
export async function ownerFilePath(owner: Owner): Promise<{ filePath: string; kind: string } | null> {
  if (owner.kind === "asset") {
    const asset = await u.db("o_assets").where("id", owner.id).select("imageId", "type").first();
    return currentImage(asset?.imageId, asset?.type === "audio" ? "audio" : "image");
  }
  if (owner.kind === "storyboard") {
    const shot = await u.db("o_storyboard").where("id", owner.id).select("imageId").first();
    return currentImage(shot?.imageId);
  }
  if (owner.kind === "track") {
    const track = await u.db("o_videoTrack").where("id", owner.id).select("videoId").first();
    if (!track?.videoId) return null;
    const video = await u.db("o_video").where({ id: track.videoId, state: "生成成功" }).select("filePath").first();
    return video?.filePath ? { filePath: video.filePath, kind: "video" } : null;
  }
  const node = await u.db("o_canvasNode").where("id", owner.id).select("imageId", "kind").first();
  return currentImage(node?.imageId, node?.kind ?? "image");
}

/** 自由节点选的风格（视觉手册目录名），存在 params.artStyle */
export function nodeArtStyle(params: string | null | undefined): string | null {
  try {
    const value = JSON.parse(params || "{}")?.artStyle;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/** 文本参考：内容存在 o_canvasNode.prompt 里的便签节点 */
export interface TextRef {
  key: string;
  name: string;
  content: string;
}

/**
 * 文本节点作参考时不是一张图，而是要拼进提示词：
 * `@文本N` 令牌替换成第 N 个文本参考的内容，没被令牌引用的文本追加成「参考文本」段；
 * 返回去掉文本 key 之后的参考列表，供 resolveRefs 只处理真正的媒体文件。
 */
export async function expandTextRefs(projectId: number, keys: string[], prompt: string) {
  const texts: TextRef[] = [];
  const refKeys: string[] = [];
  for (const key of keys) {
    const owner = parseKey(key);
    const row = owner.kind === "node" ? await u.db("o_canvasNode").where({ id: owner.id, projectId }).select("kind", "name", "prompt").first() : null;
    if (row?.kind === "text") texts.push({ key, name: row.name ?? "文本", content: (row.prompt ?? "").trim() });
    else refKeys.push(key);
  }
  if (!texts.length) return { prompt, refKeys, texts };
  const used = new Set<number>();
  let out = prompt.replace(/@文本(\d+)/g, (token, n: string) => {
    const index = Number(n) - 1;
    const text = texts[index];
    if (!text) return token;
    used.add(index);
    return text.content;
  });
  const extra = texts.filter((t, i) => !used.has(i) && t.content).map((t) => `【参考文本：${t.name}】\n${t.content}`);
  if (extra.length) out = [out.trim(), ...extra].filter(Boolean).join("\n\n");
  return { prompt: out, refKeys, texts };
}

/** 入边（参考）按 sort 排序 */
export async function incomingEdges(projectId: number, targetKey: string) {
  return u.db("o_canvasEdge").where({ projectId, targetKey }).orderBy([{ column: "sort" }, { column: "id" }]);
}

const extKind = (filePath: string): "image" | "video" | "audio" => {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a"].includes(ext)) return "audio";
  return "image";
};

export interface ResolvedRef {
  key: string;
  kind: "image" | "video" | "audio";
  base64: string;
}

/**
 * 把参考 key 列表解析成 referenceList。
 * withVoice：角色资产顺带取出绑定的音色（音色资产的第一条样本）。
 */
export async function resolveRefs(projectId: number, keys: string[], opts: { withVoice?: boolean } = {}): Promise<ResolvedRef[]> {
  const result: ResolvedRef[] = [];
  for (const key of keys) {
    const owner = await resolveOwner(projectId, key);
    const file = await ownerFilePath(owner);
    if (file) {
      // 读不到就直接报错：悄悄跳过会让模型少一张参考（比如人物没出现），用户却不知道
      let base64: string;
      try {
        base64 = await u.oss.getImageBase64(file.filePath);
      } catch (e) {
        console.warn("[画布] 参考文件读取失败", key, file.filePath, u.error(e).message);
        const name = owner.asset?.name ?? owner.node?.name ?? (owner.storyboard ? `镜头 ${owner.storyboard.index ?? owner.id}` : owner.track ? `片段 ${owner.id}` : key);
        throw new Error(`参考「${name}」的当前图文件丢失或无法读取，请在历史里换一个版本、重新生成或断开这条连线`);
      }
      result.push({ key, kind: extKind(file.filePath), base64 });
    }
    if (opts.withVoice) {
      // 角色资产用绑定表里的音色；标为角色的自由图片节点用 params.voice（音色库资产或画布上的音频节点）
      const voice = owner.asset?.type === "role" ? await roleVoiceSample(owner.id) : owner.node && nodeAssetType(owner.node.params) === "role" ? await nodeVoiceSample(projectId, owner.node.params) : null;
      if (voice) result.push({ key: `${key}#voice`, kind: "audio", base64: await u.oss.getImageBase64(voice) });
    }
  }
  return result;
}

/** 角色绑定音色的第一条样本文件 */
export async function roleVoiceSample(roleId: number): Promise<string | null> {
  const binding = await u.db("o_assetsRole2Audio").where("assetsRoleId", roleId).select("assetsAudioId").first();
  if (!binding) return null;
  return voiceAssetSample(binding.assetsAudioId!);
}

/** 音色资产（父级）的第一条样本文件 */
export async function voiceAssetSample(voiceAssetId: number): Promise<string | null> {
  const sample = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.assetsId", voiceAssetId)
    .whereNotNull("o_image.filePath")
    .select("o_image.filePath")
    .first();
  return sample?.filePath ?? null;
}

/** 自由节点（标为角色的图片）绑定的音色：音色库资产，或画布上的音频节点。存在 params.voice */
export type NodeVoice = { kind: "asset"; id: number } | { kind: "node"; key: string };
export function nodeVoice(params: string | null | undefined): NodeVoice | null {
  try {
    const value = JSON.parse(params || "{}")?.voice;
    if (value?.kind === "asset" && typeof value.id === "number") return { kind: "asset", id: value.id };
    if (value?.kind === "node" && typeof value.key === "string") return { kind: "node", key: value.key };
    return null;
  } catch {
    return null;
  }
}
/** 自由节点音色的样本文件（音色资产取第一条样本；音频节点取当前版本） */
export async function nodeVoiceSample(projectId: number, params: string | null | undefined): Promise<string | null> {
  const voice = nodeVoice(params);
  if (!voice) return null;
  if (voice.kind === "asset") return voiceAssetSample(voice.id);
  const owner = parseKey(voice.key);
  if (owner.kind !== "node") return null;
  const row = await u.db("o_canvasNode").where({ id: owner.id, projectId }).select("imageId", "kind").first();
  const file = await currentImage(row?.imageId, row?.kind ?? "audio");
  return file?.filePath ?? null;
}

export const toReferenceList = (refs: ResolvedRef[]): ReferenceList[] => refs.map((r) => ({ type: r.kind, base64: r.base64 }) as ReferenceList);

/** 读取视频模型的 mode（来自供应商模型列表） */
export async function getVideoModelMode(model: string): Promise<unknown[]> {
  const [vendorId, modelName] = model.split(/:(.+)/);
  const models = await u.vendor.getModelList(vendorId);
  const found = models.find((m: any) => m.modelName === modelName);
  if (!found) throw new Error(`未找到视频模型 ${model}`);
  return Array.isArray(found.mode) ? found.mode : [found.mode];
}

/**
 * 按视频模型 mode 裁剪参考：多参数组按 imageReference:N / audioReference:N / videoReference:N 截断；
 * 首尾帧类取前两张图；单图取第一张；纯文本不带参考。
 */
export function fitRefsToMode(refs: ResolvedRef[], mode: unknown[]): { refs: ResolvedRef[]; mode: unknown[] } {
  const images = refs.filter((r) => r.kind === "image");
  const audios = refs.filter((r) => r.kind === "audio");
  const videos = refs.filter((r) => r.kind === "video");
  const multi = mode.find((m) => Array.isArray(m)) as string[] | undefined;
  if (multi) {
    const limit = (name: string) => Number(multi.find((m) => m.startsWith(`${name}:`))?.split(":")[1] ?? 0);
    return {
      refs: [...images.slice(0, limit("imageReference")), ...audios.slice(0, limit("audioReference")), ...videos.slice(0, limit("videoReference"))],
      mode: [multi],
    };
  }
  const flat = mode as string[];
  if (images.length >= 2 && flat.some((m) => ["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(m))) {
    const picked = flat.find((m) => ["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(m))!;
    return { refs: [...images.slice(0, 2), ...audios.slice(0, 1)], mode: [picked] };
  }
  if (images.length >= 1 && flat.some((m) => ["singleImage", "startFrameOptional", "endFrameOptional"].includes(m))) {
    const picked = flat.includes("singleImage") ? "singleImage" : flat.find((m) => m !== "text")!;
    return { refs: [...images.slice(0, 1), ...audios.slice(0, 1)], mode: [picked] };
  }
  if (flat.includes("text")) return { refs: [], mode: ["text"] };
  if (flat.includes("startEndRequired")) throw new Error("该视频模型需要首尾两张参考图");
  throw new Error("参考素材不满足该视频模型的输入要求");
}

/** 当前图 URL：图片给缩略图，视频/音频给原文件 */
export async function fileUrl(filePath: string | null | undefined): Promise<string | null> {
  if (!filePath) return null;
  return extKind(filePath) === "image" ? u.oss.getSmallImageUrl(filePath) : u.oss.getFileUrl(filePath);
}

export async function touchCanvas(projectId: number) {
  const exists = await u.db("o_canvas").where("projectId", projectId).first();
  if (!exists) await u.db("o_canvas").insert({ projectId, viewport: null, layout: "{}", updateTime: Date.now() });
}

export async function readLayout(projectId: number): Promise<CanvasLayout> {
  const row = await u.db("o_canvas").where("projectId", projectId).select("layout").first();
  try {
    return { ...EMPTY_LAYOUT, ...(row?.layout ? JSON.parse(row.layout) : {}) };
  } catch {
    return { ...EMPTY_LAYOUT };
  }
}

export interface CanvasLayout {
  positions: Record<string, { x: number; y: number }>;
  nodeMeta: Record<string, Record<string, unknown>>;
  pinned: string[];
  hidden: string[];
}

export const EMPTY_LAYOUT: CanvasLayout = { positions: {}, nodeMeta: {}, pinned: [], hidden: [] };

export async function writeLayout(projectId: number, layout: CanvasLayout, viewport?: unknown) {
  await touchCanvas(projectId);
  await u
    .db("o_canvas")
    .where("projectId", projectId)
    .update({
      layout: JSON.stringify(layout),
      updateTime: Date.now(),
      ...(viewport !== undefined ? { viewport: JSON.stringify(viewport) } : {}),
    });
}

/** 把布局/连线里的 key 改名（存入资产库时 n:→a:） */
export async function renameKey(projectId: number, from: string, to: string) {
  await u.db("o_canvasEdge").where({ projectId, sourceKey: from }).update({ sourceKey: to });
  await u.db("o_canvasEdge").where({ projectId, targetKey: from }).update({ targetKey: to });
  const layout = await readLayout(projectId);
  const rename = <T>(record: Record<string, T>) => {
    if (!(from in record)) return record;
    const { [from]: value, ...rest } = record;
    return { ...rest, [to]: value };
  };
  await writeLayout(projectId, {
    positions: rename(layout.positions),
    nodeMeta: rename(layout.nodeMeta),
    pinned: layout.pinned.map((k) => (k === from ? to : k)),
    hidden: layout.hidden.map((k) => (k === from ? to : k)),
  });
}

/**
 * 参考顺序变了之后，把提示词里的 @图N / @图片N 重新编号，让它仍然指向同一张图。
 * 场景必须排图1 的工作流会打乱顺序，而分镜提示词是 Agent 按原顺序写的，
 * 不重编号就会出现「@图1 为苏念」但图1 实际是场景的错位。
 * 只改发给模型的文本，界面上保存的仍是原文。
 */
export function remapRefTokens(text: string, fromKeys: string[], toKeys: string[]): string {
  if (!text) return text;
  const map = new Map<number, number>();
  fromKeys.forEach((key, i) => {
    const to = toKeys.indexOf(key);
    if (to >= 0) map.set(i + 1, to + 1);
  });
  let changed = false;
  for (const [from, to] of map) if (from !== to) changed = true;
  if (!changed) return text;
  return text.replace(/@\s*(图片|图)\s*(\d+)/g, (whole, word: string, n: string) => {
    const next = map.get(Number(n));
    return next ? `@${word}${next}` : whole;
  });
}
