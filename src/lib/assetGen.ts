import fs from "fs";
import u from "@/utils";
import getPath from "@/utils/getPath";
import { v4 as uuidv4 } from "uuid";

// ─── 资产生成：模型绑定 + 角色多视图 ─────────────────────────────
// 画布、旧资产页、生产 Agent 三条路径共用这里的逻辑。
// 角色一步直出多视图（主大头照 + 正 / 侧 / 背全身）；想用定妆照做身份参考时，
// 在画布上把定妆照连到角色节点即可（走「有参考图」的绑定）。

export type AssetType = "role" | "scene" | "tool";
export type ImageSize = "1K" | "2K" | "4K";

export const ASSET_MODEL_KEYS = ["roleSheet", "roleSheetRef", "roleDerive", "scene", "sceneDerive", "prop", "propDerive"] as const;
export type AssetModelKey = (typeof ASSET_MODEL_KEYS)[number];

export interface AssetModelBinding {
  model: string; // "vendorId:modelName"，空串 = 跟随项目的图片模型
  aspectRatio: `${number}:${number}`;
}
export type AssetModels = Record<AssetModelKey, AssetModelBinding>;

// 内置默认只定比例，模型留空（跟随项目图片模型）；具体工作流在全局默认或项目绑定里配置
const BUILTIN_DEFAULTS: AssetModels = {
  roleSheet: { model: "", aspectRatio: "16:9" },
  roleSheetRef: { model: "", aspectRatio: "16:9" },
  roleDerive: { model: "", aspectRatio: "16:9" },
  scene: { model: "", aspectRatio: "16:9" },
  sceneDerive: { model: "", aspectRatio: "16:9" },
  prop: { model: "", aspectRatio: "16:9" },
  propDerive: { model: "", aspectRatio: "16:9" },
};

// 上一版（定妆照 → 四视图两步）的 key，读取旧配置时兼容
const LEGACY_KEY_MAP: Partial<Record<string, AssetModelKey>> = { roleFourView: "roleSheetRef" };

export const GLOBAL_DEFAULT_SETTING_KEY = "assetModelsDefault";

const TYPE_CONFIG: Record<AssetType, { label: string; taskClass: string; dir: string; title: string }> = {
  role: { label: "角色", taskClass: "角色图生成", dir: "role", title: "人物多视图" },
  scene: { label: "场景", taskClass: "场景图生成", dir: "scene", title: "场景三视图" },
  tool: { label: "道具", taskClass: "道具图生成", dir: "props", title: "道具三视图" },
};

type BindingLayer = Partial<Record<string, Partial<AssetModelBinding>>>;

const parseJson = (raw: string | null | undefined): BindingLayer => {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return {};
    const layer: BindingLayer = { ...value };
    for (const [legacy, key] of Object.entries(LEGACY_KEY_MAP)) {
      if (key && layer[legacy] && !layer[key]) layer[key] = layer[legacy];
    }
    return layer;
  } catch {
    return {};
  }
};

const mergeBindings = (...layers: BindingLayer[]): AssetModels => {
  const merged = {} as AssetModels;
  for (const key of ASSET_MODEL_KEYS) {
    merged[key] = layers.reduce<AssetModelBinding>(
      (acc, layer) => {
        const item = layer[key];
        if (!item) return acc;
        return {
          model: typeof item.model === "string" && item.model ? item.model : acc.model,
          aspectRatio: (item.aspectRatio as AssetModelBinding["aspectRatio"]) || acc.aspectRatio,
        };
      },
      { ...BUILTIN_DEFAULTS[key] },
    );
  }
  return merged;
};

export async function getGlobalAssetModels(): Promise<AssetModels> {
  const row = await u.db("o_setting").where("key", GLOBAL_DEFAULT_SETTING_KEY).select("value").first();
  return mergeBindings(parseJson(row?.value as string | undefined));
}

/** 项目绑定 → 全局默认 → 内置默认，逐项补齐 */
export async function getAssetModels(projectId: number): Promise<AssetModels> {
  const [globalRow, project] = await Promise.all([
    u.db("o_setting").where("key", GLOBAL_DEFAULT_SETTING_KEY).select("value").first(),
    u.db("o_project").where("id", projectId).select("assetModels").first(),
  ]);
  return mergeBindings(parseJson(globalRow?.value as string | undefined), parseJson(project?.assetModels));
}

/** 选绑定：显式参考（画布连线 / 上传参考图）优先；衍生资产默认以父资产为参考 */
export function bindingKeyFor(type: AssetType, isDerived: boolean, hasRefs: boolean): AssetModelKey {
  if (type === "role") return hasRefs ? "roleSheetRef" : isDerived ? "roleDerive" : "roleSheet";
  if (type === "scene") return isDerived ? "sceneDerive" : "scene";
  return isDerived ? "propDerive" : "prop";
}

