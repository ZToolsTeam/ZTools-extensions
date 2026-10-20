/**
 * 调用 ZTools 宿主能力（选择文件、读文件、读剪贴板图片）
 *
 * 宿主通过 preload 暴露 `__ztoolsElectron.transport.methods[method]({ messageId, params })`，
 * 返回 `{ success, data | error }` 信封。宿主不存在（如单元测试）时抛出 HOST_UNAVAILABLE。
 */

let seq = 0;

export class HostError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function callHost<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const methods = (globalThis as any).window?.__ztoolsElectron?.transport?.methods ?? (globalThis as any).__ztoolsElectron?.transport?.methods;
  const fn = methods?.[method];
  if (typeof fn !== "function") throw new HostError("HOST_UNAVAILABLE", `当前环境不支持 ${method}`);
  seq = (seq + 1) % 1_000_000;
  const envelope = await fn({ messageId: `b64_${Date.now()}_${seq}`, params });
  if (!envelope || typeof envelope !== "object") throw new HostError("HOST_RESPONSE_INVALID", "宿主返回了无法识别的结果");
  if (!envelope.success) throw new HostError(envelope.error?.code || "HOST_FAILED", envelope.error?.message || `${method} 调用失败`);
  return envelope.data as T;
}

/** 单张图片读取上限：宿主 IPC 单次最多 16 MiB，Base64 会膨胀到 4/3，这里留出余量 */
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;

const IMAGE_FILTER = "图片|png;jpg;jpeg;gif;webp;svg";

export interface LoadedImage {
  name: string;
  base64: string;
}

/**
 * 弹出系统选文件窗口并读取图片；用户取消时返回 null
 */
export async function pickImageFile(): Promise<LoadedImage | null> {
  const picked = await callHost<{ canceled: boolean; filePath?: string }>("window_show_open_dialog", {
    title: "选择要转成 Base64 的图片",
    filters: IMAGE_FILTER,
    properties: ["openFile"]
  });
  if (!picked || picked.canceled || !picked.filePath) return null;
  const filePath = picked.filePath;
  const size = await callHost<{ size?: number } | number>("filesystem_get_file_size", { path: filePath });
  const bytes = typeof size === "number" ? size : Number((size as any)?.size ?? 0);
  if (bytes > MAX_IMAGE_FILE_BYTES) {
    throw new HostError("FILE_TOO_LARGE", `图片超过 10 MB（${(bytes / 1024 / 1024).toFixed(1)} MB），请先压缩`);
  }
  const read = await callHost<{ content: string }>("filesystem_read_file", { path: filePath, encoding: "base64" });
  const name = filePath.split(/[\\/]/).pop() || filePath;
  return { name, base64: read.content };
}

/**
 * 读取剪贴板里的图片（截图、复制的图片）；剪贴板没有图片时返回 null
 */
export async function readClipboardImage(): Promise<LoadedImage | null> {
  const res = await callHost<any>("clipboard_read_image", {});
  if (res?.useTempFile && typeof res.tempFile === "string") {
    if (Number(res.size) > MAX_IMAGE_FILE_BYTES) {
      throw new HostError("FILE_TOO_LARGE", "剪贴板里的图片超过 10 MB，请先压缩");
    }
    const read = await callHost<{ content: string }>("filesystem_read_file", { path: res.tempFile, encoding: "base64" });
    return { name: "剪贴板图片.png", base64: read.content };
  }
  const image = typeof res?.image === "string" ? res.image : "";
  if (!image) return null;
  const comma = image.indexOf(",");
  return { name: "剪贴板图片.png", base64: comma >= 0 ? image.slice(comma + 1) : image };
}
