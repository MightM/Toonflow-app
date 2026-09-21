import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetKey, fileUrl, imageOwnerKey, nodeKey, resolveOwner, storyboardKey, trackKey } from "@/lib/canvas";
const router = express.Router();

// 历史版本：按节点或全项目，可按 kind（image/video）筛选，最新在前
// 节点可以是资产 a:、自由节点 n:、镜头 s:；不传 target 时列全项目（不含镜头，镜头数量大且按集看）
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    target: z.string().optional().nullable(),
    scriptId: z.number().optional().nullable(), // 只在列镜头历史时有意义
    kind: z.enum(["image", "video", "audio"]).optional().nullable(),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  async (req, res) => {
    const { projectId, target, scriptId, kind, page, limit } = req.body;
    let assetIds: number[] = [];
    let nodeIds: number[] = [];
    let storyboardIds: number[] = [];
    let trackIds: number[] = [];
    if (target) {
      try {
        const owner = await resolveOwner(projectId, target);
        if (owner.kind === "asset") assetIds = [owner.id];
        else if (owner.kind === "storyboard") storyboardIds = [owner.id];
        else if (owner.kind === "track") trackIds = [owner.id];
        else nodeIds = [owner.id];
      } catch (e) {
        return res.status(400).send(error(u.error(e).message));
      }
    } else if (scriptId) {
      storyboardIds = (await u.db("o_storyboard").where({ projectId, scriptId }).select("id")).map((r) => r.id!);
    } else {
      assetIds = (await u.db("o_assets").where("projectId", projectId).whereIn("type", ["role", "scene", "tool"]).select("id")).map((r) => r.id!);
      nodeIds = (await u.db("o_canvasNode").where("projectId", projectId).select("id")).map((r) => r.id!);
    }
    const query = u
      .db("o_image")
      .where((qb) => qb.whereIn("assetsId", assetIds).orWhereIn("canvasNodeId", nodeIds).orWhereIn("storyboardId", storyboardIds).orWhereIn("videoTrackId", trackIds))
      .modify((qb) => {
        if (kind === "video") qb.where("kind", "video");
        if (kind === "image") qb.where((w) => w.whereNull("kind").orWhere("kind", "image"));
      });
    const total = Number(((await query.clone().count("id as n").first()) as { n?: number } | undefined)?.n ?? 0);
    const rows: Record<string, any>[] = await query
      .clone()
      .orderBy("id", "desc")
      .offset((page - 1) * limit)
      .limit(limit)
      .select("*");

    const assets = await u.db("o_assets").whereIn("id", assetIds).select("id", "name", "imageId");
    const nodes = await u.db("o_canvasNode").whereIn("id", nodeIds).select("id", "name", "imageId");
    const shots = await u.db("o_storyboard").whereIn("id", storyboardIds).select("id", "index", "imageId");
    const tracks = await u.db("o_videoTrack").whereIn("id", trackIds).select("id", "videoId");
    const currentVideoImage = new Map(
      (await u.db("o_video").whereIn("id", tracks.map((t) => t.videoId!).filter(Boolean)).select("id", "imageId", "videoTrackId")).map((v) => [v.videoTrackId, v.imageId]),
    );
    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const shotMap = new Map(shots.map((s) => [s.id, s]));
    const list = await Promise.all(
      rows.map(async (r) => {
        const asset = r.assetsId ? assetMap.get(r.assetsId) : undefined;
        const node = r.canvasNodeId ? nodeMap.get(r.canvasNodeId) : undefined;
        const shot = r.storyboardId ? shotMap.get(r.storyboardId) : undefined;
        const current = asset?.imageId ?? node?.imageId ?? shot?.imageId ?? (r.videoTrackId ? currentVideoImage.get(r.videoTrackId) : undefined);
        return {
          imageId: r.id,
          owner: asset ? assetKey(asset.id!) : node ? nodeKey(node.id!) : shot ? storyboardKey(shot.id!) : r.videoTrackId ? trackKey(r.videoTrackId) : imageOwnerKey(r),
          ownerName: asset?.name ?? node?.name ?? (shot ? `镜头 ${(shot.index ?? 0) + 1}` : r.videoTrackId ? `片段 ${r.videoTrackId}` : ""),
          state: r.state,
          errorReason: r.errorReason,
          stage: r.stage,
          kind: r.kind ?? "image",
          model: r.model,
          resolution: r.resolution,
          aspectRatio: r.aspectRatio,
          prompt: r.prompt,
          createTime: r.createTime,
          src: r.state === "已完成" ? await fileUrl(r.filePath) : null,
          isCurrent: current != null && current === r.id,
        };
      }),
    );
    res.status(200).send(success({ total, list }));
  },
);
