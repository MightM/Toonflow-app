import express from "express";
import { z } from "zod";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetKey, nodeKey, parseKey, readLayout, writeLayout } from "@/lib/canvas";
const router = express.Router();

// 复制节点（⌘/Ctrl + C / V、Option 拖动）：自由节点连同当前版本的文件一起复制；
// 资产复制成同类型的新资产（根 → 新根，状态 → 同一根下的新状态），当前图也复制；
// 被复制的节点之间的参考连线一并复制（与外部节点的连线不复制）。
// 跨项目粘贴时资产降级成自由图片节点（资产依赖本项目的剧本 / 集数关系）。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    sourceProjectId: z.number().optional().nullable(),
    items: z.array(z.object({ key: z.string(), position: z.object({ x: z.number(), y: z.number() }) })).min(1).max(100),
  }),
  async (req, res) => {
    const { projectId, items } = req.body;
    const sourceProjectId: number = req.body.sourceProjectId ?? projectId;
    const crossProject = sourceProjectId !== projectId;
    try {
      const keyMap: Record<string, string> = {};
      const positions: Record<string, { x: number; y: number }> = {};
      for (const item of items) {
        const owner = parseKey(item.key);
        if (owner.kind === "node") keyMap[item.key] = await copyNode(owner.id, sourceProjectId, projectId);
        else if (owner.kind === "asset") keyMap[item.key] = crossProject ? await assetToNode(owner.id, sourceProjectId, projectId) : await copyAsset(owner.id, projectId);
        else continue;
        positions[keyMap[item.key]] = item.position;
      }
      // 被复制节点之间的连线
      const edges = await u.db("o_canvasEdge").where("projectId", sourceProjectId).whereIn("sourceKey", Object.keys(keyMap)).whereIn("targetKey", Object.keys(keyMap));
      if (edges.length) {
        await u
          .db("o_canvasEdge")
          .insert(edges.map((e) => ({ projectId, sourceKey: keyMap[e.sourceKey!], targetKey: keyMap[e.targetKey!], sort: e.sort ?? 0, createTime: Date.now() })));
      }
      const layout = await readLayout(projectId);
      await writeLayout(projectId, { ...layout, positions: { ...layout.positions, ...positions } });
      res.status(200).send(success({ keyMap, keys: Object.values(keyMap) }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);

/** 复制一条已完成的 o_image（连文件）到新的归属；返回新 imageId，没有可复制的返回 null */
async function copyImage(imageId: number | null | undefined, projectId: number, owner: { canvasNodeId?: number; assetsId?: number }, dir: string) {
  if (!imageId) return null;
  const row = await u.db("o_image").where({ id: imageId, state: "已完成" }).first();
  if (!row?.filePath) return null;
  const ext = path.extname(row.filePath) || ".jpg";
  const filePath = `/${projectId}/${dir}/${uuidv4()}${ext}`;
  await u.oss.writeFile(filePath, await u.oss.getFile(row.filePath));
  const [newId] = await u.db("o_image").insert({
    type: row.type,
    state: "已完成",
    filePath,
    model: row.model,
    resolution: row.resolution,
    aspectRatio: row.aspectRatio,
    prompt: row.prompt,
    kind: row.kind,
    stage: row.stage,
    refs: null,
    createTime: Date.now(),
    ...owner,
  });
  return newId;
}

async function copyNode(id: number, sourceProjectId: number, projectId: number) {
  const row = await u.db("o_canvasNode").where({ id, projectId: sourceProjectId }).first();
  if (!row) throw new Error(`节点 n:${id} 不存在`);
  // 跨项目：音色引用（音色库资产 / 别的画布上的音频节点）在目标项目里都不存在，清掉
  let params = row.params;
  if (sourceProjectId !== projectId && params) {
    try {
      const parsed = JSON.parse(params);
      delete parsed.voice;
      params = JSON.stringify(parsed);
    } catch {
      params = row.params;
    }
  }
  const [newId] = await u.db("o_canvasNode").insert({ projectId, kind: row.kind, name: row.name, prompt: row.prompt, params, createTime: Date.now() });
  const imageId = await copyImage(row.imageId, projectId, { canvasNodeId: newId }, "canvas");
  if (imageId) await u.db("o_canvasNode").where("id", newId).update({ imageId });
  return nodeKey(newId);
}

const ASSET_DIR: Record<string, string> = { role: "role", scene: "scene", tool: "props" };

async function copyAsset(id: number, projectId: number) {
  const row = await u.db("o_assets").where({ id, projectId }).first();
  if (!row) throw new Error(`资产 a:${id} 不存在`);
  const [newId] = await u.db("o_assets").insert({
    name: `${row.name ?? "资产"} 副本`,
    describe: row.describe ?? "",
    prompt: row.prompt ?? "",
    type: row.type,
    projectId,
    assetsId: row.assetsId ?? null,
    scriptId: row.scriptId ?? null,
    startTime: Date.now(),
  });
  const links = await u.db("o_scriptAssets").where("assetId", id).select("scriptId");
  if (links.length) await u.db("o_scriptAssets").insert(links.map((l) => ({ scriptId: l.scriptId, assetId: newId })));
  const imageId = await copyImage(row.imageId, projectId, { assetsId: newId }, ASSET_DIR[row.type ?? ""] ?? "canvas");
  if (imageId) await u.db("o_assets").where("id", newId).update({ imageId });
  return assetKey(newId);
}

/** 跨项目：资产降级成自由图片节点（名字、提示词、当前图保留，类型作标签） */
async function assetToNode(id: number, sourceProjectId: number, projectId: number) {
  const row = await u.db("o_assets").where({ id, projectId: sourceProjectId }).first();
  if (!row) throw new Error(`资产 a:${id} 不存在`);
  const [newId] = await u.db("o_canvasNode").insert({
    projectId,
    kind: "image",
    name: row.name,
    prompt: row.prompt ?? "",
    params: JSON.stringify({ assetType: row.type }),
    createTime: Date.now(),
  });
  const imageId = await copyImage(row.imageId, projectId, { canvasNodeId: newId }, "canvas");
  if (imageId) await u.db("o_canvasNode").where("id", newId).update({ imageId });
  return nodeKey(newId);
}
