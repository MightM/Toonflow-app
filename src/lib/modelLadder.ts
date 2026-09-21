// ─── 自动选模型 ─────────────────────────────────────────────
// 规则写在 ToonFlow 自己这边，不写进供应商脚本：
// getModelList（utils/vendor.ts:22-35）是「文件里的 models + o_vendorConfig.models」按
// modelName 合并，而且 **数据库那份在后、会覆盖文件那份**。往 data/vendor/comfyui.ts 里加字段，
// 除非用户去「设置 → 供应商 → 更新代码」重新粘一遍，否则永远读不到。
// 这也正是 SCENE_FIRST_MODELS（lib/canvas.ts:22）当初写死在代码里的原因。
//
// 另外：选模型看的是参考的**形状**，不是数量。容量梯子会把每个单镜都升到多参考模式，
// 而单镜的价值恰恰在于「已经确认过的那一帧」要被原样动起来。

/** 一个节点当前的参考构成 */
export interface RefShape {
  /** 已确认的分镜图（构图锚点） */
  frames: number;
  /** 场景资产 */
  scenes: number;
  /** 角色 + 道具 + 其它需要锁外观的参考 */
  subjects: number;
  /** 可用的角色音色 */
  voices: number;
  /** 片段里包含几个镜头 */
  shots: number;
}

/**
 * 分镜图用哪个 krea2：按参考总数走固定档位。
 * krea2_portrait（定妆照）/ krea2_4view（四视图）不在档位里——它们是资产模板专用的，
 * 让参考数量把它们选中只会出一张人物设定图而不是分镜。
 */
export function pickImageModel(shape: RefShape): string {
  const refs = shape.scenes + shape.subjects + shape.frames;
  if (refs <= 0) return "krea2_t2i";
  if (refs === 1) return "krea2_edit";
  if (refs === 2) return "krea2_dual";
  return "krea2_multi"; // 3~5 张；再多由 fitRefsToMode / 工作流槽位截断
}

/**
 * 片段用哪个 H3。关键取舍：
 * - 只有 h3_ref2v_multi 的工作流带 @audio 槽位，有台词就必须用它，否则音色会被静默丢掉；
 * - 多镜合一的片段镜头之间要切，首帧模式接不住；
 * - 其余情况（单镜、没台词）保持 h3_i2v —— 把你已经确认过的那一帧原样动起来，
 *   这是分镜先出图再出视频的全部意义，不该被「参考多了就升级」冲掉。
 */
export function pickVideoModel(shape: RefShape): string {
  if (shape.frames <= 0) return "h3_t2v";
  if (shape.voices > 0 || shape.shots > 1) return "h3_ref2v_multi";
  return "h3_i2v";
}

/** 供应商前缀跟着项目配置走，这样换供应商时不用改这份规则 */
export function withVendor(configured: string | null | undefined, modelName: string): string {
  const vendorId = (configured ?? "").split(/:(.+)/)[0];
  return vendorId ? `${vendorId}:${modelName}` : modelName;
}

/**
 * 自动选出来的模型不一定在这台机器上装了工作流（ComfyUI 是按 modelName 找
 * workflows/<dir>/<modelName>.json 的，缺了就 404）。所以调用方必须传入
 * 「这个供应商实际列出来的模型名」，选不中就退回项目配置的那个，绝不硬塞。
 */
export function pickModel(
  type: "image" | "video",
  shape: RefShape,
  available: string[],
  configured: string | null | undefined,
): { model: string; auto: boolean; reason: string } {
  const wanted = type === "image" ? pickImageModel(shape) : pickVideoModel(shape);
  const has = new Set(available.map((m) => m.split(/:(.+)/)[1] ?? m));
  if (!has.has(wanted)) return { model: configured ?? "", auto: false, reason: `这台机器没有 ${wanted} 工作流，用项目配置的模型` };
  return { model: withVendor(configured, wanted), auto: true, reason: reasonFor(type, wanted, shape) };
}

function reasonFor(type: "image" | "video", modelName: string, shape: RefShape): string {
  if (type === "image") {
    const refs = shape.scenes + shape.subjects + shape.frames;
    return refs ? `${refs} 张参考` : "没有参考，文生图";
  }
  if (modelName === "h3_ref2v_multi") {
    const why = [shape.voices > 0 ? `${shape.voices} 段音色` : "", shape.shots > 1 ? `${shape.shots} 个镜头` : ""].filter(Boolean);
    return `${why.join(" · ")}，需要多参考模式`;
  }
  if (modelName === "h3_t2v") return "没有分镜图，文生视频";
  return "单镜无台词，锁住已确认的分镜图";
}

/** 分镜信息里的「台词：…」字段——有实际台词才需要音色 */
export function hasDialogue(videoDesc: string | null | undefined): boolean {
  const matched = /台词[：:]\s*([^、。\n]*)/.exec(videoDesc ?? "");
  const line = (matched?.[1] ?? "").trim();
  return !!line && !/^(无|没有|N\/A|—|-)$/i.test(line);
}