/** 绑定的模型为空时回退到项目图片模型 */
export async function resolveBinding(projectId: number, key: AssetModelKey): Promise<{ model: string; aspectRatio: `${number}:${number}` }> {
  const models = await getAssetModels(projectId);
  const binding = models[key];
  if (binding.model) return binding;
  const project = await u.db("o_project").where("id", projectId).select("imageModel").first();
  return { model: project?.imageModel ?? "", aspectRatio: binding.aspectRatio };
}

// ─── 提示词 ────────────────────────────────────────────────

const SHEET_FORMAT_FILE = "asset_character_sheet_format.md";

// data/skills/asset_character_sheet_format.md 缺失时使用；两处内容保持一致
const SHEET_FORMAT_FALLBACK = `【输出格式】
一张{{orientation}}{{ratio}}人物多视图，纯白无缝影棚背景，无文字、无标签、无水印、无多余人物、无镜面反射。画面只包含四个视图，自左至右排列：第1个主大头照约占31%宽度，第2、3、4个全身视图各约占23%宽度，其余为均匀留白；各视图之间不重叠、不设分割线。画面中只有这一个大头照，不要生成额外的小头像、表情图或局部特写。主大头照作为唯一人脸身份母版，三个全身视图的脸部必须严格复用同一骨相、脸长宽比例、五官位置与尺寸、发际线、发型结构、肤色和年龄。

1. 主大头照：严格0°正面平视，头顶、双耳和双肩完整入画，四周留有空白，不被裁切、不被其他视图遮挡；鼻尖、下巴和面部中线正对镜头，瞳孔自然居中。
2. 正面全身照：严格0°正面站立，头部、肩线、胸口、髋部、膝盖和双脚均正对前方，双手自然下垂，双眼正视前方；从头顶到鞋底完整入镜，占该区域高度约90%，展示上装、袖口、腰饰、下装和鞋履的正面。
3. 侧面全身照：严格朝画面右侧90°侧身站立，头部、鼻尖、下巴、躯干、髋部、膝盖和双脚方向全部朝右，视线自然朝右前方，绝不回看镜头；完整呈现额头、鼻梁、鼻尖、嘴唇、下巴、耳朵、发型后部和服装侧面轮廓。
4. 背面全身照：严格180°背对镜头直立，后脑、颈部、肩背、腰臀、腿部和脚后跟完全正对镜头，从头到脚完整入镜；不得回头，不露眼睛、鼻子或侧脸，清晰展示发型后部、服装背面、腰饰、下装与鞋履后跟。

全身三视图镜头高度、透视、光线、白平衡、色彩、人物比例和服装细节完全一致，脚部完整可见。避免主大头照与全身视图不是同一张脸，避免不同视图年龄、体型、发型、服装或配饰漂移；避免斜站、斗鸡眼、错误肢体、重复肢体、裁切和变形。`;

/** 读 data/skills/ 下的固定格式文件；缺失或读取失败返回 null */
function readFormatFile(name: string): string | null {
  try {
    const file = getPath(["skills", name]);
    // 文件开头可以有说明注释（HTML 注释），发送前去掉
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf-8").replace(/<!--[\s\S]*?-->/g, "").trim();
  } catch (e) {
    console.warn(`[格式模板] ${name} 读取失败`, u.error(e).message);
  }
  return null;
}

function fillFormat(format: string, aspectRatio: string): string {
  return format.replaceAll("{{ratio}}", aspectRatio).replaceAll("{{orientation}}", orientationOf(aspectRatio));
}

function orientationOf(aspectRatio: string) {
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h || w === h) return "";
  return w > h ? "横向" : "竖向";
}

/** 角色多视图 = 开头一句 + 【人物需求】（视觉手册润色出的正文）+ 固定【输出格式】 */
export function buildCharacterSheetPrompt(content: string, aspectRatio: string): string {
  const format = fillFormat(readFormatFile(SHEET_FORMAT_FILE) ?? SHEET_FORMAT_FALLBACK, aspectRatio);
  const body = content.trim().replace(/^【人物需求】\s*/, "");
  return `根据以下需求生成一张专业人物多视图：\n\n【人物需求】\n${body}\n\n${format}`;
}

// 场景 / 道具三视图：开头一句 + 【场景需求】/【道具需求】（视觉手册润色出的正文）+ 固定【输出格式】
const SCENE_PROP_SHEET: Record<Exclude<AssetType, "role">, { file: string; subject: string; section: string }> = {
  scene: { file: "asset_scene_sheet_format.md", subject: "场景", section: "场景需求" },
  tool: { file: "asset_prop_sheet_format.md", subject: "物品", section: "道具需求" },
};

