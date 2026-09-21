import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增项目
export default router.post(
  "/",
  validateFields({
    // novel / script 是短剧流水线的两个子形态，canvas 是无限画布
    projectType: z.enum(["novel", "script", "canvas"]),
    name: z.string().min(1),
    intro: z.string().optional().default(""),
    type: z.string().optional().default(""),
    artStyle: z.string().optional().default(""),
    directorManual: z.string().optional().default(""),
    videoRatio: z.string(),
    imageModel: z.string(),
    videoModel: z.string(),
    imageQuality: z.string().optional().default(""),
    mode: z.string().optional().default(""),
  }),
  async (req, res) => {
    // validateFields 只校验不回写，zod 的 default 不会落到 req.body，这里自己兜底
    const { projectType, name, videoRatio, imageModel, videoModel } = req.body;
    const intro = req.body.intro ?? "";
    const type = req.body.type ?? "";
    const artStyle = req.body.artStyle ?? "";
    const directorManual = req.body.directorManual ?? "";
    const imageQuality = req.body.imageQuality ?? "";
    const mode = req.body.mode ?? "";

    await u.db("o_project").insert({
      id: Date.now(),
      projectType,
      name,
      intro,
      type,
      artStyle,
      videoRatio,
      directorManual,
      userId: 1,
      imageModel,
      videoModel,
      createTime: Date.now(),
      imageQuality,
      mode,
    });

    res.status(200).send(success({ message: "新增项目成功" }));
  },
);
