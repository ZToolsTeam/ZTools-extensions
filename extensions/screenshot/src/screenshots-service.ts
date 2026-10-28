import { LocalStorage } from "@ztools/declarative-ui";
import {
  ScreenshotItem,
  ScreenshotCategory,
  ScreenshotActionResult
} from "./types.js";
import {
  callHostTransport,
  invokePluginService,
  isRealElectronHost,
  getRealSystemPath,
  readRealDirectory,
  writeRealClipboardText
} from "./native-ipc.js";

const PINNED_STORAGE_KEY = "@ztools/screenshots/pinned";
/** 旧版宿主的截图 id 只编码了路径前 12 字节，同目录所有截图 id 相同；读到这种置顶记录直接丢弃 */
const LEGACY_COLLIDING_ID_RE = /^screenshot-[A-Za-z0-9_-]{16}$/;

export function formatScreenshotSize(bytes: number | null): string {
  if (bytes === null) return "未知大小";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))));
  const value = bytes / Math.pow(1024, index);
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[index]}`;
}

function isStrictRealHost(hostOverride?: unknown): boolean {
  if (isRealElectronHost(hostOverride)) return true;
  if (hostOverride !== undefined && hostOverride !== null) return true;
  return false;
}

/**
 * 从真实图片头部字节流解析真实像素宽高 (支持 PNG / GIF / BMP / JPEG / WebP)
 */
export function parseImageDimensionsFromBytes(bytes: Uint8Array): { width: number; height: number } | null {
  if (!bytes || bytes.length < 16) return null;

  // 1. PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR (offset 16..23)
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
    if (width > 0 && height > 0) return { width, height };
  }

  // 2. GIF: "GIF87a" or "GIF89a"
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    if (width > 0 && height > 0) return { width, height };
  }

  // 3. BMP: "BM"
  if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const width =
      (bytes[18] | (bytes[19] << 8) | (bytes[20] << 16) | (bytes[21] << 24)) >>> 0;
    const rawHeight =
      bytes[22] | (bytes[23] << 8) | (bytes[24] << 16) | (bytes[25] << 24);
    const height = Math.abs(rawHeight);
    if (width > 0 && height > 0) return { width, height };
  }

  // 4. WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const chunkHeader = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunkHeader === "VP8 " && bytes.length >= 30) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    } else if (chunkHeader === "VP8L" && bytes.length >= 25) {
      const b0 = bytes[21];
      const b1 = bytes[22];
      const b2 = bytes[23];
      const b3 = bytes[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      if (width > 0 && height > 0) return { width, height };
    } else if (chunkHeader === "VP8X" && bytes.length >= 30) {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      if (width > 0 && height > 0) return { width, height };
    }
  }

  // 5. JPEG: FF D8 ... SOF0..SOF3 (FF C0 .. FF C3)
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (offset + 8 < bytes.length) {
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          if (width > 0 && height > 0) return { width, height };
        }
        break;
      }
      const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (segLen < 2) break;
      offset += 2 + segLen;
    }
  }

  return null;
}

/** 读取图片头部用于解析尺寸的字节数（PNG/GIF/BMP/WebP 只需几十字节，JPEG 的 SOF 段通常在前 64KB 内） */
const IMAGE_HEADER_PROBE_BYTES = 65536;

function base64ToBytes(base64: string): Uint8Array | null {
  try {
    if (typeof atob === "function") {
      const bin = atob(base64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(base64, "base64"));
  } catch {
    // 非法 base64：按读不到处理
  }
  return null;
}

function parentDirOf(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx > 0 ? filePath.slice(0, idx) : filePath;
}

/** 宿主按窗口授权路径：未授权时返回「路径未由当前窗口授权」(PERMISSION_DENIED) */
function isPermissionError(error: string | undefined): boolean {
  return /PERMISSION_DENIED|未由当前窗口授权/i.test(String(error || ""));
}

function hostPlatform(): "mac" | "windows" | "other" {
  const nav = (globalThis as any).navigator;
  const p = String(nav?.platform || nav?.userAgent || "");
  if (/mac|darwin/i.test(p)) return "mac";
  if (/win/i.test(p)) return "windows";
  return "other";
}

/** 截图文字识别目前只有 Windows 实现（Windows 系统文字识别）；其他平台隐藏 OCR 入口 */
export function isOcrSupported(): boolean {
  return hostPlatform() === "windows";
}

function modKey(): string {
  return hostPlatform() === "mac" ? "⌘" : "Ctrl+";
}

export const AUTHORIZE_FOLDER_ACTION_TITLE = "授权访问截图目录 (Grant Folder Access)";

/** 把宿主错误整理成给用户看的原因；未授权时提示用户先授权截图目录 */
export function describeHostError(error: string | undefined, fallback: string): string {
  const msg = String(error || fallback);
  if (isPermissionError(msg)) {
    return `${msg}。请在动作面板 (${modKey()}K) 中选择「授权访问截图目录」后重试`;
  }
  return msg;
}

type DimsProbe = { width: number; height: number } | null;

/**
 * 读取图片头部解析真实像素尺寸；读不到（未授权、文件损坏、非图片）返回 null，由界面显示「未知尺寸」
 * deniedDirs：同一次扫描里已确认未授权的目录，避免对同目录每个文件重复请求
 */
async function probeImageDimensions(
  filePath: string,
  hostOverride?: any,
  deniedDirs?: Set<string>
): Promise<DimsProbe> {
  if (!filePath) return null;
  const dir = parentDirOf(filePath);
  if (deniedDirs?.has(dir)) return null;

  const ipcRes = await callHostTransport<any>(
    "filesystem_read_file_chunk",
    { path: filePath, offset: 0, length: IMAGE_HEADER_PROBE_BYTES },
    hostOverride
  );
  if (ipcRes.ok && ipcRes.data !== undefined && ipcRes.data !== null) {
    const raw = ipcRes.data;
    let bytes: Uint8Array | null = null;
    if (raw instanceof Uint8Array) {
      bytes = raw;
    } else if (typeof raw === "string") {
      bytes = base64ToBytes(raw);
    } else if (typeof raw === "object" && typeof raw.content === "string") {
      bytes = base64ToBytes(raw.content);
    }
    return bytes ? parseImageDimensionsFromBytes(bytes) : null;
  }
  if (isPermissionError(ipcRes.error)) deniedDirs?.add(dir);
  return null;
}

/**
 * 生成轻量且逼真的 SVG 缩略图数据 URL (用于双栏详情展示)
 */
export function generateScreenshotThumbnailSvg(
  label: string,
  width: number,
  height: number,
  accentColor = "#0078D4"
): string {
  // 尺寸未知时只按 16:9 画示意框
  const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
  const svgWidth = 400;
  const svgHeight = Math.max(120, Math.round(400 / aspect));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <rect width="${svgWidth}" height="${svgHeight}" rx="8" fill="#1e1e1e" />
  <!-- 窗口标题栏 -->
  <rect width="${svgWidth}" height="28" rx="8" fill="#2d2d2d" />
  <circle cx="16" cy="14" r="4.5" fill="#ff5f56" />
  <circle cx="30" cy="14" r="4.5" fill="#ffbd2e" />
  <circle cx="44" cy="14" r="4.5" fill="#27c93f" />
  <text x="${svgWidth / 2}" y="18" fill="#a0a0a0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="11" text-anchor="middle">${label}</text>
  
  <!-- 视口内容 -->
  <rect x="20" y="44" width="${svgWidth - 40}" height="14" rx="3" fill="${accentColor}" opacity="0.8" />
  <rect x="20" y="68" width="${Math.round(svgWidth * 0.7)}" height="10" rx="2" fill="#4a4a4a" />
  <rect x="20" y="86" width="${Math.round(svgWidth * 0.5)}" height="10" rx="2" fill="#3a3a3a" />
  <rect x="20" y="104" width="${Math.round(svgWidth * 0.85)}" height="10" rx="2" fill="#4a4a4a" />
  <rect x="20" y="122" width="${Math.round(svgWidth * 0.6)}" height="10" rx="2" fill="#3a3a3a" />
  
  <!-- 底部徽标与尺寸 -->
  <rect x="${svgWidth - 95}" y="${svgHeight - 24}" width="85" height="18" rx="4" fill="#000000" opacity="0.6" />
  <text x="${svgWidth - 52}" y="${svgHeight - 11}" fill="#00ffcc" font-family="monospace" font-size="10" text-anchor="middle">${width > 0 && height > 0 ? `${width}x${height}` : "?"}</text>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * 示例截图数据（仅在脱离客户端的离线预览与测试中使用）
 */
export const INITIAL_SCREENSHOTS: ScreenshotItem[] = [
  {
    id: "ss-ide-01",
    filename: "Screenshot_2026-10-13_142010.png",
    path: "C:\\Users\\User\\Pictures\\Screenshots\\Screenshot_2026-10-13_142010.png",
    width: 2560,
    height: 1440,
    dimensions: "2560 x 1440",
    sizeBytes: 1945600,
    formattedSize: "1.85 MB",
    createdAt: Date.now() - 1000 * 60 * 12,
    modifiedAt: Date.now() - 1000 * 60 * 12,
    formattedDate: "12分钟前",
    pinned: true,
    ocrText: `// 示例：读取并解析配置文件
