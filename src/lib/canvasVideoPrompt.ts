import fs from "fs/promises";
import path from "path";
import u from "@/utils";
import { fitRefsToMode, getVideoModelMode, nodeAssetType, resolveOwner, resolveRefs, type ResolvedRef } from "@/lib/canvas";

// ─── 画布视频节点的提示词 Skill ─────────────────────────────────
// 规则 = 模型绑定的视频提示词文件（设置 → 模型提示词，o_modelPrompt → data/modelPrompt/video/*.md，
// 如 MiniMax H3 多参考的官方六字段模板）+ 画布适配说明（data/skills/canvas_video_polish.md）。
// 输入按规则文件约定的格式拼：资产信息 + <storyboardItem videoDesc duration>，参考编号与实际传图顺序一致。

const CANVAS_SKILL = "canvas_video_polish.md";
/** H3 的对白 / 说话人 / 音色绑定约定，蒸馏自 data/skills/h3_skills/ 的官方与社区指南 */
const H3_DIALOGUE_SKILL = "h3_dialogue_polish.md";
const TYPE_FOR_RULES: Record<string, string> = { role: "role", scene: "scene", tool: "prop" };

export interface VideoRules {
  fileName: string;
  content: string;
}

/** 视频模型对应的提示词规则：优先用绑定，其次按模型 mode 找通用规则 */
export async function loadVideoRules(model: string, mode: unknown[], segment?: boolean): Promise<VideoRules | null> {
  const [vendorId, modelName] = model.split(/:(.+)/);
  const root = u.getPath(["modelPrompt"]);
  const read = async (relative: string) => {
    try {
      return await fs.readFile(path.join(root, relative), "utf-8");
    } catch {
      return null;
    }
  };
  // 片段（多镜合一）有专门的模板，优先级高于模型绑定：
  // 绑定是「这个模型平时用哪套规则」，片段需要的是带时间码分镜头的那套
  if (segment) {
    const segmentFile = segmentRuleFile(modelName ?? "");
    const content = segmentFile ? await read(path.join("video", segmentFile)) : null;
    if (content && segmentFile) return { fileName: segmentFile, content };
  }
  const bound = await u.db("o_modelPrompt").where({ vendorId, model: modelName }).first();
  if (bound?.path) {
    const content = await read(bound.path);
    if (content) return { fileName: bound.fileName ?? path.basename(bound.path), content };
  }
  const fallback = fallbackRuleFile(modelName ?? "", mode, segment);
  if (!fallback) return null;
  const content = await read(path.join("video", fallback));
  return content ? { fileName: fallback, content } : null;
}

/** 片段模式的专用模板（目前只有 H3 系列有） */
function segmentRuleFile(modelName: string): string | null {
  return modelName.toLowerCase().startsWith("h3_") ? "minimaxH3SegmentMode.md" : null;
}

