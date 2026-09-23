/**
 * Toonflow 供应商适配：ComfyUI（本地/局域网）
 * @version 1.9
 *
 * 工作流约定：
 * - 在 ComfyUI 中用「导出 (API)」导出工作流，保存到 ComfyUI 的 user/default/workflows/<工作流目录>/<modelName>.json
 * - 在需要注入参数的节点标题里写标记（可多个，空格分隔）：
 *     @prompt:输入名   @image1:输入名 … @image9:输入名   @seed:输入名
 *     @audio1..9:输入名(LoadAudio.audio)   @video1..9:输入名(LoadVideo.file)
 *     @width:输入名    @height:输入名   @length:输入名(帧数)   @duration:输入名(秒)
 *     @aspect:输入名(比例下拉框，如 ResolutionSelector.aspect_ratio)   @megapixels:输入名(百万像素)
 *     @voice:输入名(音色/说话人)   @speed:输入名(语速)   @pitch:输入名(音调)   @volume:输入名(音量)   ← 文本转语音工作流
 *     @output          标记取结果的输出节点（图片 / 视频 / 音频）
 *   例：LoadImage 标题 "@image1:image"，CLIPTextEncode 标题 "@prompt:text"
 * - 提示词输入原文含 {prompt} 时，只替换占位符（用于固定指令 + 画面描述）
 * - 参考素材少于 @imageN/@audioN/@videoN 标记数量时，多余的加载节点会被移除；
 *   依赖它的节点：必填输入 → 连同节点一起移除，可选输入 → 只断开该输入
 */

// ============================================================
// 类型定义
// ============================================================

type VideoMode =
  | "singleImage" //单图参考
  | "startEndRequired" //首尾帧（两张都得有）
  | "endFrameOptional" //首尾帧（尾帧可选）
  | "startFrameOptional" //首尾帧（首帧可选）
  | "text" //文本
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[]; //多参考（数字代表限制数量）

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
  utility?: boolean; // 工具型工作流（如去背景）：不吃提示词，工作流里可以没有 @prompt 标记
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string; //唯一ID，作为文件名存储用户磁盘上，禁止符号
  version: string; //版本号，格式为x.y，需遵守语义化版本控制
  name: string; //供应商名称
  author: string; //作者
  description?: string; //描述，支持Markdown格式
  icon?: string; //图标，仅支持Base64格式，建议尺寸为128x128像素
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceList?: Extract<ReferenceList, { type: "audio" }>[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// 全局声明
// ============================================================

declare const axios: any; // HTTP请求库
declare const logger: (msg: string) => void; // 日志函数
declare const jsonwebtoken: any; // JWT处理库
declare const zipImage: (base64: string, size: number) => Promise<string>; // 图片压缩函数，返回有头base64字符串
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>; // 图片分辨率调整函数，返回有头base64字符串
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>; // 图片合成函数，返回有头base64字符串
declare const urlToBase64: (url: string, headers?: Record<string, string>) => Promise<string>; // URL转Base64函数（宿主下载并编码），返回有头base64字符串
// 宿主端 HTTP：只传回 status / headers / 正文文本（新版 ToonFlow 才有，旧版回落到 axios）。
// axios 的响应对象背后挂着 socket / agent 整张图，vm2 会递归遍历每个进沙盒的对象，Electron 主进程里一次要走几秒
declare const httpRequest:
  | ((url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number }) => Promise<{ status: number; headers: Record<string, string>; text: string }>)
  | undefined;
// 宿主端 multipart 上传（新版 ToonFlow 才有，旧版回落到沙盒里 Buffer.from + FormData）
declare const uploadBase64File:
  | ((url: string, base64: string, options: { field?: string; filename: string; contentType?: string; headers?: Record<string, string>; fields?: Record<string, string> }) => Promise<any>)
  | undefined;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>; // 轮询函数，fn为异步函数，interval为轮询间隔，timeout为超时时间，返回fn的结果
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const FormData: any; // form-data 库
declare const crypto: any; // node:crypto
declare const Buffer: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any; //文本模型
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>; //图片模型，返回有头base64字符串
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>; //视频模型，返回有头base64字符串
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>; //（暂未开放）语音模型，返回有头base64字符串
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>; //检查更新函数，返回是否有更新和最新版本号和更公告（支持Markdown格式）
  updateVendor?: () => Promise<string>; //更新函数，返回最新的代码文本
};

// ============================================================
// 供应商配置
// ============================================================

