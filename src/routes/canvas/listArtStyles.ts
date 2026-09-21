import express from "express";
import { success } from "@/lib/responseFormat";
import { listArtStyles } from "@/lib/artStyleWords";
const router = express.Router();

// 画布「风格」胶囊用的视觉手册清单：目录名、名称、封面、风格词一行（不带手册正文，比 project/getVisualManual 轻得多）
export default router.post("/", async (_req, res) => {
  res.status(200).send(success(await listArtStyles()));
});