/** 按模型名 / mode 选规则文件。名字优先（H3 有官方模板），其次按能力回落到通用模板 */
function fallbackRuleFile(modelName: string, mode: unknown[], segment?: boolean): string | null {
  const name = modelName.toLowerCase();
  if (segment) {
    const segmentFile = segmentRuleFile(name);
    if (segmentFile) return segmentFile;
  }
  const byName: [RegExp, string][] = [
    [/^h3_ref2v_multi$/, "minimaxH3ReferenceMultiMode.md"],
    [/^h3_ref2v$/, "minimaxH3ReferenceMode.md"],
    [/^h3_i2v$/, "minimaxH3FirstFrameMode.md"],
    // 这两条以前没有：h3_flf 靠能力兜到通用首尾帧模板（这里写明），
    // h3_t2v 则一条都匹配不上，点「推理提示词」直接抛「没有可用的提示词规则」
    [/^h3_flf$/, "universalFirstAndLastFrameMode.md"],
    [/^h3_t2v$/, "minimaxH3TextMode.md"],
    [/wan.*2\.6/, "wan2.6Single-imageFirstFrameMode.md"],
    [/seedance.*2[.\-]0/, "seedance2Multi-parameterMode.md"],
  ];
  for (const [pattern, file] of byName) if (pattern.test(name)) return file;
  const flat = mode.flat() as string[];
  if (mode.some(Array.isArray)) return "universalMulti-parameterMode.md";
  if (flat.some((m) => ["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(m))) return "universalFirstAndLastFrameMode.md";
  return null;
}

/** 读一份 data/skills/ 下的说明文件（用户可在「设置 → 技能管理」里改），缺失时当作没有 */
async function loadSkill(fileName: string): Promise<string> {
  try {
    return await fs.readFile(path.join(u.getPath(["skills"]), fileName), "utf-8");
  } catch {
    return "";
  }
}

/** 画布适配说明（可编辑的 Skill 文件） */
export const loadCanvasVideoSkill = () => loadSkill(CANVAS_SKILL);

export interface VideoRefInfo {
  key: string;
  tag: string; // <Picture 1> / <Audio 1> / <Video 1>
  kind: "image" | "audio" | "video";
  name: string;
  type: string; // role / scene / prop / reference / audio
  detail: string;
}

/** 按实际生成时的裁剪规则解析参考，给每个素材编号并附上名称、类型与描述 */
export async function describeVideoRefs(projectId: number, keys: string[], model: string, extraRefs: ResolvedRef[] = []) {
  const mode = await getVideoModelMode(model);
  const media = extraRefs.length ? await resolveRefs(projectId, keys) : await resolveRefs(projectId, keys, { withVoice: true });
  const fitted = fitRefsToMode([...media, ...extraRefs], mode);
  const counters = { image: 0, audio: 0, video: 0 };
  const TAG = { image: "Picture", audio: "Audio", video: "Video" } as const;
  const infos: VideoRefInfo[] = [];
  for (const ref of fitted.refs) {
    counters[ref.kind] += 1;
    infos.push({ ...(await refMeta(projectId, ref)), key: ref.key, kind: ref.kind, tag: `<${TAG[ref.kind]} ${counters[ref.kind]}>` });
  }
  return { refs: infos, mode: fitted.mode };
}

async function refMeta(projectId: number, ref: ResolvedRef): Promise<{ name: string; type: string; detail: string }> {
  const [baseKey, suffix] = ref.key.split("#");
  const owner = await resolveOwner(projectId, baseKey);
  if (suffix === "voice") return { name: `${owner.asset?.name ?? ""}的音色`, type: "audio", detail: `角色「${owner.asset?.name ?? ""}」的音色参考` };
  if (owner.asset) {
    const parent = owner.asset.assetsId ? await u.db("o_assets").where("id", owner.asset.assetsId).select("name").first() : undefined;
    const lines = [owner.asset.describe, owner.asset.prompt].map((t) => (t ?? "").trim()).filter(Boolean);
    return {
      name: owner.asset.name ?? "",
      type: ref.kind === "image" ? (TYPE_FOR_RULES[owner.asset.type ?? ""] ?? "reference") : ref.kind,
      detail: [parent ? `是「${parent.name}」的一个状态` : "", ...lines].filter(Boolean).join("；").slice(0, 800),
    };
  }
  if (owner.storyboard) {
    // 镜头图是一整帧画面，不是单个主体；把画面描述给模型，让它知道这一帧里有什么
    const detail = (owner.storyboard.videoDesc ?? owner.storyboard.prompt ?? "").trim().slice(0, 800);
    return { name: `镜头 ${(owner.storyboard.index ?? 0) + 1}`, type: ref.kind === "image" ? "frame" : ref.kind, detail };
  }
  if (owner.track) return { name: `片段 ${owner.id}`, type: ref.kind, detail: (owner.track.prompt ?? "").trim().slice(0, 400) };
  const tag = nodeAssetType(owner.node!.params);
  return {
    name: owner.node!.name ?? "",
    type: ref.kind === "image" ? (tag ? TYPE_FOR_RULES[tag] : "reference") : ref.kind,
    detail: (owner.node!.prompt ?? "").trim().slice(0, 400) || (tag ? "" : "未标注类型的参考图，按用户描述判断它是人物、场景还是道具"),
  };
}

/** 这一段戏在整集里的位置。模型看不到剧本时写不出接得上的前后戏 */
export interface StoryContext {
  scriptName?: string | null;
  scriptContent?: string | null;
  /** 第 from~to 镜 / 共 total 镜（1 起） */
  from: number;
  to: number;
  total: number;
  before: string[];
  after: string[];
}

/** 一条分镜喂给语言模型的信息 */
export interface ShotBrief {
  index?: number | null;
  videoDesc?: string | null;
  /** 分镜图的图像提示词：语言模型原本看不到画面，这是最直接的画面依据 */
  imagePrompt?: string | null;
  duration?: number | string | null;
}

const esc = (text: string) => text.replace(/'/g, "’");

/** 拼成规则文件约定的输入：资产信息 + 参考编号 + 分镜（含分镜图画面） + 剧情位置 */
export function buildRuleInput(opts: {
  model: string;
  refs: VideoRefInfo[];
  text: string;
  duration: number;
  aspectRatio: string;
  shots?: ShotBrief[];
  story?: StoryContext;
}) {
  const { model, refs, text, duration, aspectRatio, shots, story } = opts;
  const pictures = refs.filter((r) => r.kind !== "audio");
  const voiceOf = (r: VideoRefInfo) => refs.find((a) => a.kind === "audio" && a.key === `${r.key}#voice`);
  const assetInfo = pictures.map((r) => `[${r.key}, ${r.type}, ${r.name}${voiceOf(r) ? `, audio:${voiceOf(r)!.name}` : ""}]`).join(", ");
  const refLines = refs.map((r) => `${r.tag} = ${r.name}（${r.type}）${r.detail ? `：${r.detail}` : ""}`);
  const desc = esc(text.trim()) || "（用户未填写，请按参考素材写一个合理的镜头）";
  const items = shots?.length
    ? shots.map((shot) => `<storyboardItem videoDesc='${esc((shot.videoDesc ?? "").trim()) || desc}' duration='${shot.duration ?? duration}'></storyboardItem>`)
    : [`<storyboardItem videoDesc='${desc}' duration='${duration}'></storyboardItem>`];
  // 分镜图的画面描述：模型看不到图，这几行是它唯一能对上画面的依据
  const frames = (shots ?? [])
    .filter((shot) => (shot.imagePrompt ?? "").trim())
    .map((shot, i) => `镜头${(shot.index ?? i) + 1}：${esc(shot.imagePrompt!.trim()).slice(0, 700)}`);
  return [
    `**模型名称**：${model.split(/:(.+)/)[1] ?? model}`,
    `**资产信息**（按实际传入顺序）：${assetInfo || "无"}`,
    `**参考素材编号**（与实际传入模型的顺序一致，必须照此编号）：`,
    ...(refLines.length ? refLines : ["无参考素材"]),
    `**画幅**：${aspectRatio}`,
    `**分镜信息**：`,
    ...items,
    ...(frames.length ? ["", `**分镜图画面**（这就是要动起来的那一帧，视频提示词必须与它一致，不要另起画面）：`, ...frames] : []),
    ...storyLines(story),
  ].join("\n");
}

/** 剧情位置：先说这一段在哪，再给前后两镜，最后附整集剧本全文 */
function storyLines(story?: StoryContext): string[] {
  if (!story) return [];
  const out = ["", `**这一段在剧情里的位置**：第 ${story.from === story.to ? story.from : `${story.from}~${story.to}`} 镜 / 共 ${story.total} 镜。`];
  if (story.before.length) out.push(`上文：${story.before.join("；")}`);
  if (story.after.length) out.push(`下文：${story.after.join("；")}`);
  if (story.scriptContent?.trim()) {
    out.push(
      "",
      `**本集剧本${story.scriptName ? `《${story.scriptName}》` : ""}全文**（只作背景，帮你判断这段戏的前因后果与人物关系；不要把没在分镜信息里出现的情节或台词写进画面）：`,
      story.scriptContent.trim(),
    );
  }
  return out;
}

export interface VideoPromptInput {
  projectId: number;
  model: string;
  refKeys: string[];
  /** 额外参考（片段里角色的音色），不走参考边 */
  extraRefs?: ResolvedRef[];
  text: string;
  duration: number;
  aspectRatio: string;
  shots?: ShotBrief[];
  /** 分镜图本身（data URL）：模型支持看图时一并发过去，不支持会自动回落成纯文本 */
  shotImages?: string[];
  /** 整集剧情与这一段的位置 */
  story?: StoryContext;
  /** 片段（多镜合一）：选用带时间码分镜头的模板 */
  segment?: boolean;
}

/**
 * 视频提示词的唯一实现：镜头台、画布视频节点、老分镜台都走这里。
 * 规则 = 模型绑定 → 按模型名/能力匹配 → （调用方自己兜底）。
 */
export async function buildVideoPrompt(input: VideoPromptInput): Promise<{ text: string; rules: string; refs: VideoRefInfo[]; framesSent: number; frameError?: string }> {
  const { refs, mode } = await describeVideoRefs(input.projectId, input.refKeys, input.model, input.extraRefs ?? []);
  const rules = await loadVideoRules(input.model, mode, input.segment);
  if (!rules) throw new Error("这个视频模型没有可用的提示词规则（设置 → 模型提示词），无法按模板扩写");

  const project = await u.db("o_project").where("id", input.projectId).select("artStyle").first();
  const visualManual = u.getArtPrompt(project?.artStyle || "无", "art_skills", "art_storyboard_video");
  const canvasSkill = await loadCanvasVideoSkill();
  const ruleInput = buildRuleInput({
    model: input.model,
    refs,
    text: input.text,
    duration: input.duration,
    aspectRatio: input.aspectRatio,
    shots: input.shots,
    story: input.story,
  });

  // H3 的对白、说话人编号、音色绑定另有一套官方约定，单独一层说明，只在 H3 上加
  const h3Skill = /^h3_/i.test(input.model.split(/:(.+)/)[1] ?? "") ? await loadSkill(H3_DIALOGUE_SKILL) : "";
  const system = [rules.content, canvasSkill, h3Skill].filter(Boolean).join("\n\n---\n\n");
  const assistant = visualManual ? [{ role: "assistant" as const, content: `视觉风格约束：\n${visualManual}` }] : [];
  const images = (input.shotImages ?? []).filter(Boolean).slice(0, 5);

  const invoke = async (withImages: boolean) => {
    // AI SDK 的 image 部件要裸 base64 + mediaType；直接塞 data URL 会被当成 URL 解析（"URL scheme must be http or https"）
    const parts = images.map((dataUrl) => {
      const matched = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
      return matched ? { type: "image" as const, image: matched[2]!, mediaType: matched[1]! } : { type: "image" as const, image: dataUrl };
    });
    const user = withImages && parts.length
      ? { role: "user" as const, content: [{ type: "text" as const, text: ruleInput }, ...parts] }
      : { role: "user" as const, content: ruleInput };
    const { text } = await u.Ai.Text("universalAi").invoke({ system, messages: [...assistant, user] as never });
    return (text ?? "").trim().replace(/^```\w*\n?|\n?```$/g, "").trim();
  };

  let output = "";
  let framesSent = images.length;
  let frameError: string | undefined;
  try {
    output = await invoke(images.length > 0);
  } catch (e) {
    if (!images.length) throw e;
    // 文本模型不支持看图：退回纯文本再试一次，别因为这个整条失败
    frameError = u.error(e).message;
    console.warn("[视频提示词] 带图调用失败，回落纯文本：", frameError);
    framesSent = 0;
    output = await invoke(false);
  }
  if (!output) throw new Error("扩写结果为空");
  return { text: output, rules: rules.fileName, refs, framesSent, frameError };
}

/** H3 多参考：把画布编辑器里的 @图片N / @音频N / @视频N 换成模型认得的 <Picture N> / <Audio N> / <Video N> */
export function toH3RefTags(prompt: string): string {
  return prompt
    .replace(/@\s*图片\s*(\d+)/g, "<Picture $1>")
    .replace(/@\s*音频\s*(\d+)/g, "<Audio $1>")
    .replace(/@\s*视频\s*(\d+)/g, "<Video $1>");
}

export const isH3ReferenceModel = (model: string, mode: unknown[]) => /^h3_/.test(model.split(/:(.+)/)[1] ?? "") && mode.some(Array.isArray);
