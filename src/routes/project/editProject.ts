import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 编辑项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string().min(1),
    intro: z.string().optional().default(""),
    type: z.string().optional().default(""),
    artStyle: z.string().optional().default(""),
    directorManual: z.string().optional().default(""),
    videoRatio: z.string(),
    imageModel: z.string(),
    videoModel: z.string(),
    projectType: z.enum(["novel", "script", "canvas"]),
    imageQuality: z.string().optional().default(""),
    mode: z.string().optional().default(""),
  }),
  async (req, res) => {
    // validateFields 只校验不回写，zod 的 default 不会落到 req.body，这里自己兜底
    const { id, name, videoRatio, imageModel, videoModel, projectType } = req.body;
    const intro = req.body.intro ?? "";
    const type = req.body.type ?? "";
    const artStyle = req.body.artStyle ?? "";
    const directorManual = req.body.directorManual ?? "";
    const imageQuality = req.body.imageQuality ?? "";
    const mode = req.body.mode ?? "";

    await u.db("o_project").where("id", id).update({
      name,
      intro,
      type,
      artStyle,
      videoRatio,
      directorManual,
      imageModel,
      videoModel,
      imageQuality,
      projectType,
      mode,
    });

    res.status(200).send(success({ message: "编辑项目成功" }));
  },
);
