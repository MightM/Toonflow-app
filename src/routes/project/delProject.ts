import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 删除项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    //删除项目
    await u.db("o_project").where("id", id).delete();
    await u.db("o_agentWorkData").where("projectId", id).delete();
    //删除项目下的原文
    await u.db("o_novel").where("projectId", id).delete();
    // 删除项目下的剧本信息
    const scriptData = await u.db("o_script").where("projectId", id).select("id");
    const scriptIds = scriptData.map((item: any) => item.id);
    if (scriptIds && scriptIds.length > 0) {
      await u.db("o_scriptAssets").whereIn("scriptId", scriptIds).delete();
    }
    await u.db("o_script").where("projectId", id).delete();
    // 删除项目下的任务
    await u.db("o_tasks").where("projectId", id).delete();
    // 删除项目下的分镜
    const storyboardData = await u.db("o_storyboard").where("projectId", id).select("id");
    const storyboardIds = storyboardData.map((item: any) => item.id);
    if (storyboardIds.length > 0) {
      await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
    }
    await u.db("o_storyboard").where("projectId", id).delete();
    //删除需要删除资产的归属图片
    const assetsData = await u.db("o_assets").where("projectId", id).select("id");
    const assetsIds = assetsData.map((item: any) => item.id);
    if (assetsIds && assetsIds.length > 0) {
      // 先将 o_assets.imageId 置空，解除对 o_image 的外键引用
      await u.db("o_assets").whereIn("id", assetsIds).update({ imageId: null });
      await u.db("o_image").whereIn("assetsId", assetsIds).delete();
    }
    // 删除项目下的资产
    await u.db("o_assets").where("projectId", id).delete();
    //删除项目下的视频轨道和视频
    const trackIds = (await u.db("o_videoTrack").where("projectId", id).select("id")).map((t: any) => t.id);
    await u.db("o_videoTrack").where("projectId", id).delete();
    await u.db("o_video").where("projectId", id).delete();
    // 画布：布局、自由节点、连线、回收站，以及分镜 / 片段 / 自由节点名下的版本图
    const nodeIds = (await u.db("o_canvasNode").where("projectId", id).select("id")).map((n: any) => n.id);
    if (nodeIds.length > 0) await u.db("o_canvasNode").whereIn("id", nodeIds).update({ imageId: null });
    await u.db("o_image")
      .where((qb) => {
        qb.whereIn("canvasNodeId", nodeIds.length ? nodeIds : [-1])
          .orWhereIn("storyboardId", storyboardIds.length ? storyboardIds : [-1])
          .orWhereIn("videoTrackId", trackIds.length ? trackIds : [-1]);
      })
      .delete();
    await u.db("o_canvasEdge").where("projectId", id).delete();
    await u.db("o_canvasNode").where("projectId", id).delete();
    await u.db("o_canvasTrash").where("projectId", id).delete();
    await u.db("o_canvas").where("projectId", id).delete();
    //删除项目下的资源

    await u.db("memories").where("isolationKey", "like", `${id}:%`).delete();

    try {
      await u.oss.deleteDirectory(`${id}/`);
      console.log(`项目 ${id} 的OSS文件夹删除成功`);
    } catch (error: any) {
      console.log(`项目 ${id} 没有对应的OSS文件夹，跳过删除`);
    }

    res.status(200).send(success({ message: "删除项目成功" }));
  },
);