export async function loadConfig(path: string) {
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}`,
    ocrStatus: "ready",
    thumbnailSvg: generateScreenshotThumbnailSvg("VS Code - config.ts", 2560, 1440, "#0078D4")
  },
  {
    id: "ss-err-02",
    filename: "Screenshot_2026-10-13_135022.png",
    path: "C:\\Users\\User\\Pictures\\Screenshots\\Screenshot_2026-10-13_135022.png",
    width: 1920,
    height: 1080,
    dimensions: "1920 x 1080",
    sizeBytes: 1124000,
    formattedSize: "1.07 MB",
    createdAt: Date.now() - 1000 * 60 * 42,
    modifiedAt: Date.now() - 1000 * 60 * 42,
    formattedDate: "42分钟前",
    pinned: false,
    ocrText: `Error 0x80070005: Access is denied.
Please run the installer as administrator and try again.`,
    ocrStatus: "ready",
    thumbnailSvg: generateScreenshotThumbnailSvg("Windows Error Dialog", 1920, 1080, "#E81123")
  },
  {
    id: "ss-dash-03",
    filename: "Screenshot_2026-10-13_123000.png",
    path: "C:\\Users\\User\\Pictures\\Screenshots\\Screenshot_2026-10-13_123000.png",
    width: 3840,
    height: 2160,
    dimensions: "3840 x 2160 (4K)",
    sizeBytes: 4210000,
    formattedSize: "4.02 MB",
    createdAt: Date.now() - 1000 * 60 * 122,
    modifiedAt: Date.now() - 1000 * 60 * 122,
    formattedDate: "2小时前",
    pinned: true,
    ocrText: `Active Users: 1,284
