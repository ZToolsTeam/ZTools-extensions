/**
 * 调用 ZTools 宿主能力（选择文件、读文件、读剪贴板文件 / 图片）
 *
 * 宿主通过 preload 暴露 `__ztoolsElectron.transport.methods[method]({ messageId, params })`，
 * 返回 `{ success, data | error }` 信封。宿主不存在（如单元测试）时抛出 HOST_UNAVAILABLE。
 */

import { t } from "./i18n.js";
import { resolveErrorMessage } from './error-i18n.js'
import { base64ToBytes, type Base64ImageFormat } from "./logic.js";

let seq = 0;

export class HostError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type HostMethod = (request: { messageId: string; params: Record<string, unknown> }) => Promise<{ success: boolean; data?: unknown; error?: { code?: string; message?: string } }>;
interface HostRoot { __ztoolsElectron?: { transport?: { methods?: Record<string, HostMethod> } }; window?: HostRoot }

export async function callHost<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const root = globalThis as unknown as HostRoot;
  const methods = root.window?.__ztoolsElectron?.transport?.methods ?? root.__ztoolsElectron?.transport?.methods;
  const fn = methods?.[method];
  if (typeof fn !== "function") throw new HostError("HOST_UNAVAILABLE", t("errHostUnsupported", { method }));
  seq = (seq + 1) % 1_000_000;
  const envelope = await fn({ messageId: `b64_${Date.now()}_${seq}`, params });
  if (!envelope || typeof envelope !== "object") throw new HostError("HOST_RESPONSE_INVALID", t("errHostResponseInvalid"));
  if (!envelope.success) throw new HostError(envelope.error?.code || "HOST_FAILED", resolveErrorMessage(envelope.error, t("errHostCallFailed", { method })));
  return envelope.data as T;
}

/** 单张图片读取上限：宿主 IPC 单次最多 16 MiB，Base64 会膨胀到 4/3，这里留出余量 */
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;

/** 保存转换后的文本；文件选择器授予当前会话写入权限，取消不创建文件。 */
export async function saveEncodedText(content: string, defaultName: string): Promise<string | null> {
  const picked = await callHost<{ canceled: boolean; filePath?: string }>("window_show_save_dialog", {
    title: t("saveDialogTitle"), defaultName, filters: t("saveDialogFilter")
  });
  if (!picked || picked.canceled || !picked.filePath) return null;
  await callHost("filesystem_write_file", { path: picked.filePath, content, encoding: "utf8" });
  return picked.filePath;
}

