import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { expandIncludes, getPreset, listPresets, presetDefaultModels } from "@/lib/canvasPresets";
const router = express.Router();

// 画布「目标模板」列表（含按项目模型绑定解析好的默认模型）
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    const { projectId } = req.body;
    const presets = await Promise.all(
      listPresets()
        .filter((p) => !p.hidden)
        .map(async (p) => {
        const [modelNoRef, modelWithRef] = await presetDefaultModels(projectId, p);
        return {
          id: p.id,
          name: p.name,
          group: p.group,
          icon: p.icon,
          desc: p.desc,
          targets: p.targets,
          ratio: p.ratio,
          size: p.size,
          requiresRef: p.requiresRef,
          optionalInput: p.optional,
          canPolish: !!p.polish,
          steps: p.pre ? [getPreset(p.pre)?.name ?? p.pre, p.name] : [],
          hint: p.hint,
          modelNoRef,
          modelWithRef,
          body: expandIncludes(p.body), // 供前端预览：include 已展开，{{需求}} 等占位符保留
        };
      }),
    );
    res.status(200).send(success(presets));
  },
);
