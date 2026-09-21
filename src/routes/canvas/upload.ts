import express from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { nodeKey, readLayout, resolveOwner, writeLayout } from "@/lib/canvas";
const router = express.Router();

const MIME_EXT: Record<string, { ext: string; kind: "image" | "video" | "audio" }> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/jpg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
  "audio/mpeg": { ext: "mp3", kind: "audio" },
  "audio/mp3": { ext: "mp3", kind: "audio" },
  "audio/wav": { ext: "wav", kind: "audio" },
  "audio/x-wav": { ext: "wav", kind: "audio" },
  "audio/mp4": { ext: "m4a", kind: "audio" },
  "audio/x-m4a": { ext: "m4a", kind: "audio" },
};

// 上传本地文件：不指定 target → 新建自由节点；指定 target → 作为该节点的新版本
// （想用定妆照做角色身份参考：上传成自由节点，再连线到角色）
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    base64Data: z.string().regex(/^data:[\w/+.-]+;base64,/, "需要 data URL"),
    name: z.string().optional(),
    target: z.string().optional().nullable(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
  }),
  async (req, res) => {
    const { projectId, base64Data, name, target, position } = req.body;
    const mime = /^data:([\w/+.-]+);base64,/.exec(base64Data)![1].toLowerCase();
    const type = MIME_EXT[mime];
    if (!type) return res.status(400).send(error(`不支持的文件类型: ${mime}`));
    const filePath = `/${projectId}/canvas/${uuidv4()}.${type.ext}`;
    try {
      const owner = target ? await resolveOwner(projectId, target) : null;
      if (owner?.asset && type.kind !== "image") return res.status(400).send(error("资产节点只能上传图片"));
      await u.oss.writeFile(filePath, base64Data);

      if (owner?.asset) {
        const [imageId] = await u.db("o_image").insert({
          type: owner.asset.type,
          state: "已完成",
          filePath,
          assetsId: owner.id,
          kind: "image",
          model: "上传",
          createTime: Date.now(),
        });
        await u.db("o_assets").where("id", owner.id).update({ imageId });
        return res.status(200).send(success({ key: owner.key, imageId }));
      }

      let nodeId = owner?.id;
      if (!owner) {
        [nodeId] = await u.db("o_canvasNode").insert({ projectId, kind: type.kind, name: name ?? "上传素材", prompt: "", createTime: Date.now() });
        if (position) {
          const layout = await readLayout(projectId);
          await writeLayout(projectId, { ...layout, positions: { ...layout.positions, [nodeKey(nodeId!)]: position } });
        }
      } else if (owner.node!.kind !== type.kind) {
        return res.status(400).send(error(`该节点只能上传${owner.node!.kind === "video" ? "视频" : owner.node!.kind === "audio" ? "音频" : "图片"}`));
      }
      const [imageId] = await u.db("o_image").insert({
        type: "canvas",
        state: "已完成",
        filePath,
        canvasNodeId: nodeId,
        kind: type.kind,
        model: "上传",
        createTime: Date.now(),
      });
      await u.db("o_canvasNode").where("id", nodeId).update({ imageId });
      res.status(200).send(success({ key: nodeKey(nodeId!), imageId }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