function buildScenePropSheetPrompt(type: Exclude<AssetType, "role">, content: string, aspectRatio: string, isDerived: boolean): string | null {
  const sheet = SCENE_PROP_SHEET[type];
  const format = readFormatFile(sheet.file);
  if (!format) return null;
  const body = content.trim().replace(new RegExp(`^【${sheet.section}】\\s*`), "");
  const intro = isDerived
    ? `以参考图1中的${sheet.subject}为基准（参考图可能是单图或三视图），保持${sheet.subject}本体不变，按以下需求生成同一个${sheet.subject}变体的三视图参考图，用于后续分镜图和参考生视频：`
    : `根据以下需求生成同一个${sheet.subject}的三视图参考图，用于后续分镜图和参考生视频：`;
  return `${intro}\n\n【${sheet.section}】\n${body}\n\n${fillFormat(format, aspectRatio)}`;
}

// 格式文件缺失时的旧包装：行格式与 ComfyUI 适配器的 stripToonflowWrapper 对齐（「请根据以下参数生成…」「- 画风风格:」等行会被剥掉）
function buildScenePropPrompt(type: Exclude<AssetType, "role">, artStyle: string, name: string, prompt: string): string {
  const cfg = TYPE_CONFIG[type];
  return `
    请根据以下参数生成${cfg.title}：

    **基础参数：**
    - 画风风格: ${artStyle || "未指定"}

    **${cfg.label}设定：**
    - 名称:${name},
    - 提示词:${prompt},

    请严格按照系统规范生成${cfg.title}。
  `;
}

export function buildAssetPrompt(type: AssetType, artStyle: string, name: string, prompt: string, aspectRatio: string, isDerived = false): string {
  if (type === "role") return buildCharacterSheetPrompt(prompt, aspectRatio);
  return buildScenePropSheetPrompt(type, prompt, aspectRatio, isDerived) ?? buildScenePropPrompt(type, artStyle, name, prompt);
}

/** 润色用的视觉手册：角色产出【人物需求】正文，场景 / 道具产出三视图的【场景需求】/【道具需求】正文；衍生资产以参考图1为基准 */
export function getPolishManual(artStyle: string, type: AssetType, isDerived: boolean): string {
  const file = { role: "art_character", scene: "art_scene", tool: "art_prop" }[type];
  return u.getArtPrompt(artStyle, "art_skills", isDerived ? `${file}_derivative` : file);
}

// ─── 生成 ────────────────────────────────────────────────

export interface GenerateStageInput {
  projectId: number;
  assetId: number;
  model?: string; // 缺省 = 按绑定取
  size?: ImageSize; // 缺省 = 项目 imageQuality
  aspectRatio?: `${number}:${number}`; // 缺省 = 按绑定取
  prompt?: string; // 缺省 = 资产上保存的提示词
  rawPrompt?: boolean; // true = 不套资产模板
  referenceBase64?: string[]; // 显式参考图（画布连线 / 上传），有就走「有参考图」的绑定
  refKeys?: string[]; // 记录在 o_image.refs 里
  earlyRepoint?: boolean; // 旧前端靠 imageId 轮询，需要先把 imageId 指向占位
  resolvePrompt?: () => Promise<string>; // 执行时才生成提示词（如先让 LLM 按视觉手册写），结果会写回资产
  resolveReferences?: () => Promise<string[]>; // 执行时才取的参考图（如工作流上一步的产物），排在显式参考之后
  stage?: string; // o_image.stage；缺省：角色 sheet，其余空
  setCurrent?: boolean; // false = 只留在历史里，不设为资产当前图（工作流中间步骤）
}

export interface PreparedStage {
  imageId: number;
  run: () => Promise<{ ok: boolean; filePath?: string; error?: string }>;
}

const toSize = (value: unknown): ImageSize => (value === "2K" || value === "4K" ? value : "1K");

async function imagePathBase64(filePath: string | null | undefined): Promise<string | null> {
  if (!filePath) return null;
  try {
    return await u.oss.getImageBase64(filePath);
  } catch {
    return null;
  }
}

/** 资产当前可用作参考的图 */
export async function assetReferencePath(assetId: number): Promise<string | null> {
  const asset = await u.db("o_assets").where("id", assetId).select("imageId").first();
  if (!asset?.imageId) return null;
  const image = await u.db("o_image").where({ id: asset.imageId, state: "已完成" }).select("filePath").first();
  return image?.filePath ?? null;
}

/**
 * 插入「生成中」占位并返回执行函数。调用方决定同步 await 还是丢到后台。
 * 只有成功时才改资产的 imageId（earlyRepoint 时失败会恢复原值）。
 */
