import express from "express";
import { z } from "zod";
import u from "@/utils";
import { db as knexDb } from "@/utils/db";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { trackKey } from "@/lib/canvas";
const router = express.Router();

// 片段的合并 / 拆开。
// 片段 = o_videoTrack，默认一镜一段；合并后一段提示词按时间码写多个镜头，一次出 10~15 秒。
// 合并要求镜头在同一集里连续（片段是时间上连续的一截）。
// 空掉的老片段：还挂着视频的保留（不丢已生成的成片），没视频的删掉。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    action: z.enum(["merge", "split"]),
    shotIds: z.array(z.number()).min(1),
  }),
  async (req, res) => {
    const { projectId, scriptId, action, shotIds } = req.body;
    try {
      const all = await u.db("o_storyboard").where({ projectId, scriptId }).orderBy([{ column: "index" }, { column: "id" }]).select("id", "index", "duration", "trackId");
      const picked = all.filter((s) => shotIds.includes(s.id!));
      if (picked.length !== shotIds.length) return res.status(400).send(error("有镜头不属于这一集"));

      const touchedTracks = new Set<number>(picked.map((s) => s.trackId!).filter(Boolean));

      if (action === "merge") {
        if (picked.length < 2) return res.status(400).send(error("至少选两个镜头才能合并"));
        const positions = picked.map((s) => all.findIndex((a) => a.id === s.id)).sort((a, b) => a - b);
        if (positions.some((p, i) => i > 0 && p !== positions[i - 1]! + 1)) return res.status(400).send(error("只能合并连续的镜头"));
        const duration = picked.reduce((sum, s) => sum + Number(s.duration ?? 0), 0);
        // 新建片段而不是复用第一个镜头的片段：老片段里可能还挂着别的镜头，
        // 复用会把不相邻的镜头一起带进来，时长也算不对
        let newId = 0;
        await knexDb.transaction(async (trx) => {
          [newId] = await trx("o_videoTrack").insert({ projectId, scriptId, duration, kind: "segment" });
          await trx("o_storyboard").whereIn("id", shotIds).update({ trackId: newId });
        });
        await rebalanceTracks(projectId, [...touchedTracks]);
        return res.status(200).send(success({ trackId: newId, kind: "segment", duration }));
      }

      // split：选中的镜头各自独立成段
      const created: number[] = [];
      for (const shot of picked) {
        const [newId] = await u.db("o_videoTrack").insert({ projectId, scriptId, duration: Number(shot.duration ?? 0), kind: "shot" });
        await u.db("o_storyboard").where("id", shot.id).update({ trackId: newId });
        created.push(newId);
      }
      await rebalanceTracks(projectId, [...touchedTracks]);
      res.status(200).send(success({ trackIds: created }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);

/** 片段里剩下的镜头变了：重算时长与 kind；空掉的按规则清理。
 *  参考不用管——没手动覆盖过的片段每次都按组内镜头现推，合并拆分自然跟着变 */
async function rebalanceTracks(projectId: number, trackIds: number[]): Promise<void> {
  for (const trackId of trackIds) {
    const rest = await u.db("o_storyboard").where("trackId", trackId).select("duration");
    if (!rest.length) continue;
    await u
      .db("o_videoTrack")
      .where("id", trackId)
      .update({ duration: rest.reduce((sum, s) => sum + Number(s.duration ?? 0), 0), kind: rest.length > 1 ? "segment" : "shot" });
  }
  await cleanupEmptyTracks(projectId, trackIds);
}

/** 没有镜头也没有视频的片段直接删掉；还挂着视频的留着，免得丢掉已生成的成片 */
async function cleanupEmptyTracks(projectId: number, trackIds: number[]): Promise<void> {
  for (const trackId of trackIds) {
    const shots = await u.db("o_storyboard").where("trackId", trackId).count("id as n").first();
    if (Number((shots as { n?: number } | undefined)?.n ?? 0) > 0) continue;
    const videos = await u.db("o_video").where("videoTrackId", trackId).count("id as n").first();
    if (Number((videos as { n?: number } | undefined)?.n ?? 0) > 0) continue;
    await u.db("o_canvasEdge").where({ projectId, targetKey: trackKey(trackId) }).del();
    await u.db("o_image").where("videoTrackId", trackId).del();
    await u.db("o_videoTrack").where("id", trackId).del();
  }
}
