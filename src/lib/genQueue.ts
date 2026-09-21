import { AsyncLocalStorage } from "async_hooks";

// 画布生成队列：图片 / 视频 / 音频三条通道，各自按先进先出、默认同时只跑一个，
// 多个请求一起发出来也只会依次交给模型。任务用 o_image.id 标识（前端轮询的就是它）。
// 取消：排队中的直接移除；正在跑的通过 AbortSignal 通知——供应商脚本里的 pollTask 会在下一轮
// 看到信号后返回「已取消」，ComfyUI 适配器再顺手把工作流从 ComfyUI 队列里删掉 / 中断。
// 队列只在内存里：ToonFlow 重启后未完成的任务由 fixDB 标成失败，与以前一致。

export type Lane = "image" | "video" | "audio";

interface Job {
  imageId: number;
  lane: Lane;
  run: () => Promise<unknown>;
  controller: AbortController;
  enqueuedAt: number;
}

export interface QueueInfo {
  lane: Lane;
  /** 0 = 正在生成；N = 前面还有 N 个在排队 */
  ahead: number;
  running: boolean;
}

/** 供应商脚本 / pollTask 通过它拿到当前任务的取消信号 */
export const genContext = new AsyncLocalStorage<{ signal: AbortSignal; imageId: number }>();

const DEFAULT_CONCURRENCY = 1;
const concurrency = (lane: Lane) => Math.max(1, Number(process.env[`GEN_CONCURRENCY_${lane.toUpperCase()}`]) || DEFAULT_CONCURRENCY);

const waiting: Record<Lane, Job[]> = { image: [], video: [], audio: [] };
const running: Record<Lane, Map<number, Job>> = { image: new Map(), video: new Map(), audio: new Map() };

export function enqueue(imageId: number, lane: Lane, run: () => Promise<unknown>) {
  const job: Job = { imageId, lane, run, controller: new AbortController(), enqueuedAt: Date.now() };
  waiting[lane].push(job);
  pump(lane);
}

function pump(lane: Lane) {
  while (running[lane].size < concurrency(lane) && waiting[lane].length) {
    const job = waiting[lane].shift()!;
    running[lane].set(job.imageId, job);
    genContext
      .run({ signal: job.controller.signal, imageId: job.imageId }, () => job.run())
      .catch((e) => console.error(`[生成队列] ${lane} #${job.imageId}`, (e as Error)?.message ?? e))
      .finally(() => {
        running[lane].delete(job.imageId);
        pump(lane);
      });
  }
}

/** 取消：排队中的移除并返回 queued=true；正在跑的发出取消信号。都不在队列里返回 found=false */
export function cancel(imageId: number): { found: boolean; queued: boolean } {
  for (const lane of Object.keys(waiting) as Lane[]) {
    const index = waiting[lane].findIndex((j) => j.imageId === imageId);
    if (index >= 0) {
      waiting[lane].splice(index, 1);
      return { found: true, queued: true };
    }
    const job = running[lane].get(imageId);
    if (job) {
      job.controller.abort();
      return { found: true, queued: false };
    }
  }
  return { found: false, queued: false };
}

export function queueInfo(imageId: number): QueueInfo | null {
  for (const lane of Object.keys(waiting) as Lane[]) {
    if (running[lane].has(imageId)) return { lane, ahead: 0, running: true };
    const index = waiting[lane].findIndex((j) => j.imageId === imageId);
    if (index >= 0) return { lane, ahead: running[lane].size + index, running: false };
  }
  return null;
}

/** 当前任务是否已被取消（给不经过 pollTask 的长操作用） */
export const isCancelled = () => !!genContext.getStore()?.signal.aborted;