Average Response Time: 120 ms
Cache Hit Ratio: 96.4%
Memory Usage: 2.1 GB`,
    ocrStatus: "ready",
    thumbnailSvg: generateScreenshotThumbnailSvg("System Metrics Dashboard", 3840, 2160, "#107C41")
  },
  {
    id: "ss-db-04",
    filename: "Screenshot_2026-10-13_111530.png",
    path: "C:\\Users\\User\\Pictures\\Screenshots\\Screenshot_2026-10-13_111530.png",
    width: 2560,
    height: 1440,
    dimensions: "2560 x 1440",
    sizeBytes: 2048000,
    formattedSize: "1.95 MB",
    createdAt: Date.now() - 1000 * 60 * 195,
    modifiedAt: Date.now() - 1000 * 60 * 195,
    formattedDate: "3小时前",
    pinned: false,
    ocrText: `SELECT id, title, created_at
FROM notes
ORDER BY created_at DESC LIMIT 10;
-- 10 rows returned`,
    ocrStatus: "ready",
    thumbnailSvg: generateScreenshotThumbnailSvg("SQLite Query Execution", 2560, 1440, "#744DA9")
  },
  {
    id: "ss-pr-05",
    filename: "Screenshot_2026-10-13_094510.png",
    path: "C:\\Users\\User\\Pictures\\Screenshots\\Screenshot_2026-10-13_094510.png",
    width: 1920,
    height: 1080,
    dimensions: "1920 x 1080",
    sizeBytes: 1540000,
    formattedSize: "1.47 MB",
    createdAt: Date.now() - 1000 * 60 * 285,
    modifiedAt: Date.now() - 1000 * 60 * 285,
    formattedDate: "4小时前",
    pinned: false,
    ocrText: `Pull Request #42: Fix install command in README
