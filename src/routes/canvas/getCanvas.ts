import express from "express";
import { queueInfo } from "@/lib/genQueue";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { CANVAS_ASSET_TYPES, assetKey, fileUrl, nodeAssetType, nodeKey, nodeVoice, readLayout } from "@/lib/canvas";
import { getAssetModels } from "@/lib/assetGen";
const router = express.Router();

type ImageRow = { id: number; filePath: string | null; state: string | null; stage: string | null; kind: string | null; errorReason: string | null; aspectRatio: string | null };

const imageDto = async (row: ImageRow | undefined) =>
  row
    ? {
        imageId: row.id,
        state: row.state,
        stage: row.stage,
        kind: row.kind ?? "image",
        aspectRatio: row.aspectRatio,
        errorReason: row.errorReason,
        src: row.state === "已完成" ? await fileUrl(row.filePath) : null,
        queue: row.state === "生成中" ? queueInfo(row.id) : null,
      }
    : null;

// 读取整张资产画布：资产（根 + 状态，角色当前图即多视图）、自由节点、参考连线、布局、生成中的版本
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, scriptId } = req.body;
    const layout = await readLayout(projectId);
    const canvasRow = await u.db("o_canvas").where("projectId", projectId).select("viewport").first();

    let assets = await u.db("o_assets").where("projectId", projectId).whereIn("type", CANVAS_ASSET_TYPES as unknown as string[]).select("*");
    if (scriptId) {
      const linked = new Set((await u.db("o_scriptAssets").where("scriptId", scriptId).select("assetId")).map((r) => r.assetId));
      const pinned = new Set(layout.pinned);
      const rootIds = new Set(assets.filter((a) => a.assetsId == null && (linked.has(a.id!) || pinned.has(assetKey(a.id!)))).map((a) => a.id));
      assets = assets.filter((a) => rootIds.has(a.assetsId == null ? a.id : a.assetsId) || pinned.has(assetKey(a.id!)));
    }
    const assetIds = assets.map((a) => a.id!);
    const nodes = await u.db("o_canvasNode").where("projectId", projectId).select("*");
    const nodeIds = nodes.map((n) => n.id!);

    const images: ImageRow[] = await u
      .db("o_image")
      .where((qb) => qb.whereIn("assetsId", assetIds).orWhereIn("canvasNodeId", nodeIds))
      .select("id", "filePath", "state", "stage", "kind", "errorReason", "aspectRatio", "assetsId", "canvasNodeId");
    const imageById = new Map(images.map((i) => [i.id, i]));
    const latestBy = (column: "assetsId" | "canvasNodeId", id: number) => images.filter((i: any) => i[column] === id).sort((a, b) => b.id - a.id)[0];
    const pendingBy = (column: "assetsId" | "canvasNodeId", id: number) => images.filter((i: any) => i[column] === id && i.state === "生成中").map((i) => i.id);

    const voiceRows = await u
      .db("o_assetsRole2Audio")
      .leftJoin("o_assets", "o_assets.id", "o_assetsRole2Audio.assetsAudioId")
      .whereIn("o_assetsRole2Audio.assetsRoleId", assetIds)
      .select("o_assets.id", "o_assets.name", "o_assetsRole2Audio.assetsRoleId");

    const assetNodes = await Promise.all(
      assets.map(async (a) => ({
        key: assetKey(a.id!),
        kind: "asset" as const,
        id: a.id,
        assetType: a.type,
        parentKey: a.assetsId != null ? assetKey(a.assetsId) : null,
        name: a.name,
        describe: a.describe,
        prompt: a.prompt,
        promptState: a.promptState,
        audioBindState: a.audioBindState ?? null,
        current: await imageDto(a.imageId ? imageById.get(a.imageId) : undefined),
        latest: await imageDto(latestBy("assetsId", a.id!)),
        pendingImageIds: pendingBy("assetsId", a.id!),
        voices: voiceRows.filter((v) => v.assetsRoleId === a.id).map((v) => ({ id: v.id, name: v.name })),
      })),
    );
    // 自由节点绑定的音色名字（音色库资产 / 画布音频节点）
    const voiceAssetIds = nodes.map((n) => nodeVoice(n.params)).filter((v): v is { kind: "asset"; id: number } => v?.kind === "asset").map((v) => v.id);
    const voiceAssets = voiceAssetIds.length ? await u.db("o_assets").whereIn("id", voiceAssetIds).select("id", "name") : [];
    const voiceOf = (params: string | null | undefined) => {
      const v = nodeVoice(params);
      if (!v) return null;
      if (v.kind === "asset") return { kind: "asset" as const, name: voiceAssets.find((a) => a.id === v.id)?.name ?? "（音色已删除）" };
      const node = nodes.find((n) => nodeKey(n.id!) === v.key);
      return { kind: "node" as const, name: node?.name ?? "（音频节点已删除）" };
    };
    const freeNodes = await Promise.all(
      nodes.map(async (n) => ({
        key: nodeKey(n.id!),
        kind: n.kind,
        id: n.id,
        name: n.name,
        prompt: n.prompt,
        params: n.params ? JSON.parse(n.params) : {},
        assetType: nodeAssetType(n.params),
        voice: voiceOf(n.params),
        current: await imageDto(n.imageId ? imageById.get(n.imageId) : undefined),
        latest: await imageDto(latestBy("canvasNodeId", n.id!)),
        pendingImageIds: pendingBy("canvasNodeId", n.id!),
      })),
    );

    const visible = new Set<string>([...assetNodes.map((n) => n.key), ...freeNodes.map((n) => n.key)]);
    const refEdges = (await u.db("o_canvasEdge").where("projectId", projectId).orderBy([{ column: "targetKey" }, { column: "sort" }, { column: "id" }]))
      .filter((e) => visible.has(e.sourceKey as string) && visible.has(e.targetKey as string))
      .map((e) => ({ id: `ref-${e.id}`, edgeId: e.id, source: e.sourceKey, target: e.targetKey, kind: "ref", sort: e.sort }));
    const deriveEdges = assetNodes
      .filter((n) => n.parentKey && visible.has(n.parentKey))
      .map((n) => ({ id: `derive-${n.key}`, source: n.parentKey, target: n.key, kind: "derive" }));

    const audioAssets = await u.db("o_assets").where({ projectId, type: "audio" }).whereNull("assetsId").select("id", "name", "describe");
    const project = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "videoModel", "videoRatio").first();

    res.status(200).send(
      success({
        viewport: canvasRow?.viewport ? JSON.parse(canvasRow.viewport) : null,
        layout,
        nodes: [...assetNodes, ...freeNodes],
        edges: [...deriveEdges, ...refEdges],
        voices: audioAssets,
        defaults: { ...project, assetModels: await getAssetModels(projectId) },
      }),
    );
  },
);