export async function prepareAssetStage(input: GenerateStageInput): Promise<PreparedStage> {
  const asset = await u.db("o_assets").where("id", input.assetId).select("*").first();
  if (!asset) throw new Error("资产不存在");
  const type = asset.type as AssetType;
  if (!TYPE_CONFIG[type]) throw new Error(`不支持的资产类型: ${asset.type}`);
  const project = await u.db("o_project").where("id", input.projectId).select("artStyle", "imageQuality").first();
  if (!project) throw new Error("项目不存在");

  const isDerived = asset.assetsId != null;
  const explicitRefs = (input.referenceBase64 ?? []).filter(Boolean);
  const hasExplicitRefs = explicitRefs.length > 0 || !!input.resolveReferences;
  const binding = await resolveBinding(input.projectId, bindingKeyFor(type, isDerived, hasExplicitRefs));
  const model = input.model || binding.model;
  if (!model || !model.includes(":")) throw new Error("未配置生成模型，请在资产模型绑定里设置");
  const aspectRatio = input.aspectRatio || binding.aspectRatio;
  const size = toSize(input.size ?? project.imageQuality);

  // 参考图：显式参考优先；没有时衍生资产自动带父资产当前图
  const referenceList: { type: "image"; base64: string }[] = explicitRefs.map((base64) => ({ type: "image", base64 }));
  if (!hasExplicitRefs && isDerived) {
    const parentRef = await imagePathBase64(await assetReferencePath(asset.assetsId!));
    if (parentRef) referenceList.push({ type: "image", base64: parentRef });
  }

  const wrap = (text: string) => (input.rawPrompt ? text : buildAssetPrompt(type, project.artStyle ?? "", asset.name ?? "", text, aspectRatio, isDerived));
  let finalPrompt = wrap(input.prompt ?? asset.prompt ?? "");

  const [imageId] = await u.db("o_image").insert({
    type,
    state: "生成中",
    assetsId: asset.id,
    model: model.split(/:(.+)/)[1],
    resolution: size,
    aspectRatio,
    prompt: finalPrompt,
    kind: "image",
    stage: input.stage ?? (type === "role" ? "sheet" : null),
    refs: input.refKeys?.length ? JSON.stringify(input.refKeys) : null,
    createTime: Date.now(),
  });
  const previousImageId = asset.imageId ?? null;
  if (input.earlyRepoint) await u.db("o_assets").where("id", asset.id).update({ imageId });

  const cfg = TYPE_CONFIG[type];
  const run = async () => {
    const imagePath = `/${input.projectId}/${cfg.dir}/${uuidv4()}.jpg`;
    try {
      if (input.resolveReferences) {
        for (const base64 of await input.resolveReferences()) referenceList.push({ type: "image", base64 });
      }
      if (input.resolvePrompt) {
        const text = await input.resolvePrompt();
        finalPrompt = wrap(text);
        await u.db("o_assets").where("id", asset.id).update({ prompt: text });
        await u.db("o_image").where("id", imageId).update({ prompt: finalPrompt });
      }
      const aiImage = u.Ai.Image(model as `${string}:${string}`);
      await aiImage.run(
        { prompt: finalPrompt, referenceList, size, aspectRatio },
        {
          taskClass: cfg.taskClass,
          describe: `生成${cfg.label}图，名称：${asset.name}`,
          projectId: input.projectId,
          relatedObjects: JSON.stringify({ id: asset.id, projectId: input.projectId, type: cfg.label }),
        },
      );
      const current = await u.db("o_image").where("id", imageId).select("state").first();
      if (!current) return { ok: false, error: "资产已被删除" };
      if (current.state === "生成失败") return { ok: false, error: "已取消" };
      await aiImage.save(imagePath);
      await u.db("o_image").where("id", imageId).update({ state: "已完成", filePath: imagePath });
      if (input.setCurrent !== false) await u.db("o_assets").where("id", asset.id).update({ imageId });
      return { ok: true, filePath: imagePath };
    } catch (e) {
      const message = u.error(e).message || "图片生成失败";
      await u.db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: message });
      if (input.earlyRepoint) await restoreImageId(asset.id!, imageId, previousImageId);
      return { ok: false, error: message };
    }
  };
  return { imageId, run };
}

/** 失败时把提前指向占位的 imageId 恢复成原来那张 */
async function restoreImageId(assetId: number, failedImageId: number, previousImageId: number | null) {
  const asset = await u.db("o_assets").where("id", assetId).select("imageId").first();
  if (!asset || asset.imageId !== failedImageId) return;
  if (!previousImageId) return; // 原来就没有图，保留失败占位让旧界面能显示错误
  const previous = await u.db("o_image").where({ id: previousImageId, state: "已完成" }).first();
  if (previous) await u.db("o_assets").where("id", assetId).update({ imageId: previousImageId });
}