// MiniMax H3：时长 3~15 秒任意整秒（工作流按秒数换算成 17k+5 帧），分辨率为短边像素
// 分辨率是短边像素：1080P 在 8G 显存上会明显更慢、更吃显存，超时按需放大
const H3_DURATION_MAP = [{ duration: Array.from({ length: 13 }, (_, i) => i + 3), resolution: ["480P", "720P", "1080P"] }];

const vendor: VendorConfig = {
  id: "comfyui",
  version: "1.9",
  author: "local",
  name: "ComfyUI",
  description:
    "## ComfyUI 工作流\n调用局域网 ComfyUI 的 API 格式工作流。每个模型对应 `workflows/<工作流目录>/<modelName>.json`，节点标题用 `@prompt:text`、`@image1:image`、`@seed:seed`、`@output` 等标记注入参数。",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "url", required: true, placeholder: "示例：http://192.168.1.10:8188" },
    { key: "token", label: "访问令牌（反向代理鉴权，可留空）", type: "password", required: false },
    { key: "workflowDir", label: "工作流目录（相对 user/default/workflows）", type: "text", required: true, placeholder: "api" },
    { key: "imageTimeoutMinutes", label: "图片超时（分钟，含排队）", type: "text", required: false, placeholder: "30" },
    { key: "videoTimeoutMinutes", label: "视频超时（分钟，含排队）", type: "text", required: false, placeholder: "180" },
  ],
  inputValues: { baseUrl: "http://127.0.0.1:8188", token: "", workflowDir: "api", imageTimeoutMinutes: "30", videoTimeoutMinutes: "180" },
  models: [
    { name: "Krea2 文生图 · 不用参考图", modelName: "krea2_t2i", type: "image", mode: ["text"] },
    { name: "Krea2 人物定妆照 · 不用参考图（竖图）", modelName: "krea2_portrait", type: "image", mode: ["text"] },
    { name: "Krea2 人物多视图 · 需 1 张定妆照，会重新排版", modelName: "krea2_4view", type: "image", mode: ["singleImage"] },
    { name: "Krea2 改图 · 保留原图只改指定处，尺寸跟随原图", modelName: "krea2_edit", type: "image", mode: ["singleImage"] },
    { name: "Krea2 参照改写 · 1 张参考定样式，按目标尺寸出新图", modelName: "krea2_restyle", type: "image", mode: ["singleImage"] },
    { name: "Krea2 双图合成 · 任意 2 张参考合成一张（有场景就放图1）", modelName: "krea2_dual", type: "image", mode: ["singleImage", "multiReference"] },
    { name: "Krea2 多图合成 · 最多 5 张（图1 独占一位，图2~5 拼成一张主体图）", modelName: "krea2_multi", type: "image", mode: ["singleImage", "multiReference"] },
    { name: "去背景 · 抠出主体，白底 + 透明 PNG（rembg，不用提示词）", modelName: "rmbg", type: "image", mode: ["singleImage"], utility: true },
    {
      name: "H3 首帧生视频 · 锁定这张图当第 0 秒",
      modelName: "h3_i2v",
      type: "video",
      mode: ["singleImage"],
      audio: true,
      durationResolutionMap: H3_DURATION_MAP,
    },
    {
      name: "H3 首尾帧生视频 · 给头尾两张图，补中间过程",
      modelName: "h3_flf",
      type: "video",
      mode: ["endFrameOptional"],
      audio: true,
      durationResolutionMap: H3_DURATION_MAP,
    },
    {
      name: "H3 参考生视频 · 2 张图，会重新构图",
      modelName: "h3_ref2v",
      type: "video",
      mode: [["imageReference:2"]],
      audio: true,
      durationResolutionMap: H3_DURATION_MAP,
    },
    {
      name: "H3 多参考生视频 · 图5 + 音色3 + 视频1，对白能对上音色",
      modelName: "h3_ref2v_multi",
      type: "video",
      mode: [["imageReference:5", "audioReference:3", "videoReference:1"]],
      audio: true,
      durationResolutionMap: H3_DURATION_MAP,
    },
    {
      name: "H3 文生视频 · 不用参考",
      modelName: "h3_t2v",
      type: "video",
      mode: ["text"],
      audio: true,
      durationResolutionMap: H3_DURATION_MAP,
    },
    // 文本转语音：对应 workflows/api/tts.json，@prompt 接朗读文本，@audio1 可接音色参考，@voice/@speed 可选；
    // voices 按实际 TTS 节点支持的说话人填写（value 写进 @voice 标记的输入）
    { name: "文本转语音（tts 工作流）", modelName: "tts", type: "tts", voices: [] },
  ],
};

