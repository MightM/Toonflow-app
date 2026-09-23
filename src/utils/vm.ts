import { VM } from "vm2";
import { genContext } from "@/lib/genQueue";
import sharp from "sharp";
import axios from "axios";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createZhipu } from "zhipu-ai-provider";
import { createQwen } from "qwen-ai-provider-v5";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createMinimax } from "vercel-minimax-ai-provider";
import FormData from "form-data";
import jsonwebtoken from "jsonwebtoken";
import u from "@/utils";
import crypto from "node:crypto";
export default function runCode(code: string, vendor?: Record<string, any>) {
  code = code.replace(/export\s*\{\s*\};?/g, ""); // 去掉 export {} 以免沙盒环境报错
  // 创建一个沙盒
  const exports = {};
  const sandbox: Record<string, any> = {
    createOpenAI,
    createDeepSeek,
    createZhipu,
    createQwen,
    createAnthropic,
    createOpenAICompatible,
    createXai,
    createMinimax,
    createGoogleGenerativeAI,
    zipImage,
    zipImageResolution,
    urlToBase64,
    uploadBase64File,
    httpRequest,
    mergeImages,
    pollTask,
    fetch: fetch,
    exports,
    axios,
    FormData,
    logger,
    jsonwebtoken,
    crypto,
  };
  if (vendor !== undefined) {
    sandbox.vendor = vendor;
  }
  const vm = new VM({
    timeout: 0,
    sandbox,
    compiler: "javascript",
    eval: false,
    wasm: false,
  });

  vm.run(code);

  return exports as Record<string, any>;
}
export function logger(logstring: any) {
  console.log("【VM】" + JSON.stringify(logstring));
}
/**
 * 压缩图片，目标字节数不高于 size
 */
export async function zipImage(completeBase64: string, size: number): Promise<string> {
  let quality = 80;
  let buffer = Buffer.from(completeBase64.split(",")[1], "base64");
  let output = await sharp(buffer).jpeg({ quality }).toBuffer();
  while (output.length > size && quality > 10) {
    quality -= 10;
    output = await sharp(buffer).jpeg({ quality }).toBuffer();
  }
  return "data:image/jpeg;base64," + output.toString("base64");
}

export async function zipImageResolution(completeBase64: string, width: number, height: number): Promise<string> {
  const buffer = Buffer.from(completeBase64.split(",")[1], "base64");
  const out = await sharp(buffer).resize(width, height).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

// url 转 Base64（在宿主里下载并编码，可带请求头）。
// 供应商脚本别在沙盒里对二进制逐字节操作：vm2 的膜会把 Buffer.from(沙盒外的 Buffer) 变成几百万次代理调用，
// 实测 3MB 一张图要 1.2 秒并且阻塞主进程（Electron 里等于整个窗口无响应）。
export async function urlToBase64(url: string, headers?: Record<string, string>): Promise<string> {
  const res = await axios.get(url, { responseType: "arraybuffer", headers }).catch(rethrowPlain);
  const mime = String(res.headers["content-type"] || "image/jpeg").split(";")[0];
  const b64 = Buffer.from(res.data).toString("base64");
  return `data:${mime};base64,${b64}`;
}

/**
 * 沙盒里的 vm2（3.10）会把每个从宿主进入沙盒的对象递归遍历所有自有属性（containsDangerousConstructor），
 * axios 的响应 / 错误对象背后挂着 request → socket → agent 整张图，Electron 主进程里一次要走几秒到几十秒。
 * 所以给供应商脚本的 HTTP 只传回 status / headers / 正文文本这三样，错误也只抛纯 Error（带 code / response 两个小字段）。
 */
function rethrowPlain(e: any): never {
  const err: any = new Error(e?.message || String(e));
  if (e?.code) err.code = e.code;
  if (e?.response) err.response = { status: e.response.status, data: typeof e.response.data === "string" ? e.response.data.slice(0, 2000) : safeJson(e.response.data) };
  throw err;
}
const safeJson = (value: unknown) => {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
};
export async function httpRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number } = {},
): Promise<{ status: number; headers: Record<string, string>; text: string }> {
  const res = await axios
    .request({
      url,
      method: options.method ?? "GET",
      headers: options.headers,
      data: options.body,
      timeout: options.timeout,
      responseType: "text",
      transformResponse: [(d: unknown) => d],
      validateStatus: () => true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    })
    .catch(rethrowPlain);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers ?? {})) if (typeof value === "string") headers[key] = value;
  return { status: res.status, headers, text: typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "") };
}