/** 根据已识别的图片格式构建默认保存文件名（去除原扩展名，附加真实格式扩展名）。 */
function buildDefaultImageFileName(format: Base64ImageFormat, sourceName?: string): string {
  const rawBase = (sourceName || "").trim().replace(/\.[^.\\/]+$/, "").replace(/[\\/:*?"<>|]/g, "_").trim();
  const base = rawBase || t("restoredImageBaseName");
  return `${base}.${format}`;
}

/** 将解码后的 Base64 还原并保存为真实图片文件（SVG 写入 UTF-8 文本，位图写入真实二进制字节）。 */
export async function saveDecodedImage(
  base64: string,
  format: Base64ImageFormat,
  sourceName?: string
): Promise<string | null> {
  const cleanBase64 = (base64 || "").replace(/[ \t\r\n]/g, "");
  const bytes = base64ToBytes(cleanBase64);
  const svgText = format === "svg" ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : null;
  const defaultName = buildDefaultImageFileName(format, sourceName);
  const filters = t("saveImageDialogFilter", { format: format.toUpperCase(), ext: format });
  const picked = await callHost<{ canceled: boolean; filePath?: string }>("window_show_save_dialog", {
    title: t("saveImageDialogTitle"),
    defaultName,
    filters
  });
  if (!picked || picked.canceled || !picked.filePath) return null;
  if (svgText !== null) {
    await callHost("filesystem_write_file", { path: picked.filePath, content: svgText, encoding: "utf8" });
  } else {
    await callHost("filesystem_write_file", { path: picked.filePath, content: cleanBase64, encoding: "base64" });
  }
  return picked.filePath;
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"];
const getImageFilter = () => t("imageDialogFilter", { exts: IMAGE_EXTENSIONS.join(";") });

export interface LoadedImage {
  name: string;
  base64: string;
}

const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

export function hasImageExtension(filePath: string): boolean {
  const ext = filePath.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase();
  return Boolean(ext && IMAGE_EXTENSIONS.includes(ext));
}

/** 读取一个图片文件的原始字节（Base64），先检查大小，避免把超大文件整段读进内存 */
export async function readImageFile(filePath: string): Promise<LoadedImage> {
  const size = await callHost<{ size?: number } | number>("filesystem_get_file_size", { path: filePath });
  const bytes = typeof size === "number" ? size : Number(size?.size ?? 0);
  if (bytes > MAX_IMAGE_FILE_BYTES) {
    throw new HostError("FILE_TOO_LARGE", t("errFileTooLarge", { size: formatMb(bytes) }));
  }
  const read = await callHost<{ content: string }>("filesystem_read_file", { path: filePath, encoding: "base64" });
  return { name: baseName(filePath), base64: read.content };
}

/**
 * 读取通过 plugin_files_dropped 拖入的图片文件
 */
export async function readDroppedImageFile(envelopeOrPayload: unknown): Promise<LoadedImage | null> {
  if (!envelopeOrPayload || typeof envelopeOrPayload !== "object") return null;
  const record = envelopeOrPayload as Record<string, unknown>;
  const payload = record.payload && typeof record.payload === "object" ? (record.payload as Record<string, unknown>) : record;
  const files = Array.isArray(payload.files)
    ? payload.files.filter((f): f is string => typeof f === "string" && f.trim().length > 0).map(f => f.trim())
    : [];
  if (files.length === 0) return null;
  const image = files.find(hasImageExtension);
  if (!image) {
    throw new HostError("NOT_IMAGE_FILE", t("errDroppedNotImage", { name: baseName(files[0]) }));
  }
  return readImageFile(image);
}

/**
 * 弹出系统选文件窗口并读取图片；用户取消时返回 null
 */
export async function pickImageFile(): Promise<LoadedImage | null> {
  const picked = await callHost<{ canceled: boolean; filePath?: string }>("window_show_open_dialog", {
    title: t("openDialogTitle"),
    filters: getImageFilter(),
    properties: ["openFile"]
  });
  if (!picked || picked.canceled || !picked.filePath) return null;
  return readImageFile(picked.filePath);
}

/**
 * 读取剪贴板里复制的图片文件（访达 / 资源管理器里 ⌘C 的文件），保留原文件字节与文件名。
 * 剪贴板里没有文件、或宿主读不了文件剪贴板时返回 null，由调用方改读剪贴板图片；
 * 有文件但都不是支持的图片时抛出 NOT_IMAGE_FILE。
 */
export async function readClipboardImageFile(): Promise<LoadedImage | null> {
  let files: string[];
  try {
    const res = await callHost<{ files?: unknown }>("clipboard_read_files", {});
    files = Array.isArray(res?.files) ? res.files.filter((f): f is string => typeof f === "string" && f.length > 0) : [];
  } catch {
    // 文件剪贴板不可用（旧宿主、开发版缺少原生助手等）不影响读取截图
    return null;
  }
  if (files.length === 0) return null;
  const image = files.find(hasImageExtension);
  if (!image) {
    throw new HostError("NOT_IMAGE_FILE", t("errCopiedNotImage", { name: baseName(files[0]) }));
  }
  return readImageFile(image);
}

/**
 * 读取剪贴板里的图片（截图、复制的图片）；剪贴板没有图片时返回 null
 */
export async function readClipboardImage(): Promise<LoadedImage | null> {
  const res = await callHost<{ useTempFile?: boolean; tempFile?: string; size?: number; image?: string }>("clipboard_read_image", {});
  if (res?.useTempFile && typeof res.tempFile === "string") {
    const bytes = Number(res.size);
    if (bytes > MAX_IMAGE_FILE_BYTES) {
      throw new HostError("FILE_TOO_LARGE", t("errClipboardImageTooLarge", { size: formatMb(bytes) }));
    }
    const read = await callHost<{ content: string }>("filesystem_read_file", { path: res.tempFile, encoding: "base64" });
    return { name: t("clipboardImageName"), base64: read.content };
  }
  const image = typeof res?.image === "string" ? res.image : "";
  if (!image) return null;
  const comma = image.indexOf(",");
  return { name: t("clipboardImageName"), base64: comma >= 0 ? image.slice(comma + 1) : image };
}
