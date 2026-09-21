import fs from "fs";
import path from "path";
import u from "@/utils";
import getPath from "@/utils/getPath";
import { ASSET_MODEL_KEYS, type AssetModelKey, getAssetModels } from "@/lib/assetGen";

// ─── 画布「目标模板」：data/skills/canvas_presets/*.md ─────────────────
// 每个文件 = 头部配置（--- 包裹的 key: value）+ 提示词正文；格式说明见目录下的 README.md。每次读取都重新扫描，改了即时生效。

const PRESET_DIR = "canvas_presets";

export interface CanvasPreset {
  id: string;
  name: string;
  group: string;
  icon: string;
  desc: string;
  targets: string[];
  binding: [string, string]; // [无参考, 有参考]，空串 = 不用绑定
  model: [string, string]; // 绑定未配置模型时的默认值
  ratio: string;
  size: string;
  requiresRef: boolean;
  polish: string;
  hint: string;
  order: number;
  pre: string; // 工作流前置步骤的模板 id：先按它生成一张图，再把结果作为本模板的参考图
  hidden: boolean; // true = 只作为别的模板的前置步骤，不出现在选择面板里
  body: string;
}

const pair = (raw: string | undefined): [string, string] => {
  const [a = "", b] = String(raw ?? "").split("|").map((s) => s.trim());
  return [a, b ?? a];
};

function parsePreset(id: string, text: string): CanvasPreset | null {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = /^\s*([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  if (!meta.name) return null;
  return {
    id,
    name: meta.name,
    group: meta.group || "通用",
    icon: meta.icon || "magic",
    desc: meta.desc || "",
    targets: (meta.targets || "image").split(",").map((s) => s.trim()).filter(Boolean),
    binding: pair(meta.binding),
    model: pair(meta.model),
    ratio: meta.ratio || "",
    size: meta.size || "",
    requiresRef: meta.requiresRef === "true",
    polish: meta.polish || "",
    hint: meta.hint || "",
    order: Number(meta.order) || 100,
    pre: meta.pre || "",
    hidden: meta.hidden === "true",
    body: match[2].trim(),
  };
}

export function listPresets(): CanvasPreset[] {
  const dir = getPath(["skills", PRESET_DIR]);
  if (!fs.existsSync(dir)) return [];
  const presets: CanvasPreset[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md") || file.toLowerCase() === "readme.md") continue;
    try {
      const preset = parsePreset(file.replace(/\.md$/, ""), fs.readFileSync(path.join(dir, file), "utf-8"));
      if (preset) presets.push(preset);
    } catch (e) {
      console.warn("[目标模板] 读取失败", file, u.error(e).message);
    }
  }
  return presets.sort((a, b) => a.order - b.order);
}

export function getPreset(id: string): CanvasPreset | undefined {
  return listPresets().find((p) => p.id === id);
}

function orientationOf(aspectRatio: string) {
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h || w === h) return "";
  return w > h ? "横向" : "竖向";
}

/** 展开 {{include:文件}}（去掉 HTML 注释），其余占位符保留 */
export function expandIncludes(body: string): string {
  return body
    .replace(/\{\{include:([^}]+)\}\}/g, (_, name: string) => {
      const file = getPath(["skills", name.trim()]);
      if (!fs.existsSync(file)) return "";
      return fs.readFileSync(file, "utf-8").replace(/<!--[\s\S]*?-->/g, "").trim();
    })
    .replace(/<!--[\s\S]*?-->/g, "");
}

/** 展开 include，再替换 {{需求}} / {{ratio}} / {{orientation}} */
export function renderPreset(preset: CanvasPreset, text: string, aspectRatio: string): string {
  return expandIncludes(preset.body)
    .replaceAll("{{需求}}", text.trim())
    .replaceAll("{{ratio}}", aspectRatio)
    .replaceAll("{{orientation}}", orientationOf(aspectRatio))
    .trim();
}

/** 模板在项目里的默认模型：[无参考, 有参考]。绑定优先，其次模板里写的 model，最后项目图片模型 */
export async function presetDefaultModels(projectId: number, preset: CanvasPreset): Promise<[string, string]> {
  // 既没绑定也没写模型（如「自由描述」）= 不改用户选的模型
  if (!preset.binding.some(Boolean) && !preset.model.some(Boolean)) return ["", ""];
  const models = await getAssetModels(projectId);
  const project = await u.db("o_project").where("id", projectId).select("imageModel").first();
  const pick = (index: 0 | 1) => {
    const key = preset.binding[index];
    const bound = (ASSET_MODEL_KEYS as readonly string[]).includes(key) ? models[key as AssetModelKey].model : "";
    return bound || preset.model[index] || project?.imageModel || "";
  };
  return [pick(0), pick(1)];
}
