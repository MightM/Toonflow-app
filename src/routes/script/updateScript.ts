import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 编辑剧本。o_script 是剧本正文的权威表：剧本 Agent 的剧本 Tab、制作画布的剧本节点、
// 视频提示词的「本集剧本全文」都以它为准，任何编辑入口都要写到这里来，否则改动会被下次读取覆盖掉。
// name / assets 可以不传：制作画布的剧本节点只改正文，不碰标题和关联资产。
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string().optional(),
    content: z.string(),
    assets: z.array(z.number()).optional(),
  }),
  async (req, res) => {
    const { id, name, content, assets } = req.body;
    await u
      .db("o_script")
      .where({ id })
      .update(name === undefined ? { content } : { name, content });
    if (assets?.length) {
      const assetsData = await u.db("o_assets").whereIn("id", assets).select();
      await u.db("o_scriptAssets").where({ scriptId: id }).delete();
      if (assetsData.length) {
        const insertData = assetsData.map((item) => {
          return {
            scriptId: id,
            assetId: item.id,
          };
        });
        await u.db("o_scriptAssets").insert(insertData);
      }
    }

    res.status(200).send(success({ message: "编辑剧本成功" }));
  },
);
