import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { nodeKey, readLayout, writeLayout } from "@/lib/canvas";
const router = express.Router();

// 新建自由节点（图片 / 视频 / 文本 / 音频）；文本节点的内容存在 prompt 里，没有版本链
const DEFAULT_NAME: Record<string, string> = { image: "图片", video: "视频", text: "文本", audio: "音频" };
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    kind: z.enum(["image", "video", "text", "audio"]),
    name: z.string().optional(),
    prompt: z.string().optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    params: z.record(z.string(), z.unknown()).optional(), // 如 { artStyle } 给图片节点带默认风格
  }),
  async (req, res) => {
    const { projectId, kind, name, prompt, position, params } = req.body;
    const [id] = await u.db("o_canvasNode").insert({
      projectId,
      kind,
      name: name ?? DEFAULT_NAME[kind],
      prompt: prompt ?? "",
      params: params && Object.keys(params).length ? JSON.stringify(params) : null,
      createTime: Date.now(),
    });
    if (position) {
      const layout = await readLayout(projectId);
      await writeLayout(projectId, { ...layout, positions: { ...layout.positions, [nodeKey(id)]: position } });
    }
    res.status(200).send(success({ key: nodeKey(id), id }));
  },
);
