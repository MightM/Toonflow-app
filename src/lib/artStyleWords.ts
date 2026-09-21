import fs from "fs";
import path from "path";
import u from "@/utils";

// 视觉手册（data/skills/art_skills/<style>/）的轻量信息：给画布的「风格」胶囊用。
// 风格词取自 prefix.md 的「风格基因」表（一级风格 / 二级风格 / 质感锚词），没有这张表时退回 README 首行。

export interface ArtStyleInfo {
  stylePath: string;
  name: string;
  cover: string | null;
  /** 追加到提示词末尾的一行风格词 */
  line: string;
}

const GENE_ROWS = ["一级风格", "二级风格", "质感锚词"] as const;
const MAX_TEXTURE_CHARS = 60; // 有的手册锚词写成了一段话，只取前面一截

/** 从 prefix.md 的 markdown 表格里取「| **一级风格** | xxx |」这类行 */
function parseGene(prefix: string): Partial<Record<(typeof GENE_ROWS)[number], string>> {
  const out: Partial<Record<(typeof GENE_ROWS)[number], string>> = {};
  for (const line of prefix.split("\n")) {
    const match = /^\|\s*\**([^*|]+?)\**\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (!match) continue;
    const key = match[1].trim() as (typeof GENE_ROWS)[number];
    if (GENE_ROWS.includes(key) && !out[key]) out[key] = match[2].trim();
  }
  return out;
}

const readText = (file: string) => {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return "";
  }
};

export function styleName(stylePath: string): string {
  const readme = readText(path.join(u.getPath(["skills", "art_skills", stylePath]), "README.md"));
  return (readme.split("\n")[0] ?? "").replace(/^#+\s*/, "").replace(/--/g, "").trim() || stylePath;
}

/** 一行风格词，如「画风：超写实3D真人渲染（Hyperreal 3D Human CG）· 电影级夜色灯光；质感：超写实3D渲染、完美面容…」 */
export function styleLine(stylePath: string): string {
  const dir = u.getPath(["skills", "art_skills", stylePath]);
  if (!fs.existsSync(dir)) return "";
  const gene = parseGene(readText(path.join(dir, "prefix.md")));
  const main = [gene["一级风格"], gene["二级风格"]].filter(Boolean).join(" · ");
  const texture = (gene["质感锚词"] ?? "").slice(0, MAX_TEXTURE_CHARS);
  const parts = [main ? `画风：${main}` : `画风：${styleName(stylePath)}`, texture ? `质感：${texture}` : ""].filter(Boolean);
  return parts.join("；");
}

export async function listArtStyles(): Promise<ArtStyleInfo[]> {
  const root = u.getPath(["skills", "art_skills"]);
  if (!fs.existsSync(root)) return [];
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  return Promise.all(
    dirs.map(async (d) => {
      let cover: string | null = null;
      try {
        const images = fs.readdirSync(path.join(root, d.name, "images")).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)).sort();
        if (images[0]) cover = await u.oss.getFileUrl(path.join("art_skills", d.name, "images", images[0]), "skills");
      } catch {
        cover = null;
      }
      return { stylePath: d.name, name: styleName(d.name), cover, line: styleLine(d.name) };
    }),
  );
}