// ============================================================
// 辅助工具
// ============================================================

const getBaseUrl = (): string => {
  const baseUrl = String(vendor.inputValues.baseUrl || "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("缺少 ComfyUI 地址");
  return baseUrl;
};

const getHeaders = (): Record<string, string> => {
  const token = String(vendor.inputValues.token || "").trim().replace(/^Bearer\s+/i, "");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

type HttpResp = { status: number; headers: Record<string, string>; data: any };
/** 所有对 ComfyUI 的 JSON / 文本请求都走这里：宿主只返回文本，沙盒自己 JSON.parse，响应对象不进沙盒；非 2xx 抛带 response 的 Error */
const http = async (method: "GET" | "POST", url: string, options: { headers?: Record<string, string>; json?: unknown } = {}): Promise<HttpResp> => {
  const headers = { ...(options.json !== undefined ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  const body = options.json !== undefined ? JSON.stringify(options.json) : undefined;
  let status: number;
  let respHeaders: Record<string, string>;
  let text: string;
  if (typeof httpRequest === "function") {
    ({ status, headers: respHeaders, text } = await httpRequest(url, { method, headers, body }));
  } else {
    const resp = await axios.request({ url, method, headers, data: body, responseType: "text", transformResponse: [(d: any) => d], validateStatus: () => true });
    status = resp.status;
    respHeaders = resp.headers || {};
    text = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data ?? "");
  }
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    // 非 JSON 保持文本
  }
  if (status >= 400) {
    const err: any = new Error(`HTTP ${status}`);
    err.response = { status, data };
    throw err;
  }
  return { status, headers: respHeaders, data };
};

const describeAxiosError = (err: any): string => {
  const data = err?.response?.data;
  if (data?.error) {
    const nodeErrors = Object.entries(data.node_errors || {})
      .map(([nodeId, info]: [string, any]) => {
        const detail = (info.errors || []).map((e: any) => `${e.message}${e.details ? `: ${e.details}` : ""}`).join("; ");
        return `节点 ${nodeId}(${info.class_type}) ${detail}`;
      })
      .join("\n");
    return `${data.error.message || data.error}${nodeErrors ? `\n${nodeErrors}` : ""}`;
  }
  if (err?.response) return `HTTP ${err.response.status}: ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data ?? "").slice(0, 300)}`;
  return err?.message || String(err);
};

// 节点标题中的标记，如 "@prompt:text @seed:seed" → [{ key: "prompt", field: "text" }, ...]
const parseTags = (title: string): { key: string; field: string }[] => {
  const tags: { key: string; field: string }[] = [];
  const pattern = /@([A-Za-z]+\d*)(?::([^\s@,;]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(title || ""))) !== null) {
    tags.push({ key: match[1].toLowerCase(), field: match[2] || "" });
  }
  return tags;
};

// /object_info 中某个输入的定义；Autogrow 输入（如 ref_images.ref_image_0）按其父输入名查找
const findInputSpec = (nodeDef: any, inputName: string): { spec: any; required: boolean } | null => {
  const baseName = inputName.split(".")[0];
  const required = nodeDef?.input?.required || {};
  const optional = nodeDef?.input?.optional || {};
  if (baseName in required) return { spec: required[baseName], required: true };
  if (baseName in optional) return { spec: optional[baseName], required: false };
  return null;
};

// 把 "16:9" 这类比例匹配到下拉框选项（如 "16:9 (Widescreen)"），没有完全匹配时取比例最接近的选项
const matchRatioOption = (nodeDef: any, inputName: string, aspectRatio: string): string => {
  const spec = findInputSpec(nodeDef, inputName)?.spec;
  const options: string[] = Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options || [];
  const ratioOptions = options.filter((option) => /^\d+:\d+/.test(String(option)));
  if (ratioOptions.length === 0) return aspectRatio;
  const exact = ratioOptions.find((option) => option === aspectRatio || option.startsWith(`${aspectRatio} `));
  if (exact) return exact;
  const target = parseRatio(aspectRatio);
  return ratioOptions.reduce((best, option) =>
    Math.abs(parseRatio(option.split(" ")[0]) - target) < Math.abs(parseRatio(best.split(" ")[0]) - target) ? option : best,
  );
};

// 移除节点后，依赖它的必填输入所在节点一并移除，可选输入只断开连线；nodeDefs 缺失的节点按必填处理
const pruneRemovedNodes = (workflow: Record<string, any>, initialRemoved: string[], nodeDefs: Record<string, any>): string[] => {
  const removed = new Set(initialRemoved);
  let changed = removed.size > 0;
  while (changed) {
    changed = false;
    for (const [nodeId, node] of Object.entries(workflow)) {
      if (removed.has(nodeId)) continue;
      const brokenInputs = Object.entries(node.inputs || {}).filter(([, value]) => Array.isArray(value) && removed.has(String(value[0])));
      if (brokenInputs.length === 0) continue;
      const nodeDef = nodeDefs[node.class_type];
      if (brokenInputs.some(([name]) => !nodeDef || findInputSpec(nodeDef, name)?.required !== false)) {
        removed.add(nodeId);
        changed = true;
        continue;
      }
      node.inputs = Object.fromEntries(Object.entries(node.inputs).filter(([name]) => !brokenInputs.some(([broken]) => broken === name)));
    }
  }
  for (const nodeId of removed) delete workflow[nodeId];
  return [...removed];
};

// 参考素材标记：@imageN / @audioN / @videoN，值为上传到 ComfyUI input 目录后的文件名
const MEDIA_TAG_PATTERN = /^(image|audio|video)\d+$/;

// 按标记写入参数；返回新的工作流对象，并移除未分配到素材的 @imageN/@audioN/@videoN 节点及其必需下游
const applyTags = (workflow: Record<string, any>, values: Record<string, any>, nodeDefs: Record<string, any> = {}) => {
  const result: Record<string, any> = JSON.parse(JSON.stringify(workflow));
  const applied = new Set<string>();
  const unassignedMediaNodeIds: string[] = [];

  for (const [nodeId, node] of Object.entries(result)) {
    const tags = parseTags(node?._meta?.title);
    const mediaTags = tags.filter((tag) => MEDIA_TAG_PATTERN.test(tag.key));
    const hasOnlyMediaTags = mediaTags.length > 0 && tags.every((tag) => MEDIA_TAG_PATTERN.test(tag.key) || tag.key === "output");
    if (hasOnlyMediaTags && mediaTags.every((tag) => values[tag.key] === undefined)) {
      unassignedMediaNodeIds.push(nodeId);
      continue;
    }
    for (const tag of tags) {
      if (tag.key === "output" || values[tag.key] === undefined) continue;
      if (!tag.field) throw new Error(`节点 ${nodeId} 的标记 @${tag.key} 缺少输入名，应写成 @${tag.key}:输入名`);
      const nodeDef = nodeDefs[node.class_type];
      if (nodeDef && !findInputSpec(nodeDef, tag.field)) {
        const names = [...Object.keys(nodeDef.input?.required || {}), ...Object.keys(nodeDef.input?.optional || {})].join(", ");
        throw new Error(`节点 ${nodeId}(${node.class_type}) 没有输入 "${tag.field}"，请检查标记 @${tag.key}:${tag.field}（可用输入：${names}）`);
      }
      const current = node.inputs?.[tag.field];
      let value = values[tag.key];
      if (tag.key === "aspect") value = matchRatioOption(nodeDefs[node.class_type], tag.field, String(value));
      if (tag.key === "prompt" && typeof current === "string" && current.includes("{prompt}")) value = current.split("{prompt}").join(String(value));
      node.inputs = { ...node.inputs, [tag.field]: value };
      applied.add(tag.key);
    }
  }

  const removedNodeIds = pruneRemovedNodes(result, unassignedMediaNodeIds, nodeDefs);
  const outputNodeIds = Object.entries(result)
    .filter(([, node]) => parseTags(node?._meta?.title).some((tag) => tag.key === "output"))
    .map(([nodeId]) => nodeId);

  return { workflow: result, applied, outputNodeIds, removedNodeIds };
};

const roundTo = (value: number, step: number): number => Math.max(step, Math.round(value / step) * step);

const parseRatio = (aspectRatio: string): number => {
  const [w, h] = String(aspectRatio || "1:1").split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 1;
};

// 图片："1K"/"2K"/"4K" 表示约 1024²/2048²/4096² 像素面积
const imageSizeFromConfig = (size: string, aspectRatio: string): { width: number; height: number } => {
  const side = ({ "1K": 1024, "2K": 2048, "4K": 4096 } as Record<string, number>)[size] || 1024;
  const ratio = parseRatio(aspectRatio);
  const width = Math.sqrt(side * side * ratio);
  return { width: roundTo(width, 16), height: roundTo(width / ratio, 16) };
};

// 视频："480P"/"720P"/"1080P" 表示短边像素
const videoSizeFromConfig = (resolution: string, aspectRatio: string): { width: number; height: number } => {
  const shortSide = parseInt(String(resolution || "480"), 10) || 480;
  const ratio = parseRatio(aspectRatio);
  const longSide = shortSide * Math.max(ratio, 1 / ratio);
  const landscape = ratio >= 1;
  return {
    width: roundTo(landscape ? longSide : shortSide, 32),
    height: roundTo(landscape ? shortSide : longSide, 32),
  };
};

// MiniMax H3 帧数为 17k+5（24fps），向上取整以覆盖目标时长
const framesFromDuration = (seconds: number, fps: number = 24): number => {
  const k = Math.max(0, Math.ceil((seconds * fps - 5) / 17));
  return k * 17 + 5;
};

type MediaKind = "image" | "audio" | "video";
type MediaLists = Record<MediaKind, string[]>;

const MEDIA_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/png": "png",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};
const MEDIA_LABELS: Record<MediaKind, string> = { image: "参考图", audio: "参考音频", video: "参考视频" };
const MAX_MEDIA_PER_KIND = 9;

const parseDataUrl = (base64: string): { mime: string; data: string } => {
  const text = String(base64);
  if (!text.includes(",")) return { mime: "image/png", data: text };
  const [header, data] = text.split(",", 2);
  return { mime: (header.match(/^data:([^;]+)/) || [])[1] || "image/png", data };
};

// ToonFlow 会把 mp4 资产标成 type:"image"，所以按 data URL 的 MIME 分类，MIME 缺失时才看 type
const classifyReferences = (referenceList: ReferenceList[] = []): MediaLists => {
  const lists: MediaLists = { image: [], audio: [], video: [] };
  for (const ref of referenceList) {
    const mime = String(ref.base64).startsWith("data:") ? parseDataUrl(ref.base64).mime : "";
    const kind = (["image", "audio", "video"] as MediaKind[]).find((k) => mime.startsWith(`${k}/`)) || (ref.type as MediaKind);
    if (lists[kind]) lists[kind].push(ref.base64);
  }
  return lists;
};

// 上传到 ComfyUI input 目录（/upload/image 接受任意文件，LoadAudio / LoadVideo 也从 input 目录读取）
const uploadMedia = async (base64: string, kind: MediaKind): Promise<string> => {
  const { mime, data } = parseDataUrl(base64);
  const ext = MEDIA_EXTENSIONS[mime] || { image: "png", audio: "mp3", video: "mp4" }[kind];
  // 二进制不进沙盒：文件名哈希直接算 base64 字符串，上传交给宿主的 uploadBase64File。
  // 沙盒里 Buffer.from(...) 会让 vm2 逐字节复制（3MB 一张图 1.3 秒，且阻塞 Electron 主进程 → 整个窗口无响应）
  const fileName = `toonflow_${crypto.createHash("sha1").update(data).digest("hex").slice(0, 16)}.${ext}`;
  const url = `${getBaseUrl()}/upload/image`;
  try {
    let result: any;
    if (typeof uploadBase64File === "function") {
      result = await uploadBase64File(url, data, { field: "image", filename: fileName, contentType: mime, headers: getHeaders(), fields: { overwrite: "true" } });
    } else {
      const form = new FormData();
      form.append("image", Buffer.from(data, "base64"), { filename: fileName, contentType: mime });
      form.append("overwrite", "true");
      result = (await axios.post(url, form, { headers: { ...form.getHeaders(), ...getHeaders() } })).data;
    }
    const { name, subfolder } = result;
    return subfolder ? `${subfolder}/${name}` : name;
  } catch (err) {
    throw new Error(`上传${MEDIA_LABELS[kind]}失败：${describeAxiosError(err)}`);
  }
};

const loadWorkflow = async (modelName: string): Promise<Record<string, any>> => {
  const dir = String(vendor.inputValues.workflowDir || "api").replace(/^\/+|\/+$/g, "");
  const filePath = `workflows/${dir}/${modelName}.json`;
  let workflow: any;
  try {
    const resp = await http("GET", `${getBaseUrl()}/api/userdata/${encodeURIComponent(filePath)}`, { headers: getHeaders() });
    workflow = typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data;
  } catch (err: any) {
    if (err?.response?.status === 404) throw new Error(`ComfyUI 上找不到工作流 user/default/${filePath}`);
    throw new Error(`读取工作流 ${filePath} 失败：${describeAxiosError(err)}`);
  }
  if (Array.isArray(workflow?.nodes)) throw new Error(`${filePath} 是 UI 格式，请在 ComfyUI 中用「导出 (API)」重新导出`);
  const isApiFormat = workflow && typeof workflow === "object" && Object.values(workflow).every((node: any) => node && node.class_type);
  if (!isApiFormat) throw new Error(`${filePath} 不是有效的 ComfyUI API 格式工作流`);
  return workflow;
};

type OutputKind = "image" | "video" | "audio";
const OUTPUT_EXT: Record<OutputKind, RegExp> = { image: /\.(png|jpe?g|webp)$/i, video: /\.(mp4|webm|mov|mkv|gif)$/i, audio: /\.(mp3|wav|flac|ogg|m4a|opus)$/i };
const OUTPUT_LABEL: Record<OutputKind, string> = { image: "图片", video: "视频", audio: "音频" };

const pickOutputFile = (outputs: Record<string, any>, nodeIds: string[], kind: OutputKind) => {
  const extPattern = OUTPUT_EXT[kind];
  const candidates = (nodeIds.length > 0 ? nodeIds : Object.keys(outputs)).map((id) => outputs[id]).filter(Boolean);
  for (const ui of candidates) {
    for (const key of ["preview_media", "videos", "gifs", "images", "video", "audio", "audios"]) {
      const items = Array.isArray(ui[key]) ? ui[key] : [];
      const file = items.find((item: any) => item?.filename && extPattern.test(item.filename));
      if (file) return file;
    }
  }
  return null;
};

// ToonFlow 的 pollTask 在任务被用户终止时返回这个 error
const CANCELLED = "已取消";

// 撤掉 ComfyUI 上的一个任务：在队列里就删除；正在执行就 /interrupt（ComfyUI 一次只跑一个，当前执行的就是它）
const cancelPrompt = async (promptId: string) => {
  const baseUrl = getBaseUrl();
  try {
    const resp = await http("GET", `${baseUrl}/queue`, { headers: getHeaders() });
    const isRunning = (resp.data?.queue_running || []).some((item: any) => item?.[1] === promptId);
    if (isRunning) await http("POST", `${baseUrl}/interrupt`, { headers: getHeaders(), json: {} });
    else await http("POST", `${baseUrl}/queue`, { headers: getHeaders(), json: { delete: [promptId] } });
    logger(`ComfyUI 任务已${isRunning ? "中断" : "从队列移除"} prompt_id=${promptId}`);
  } catch (err) {
    logger(`撤销 ComfyUI 任务失败 prompt_id=${promptId}：${describeAxiosError(err)}`);
  }
};

const runWorkflow = async (workflow: Record<string, any>, outputNodeIds: string[], kind: OutputKind): Promise<string> => {
  const baseUrl = getBaseUrl();
  let promptId = "";
  try {
    const resp = await http("POST", `${baseUrl}/prompt`, { headers: getHeaders(), json: { prompt: workflow, client_id: `toonflow-${crypto.randomUUID()}` } });
    promptId = resp.data.prompt_id;
  } catch (err) {
    throw new Error(`提交工作流失败：${describeAxiosError(err)}`);
  }
  logger(`ComfyUI 任务已提交 prompt_id=${promptId}`);

  // 语音与图片一样快，共用图片超时
  const timeoutKey = kind === "video" ? "videoTimeoutMinutes" : "imageTimeoutMinutes";
  const timeoutMinutes = Number(vendor.inputValues[timeoutKey]) || (kind === "video" ? 180 : 30);
  const result = await pollTask(
    async () => {
      const resp = await http("GET", `${baseUrl}/history/${promptId}`, { headers: getHeaders() });
      const entry = resp.data?.[promptId];
      if (!entry) return { completed: false };
      const status = entry.status || {};
      if (status.status_str === "error") {
        const errorMessage = (status.messages || []).find((m: any) => m[0] === "execution_error")?.[1];
        const interrupted = (status.messages || []).some((m: any) => m[0] === "execution_interrupted");
        if (interrupted) return { completed: true, error: "ComfyUI 任务被中断" };
        return {
          completed: true,
          error: errorMessage ? `节点 ${errorMessage.node_id}(${errorMessage.node_type}) 执行失败：${errorMessage.exception_message}` : "ComfyUI 执行失败",
        };
      }
      if (!status.completed) return { completed: false };
      const file = pickOutputFile(entry.outputs || {}, outputNodeIds, kind);
      if (!file) return { completed: true, error: `工作流已完成，但在输出节点中没有找到${OUTPUT_LABEL[kind]}（请给结果节点加 @output 标记）` };
      return { completed: true, data: JSON.stringify(file) };
    },
    kind === "video" ? 10000 : 3000,
    timeoutMinutes * 60 * 1000,
  );
  if (result.error === CANCELLED) {
    // ToonFlow 那边用户终止了：把工作流从 ComfyUI 撤掉（排队中的删掉，正在跑的中断），别让 GPU 白跑
    await cancelPrompt(promptId);
    throw new Error(CANCELLED);
  }
  if (result.error) throw new Error(result.error === "timeout" ? `等待 ComfyUI 结果超时（${timeoutMinutes} 分钟）prompt_id=${promptId}` : result.error);

  const file = JSON.parse(result.data!);
  const query = `filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder || "")}&type=${encodeURIComponent(file.type || "output")}`;
  logger(`ComfyUI 任务完成，下载 ${file.subfolder ? `${file.subfolder}/` : ""}${file.filename}`);
  try {
    // 下载与 base64 编码都在宿主里做（urlToBase64），沙盒只拿到一个字符串；沙盒里 Buffer.from(resp.data) 会逐字节穿越 vm2 的膜
    const dataUrl = await urlToBase64(`${baseUrl}/view?${query}`, getHeaders());
    const fallbackMime = { image: "image/png", video: "video/mp4", audio: "audio/mpeg" }[kind];
    const { mime } = parseDataUrl(dataUrl);
    return mime.startsWith(`${kind}/`) ? dataUrl : `data:${fallbackMime};base64,${parseDataUrl(dataUrl).data}`;
  } catch (err) {
    throw new Error(`下载结果失败：${describeAxiosError(err)}`);
  }
};

// 读取工作流中各节点类型的输入定义（用于比例下拉框匹配与必填输入判断）；读取失败的类型按缺失处理
const loadNodeDefs = async (workflow: Record<string, any>): Promise<Record<string, any>> => {
  const classTypes = [...new Set(Object.values(workflow).map((node: any) => String(node.class_type)))];
  const entries = await Promise.all(
    classTypes.map(async (classType) => {
      try {
        const resp = await http("GET", `${getBaseUrl()}/object_info/${encodeURIComponent(classType)}`, { headers: getHeaders() });
        return [classType, resp.data?.[classType]];
      } catch (err) {
        logger(`读取节点定义 ${classType} 失败：${describeAxiosError(err)}`);
        return [classType, undefined];
      }
    }),
  );
  return Object.fromEntries(entries.filter(([, def]) => def));
};

const uploadMediaLists = async (media: MediaLists): Promise<Record<string, string>> => {
  const entries = await Promise.all(
    (Object.keys(media) as MediaKind[]).flatMap((kind) =>
      media[kind].slice(0, MAX_MEDIA_PER_KIND).map(async (base64, index) => [`${kind}${index + 1}`, await uploadMedia(base64, kind)] as const),
    ),
  );
  return Object.fromEntries(entries);
};

const generate = async (modelName: string, kind: OutputKind, prompt: string, media: MediaLists, values: Record<string, any>) => {
  const workflow = await loadWorkflow(modelName);
  const [nodeDefs, mediaValues] = await Promise.all([loadNodeDefs(workflow), uploadMediaLists(media)]);
  const megapixels = Math.round(((values.width * values.height) / (1024 * 1024)) * 100) / 100;
  const tagged = applyTags(workflow, { megapixels, ...values, ...mediaValues, prompt, seed: Math.floor(Math.random() * 2 ** 32) }, nodeDefs);

  // 工具型工作流（去背景）不吃提示词，只要求至少有一张图进去了
  const isUtility = vendor.models.some((m) => m.modelName === modelName && m.type === "image" && m.utility);
  if (!tagged.applied.has("prompt") && !isUtility) throw new Error(`工作流 ${modelName} 缺少 @prompt 标记`);
  if (isUtility && !tagged.applied.has("image1")) throw new Error(`工作流 ${modelName} 需要一张图（@image1）`);
  for (const mediaKind of Object.keys(media) as MediaKind[]) {
    const uploaded = Object.keys(mediaValues).filter((key) => key.startsWith(mediaKind)).length;
    const used = [...tagged.applied].filter((key) => new RegExp(`^${mediaKind}\\d+$`).test(key)).length;
    if (used < uploaded) logger(`工作流 ${modelName} 只有 ${used} 个 @${mediaKind}N 标记，忽略多余的 ${uploaded - used} 个${MEDIA_LABELS[mediaKind]}`);
  }
  if (tagged.removedNodeIds.length > 0) logger(`未分配参考素材，已移除节点 ${tagged.removedNodeIds.join(",")}`);

  return runWorkflow(tagged.workflow, tagged.outputNodeIds, kind);
};

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  return "";
};