export const CANCELLED = "已取消";
export async function pollTask(
  fn: () => Promise<{ completed: boolean; data?: string; error?: string }>,
  interval = 3000,
  timeout = 3000000,
): Promise<{ completed: boolean; data?: string; error?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // 画布生成队列里的任务被用户终止：不再等结果（供应商脚本拿到这个 error 后可顺手把远端任务撤掉）
    if (genContext.getStore()?.signal.aborted) return { completed: false, error: CANCELLED };
    try {
      const result = await fn();
      if (result.completed) return result;
      if (result?.error) return result;
    } catch (e: any) {
      return { completed: false, error: u.error(e).message || "poll error" };
    }
    await new Promise((res) => setTimeout(res, interval));
  }
  return { completed: false, error: "timeout" };
}

/**
 * 将多张图片横向拼接为一张，并确保输出大小不超过指定限制
 * @param imageBase64List - base64编码的图片数组
 * @param maxSize - 最大输出大小，支持格式如 "10mb", "5MB", "1024kb" 等
 * @returns 拼接后的图片base64字符串
 */
export async function mergeImages(imageBase64List: string[], maxSize = "10mb"): Promise<string> {
  if (imageBase64List.length === 0) {
    throw new Error("图片列表不能为空");
  }

  const maxBytes = parseSize(maxSize);
  const imageBuffers = imageBase64List.map(base64ToBuffer);
  const imageMetadatas = await Promise.all(imageBuffers.map((buffer) => sharp(buffer).metadata()));
  const maxHeight = Math.max(...imageMetadatas.map((m) => m.height || 0));

  // 计算各图片调整后的宽度
  const imageWidths = imageMetadatas.map((metadata) => {
    const aspectRatio = (metadata.width || 1) / (metadata.height || 1);
    return Math.round(maxHeight * aspectRatio);
  });
  const totalWidth = imageWidths.reduce((sum, w) => sum + w, 0);

  // 拼接图片
  const resizedImages = await Promise.all(
    imageBuffers.map(async (buffer, index) => {
      return sharp(buffer).resize(imageWidths[index], maxHeight, { fit: "cover" }).toBuffer();
    }),
  );

  let currentX = 0;
  const compositeInputs = resizedImages.map((buffer, index) => {
    const input = { input: buffer, left: currentX, top: 0 };
    currentX += imageWidths[index];
    return input;
  });

  const mergedBuffer = await sharp({
    create: {
      width: totalWidth,
      height: maxHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(compositeInputs)
    .jpeg({ quality: 90 })
    .toBuffer();

  // 复用压缩逻辑
  const resultBuffer = await compressToSize(mergedBuffer, maxBytes, totalWidth, maxHeight);
  return resultBuffer.toString("base64");
}

/**
 * 解析大小字符串为字节数
 */
function parseSize(size: string): number {
  const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb|b)?$/);
  if (!match) {
    throw new Error(`无效的大小格式: ${size}`);
  }
  const value = parseFloat(match[1]);
  const unit = match[2] || "b";
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };
  return Math.floor(value * multipliers[unit]);
}

/**
 * 在宿主里把 base64 当文件字段 multipart 上传，返回响应体。给供应商脚本用：
 * 二进制绝不能进沙盒——vm2 会把跨膜的 Buffer 逐字节复制（实测 3MB 一张图 1.3 秒，且阻塞 Electron 主进程），
 * 字符串跨膜只是一次拷贝。
 */
export async function uploadBase64File(
  url: string,
  base64: string,
  options: { field?: string; filename: string; contentType?: string; headers?: Record<string, string>; fields?: Record<string, string> },
): Promise<any> {
  const form = new FormData();
  form.append(options.field ?? "file", base64ToBuffer(base64), { filename: options.filename, contentType: options.contentType });
  for (const [key, value] of Object.entries(options.fields ?? {})) form.append(key, value);
  const res = await axios
    .post(url, form, { headers: { ...form.getHeaders(), ...(options.headers ?? {}) }, maxBodyLength: Infinity, maxContentLength: Infinity })
    .catch(rethrowPlain);
  return safeJson(res.data); // 只让纯 JSON 进沙盒，别把响应对象带过去
}

/**
 * 将 base64 字符串（可带 data: 头）转换为宿主 Buffer（宿主内部用，不暴露给沙盒）
 */
export function base64ToBuffer(base64: string): Buffer {
  const base64Data = base64.replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(base64Data, "base64");
}

/**
 * 压缩Buffer到指定大小以内
 */
async function compressToSize(imageBuffer: Buffer, maxBytes: number, originalWidth: number, originalHeight: number): Promise<Buffer> {
  let quality = 90;
  let scale = 1;

  while (true) {
    const targetWidth = Math.round(originalWidth * scale);
    const targetHeight = Math.round(originalHeight * scale);

    const resultBuffer = await sharp(imageBuffer).resize(targetWidth, targetHeight, { fit: "fill" }).jpeg({ quality }).toBuffer();

    if (resultBuffer.length <= maxBytes) {
      return resultBuffer;
    }

    if (quality > 10) {
      quality -= 10;
    } else {
      quality = 90;
      scale *= 0.8;
    }
  }
}
