import u from "@/utils";
import { db as knexDb } from "@/utils/db";
import type { o_assets, o_assets2Storyboard, o_assetsRole2Audio, o_canvasEdge, o_canvasNode, o_image, o_scriptAssets } from "@/types/database";
import type { Knex } from "knex";
import { assetKey, EMPTY_LAYOUT, type CanvasLayout, type Owner } from "@/lib/canvas";

// 画布回收站：删除节点时把相关行做成快照再删，文件留在磁盘上，撤销时按快照原样写回。
// 超过保留期的快照在下次删除 / 打开画布时清理，那时才真正删文件。

export const TRASH_TTL = 24 * 60 * 60 * 1000;

interface LayoutSlice {
  positions: CanvasLayout["positions"];
  nodeMeta: CanvasLayout["nodeMeta"];
  pinned: string[];
  hidden: string[];
}

export interface TrashSnapshot {
  keys: string[];
  assets: o_assets[];
  nodes: o_canvasNode[];
  images: o_image[];
  storyboardLinks: o_assets2Storyboard[];
  scriptLinks: o_scriptAssets[];
  voiceLinks: o_assetsRole2Audio[];
  edges: o_canvasEdge[];
  layout: LayoutSlice;
}

// 布局里可能残留派生节点 id（上一版角色拆分留下的 a:1@portrait），按去掉后缀后的 key 匹配
const baseKey = (key: string) => key.replace(/@\w+$/, "");

function sliceLayout(layout: CanvasLayout, keys: string[]): { taken: LayoutSlice; rest: CanvasLayout } {
  const hit = (k: string) => keys.includes(baseKey(k));
  const split = <T>(record: Record<string, T>) => [
    Object.fromEntries(Object.entries(record).filter(([k]) => hit(k))),
    Object.fromEntries(Object.entries(record).filter(([k]) => !hit(k))),
  ];
  const [positions, restPositions] = split(layout.positions);
  const [nodeMeta, restMeta] = split(layout.nodeMeta);
  return {
    taken: { positions, nodeMeta, pinned: layout.pinned.filter(hit), hidden: layout.hidden.filter(hit) },
    rest: { positions: restPositions, nodeMeta: restMeta, pinned: layout.pinned.filter((k) => !hit(k)), hidden: layout.hidden.filter((k) => !hit(k)) },
  };
}

type Trx = Knex.Transaction;

/** 资产连同它的状态资产（根资产才有状态）的 id */
export async function assetFamilyIds(owner: Owner & { asset?: o_assets | null }, q: Knex | Trx = knexDb): Promise<number[]> {
  if (owner.kind !== "asset") return [];
  const self = await q("o_assets").where("id", owner.id).select("assetsId").first();
  const children = self && self.assetsId == null ? await q("o_assets").where("assetsId", owner.id).select("id") : [];
  return [owner.id, ...children.map((c: { id: number }) => c.id)];
}

// 布局的读改写放进同一事务（SQLite 只有一个连接，事务期间其它写入会排队），避免覆盖并发的拖动 / 固定
async function readLayoutTx(trx: Trx, projectId: number): Promise<CanvasLayout> {
  const row = await trx("o_canvas").where("projectId", projectId).select("layout").first();
  try {
    return { ...EMPTY_LAYOUT, ...(row?.layout ? JSON.parse(row.layout) : {}) };
  } catch {
    return { ...EMPTY_LAYOUT };
  }
}
async function writeLayoutTx(trx: Trx, projectId: number, layout: CanvasLayout) {
  const exists = await trx("o_canvas").where("projectId", projectId).first();
  const data = { layout: JSON.stringify(layout), updateTime: Date.now() };
  if (exists) await trx("o_canvas").where("projectId", projectId).update(data);
  else await trx("o_canvas").insert({ projectId, viewport: null, ...data });
}

const ids = (rows: { id?: number }[]) => rows.map((r) => r.id!);

/**
 * 把节点移进回收站（删行不删文件），返回回收站 id。
 * 快照和删除在同一事务里，删除只按快照里记下的 id 删，不会误删快照之外新写入的行。
 */