// ToonFlow 资产生成（assetsGenerate/generateAssets.ts）会给提示词包上「请根据以下参数生成角色标准四视图…」等说明行，
// 这些中文说明对扩散模型是噪声，这里只保留「提示词:」后面的正文
const WRAPPER_LINE_PATTERNS = [/^\s*请根据以下参数生成.*$/, /^\s*请严格按照系统规范生成.*$/, /^\s*\*\*[^*]+\*\*\s*$/, /^\s*-\s*画风风格\s*[:：].*$/, /^\s*-\s*名称\s*[:：].*$/];

const stripToonflowWrapper = (prompt: string): string =>
  String(prompt || "")
    .split("\n")
    .filter((line) => !WRAPPER_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .map((line) => line.replace(/^\s*-\s*提示词\s*[:：]/, ""))
    .join("\n")
    .trim();

const PORTRAIT_MODEL = "krea2_portrait";
const PORTRAIT_DEFAULT_ASPECT = "9:16";
const MULTI_VIEW_PATTERN =
  /四视图|三视图|设定图|character design sheet|character turnaround|turnaround|同一画面|左至右并排|人像特写|全身立像|正视图|侧视图|后视图|纯净(深灰|中性灰)背景|img2img|基础形象图为底图|多视图|拼图/i;
const PORTRAIT_SUFFIX = "单人定妆照，single character portrait，画面中只有一位角色，全身构图，头顶到鞋底完整入画，四周留少量空白，正面微侧自然站姿，柔和主光与轮廓光，简洁深灰渐变背景，单一画面，不拼图，不分格";

// 人物定妆照只出竖图：请求本身是竖向比例就沿用，否则用 9:16
const portraitAspect = (aspectRatio?: string): string => (parseRatio(aspectRatio ?? "") < 1 ? String(aspectRatio) : PORTRAIT_DEFAULT_ASPECT);

// 人物定妆照：去掉四视图相关的句段，改为单人竖图
const cleanPortraitPrompt = (prompt: string): string => {
  const segments = stripToonflowWrapper(prompt)
    .split(/[，,\n]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !MULTI_VIEW_PATTERN.test(segment));
  return [...segments, PORTRAIT_SUFFIX].join("，");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const isPortrait = model.modelName === PORTRAIT_MODEL;
  const aspectRatio = isPortrait ? portraitAspect(config.aspectRatio) : config.aspectRatio;
  const prompt = isPortrait ? cleanPortraitPrompt(config.prompt) : stripToonflowWrapper(config.prompt);
  const { width, height } = imageSizeFromConfig(config.size, aspectRatio);
  const images = classifyReferences(config.referenceList).image;
  logger(`ComfyUI 生图 ${model.modelName} ${width}x${height} 参考图 ${images.length} 张`);
  return generate(model.modelName, "image", prompt, { image: images, audio: [], video: [] }, { width, height, aspect: aspectRatio });
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const { width, height } = videoSizeFromConfig(config.resolution, config.aspectRatio);
  const mode = ([] as any[]).concat(config.mode ?? []);
  const media = mode.includes("text") ? { image: [], audio: [], video: [] } : classifyReferences(config.referenceList);
  const length = framesFromDuration(config.duration);
  logger(
    `ComfyUI 生视频 ${model.modelName} ${width}x${height} ${config.duration}s(${length}帧) 参考图 ${media.image.length} 张 音频 ${media.audio.length} 段 视频 ${media.video.length} 段`,
  );
  return generate(model.modelName, "video", config.prompt, media, { width, height, length, duration: config.duration, aspect: config.aspectRatio });
};

// 文本转语音：@prompt 接朗读文本；连入的音频作 @audio1 音色参考（没接标记时自动移除）；
// @voice / @speed / @pitch / @volume 都是可选标记，voice 为空时不写入（避免把空串塞进下拉框）
const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  const audios = classifyReferences(config.referenceList as ReferenceList[] | undefined).audio;
  const values: Record<string, any> = { speed: config.speechRate, pitch: config.pitchRate, volume: config.volume };
  if (config.voice) values.voice = config.voice;
  logger(`ComfyUI 文本转语音 ${model.modelName} 文本 ${String(config.text || "").length} 字 音色参考 ${audios.length} 段 voice=${config.voice || "(默认)"}`);
  return generate(model.modelName, "audio", String(config.text || ""), { image: [], audio: audios, video: [] }, values);
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;

// 这行代码用于确保当前文件被识别为模块，避免全局变量冲突
export {};
