import express from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { expandTextRefs, fitRefsToMode, getVideoModelMode, incomingEdges, resolveOwner, resolveRefs, toReferenceList } from "@/lib/canvas";
import { isH3ReferenceModel, toH3RefTags } from "@/lib/canvasVideoPrompt";
import { resolveTrackRefs, trackRefKeys, trackVoiceRefs } from "@/lib/trackVideo";
import { autoVideoModel } from "@/lib/autoModel";
import { enqueue } from "@/lib/genQueue";
const router = express.Router();

// 生成视频：参考 = 入边（按 sort），按模型 mode 裁剪数量；立即返回 imageId，后台生成。
// 目标可以是画布视频节点（n:）或镜头台的片段（v:）。
// 片段额外带上组内角色的音色，并在成功后写一条 o_video + 更新 o_videoTrack.videoId，
// 让剪辑台、成片导出和分镜台的老接口继续能读到。
// 时长由模型的 durationResolutionMap 决定（ComfyUI H3 为 3~15 秒），这里只校验范围。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    target: z.string(),
    model: z.string().optional().nullable(),
    prompt: z.string(),
    duration: z.number().int().min(1).max(60),
    resolution: z.string(),
    aspectRatio: z.enum(["16:9", "9:16"]).optional().nullable(),
    audio: z.boolean().optional().nullable(),
    refs: z.array(z.string()).optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, target, model, prompt, duration, resolution, aspectRatio, audio, refs } = req.body;
    let imageId: number | undefined;
    try {
      const owner = await resolveOwner(projectId, target);
      const isTrack = owner.kind === "track";
      if (!isTrack && owner.node?.kind !== "video") return res.status(400).send(error("只有视频节点或片段可以生成视频"));
      const project = await u.db("o_project").where("id", projectId).select("videoModel", "videoRatio").first();
      // 没指定模型时按参考形状自动选：有台词要走带 @audio 槽位的多参考模式，
      // 单镜无台词则保持首帧模式，把已确认的那张分镜图原样动起来
      const auto = !model && isTrack ? await autoVideoModel(projectId, owner.id, (await trackVoiceRefs(projectId, owner.id)).length) : null;
      const useModel = model || auto?.model || owner.track?.model || project?.videoModel;
      if (!useModel || !useModel.includes(":")) return res.status(400).send(error("请选择视频模型"));

      const rawKeys: string[] = refs ?? (isTrack ? await trackRefKeys(projectId, owner.id) : (await incomingEdges(projectId, target)).map((e) => e.sourceKey as string));
      // 自由节点：文本参考拼进提示词，不占参考位（片段没有文本参考）
      const textExpanded = isTrack ? { prompt, refKeys: rawKeys } : await expandTextRefs(projectId, rawKeys, prompt);
      const refKeys = textExpanded.refKeys;
      const modelMode = await getVideoModelMode(useModel);
      const resolved = isTrack ? await resolveTrackRefs(projectId, owner.id, refKeys) : await resolveRefs(projectId, refKeys, { withVoice: true });
      const fitted = fitRefsToMode(resolved, modelMode);
      // H3 多参考只认 <Picture N> 这类标签，编辑器里的 @图片N 发送前换掉（界面上保存的仍是原文）
      const sendPrompt = isH3ReferenceModel(useModel, modelMode) ? toH3RefTags(textExpanded.prompt) : textExpanded.prompt;
      const ratio = (aspectRatio ?? project?.videoRatio ?? "16:9") as "16:9" | "9:16";
      const params = JSON.stringify({
        model: useModel,
        duration,
        resolution,
        aspectRatio: ratio,
        audio: !!audio,
      });

      // duration 列不动：它是分镜表按各镜时长累加出来的，是剪辑台对时间轴的依据。
      // 这次实际用的时长（可能被模型下限夹过）只记在 params 里
      if (isTrack) await u.db("o_videoTrack").where("id", owner.id).update({ prompt, model: useModel, params });
      else await u.db("o_canvasNode").where("id", owner.id).update({ prompt, params });

      [imageId] = await u.db("o_image").insert({
        type: isTrack ? "storyboard" : "canvas",
        state: "生成中",
        canvasNodeId: isTrack ? null : owner.id,
        videoTrackId: isTrack ? owner.id : null,
        model: useModel.split(/:(.+)/)[1],
        resolution,
        aspectRatio: ratio,
        prompt: sendPrompt,
        kind: "video",
        refs: JSON.stringify(fitted.refs.map((r) => r.key)),
        createTime: Date.now(),
      });
      // 剪辑台与成片读的是 o_video：片段生成时同步建一条「生成中」，成功再回填路径
      let videoRowId: number | undefined;
      if (isTrack) {
        [videoRowId] = await u.db("o_video").insert({
          state: "生成中",
          projectId,
          scriptId: owner.track!.scriptId,
          videoTrackId: owner.id,
          imageId,
          time: duration,
        });
      }
      res.status(200).send(
        success({
          imageId,
          videoId: videoRowId ?? null,
          usedRefs: fitted.refs.map((r) => ({ key: r.key, kind: r.kind })),
        }),
      );

      const jobImageId = imageId!;
      const run = async () => {
        try {
          const filePath = isTrack ? `/${projectId}/video/${uuidv4()}.mp4` : `/${projectId}/canvas/${uuidv4()}.mp4`;
          const ai = u.Ai.Video(useModel as `${string}:${string}`);
          await ai.run(
            {
              prompt: sendPrompt,
              referenceList: toReferenceList(fitted.refs),
              mode: fitted.mode as any,
              duration,
              resolution,
              aspectRatio: ratio,
              audio: !!audio,
            },
            {
              taskClass: isTrack ? "视频生成" : "画布视频生成",
              describe: isTrack ? `片段：${owner.id}` : `画布视频节点：${owner.node!.name}`,
              projectId,
              relatedObjects: JSON.stringify(isTrack ? { projectId, videoTrackId: owner.id } : { projectId, canvasNodeId: owner.id }),
            },
          );
          const current = await u.db("o_image").where("id", imageId).select("state").first();
          if (!current || current.state === "生成失败") return;
          await ai.save(filePath);
          await u.db("o_image").where("id", imageId).update({ state: "已完成", filePath });
          if (isTrack) {
            await u.db("o_video").where("id", videoRowId).update({ state: "生成成功", filePath });
            await u.db("o_videoTrack").where("id", owner.id).update({ videoId: videoRowId });
          } else {
            await u.db("o_canvasNode").where("id", owner.id).update({ imageId });
          }
        } catch (e) {
          const message = u.error(e).message;
          await u.db("o_image").where("id", jobImageId).update({ state: "生成失败", errorReason: message });
          await u.db("o_video").where("imageId", jobImageId).update({ state: "生成失败", errorReason: message });
        }
      };
      enqueue(jobImageId, "video", run);
    } catch (e) {
      const message = u.error(e).message;
      if (imageId) {
        await u.db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: message });
        await u.db("o_video").where("imageId", imageId).update({ state: "生成失败", errorReason: message });
      }
      if (!res.headersSent) res.status(400).send(error(message));
    }
  },
);