export async function moveToTrash(projectId: number, key: string, owner: Owner): Promise<{ trashId: number; keys: string[] }> {
  const isNode = owner.kind === "node";
  return knexDb.transaction(async (trx) => {
    const assetIds = await assetFamilyIds(owner, trx);
    const keys = isNode ? [key] : assetIds.map(assetKey);
    const layout = await readLayoutTx(trx, projectId);
    const { taken, rest } = sliceLayout(layout, keys);

    const snapshot: TrashSnapshot = {
      keys,
      assets: isNode ? [] : await trx("o_assets").whereIn("id", assetIds).select("*"),
      nodes: isNode ? await trx("o_canvasNode").where("id", owner.id).select("*") : [],
      images: isNode ? await trx("o_image").where("canvasNodeId", owner.id).select("*") : await trx("o_image").whereIn("assetsId", assetIds).select("*"),
      storyboardLinks: isNode ? [] : await trx("o_assets2Storyboard").whereIn("assetId", assetIds).select("*"),
      scriptLinks: isNode ? [] : await trx("o_scriptAssets").whereIn("assetId", assetIds).select("*"),
      voiceLinks: isNode ? [] : await trx("o_assetsRole2Audio").whereIn("assetsRoleId", assetIds).select("*"),
      edges: await trx("o_canvasEdge")
        .where("projectId", projectId)
        .where((qb) => qb.whereIn("sourceKey", keys).orWhereIn("targetKey", keys))
        .select("*"),
      layout: taken,
    };

    // o_assets.imageId 有外键指向 o_image：先删资产（及关联），再删版本图
    await trx("o_canvasEdge").whereIn("id", ids(snapshot.edges)).delete();
    if (isNode) await trx("o_canvasNode").where("id", owner.id).delete();
    else {
      await trx("o_assets2Storyboard").whereIn("assetId", assetIds).delete();
      await trx("o_scriptAssets").whereIn("assetId", assetIds).delete();
      await trx("o_assetsRole2Audio").whereIn("assetsRoleId", assetIds).delete();
      await trx("o_assets").whereIn("id", assetIds).delete();
    }
    await trx("o_image").whereIn("id", ids(snapshot.images)).delete();
    await writeLayoutTx(trx, projectId, rest);
    const [trashId] = await trx("o_canvasTrash").insert({ projectId, key, snapshot: JSON.stringify(snapshot), createTime: Date.now() });
    return { trashId, keys };
  });
}

const liveIds = async (trx: Trx, table: "o_assets" | "o_canvasNode" | "o_image", list: number[]) =>
  new Set<number>(list.length ? ids(await trx(table).whereIn("id", list).select("id")) : []);

/** 另一端已不在的连线不恢复（例如对端也被删了且还没撤销） */
async function liveOtherEnds(trx: Trx, snap: TrashSnapshot): Promise<Set<string>> {
  const others = [...new Set(snap.edges.flatMap((e) => [e.sourceKey!, e.targetKey!]).filter((k) => !snap.keys.includes(k)))];
  const idOf = (k: string) => Number(k.slice(2));
  const assets = await liveIds(trx, "o_assets", others.filter((k) => k.startsWith("a:")).map(idOf));
  const nodes = await liveIds(trx, "o_canvasNode", others.filter((k) => k.startsWith("n:")).map(idOf));
  return new Set(others.filter((k) => (k.startsWith("a:") ? assets : nodes).has(idOf(k))));
}

export interface RestoreResult {
  restored: string[];
  /** id 在删除后被新数据占用时，恢复出来的节点换了新 key：旧 key → 新 key */
  keyMap: Record<string, string>;
}

/**
 * 按快照写回。SQLite 会复用最大 id，已被占用的资产 / 节点 / 版本图换新 id，并同步改关联、连线与布局。
 * 整个恢复（含连线、布局和删除回收站记录）在一个事务里，失败则什么都不变，可以重试。
 */