Changes:
- Corrected the npm install command
All checks passed. Ready to merge.`,
    ocrStatus: "ready",
    thumbnailSvg: generateScreenshotThumbnailSvg("GitHub PR Review", 1920, 1080, "#238636")
  }
];


const UNKNOWN_DIMENSIONS = "未知尺寸";

function sortScreenshots(items: ScreenshotItem[]): ScreenshotItem[] {
  return items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.modifiedAt - a.modifiedAt;
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function readLocalImageHeader(fs: any, filePath: string): DimsProbe {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(IMAGE_HEADER_PROBE_BYTES);
      const bytesRead = fs.readSync(fd, buf, 0, IMAGE_HEADER_PROBE_BYTES, 0);
      return bytesRead > 0 ? parseImageDimensionsFromBytes(new Uint8Array(buf.buffer, buf.byteOffset, bytesRead)) : null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

export class ScreenshotsManager {
  private items: ScreenshotItem[] = isRealElectronHost() ? [] : [...INITIAL_SCREENSHOTS];
  private pinnedSet = new Set<string>(["ss-ide-01", "ss-dash-03"]);
  /** 本次运行中「立即截取」得到的截图（保存在 ZTools 缓存目录，宿主扫描不到，单独保留在列表里） */
  private captures: ScreenshotItem[] = [];
  private scanned = false;

  private mapHostScreenshot(raw: any, parsedDims?: DimsProbe): ScreenshotItem {
    const filename = String(raw?.filename || raw?.name || "Screenshot.png");
    const fullPath = String(raw?.path || filename);
    // 读不到真实尺寸时记为 0 并显示「未知尺寸」，不再伪造 1920 x 1080
    const width = Number(raw?.width) > 0 ? Number(raw.width) : parsedDims && parsedDims.width > 0 ? parsedDims.width : 0;
    const height = Number(raw?.height) > 0 ? Number(raw.height) : parsedDims && parsedDims.height > 0 ? parsedDims.height : 0;
    const known = width > 0 && height > 0;
    const rawSize = raw?.sizeBytes ?? raw?.size;
    const sizeBytes = typeof rawSize === "number" && Number.isSafeInteger(rawSize) && rawSize >= 0 ? rawSize : null;
    const modifiedAt = Number(raw?.modifiedAt ?? raw?.mtimeMs) > 0 ? Number(raw.modifiedAt ?? raw.mtimeMs) : Date.now();
    const createdAt = Number(raw?.createdAt ?? raw?.birthtimeMs) > 0 ? Number(raw.createdAt ?? raw.birthtimeMs) : modifiedAt;
    // 没有宿主 id 时用完整路径作 id，保证同目录不同文件不会撞 id
    const id = String(raw?.id || (raw?.path ? `ss-path:${fullPath}` : `ss-${filename.replace(/[^a-zA-Z0-9_-]/g, "")}`));
    const hasRealOcr = typeof raw?.ocrText === "string" && raw.ocrText.trim().length > 0;

    return {
      id,
      filename,
      path: fullPath,
      width,
      height,
      dimensions: String(raw?.dimensions || (known ? `${width} x ${height}` : UNKNOWN_DIMENSIONS)),
      sizeBytes,
      formattedSize: formatScreenshotSize(sizeBytes),
      createdAt,
      modifiedAt,
      formattedDate: String(raw?.formattedDate || new Date(modifiedAt).toLocaleTimeString()),
      pinned: Boolean(raw?.pinned) || this.pinnedSet.has(id),
      // 严禁拼接 `系统自动提取文件文本 [${filename}]` 假 OCR 文本
      ocrText: hasRealOcr ? String(raw.ocrText).trim() : "",
      ocrStatus: raw?.ocrStatus ? raw.ocrStatus : hasRealOcr ? "ready" : "pending",
      thumbnailSvg: String(raw?.thumbnailSvg || generateScreenshotThumbnailSvg(filename, width, height, "#0078D4")),
      ...(raw?.source === "capture" ? { source: "capture" as const } : {})
    };
  }

  /** 读取图片文件的 base64 内容（宿主 filesystem_read_file，需路径已授权；ZTools 缓存目录始终可读） */
  private async readImageBase64(filePath: string, hostOverride?: any): Promise<{ ok: boolean; base64?: string; error?: string }> {
    const res = await callHostTransport<any>("filesystem_read_file", { path: filePath, encoding: "base64" }, hostOverride);
    if (!res.ok) return { ok: false, error: res.error };
    const content = typeof res.data === "string" ? res.data : typeof res.data?.content === "string" ? res.data.content : "";
    if (!content) return { ok: false, error: "读取到的图片内容为空" };
    return { ok: true, base64: content };
  }

  /**
   * 把图片本身写入剪贴板：优先以图片格式写入（可直接粘贴进聊天/文档），宿主不支持该图片格式时退回复制文件引用
   */
  private async copyImageFile(filePath: string, hostOverride?: any): Promise<{ ok: boolean; error?: string }> {
    const read = await this.readImageBase64(filePath, hostOverride);
    let imageError = "";
    if (read.ok && read.base64) {
      const img = await callHostTransport<any>("clipboard_copy_image", { image: read.base64 }, hostOverride);
      if (img.ok) return { ok: true };
      imageError = String(img.error || "");
    } else if (isPermissionError(read.error)) {
      return { ok: false, error: read.error };
    }
    const file = await callHostTransport<any>("clipboard_copy_file", { filePath }, hostOverride);
    if (file.ok) return { ok: true };
    // 两条路都失败时优先报告图片本身的问题（如文件损坏、格式不受支持）
    return { ok: false, error: imageError || file.error || read.error };
  }

  /**
   * 立即截取全部显示器并加入截图列表（宿主 screen_capture 只接受可选 rect，返回 { tempFile, width, height }）
   * 截取前隐藏 ZTools 窗口，避免把自己截进去；截完立即恢复显示
   */
  public async captureScreenNow(
    options: { copyToClipboard?: boolean } = {},
    hostOverride?: any
  ): Promise<ScreenshotActionResult> {
    const copyToClipboard = options?.copyToClipboard !== false;
    let capRes: { ok: boolean; data?: any; error?: string };
    const hideRes = await callHostTransport<any>("window_hide", {}, hostOverride);
    try {
      if (hideRes.ok) await new Promise((r) => setTimeout(r, 250));
      capRes = await callHostTransport<any>("screen_capture", {}, hostOverride);
    } finally {
      if (hideRes.ok) await callHostTransport<any>("window_show", {}, hostOverride);
    }

    if (!capRes.ok) {
      return {
        success: false,
        message: `截屏失败: ${capRes.error || "screen_capture 未响应"}`,
        error: capRes.error || "CAPTURE_FAILED"
      };
    }
    const raw = capRes.data && typeof capRes.data === "object" ? capRes.data : {};
    const filePath = String(raw.tempFile || raw.path || "");
    if (!filePath) {
      return { success: false, message: "截屏失败: 宿主没有返回截图文件", error: "CAPTURE_NO_FILE" };
    }

    const fileSize = await callHostTransport<{ size: number }>("filesystem_get_file_size", { path: filePath }, hostOverride);
    const bytes = fileSize.ok ? fileSize.data?.size : undefined;
    const sizeKnown = typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0;
    const sizeNotice = sizeKnown ? "" : `；文件大小未知：${fileSize.error || "宿主未返回有效文件大小"}`;
    const now = new Date();
    const filename = `屏幕截图 ${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}.${pad2(now.getMinutes())}.${pad2(now.getSeconds())}.png`;
    const item = this.mapHostScreenshot({
      id: `capture:${filePath}`,
      filename,
      path: filePath,
      width: raw.width,
      height: raw.height,
      sizeBytes: bytes,
      modifiedAt: now.getTime(),
      source: "capture"
    });
    this.captures = [item, ...this.captures.filter((c) => c.path !== item.path)];
    this.items = sortScreenshots([item, ...this.items.filter((i) => i.path !== item.path)]);

    if (!copyToClipboard) {
      return { success: true, message: `已截取全部屏幕 (${item.dimensions})，已加入列表${sizeNotice}`, screenshot: item };
    }
    const copied = await this.copyImageFile(filePath, hostOverride);
    if (!copied.ok) {
      return {
        success: false,
        message: `已截取全部屏幕 (${item.dimensions})，但复制到剪贴板失败: ${describeHostError(copied.error, "剪贴板不可用")}${sizeNotice}`,
        error: "CAPTURE_COPY_FAILED",
        screenshot: item
      };
    }
    return {
      success: true,
      message: `已截取全部屏幕 (${item.dimensions}) 并复制到剪贴板，按 ${modKey()}V 粘贴${sizeNotice}`,
      screenshot: item
    };
  }

  /**
   * 弹出选择目录对话框，由用户授权 ZTools 访问截图所在目录（宿主授权有效期 1 小时）
   * 授权后复制、回贴、打开、定位与读取尺寸才能访问该目录下的截图
   */
  public async authorizeFolder(defaultPath?: string, hostOverride?: any): Promise<ScreenshotActionResult> {
    const res = await callHostTransport<any>(
      "window_show_select_folder_dialog",
      { title: "选择要授权 ZTools 访问的截图目录", ...(defaultPath ? { defaultPath } : {}) },
      hostOverride
    );
    if (!res.ok) {
      return { success: false, message: `授权失败: ${res.error || "目录对话框不可用"}`, error: res.error || "AUTHORIZE_FAILED" };
    }
    if (res.data?.canceled || !res.data?.folderPath) {
      return { success: false, message: "已取消授权", error: "CANCELED" };
    }
    return { success: true, message: `已授权访问: ${res.data.folderPath}` };
  }

  /**
   * 探测系统默认截图目录 (支持 Windows Pictures/Screenshots 与 macOS Desktop / Pictures)
   */
  public getDefaultLocations(): readonly string[] {
    const locations: string[] = [];
    const home = typeof process !== "undefined" ? process.env.USERPROFILE || process.env.HOME || "" : "";

    if (home) {
      if (home.startsWith("/")) {
        locations.push(`${home}/Desktop`);
        locations.push(`${home}/Pictures/Screenshots`);
        locations.push(`${home}/Pictures`);
      } else {
        locations.push(`${home}\\Pictures\\Screenshots`);
        locations.push(`${home}\\OneDrive\\Pictures\\Screenshots`);
        locations.push(`${home}\\Pictures`);
      }
    }

    return locations;
  }

  /**
   * 扫描真实截图文件并解析图片宽高
   */
  public async scanRealScreenshots(hostOverride?: any): Promise<ScreenshotItem[]> {
    return this.loadScreenshots(true, hostOverride);
  }

  /**
   * 扫描系统磁盘中的截图文件 (优先通过 screenshots_scan IPC 调用主进程扫描，或扫描真实 Pictures / Desktop 目录并解析真实图片文件头尺寸)
   */
  public async loadScreenshots(forceRefresh = false, hostOverride?: any): Promise<ScreenshotItem[]> {
    const strictReal = isStrictRealHost(hostOverride);
    if (this.scanned && !forceRefresh && !hostOverride) {
      return [...this.items];
    }

    try {
      const storedPinned = await LocalStorage.getItem<string[]>(PINNED_STORAGE_KEY);
      if (Array.isArray(storedPinned)) {
        const valid = storedPinned.filter((id) => typeof id === "string" && !LEGACY_COLLIDING_ID_RE.test(id));
        this.pinnedSet = new Set(valid);
        if (valid.length !== storedPinned.length) {
          await LocalStorage.setItem(PINNED_STORAGE_KEY, valid);
        }
      }
    } catch {
      // ignore
    }

    let loadedFromHost = false;
    const deniedDirs = new Set<string>();

    // 1. 优先尝试通过宿主 IPC 通道 screenshots_scan 获取跨平台截图列表
    try {
      if (strictReal) {
        // 宿主只提供 screenshots_scan；失败时如实报告它的错误，不再回退到不存在的方法（会把真实原因覆盖掉）
        const scanRes = await callHostTransport("screenshots_scan", { forceRefresh }, hostOverride);
        if (scanRes.ok && scanRes.data) {
          const rawList = Array.isArray(scanRes.data)
            ? scanRes.data
            : Array.isArray(scanRes.data?.screenshots)
              ? scanRes.data.screenshots
              : Array.isArray(scanRes.data?.items)
                ? scanRes.data.items
                : Array.isArray(scanRes.data?.files)
                  ? scanRes.data.files
                  : [];
          if (Array.isArray(scanRes.data) || Array.isArray(scanRes.data?.screenshots) || Array.isArray(scanRes.data?.items) || Array.isArray(scanRes.data?.files)) {
            const mapped: ScreenshotItem[] = [];
            for (const r of rawList) {
              const hasDims = Number(r?.width) > 0 && Number(r?.height) > 0;
              const dims = hasDims ? null : await probeImageDimensions(String(r?.path || ""), hostOverride, deniedDirs);
              mapped.push(this.mapHostScreenshot(r, dims));
            }
            this.items = mapped;
            loadedFromHost = true;
          }
        }

        if (!loadedFromHost) throw new Error(scanRes.error || "截图扫描结果无效")
      }
    } catch (error) {
      if (strictReal) throw error
    }

    // 2. 在非显式 hostOverride 模式下尝试读取本地文件系统真实系统截图
    if (!loadedFromHost && !hostOverride) {
      try {
        if (typeof process !== "undefined" && process.versions?.node) {
          const fs = await import("node:fs").catch(() => null);
          const path = await import("node:path").catch(() => null);

          if (fs && path) {
            const dirs = this.getDefaultLocations();
            const discovered: ScreenshotItem[] = [];

            for (const dir of dirs) {
              try {
                if (!fs.existsSync(dir)) continue;
                const files = fs.readdirSync(dir);
                for (const f of files) {
                  const ext = path.extname(f).toLowerCase();
                  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp" || ext === ".bmp") {
                    const full = path.join(dir, f);
                    const stat = fs.statSync(full);
                    if (!stat.isFile()) continue;
                    discovered.push(
                      this.mapHostScreenshot(
                        { id: `disk:${full}`, filename: f, path: full, size: stat.size, modifiedAt: stat.mtimeMs, createdAt: stat.birthtimeMs },
                        readLocalImageHeader(fs, full)
                      )
                    );
                  }
                }
              } catch {
                // ignore
              }
            }

            if (discovered.length > 0) {
              const map = new Map<string, ScreenshotItem>();
              for (const item of discovered) map.set(item.id, item);
              if (!strictReal) {
                for (const item of this.items) {
                  if (!map.has(item.id)) map.set(item.id, item);
                }
              }
              this.items = Array.from(map.values());
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 合并本次运行中立即截取的截图（宿主扫描不到缓存目录）
    if (this.captures.length > 0) {
      const scannedPaths = new Set(this.items.map((s) => s.path));
      this.items = [...this.captures.filter((c) => !scannedPaths.has(c.path)), ...this.items];
    }

    // 同步置顶状态
    this.items = this.items.map((s) => ({
      ...s,
      pinned: Boolean(s.pinned) || this.pinnedSet.has(s.id)
    }));

    // 排序：置顶在前，其余按修改时间降序
    sortScreenshots(this.items);

    this.scanned = true;
    return [...this.items];
  }

  /**
   * 搜索与筛选截图 (支持文件名、路径以及 OCR 提取文字过滤)
   */
  public filterScreenshots(
    items: ScreenshotItem[],
    query: string,
    category: ScreenshotCategory = "all"
  ): ScreenshotItem[] {
    const raw = (query || "").trim().toLowerCase();

    return items.filter((item) => {
      // 1. 分类过滤
      if (category === "pinned" && !item.pinned) return false;
      if (category === "recent") {
        const oneHourAgo = Date.now() - 1000 * 60 * 60;
        if (item.modifiedAt < oneHourAgo) return false;
      }
      if (category === "ocr" && (!item.ocrText || item.ocrStatus !== "ready")) return false;

      // 2. 搜索词匹配
      if (!raw) return true;
      if (item.filename.toLowerCase().includes(raw)) return true;
      if (item.path.toLowerCase().includes(raw)) return true;
      if (item.dimensions.toLowerCase().includes(raw)) return true;
      if (item.ocrText.toLowerCase().includes(raw)) return true;

      return false;
    });
  }

  /**
   * 提取指定截图的真实 OCR 文字并写入剪贴板
   * 调用文字识别服务 invokePluginService('OcrPlugin', 'recognizeImage', { path: item.path }, hostBridge)；
   * 该服务只有 Windows 实现，其他平台直接报不支持，不再发出注定失败的 dllplugin_call
   */
  public async extractOcr(item: ScreenshotItem, hostOverride?: any): Promise<string> {
    if (!item || !item.path) {
      throw new Error("INVALID_SCREENSHOT_ITEM: 截图路径不能为空");
    }

    const strictReal = isStrictRealHost(hostOverride);
    if (strictReal && !isOcrSupported()) {
      throw new Error("OCR_NOT_SUPPORTED: 当前平台暂不支持截图文字识别");
    }

    // 1. 优先调用文字识别服务的 recognizeImage
    const pluginRes = await invokePluginService<any>(
      "OcrPlugin",
      "recognizeImage",
      { path: item.path },
      hostOverride
    );

    if (pluginRes.ok && pluginRes.data !== undefined && pluginRes.data !== null) {
      const data = pluginRes.data;
      const text =
        typeof data === "string"
          ? data.trim()
          : typeof data === "object"
            ? String(data.text ?? data.content ?? data.result ?? "").trim()
            : "";
      if (text) {
        ;(item as { ocrText?: string; ocrStatus?: string }).ocrText = text;
        ;(item as { ocrText?: string; ocrStatus?: string }).ocrStatus = "ready";
        await writeRealClipboardText(text, hostOverride);
        return text;
      }
    }

    // 真实宿主下识别失败时绝不伪造 `系统自动提取文件文本 [...]`
    if (strictReal) {
      ;(item as { ocrStatus?: string }).ocrStatus = "failed";
      throw new Error(
        pluginRes.error || `OCR_EXTRACTION_FAILED: 未能从截图 [${item.filename}] 中识别出有效文本`
      );
    }

    if (item.ocrText && item.ocrText.trim()) {
      await writeRealClipboardText(item.ocrText.trim(), hostOverride);
      return item.ocrText.trim();
    }

    return "";
  }

  /**
   * 粘贴截图到当前活动窗口 (Paste to Active Window)
   * 先读出图片交给宿主 clipboard_hide_and_paste_image（写剪贴板 → 隐藏窗口 → 模拟粘贴）；
   * 宿主无法模拟粘贴（如 macOS 未授予辅助功能权限）时，确保图片已在剪贴板并提示用户手动粘贴
   */
  public async pasteToActiveWindow(
    item: ScreenshotItem,
    hostOverride?: any
  ): Promise<ScreenshotActionResult> {
    if (!item || !item.path) {
      return { success: false, message: "截图记录为空", error: "NULL_ITEM" };
    }

    let pasteError = "";
    const read = await this.readImageBase64(item.path, hostOverride);
    if (read.ok && read.base64) {
      const pasteRes = await callHostTransport<any>("clipboard_hide_and_paste_image", { image: read.base64 }, hostOverride);
      if (pasteRes.ok) {
        return { success: true, message: `已将截图 [${item.filename}] 回贴到前台活动窗口`, screenshot: item };
      }
      pasteError = String(pasteRes.error || "");
    } else if (isPermissionError(read.error)) {
      return {
        success: false,
        message: `回贴截图失败: ${describeHostError(read.error, "无法读取截图")}`,
        error: "PERMISSION_DENIED",
        screenshot: item
      };
    }

    const copied = await this.copyImageFile(item.path, hostOverride);
    if (copied.ok) {
      return {
        success: true,
        message: `已复制截图 [${item.filename}]，请按 ${modKey()}V 粘贴到目标窗口${
          /辅助功能/.test(pasteError) ? "（自动粘贴需在 系统设置 -> 隐私与安全性 -> 辅助功能 中授权 ZTools）" : ""
        }`,
        screenshot: item
      };
    }
    return {
      success: false,
      message: `回贴截图失败: ${describeHostError(copied.error, "宿主剪贴板接口未响应")}`,
      error: copied.error || "PASTE_FAILED",
      screenshot: item
    };
  }

  /**
   * 快速回贴最新一张截图 (优先调用 screenshots_paste_latest IPC)
   */
  public async pasteLatestScreenshot(hostOverride?: any): Promise<ScreenshotActionResult> {
    if (isStrictRealHost(hostOverride)) {
      const ipcRes = await callHostTransport<any>("screenshots_paste_latest", {}, hostOverride);
      if (ipcRes.ok) {
        const target = ipcRes.data?.screenshot
          ? this.mapHostScreenshot(ipcRes.data.screenshot)
          : this.items[0];
        // 宿主返回 success:false 时 callHostTransport 给出 ok:false，走下面的插件自身回退；这里按宿主实际结果提示
        return {
          success: true,
          message:
            ipcRes.data?.message ||
            (ipcRes.data?.pasted
              ? `已粘贴最新截图: ${target?.filename || "Latest"}`
              : `已复制最新截图: ${target?.filename || "Latest"}，请按 ${modKey()}V 粘贴`),
          screenshot: target
        };
      }
    }

    const list = await this.loadScreenshots(false, hostOverride);
    if (list.length === 0) {
      return { success: false, message: "未找到近期截图", error: "NO_SCREENSHOTS" };
    }
    return this.pasteToActiveWindow(list[0], hostOverride);
  }

  /**
   * 复制图片本身到剪贴板
   */
  public async copyImageToClipboard(
    item: ScreenshotItem,
    hostOverride?: any
  ): Promise<ScreenshotActionResult> {
    if (!item || !item.path) return { success: false, message: "截图记录为空", error: "NULL_ITEM" };

    const copied = await this.copyImageFile(item.path, hostOverride);
    if (copied.ok) {
      return { success: true, message: `已复制截图到剪贴板: ${item.filename}`, screenshot: item };
    }
    return {
      success: false,
      message: `复制截图失败: ${describeHostError(copied.error, "宿主剪贴板接口未响应")}`,
      error: copied.error || "COPY_FILE_FAILED",
      screenshot: item
    };
  }

  /**
   * 复制图片本地路径
   */
  public async copyImagePath(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult> {
    if (!item) return { success: false, message: "截图记录为空", error: "NULL_ITEM" };
    await writeRealClipboardText(item.path, hostOverride);
    return {
      success: true,
      message: `已复制路径: ${item.path}`,
      screenshot: item
    };
  }

  /**
   * 复制 OCR 提取文字
   */
  public async copyOcrText(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult> {
    if (!item) return { success: false, message: "截图记录为空", error: "NULL_ITEM" };
    try {
      const text = await this.extractOcr(item, hostOverride);
      return {
        success: true,
        message: `已复制 OCR 提取文字 (${text.length} 字符)`,
        screenshot: item,
        ocrText: text
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || "OCR 文本提取失败",
        error: "OCR_FAILED",
        screenshot: item
      };
    }
  }

  /**
   * 在 Finder / 资源管理器中定位 (Show in Finder / Explorer)，按宿主真实结果返回
   */
  public async showInExplorer(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult> {
    if (!item || !item.path) return { success: false, message: "无效的文件路径", error: "INVALID_PATH" };

    const res = await callHostTransport<any>("shell_show_item_in_folder", { fullPath: item.path }, hostOverride);
    if (!res.ok) {
      return {
        success: false,
        message: `定位截图失败: ${describeHostError(res.error, "宿主未响应")}`,
        error: res.error || "SHOW_IN_FOLDER_FAILED",
        screenshot: item
      };
    }
    return { success: true, message: `已在 Finder / 资源管理器中定位: ${item.filename}`, screenshot: item };
  }

  /**
   * 用默认图片查看器打开 (Open with Default App)，按宿主真实结果返回
   */
  public async openWithDefaultApp(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult> {
    if (!item || !item.path) return { success: false, message: "无效的文件路径", error: "INVALID_PATH" };

    const res = await callHostTransport<any>("shell_open_path", { fullPath: item.path }, hostOverride);
    if (!res.ok) {
      return {
        success: false,
        message: `打开截图失败: ${describeHostError(res.error, "宿主未响应")}`,
        error: res.error || "OPEN_FAILED",
        screenshot: item
      };
    }
    return { success: true, message: `已使用系统默认查看器打开: ${item.filename}`, screenshot: item };
  }

  /**
   * 删除截图文件：扫描到的截图走宿主 screenshots_delete（只允许操作扫描结果，移入废纸篓 / 回收站）；
   * 本次立即截取的缓存文件直接删除。宿主失败时保留列表行并返回失败原因
   */
  public async deleteScreenshot(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult> {
    if (!item || !item.path) return { success: false, message: "截图记录为空", error: "NULL_ITEM" };

    if (isStrictRealHost(hostOverride)) {
      const res =
        item.source === "capture"
          ? await callHostTransport<any>("filesystem_delete_file", { path: item.path }, hostOverride)
          : await callHostTransport<any>("screenshots_delete", { filePath: item.path }, hostOverride);
      if (!res.ok) {
        return {
          success: false,
          message: `删除截图失败: ${describeHostError(res.error, "宿主未能移入废纸篓")}`,
          error: res.error || "DELETE_FAILED",
          screenshot: item
        };
      }
    } else if (typeof process !== "undefined" && process.versions?.node) {
      const fs = await import("node:fs").catch(() => null);
      if (fs && fs.existsSync(item.path)) {
        try {
          await fs.promises.unlink(item.path);
        } catch (err: any) {
          return { success: false, message: `删除截图失败: ${err?.message || String(err)}`, error: "DELETE_FAILED", screenshot: item };
        }
      }
    }

    this.items = this.items.filter((s) => s.id !== item.id);
    this.captures = this.captures.filter((s) => s.id !== item.id);
    if (this.pinnedSet.delete(item.id)) {
      try {
        await LocalStorage.setItem(PINNED_STORAGE_KEY, Array.from(this.pinnedSet));
      } catch {
        // 置顶记录写回失败不影响删除结果
      }
    }

    return {
      success: true,
      message: `已删除截图: ${item.filename}`,
      screenshot: item
    };
  }

  /**
   * 置顶/取消置顶截图
   */
  public async togglePinScreenshot(item: ScreenshotItem): Promise<ScreenshotActionResult> {
    if (!item) return { success: false, message: "截图记录为空", error: "NULL_ITEM" };

    const nextPinned = !item.pinned;
    if (nextPinned) {
      this.pinnedSet.add(item.id);
    } else {
      this.pinnedSet.delete(item.id);
    }

    this.items = this.items.map((s) => (s.id === item.id ? { ...s, pinned: nextPinned } : s));
    this.captures = this.captures.map((s) => (s.id === item.id ? { ...s, pinned: nextPinned } : s));
    sortScreenshots(this.items);

    await LocalStorage.setItem(PINNED_STORAGE_KEY, Array.from(this.pinnedSet));

    return {
      success: true,
      message: nextPinned ? `已置顶截图 [${item.filename}]` : `已取消置顶 [${item.filename}]`,
      screenshot: { ...item, pinned: nextPinned }
    };
  }
}

export const defaultScreenshotsManager = new ScreenshotsManager();

export async function scanRealScreenshots(hostOverride?: any): Promise<ScreenshotItem[]> {
  return defaultScreenshotsManager.scanRealScreenshots(hostOverride);
}

export async function extractOcr(item: ScreenshotItem, hostOverride?: any): Promise<string> {
  return defaultScreenshotsManager.extractOcr(item, hostOverride);
}

export async function pasteToActiveWindow(
  item: ScreenshotItem,
  hostOverride?: any
): Promise<ScreenshotActionResult> {
  return defaultScreenshotsManager.pasteToActiveWindow(item, hostOverride);
}

export async function copyImageToClipboard(
  item: ScreenshotItem,
  hostOverride?: any
): Promise<ScreenshotActionResult> {
  return defaultScreenshotsManager.copyImageToClipboard(item, hostOverride);
}
