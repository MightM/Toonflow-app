import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetKey, CANVAS_ASSET_TYPES, fileUrl, nodeAssetType, nodeKey, storyboardKey, trackKey } from "@/lib/canvas";
import { ensureStoryboardEdges } from "@/lib/storyboardImage";
import { deriveTrackRefs, trackVoiceNames } from "@/lib/trackVideo";
import { autoImageModel, autoVideoModel } from "@/lib/autoModel";
const router = express.Router();

type ImageRow = {
  id: number;
  filePath: string | null;
  state: string | null;
  stage: string | null;
  kind: string | null;
  errorReason: string | null;
  aspectRatio: string | null;
  storyboardId?: number | null;
  videoTrackId?: number | null;
};

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
        // 镜头台顶部是大图预览，缩略图不够用
        full: row.state === "已完成" && row.filePath ? await u.oss.getFileUrl(row.filePath) : null,
      }
    : null;

// 镜头台的整集数据：镜头（含当前图、版本状态、参考条）、片段、可选参考素材池。
// 镜头与资产共用 /api/canvas/* 的生成与版本接口，这里只负责「一次把一集读出来」。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
  }),
  async (req, res) => {
    const { projectId, scriptId } = req.body;

    const shots = await u.db("o_storyboard").where({ projectId, scriptId }).orderBy([{ column: "index" }, { column: "id" }]).select("*");
    const shotIds = shots.map((s) => s.id!);
    await ensureStoryboardEdges(projectId, shotIds);

    // 参考素材池：本项目全部资产 + 自由节点 + 本集其它镜头
    const assets = await u
      .db("o_assets")
      .where("projectId", projectId)
      .whereIn("type", CANVAS_ASSET_TYPES as unknown as string[])
      .select("id", "name", "type", "assetsId", "imageId");
    const freeNodes = await u.db("o_canvasNode").where("projectId", projectId).select("id", "name", "kind", "imageId");
    const tracksForImages = await u.db("o_videoTrack").where({ projectId, scriptId }).select("id");

    const images: ImageRow[] = await u
      .db("o_image")
      .where((qb) =>
        qb
          .whereIn(
            "assetsId",
            assets.map((a) => a.id!),
          )
          .orWhereIn(
            "canvasNodeId",
            freeNodes.map((n) => n.id!),
          )
          .orWhereIn("storyboardId", shotIds)
          .orWhereIn(
            "videoTrackId",
            tracksForImages.map((t) => t.id!),
          ),
      )
      .select("id", "filePath", "state", "stage", "kind", "errorReason", "aspectRatio", "assetsId", "canvasNodeId", "storyboardId", "videoTrackId");
    const imageById = new Map(images.map((i) => [i.id, i]));
    const latestShot = (id: number) => images.filter((i) => i.storyboardId === id).sort((a, b) => b.id - a.id)[0];
    const pendingShot = (id: number) => images.filter((i) => i.storyboardId === id && i.state === "生成中").map((i) => i.id);

    // 素材池条目：key → 展示名、类型、缩略图
    const pool = new Map<string, { key: string; name: string; kind: string; assetType: string | null; src: string | null }>();
    for (const a of assets) {
      pool.set(assetKey(a.id!), {
        key: assetKey(a.id!),
        name: a.name ?? "",
        kind: "image",
        assetType: a.type ?? null,
        src: await fileUrl(imageById.get(a.imageId!)?.filePath),
      });
    }
    for (const n of freeNodes) {
      pool.set(nodeKey(n.id!), {
        key: nodeKey(n.id!),
        name: n.name ?? "",
        kind: n.kind ?? "image",
        assetType: nodeAssetType(null),
        src: await fileUrl(imageById.get(n.imageId!)?.filePath),
      });
    }
    for (const s of shots) {
      pool.set(storyboardKey(s.id!), {
        key: storyboardKey(s.id!),
        name: `镜头 ${(s.index ?? 0) + 1}`,
        kind: "image",
        assetType: null,
        src: await fileUrl(imageById.get(s.imageId!)?.filePath),
      });
    }

    const trackIdsAll = [...new Set(shots.map((s) => s.trackId).filter((id): id is number => !!id))];
    const edges = await u
      .db("o_canvasEdge")
      .where("projectId", projectId)
      .whereIn("targetKey", [...shotIds.map((id) => storyboardKey(id)), ...trackIdsAll.map((id) => trackKey(id))])
      .orderBy([{ column: "targetKey" }, { column: "sort" }, { column: "id" }]);
    /** edgeId 为空 = 推导出来的参考，前端不给删（要先「转为手动」落成边） */
    const refDto = (sourceKey: string, edgeId: number | null, sort: number) => {
      const item = pool.get(sourceKey);
      return {
        edgeId,
        key: sourceKey,
        sort,
        name: item?.name ?? sourceKey,
        kind: item?.kind ?? "image",
        assetType: item?.assetType ?? null,
        src: item?.src ?? null,
        missing: !item, // 资产被删了但边还在
      };
    };
    const refsOf = (key: string) => edges.filter((e) => e.targetKey === key).map((e) => refDto(String(e.sourceKey), e.id ?? null, e.sort ?? 0));
    // 自动态（refMode !== "manual"）的片段参考是按组内各镜的素材板现推的，见 lib/trackVideo.ts 的 deriveTrackRefs
    const trackRefsOf = async (track: { id?: number; refMode?: string | null }) => {
      if (track.refMode === "manual") return { refs: refsOf(trackKey(track.id!)), derived: false };
      const keys = await deriveTrackRefs(projectId, track.id!);
      return { refs: keys.map((key, i) => refDto(key, null, i)), derived: true };
    };

    // 面板上要显示「将用哪个模型、为什么」，顺带把音色一起带出去——音色不在参考列表里，
    // 界面上看不到它们，不单独列一行用户就不知道对白会用谁的声音
    const trackVideoAuto = async (trackId: number) => {
      const voices = await trackVoiceNames(projectId, trackId);
      return { voices, auto: await autoVideoModel(projectId, trackId, voices.length) };
    };

    const shotList = await Promise.all(
      shots.map(async (s) => ({
        key: storyboardKey(s.id!),
        id: s.id,
        index: s.index ?? 0,
        prompt: s.prompt,
        videoDesc: s.videoDesc,
        duration: Number(s.duration ?? 0),
        track: s.track,
        trackId: s.trackId,
        shouldGenerateImage: s.shouldGenerateImage,
        state: s.state,
        reason: s.reason,
        current: await imageDto(s.imageId ? imageById.get(s.imageId) : undefined),
        latest: await imageDto(latestShot(s.id!)),
        pendingImageIds: pendingShot(s.id!),
        refs: refsOf(storyboardKey(s.id!)),
        auto: await autoImageModel(projectId, s.id!),
      })),
    );

    // 片段（o_videoTrack）与它们的候选视频
    // 合并片段后可能留下「没有镜头但还挂着视频」的老片段，镜头台里不显示它们
    const liveTrackIds = new Set(shots.map((s) => s.trackId).filter(Boolean));
    const tracks = (await u.db("o_videoTrack").where({ projectId, scriptId }).select("*")).filter((t) => liveTrackIds.has(t.id));
    const videos = await u
      .db("o_video")
      .whereIn(
        "videoTrackId",
        tracks.map((t) => t.id!),
      )
      .select("id", "videoTrackId", "filePath", "state", "errorReason", "imageId");
    const trackList = await Promise.all(
      tracks.map(async (t) => ({
        key: trackKey(t.id!),
        id: t.id,
        kind: t.kind ?? "shot",
        duration: t.duration,
        prompt: t.prompt,
        state: t.state,
        reason: t.reason,
        model: t.model,
        params: t.params ? JSON.parse(t.params) : {},
        videoId: t.videoId,
        shotIds: shots.filter((s) => s.trackId === t.id).map((s) => s.id),
        ...(await trackRefsOf(t)),
        ...(await trackVideoAuto(t.id!)),
        pendingImageIds: images.filter((i) => i.videoTrackId === t.id && i.state === "生成中").map((i) => i.id),
        videos: await Promise.all(
          videos
            .filter((v) => v.videoTrackId === t.id)
            .map(async (v) => ({
              id: v.id,
              imageId: v.imageId,
              state: v.state,
              errorReason: v.errorReason,
              src: v.state === "生成成功" ? await fileUrl(v.filePath) : null,
            })),
        ),
      })),
    );

    const project = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "videoModel", "videoRatio", "artStyle").first();

    res.status(200).send(
      success({
        defaults: project ?? {},
        shots: shotList,
        tracks: trackList,
        pool: [...pool.values()],
      }),
    );
  },
);