export async function restoreFromTrash(projectId: number, trashId: number): Promise<RestoreResult> {
  return knexDb.transaction(async (trx) => {
    const row = await trx("o_canvasTrash").where({ id: trashId, projectId }).first();
    if (!row) throw new Error("回收站里没有这条记录（可能已过期清理）");
    const snap = JSON.parse(row.snapshot) as TrashSnapshot;

    const takenAssets = await liveIds(trx, "o_assets", ids(snap.assets));
    const takenNodes = await liveIds(trx, "o_canvasNode", ids(snap.nodes));
    const takenImages = await liveIds(trx, "o_image", ids(snap.images));
    const otherEnds = await liveOtherEnds(trx, snap);

    const assetMap = new Map<number, number>();
    const nodeMap = new Map<number, number>();
    const imageMap = new Map<number, number>();
    const mapId = (map: Map<number, number>, id: number | null | undefined) => (id == null ? id : (map.get(id) ?? id));
    const insertKeepingId = async <T extends { id?: number }>(table: string, rowData: T, taken: Set<number>, map: Map<number, number>) => {
      if (!taken.has(rowData.id!)) return void (await trx(table).insert(rowData));
      const { id, ...rest } = rowData;
      const [newId] = await trx(table).insert(rest);
      map.set(id!, newId);
    };

    // 根资产先写，状态资产的 assetsId 才能指向（可能换了 id 的）根
    const ordered = [...snap.assets].sort((a, b) => Number(a.assetsId != null) - Number(b.assetsId != null));
    // o_assets.imageId 有外键指向 o_image：资产先不带当前图写入，版本图写回后再补上（跟着换过 id 的版本图走）
    for (const asset of ordered) {
      await insertKeepingId("o_assets", { ...asset, assetsId: mapId(assetMap, asset.assetsId), imageId: null }, takenAssets, assetMap);
    }
    for (const node of snap.nodes) await insertKeepingId("o_canvasNode", node, takenNodes, nodeMap);
    for (const image of snap.images) {
      const rowData = { ...image, assetsId: mapId(assetMap, image.assetsId), canvasNodeId: mapId(nodeMap, image.canvasNodeId) };
      await insertKeepingId("o_image", rowData, takenImages, imageMap);
    }
    for (const asset of snap.assets) {
      if (asset.imageId == null) continue;
      const imageId = mapId(imageMap, asset.imageId);
      const exists = await trx("o_image").where("id", imageId!).first();
      await trx("o_assets")
        .where("id", mapId(assetMap, asset.id)!)
        .update({ imageId: exists ? imageId : null });
    }
    for (const node of snap.nodes) {
      if (node.imageId != null && imageMap.has(node.imageId)) {
        await trx("o_canvasNode").where("id", mapId(nodeMap, node.id)!).update({ imageId: imageMap.get(node.imageId) });
      }
    }
    const storyboardLinks = snap.storyboardLinks.map((r) => ({ ...r, assetId: mapId(assetMap, r.assetId) }));
    const scriptLinks = snap.scriptLinks.map((r) => ({ ...r, assetId: mapId(assetMap, r.assetId) }));
    const voiceLinks = snap.voiceLinks.map((r) => ({ ...r, assetsRoleId: mapId(assetMap, r.assetsRoleId) }));
    if (storyboardLinks.length) await trx("o_assets2Storyboard").insert(storyboardLinks);
    if (scriptLinks.length) await trx("o_scriptAssets").insert(scriptLinks);
    if (voiceLinks.length) await trx("o_assetsRole2Audio").insert(voiceLinks);

    const keyMap: Record<string, string> = Object.fromEntries([
      ...[...assetMap].map(([from, to]) => [assetKey(from), assetKey(to)]),
      ...[...nodeMap].map(([from, to]) => [`n:${from}`, `n:${to}`]),
    ]);
    const renameKey = (k: string) => {
      const base = baseKey(k);
      return keyMap[base] ? keyMap[base] + k.slice(base.length) : k;
    };
    const renameRecord = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).map(([k, v]) => [renameKey(k), v]));

    const edges = snap.edges
      .filter((e) => [e.sourceKey!, e.targetKey!].every((k) => snap.keys.includes(k) || otherEnds.has(k)))
      .map(({ id, ...rest }) => ({ ...rest, sourceKey: renameKey(rest.sourceKey!), targetKey: renameKey(rest.targetKey!) }));
    if (edges.length) await trx("o_canvasEdge").insert(edges);

    const layout = await readLayoutTx(trx, projectId);
    await writeLayoutTx(trx, projectId, {
      positions: { ...layout.positions, ...renameRecord(snap.layout.positions) },
      nodeMeta: { ...layout.nodeMeta, ...renameRecord(snap.layout.nodeMeta) },
      pinned: [...new Set([...layout.pinned, ...snap.layout.pinned.map(renameKey)])],
      hidden: [...new Set([...layout.hidden, ...snap.layout.hidden.map(renameKey)])],
    });
    await trx("o_canvasTrash").where("id", trashId).delete();
    return { restored: snap.keys.map(renameKey), keyMap };
  });
}

/** 清理过期快照并删除它们独占的文件（仍被其他版本引用的文件保留） */
export async function purgeTrash(projectId: number): Promise<void> {
  const expired = await u
    .db("o_canvasTrash")
    .where("projectId", projectId)
    .where("createTime", "<", Date.now() - TRASH_TTL)
    .select("id", "snapshot");
  for (const row of expired) {
    const snap = JSON.parse(row.snapshot) as TrashSnapshot;
    const paths = [...new Set(snap.images.map((i) => i.filePath).filter((p): p is string => !!p))];
    const stillUsed = new Set(paths.length ? (await u.db("o_image").whereIn("filePath", paths).select("filePath")).map((r) => r.filePath) : []);
    for (const path of paths.filter((p) => !stillUsed.has(p))) {
      await u.oss.deleteFile(path).catch((e) => {
        if (e?.code !== "ENOENT") throw e;
      });
    }
    await u.db("o_canvasTrash").where("id", row.id).delete();
  }
}
