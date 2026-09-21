import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { seedStoryboardEdges } from "@/lib/storyboardImage";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    data: z.array(
      z.object({
        prompt: z.string(),
        duration: z.number(),
        track: z.string(),
        state: z.string(),
        src: z.string().nullable(),
        videoDesc: z.string(),
        shouldGenerateImage: z.number(),
        associateAssetsIds: z.array(z.number()),
      }),
    ),
    scriptId: z.number(),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { data, scriptId, projectId } = req.body;
    if (!data.length) return res.status(400).send({ success: false, message: "数据不能为空" });
    for (const item of data) {
      const [id] = await u.db("o_storyboard").insert({
        prompt: item.prompt,
        duration: String(item.duration),
        state: item.state,
        scriptId,
        projectId,
        track: item.track,
        videoDesc: item.videoDesc,
        shouldGenerateImage: item.shouldGenerateImage,
        createTime: Date.now(),
      });
      if (item.associateAssetsIds?.length) {
        await u.db("o_assets2Storyboard").insert(
          item.associateAssetsIds.map((assetId: number) => ({
            assetId,
            storyboardId: id,
          })),
        );
      }
      item.id = id;
    }
    // 关联资产的顺序 = 参考边的初始顺序（图1、图2…），之后用户可在镜头台里调整
    await seedStoryboardEdges(
      projectId,
      data.map((item: { id: number }) => item.id),
    );
    const lastStoryboard = await u.db("o_storyboard").where("scriptId", scriptId).orderBy([{ column: "index" }, { column: "id" }]);
    if (!lastStoryboard || !lastStoryboard.length) return res.status(400).send(error("未查到分镜数据"));

    // 按 track 标签分组，但**只把相邻的镜头并进同一段**。
    // 标签是 Agent 每批生成时从 1 数起的，分两批出分镜表就会重号（镜头 17 又叫「1」）；
    // 原来按全集同名标签分组并复用同名 trackId，于是镜头 1 和镜头 17 被并成一段，
    // 时长是两者之和，出视频时把两个不相干的时刻塞进同一条。
    // 片段本来就要求镜头连续（setSegment 里也拦了「只能合并连续的镜头」），按连续段分就对了。
    const groups: { track: string; ids: number[]; duration: number }[] = [];
    for (const item of lastStoryboard as { id: number; track: string | null; duration: string | null }[]) {
      const last = groups[groups.length - 1];
      if (last && last.track === String(item.track ?? "")) {
        last.ids.push(item.id);
        last.duration += Number(item.duration ?? 0);
      } else {
        groups.push({ track: String(item.track ?? ""), ids: [item.id], duration: Number(item.duration ?? 0) });
      }
    }

    // 已经分配过 trackId 的镜头沿用原片段（重跑分镜表时不丢已生成的视频）；
    // 复用的判据是「这一段里的镜头自己挂着哪个 trackId」，不再按标签全集查找
    for (const group of groups) {
      const assigned = await u.db("o_storyboard").whereIn("id", group.ids).whereNotNull("trackId").first();
      let trackId: number;
      if (assigned?.trackId) {
        trackId = assigned.trackId;
        await u.db("o_videoTrack").where("id", trackId).update({ duration: group.duration, kind: group.ids.length > 1 ? "segment" : "shot" });
      } else {
        // id 交给 SQLite 自增：原来用 Date.now()，同一毫秒建多个 track 会主键冲突
        const [newTrackId] = await u.db("o_videoTrack").insert({
          scriptId,
          projectId,
          duration: group.duration,
          kind: group.ids.length > 1 ? "segment" : "shot",
        });
        trackId = newTrackId;
      }
      await u.db("o_storyboard").whereIn("id", group.ids).update({ trackId });
    }

    const storyboardData = await Promise.all(
      lastStoryboard.map(async (i) => {
        return {
          associateAssetsIds: await u.db("o_assets2Storyboard").where("storyboardId", i.id).orderBy("rowid").select("assetId").pluck("assetId"),
          src: i.filePath ? await u.oss.getSmallImageUrl(i.filePath) : "",
          id: i.id,
          trackId: i.trackId,
          prompt: i.prompt,
          duration: Number(i.duration),
          state: i.state,
          scriptId: i.scriptId,
          reason: i.reason,
          videoDesc: i.videoDesc
        };
      }),
    );
    return res.status(200).send(success(storyboardData));
  },
);
