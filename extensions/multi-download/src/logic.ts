/**
 * 多线程分块下载业务逻辑
 *
 * - 16 / 8 / 4 / 1 线程档位，对应 aria2 参数（如 `--split=16 --min-split-size=1M`）
 * - 发起下载：先交给本机 aria2 JSON-RPC 服务 (`http://127.0.0.1:6800/jsonrpc`) 多线程下载；
 *   连不上 aria2 时，HTTP / HTTPS 链接在用户选好保存位置后由客户端单连接下载，FTP 与磁力链接直接报错
 * - 可把对应的 aria2c 命令复制到剪贴板，由用户自行运行
 * - 从剪贴板识别 HTTP/HTTPS/FTP/Magnet 下载链接
 * - 扫描本机「下载」文件夹（安装包、压缩包、音视频、镜像与文档），读取所在磁盘的剩余空间
 * - 打开文件、在资源管理器中定位，以及在用户确认后把已勾选的文件移入回收站
 */

import { getHostTransport } from "@ztools/declarative-ui";
import {
  callHostTransport,
  getRealFileSize,
  invokeHostCapability,
  openRealPath,
  resolveRealSpecialPaths,
  scanRealDirectoryTree,
  showRealItemInFolder,
  trashRealItem,
  writeRealClipboardText,
  formatBytes,
  type NativeInvocationResult
} from "./native-ipc.js";

export { formatBytes };
export type { NativeInvocationResult };

export const FORBIDDEN_TARGET_PATTERN =
  /(^|[\\/])(Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|Boot|Recovery)($|[\\/])/i;
export const FORBIDDEN_REASON = "禁止操作 Windows 系统核心目录中的受保护文件";

export const ARIA2_ENDPOINT = "http://127.0.0.1:6800/jsonrpc";
/** 客户端单次请求的最长等待时间（5 分钟）；客户端 HTTP 下载单个文件最大 1 GiB */
export const DIRECT_DOWNLOAD_TIMEOUT_MS = 300_000;

export type DownloadFileCategory =
  | "all"
  | "installer"
  | "archive"
  | "media"
  | "iso_image"
  | "document"
  | "other";

export interface DownloadCategoryMeta {
  id: DownloadFileCategory;
  name: string;
  icon: string;
  color: string;
  exts: string[];
}

export const DOWNLOAD_CATEGORIES: DownloadCategoryMeta[] = [
  {
    id: "installer",
    name: "应用安装包",
    icon: "Icon.Box",
    color: "#3b82f6",
    exts: [".exe", ".msi", ".msix", ".appx", ".dmg", ".deb", ".rpm"]
  },
  {
    id: "archive",
    name: "压缩归档包",
    icon: "Icon.Archive",
    color: "#f59e0b",
    exts: [".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz", ".tgz"]
  },
  {
    id: "media",
    name: "音视频与图像",
    icon: "Icon.Video",
    color: "#ec4899",
    exts: [".mp4", ".mkv", ".mov", ".webm", ".avi", ".mp3", ".flac", ".wav", ".png", ".jpg", ".webp"]
  },
  {
    id: "iso_image",
    name: "系统镜像与模型",
    icon: "Icon.Disc",
    color: "#8b5cf6",
    exts: [".iso", ".img", ".vhd", ".vhdx", ".gguf", ".safetensors", ".onnx", ".bin"]
  },
  {
    id: "document",
    name: "办公文档与脚本",
    icon: "Icon.Document",
    color: "#10b981",
    exts: [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".txt", ".md", ".csv", ".json", ".sql"]
  },
  {
    id: "other",
    name: "其他下载文件",
    icon: "Icon.Folder",
    color: "#64748b",
    exts: []
  }
];

export type ThreadSplitPresetId = "threads_16" | "threads_8" | "threads_4" | "threads_1";

export interface ThreadSplitPreset {
  id: ThreadSplitPresetId;
  name: string;
  threads: number;
  splitSize: string;
  aria2Flags: string;
  description: string;
}

/** 线程档位只在交给 aria2 时生效；客户端单连接下载不分块 */
export const THREAD_SPLIT_PRESETS: ThreadSplitPreset[] = [
  {
    id: "threads_16",
    name: "16 线程",
    threads: 16,
    splitSize: "1M",
    aria2Flags: "--max-connection-per-server=16 --split=16 --min-split-size=1M --continue=true",
    description: "16 路并发连接、1MB 最小分块，适合支持分块下载的大文件直链"
  },
  {
    id: "threads_8",
    name: "8 线程",
    threads: 8,
    splitSize: "2M",
    aria2Flags: "--max-connection-per-server=8 --split=8 --min-split-size=2M --continue=true",
    description: "8 路并发连接，服务器限制连接数时比 16 线程稳妥"
  },
  {
    id: "threads_4",
    name: "4 线程",
    threads: 4,
    splitSize: "4M",
    aria2Flags: "--max-connection-per-server=4 --split=4 --min-split-size=4M --continue=true",
    description: "适合严格限制单 IP 连接数的镜像站与网盘直链"
  },
  {
    id: "threads_1",
    name: "单线程",
    threads: 1,
    splitSize: "10M",
    aria2Flags: "--max-connection-per-server=1 --split=1 --continue=true",
    description: "适合不支持分块请求（Range）的链接"
  }
];

export interface DownloadedFileItem {
  id: string;
  name: string;
  path: string;
  ext: string;
  sizeBytes: number;
  mtimeMs: number;
  category: DownloadFileCategory;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
}

export interface Aria2Status {
  /** 连上了 aria2 并拿到了版本号 */
  online: boolean;
  /** 连上了但被拒绝（例如设置了 RPC 密钥），或连接失败的原因 */
  error?: string;
  version?: string;
}

export interface MultiDownloadSnapshot {
  downloadDir: string;
  driveLetter: string;
  /** 是否读到了下载盘的容量；读不到时 driveFreeBytes / driveTotalBytes 为 0，不能当作真实数值显示 */
  driveInfoAvailable: boolean;
  driveFreeBytes: number;
  driveTotalBytes: number;
  aria2RpcOnline: boolean;
  aria2Status: Aria2Status;
  aria2Endpoint: string;
  sniffedClipboardUrl: string;
  sniffedProtocol: string;
  files: DownloadedFileItem[];
  totalSizeBytes: number;
  categoryStats: Array<{
    category: DownloadFileCategory;
    name: string;
    color: string;
    sizeBytes: number;
    count: number;
  }>;
  updatedAt: string;
}

/** 测试可注入的 fetch；默认使用运行环境的 fetch */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface Aria2Options {
  fetchImpl?: FetchLike;
}

export function classifyDownloadedExtension(extRaw: string): DownloadCategoryMeta {
  const ext = String(extRaw || "").toLowerCase();
  for (const cat of DOWNLOAD_CATEGORIES) {
    if (cat.id !== "other" && cat.exts.includes(ext)) {
      return cat;
    }
  }
  return DOWNLOAD_CATEGORIES[DOWNLOAD_CATEGORIES.length - 1];
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function detectDownloadUrlFromText(rawText: string): {
  url: string;
  protocol: string;
  suggestedFileName: string;
} {
  const text = String(rawText || "").trim();
  if (!text) return { url: "", protocol: "无链接", suggestedFileName: "" };

  const magnetMatch = text.match(/magnet:\?xt=urn:[a-z0-9]+:[a-zA-Z0-9]{32,}/i);
  if (magnetMatch) {
    return {
      url: magnetMatch[0],
      protocol: "磁力链接",
      suggestedFileName: ""
    };
  }

  const httpMatch = text.match(/(https?|ftp):\/\/[^\s"'<>]+/i);
  if (httpMatch) {
    const url = httpMatch[0];
    const cleanPath = url.split("?")[0].split("#")[0];
    const lastSeg = cleanPath.substring(cleanPath.lastIndexOf("/") + 1);
    const protocol = url.toLowerCase().startsWith("ftp") ? "FTP 链接" : "HTTP(S) 链接";
    const fileName = safeDecode(lastSeg)
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
      .trim()
      .slice(0, 120);
    return { url, protocol, suggestedFileName: fileName };
  }

  return { url: "", protocol: "剪贴板未检测到下载链接", suggestedFileName: "" };
}

function failure(error: string, message: string): NativeInvocationResult {
  return { ok: false, code: -1, error, message };
}

type Aria2CallResult =
  | { reachable: false; error: string }
  | { reachable: true; result?: unknown; error?: string };

/** 调用本机 aria2 JSON-RPC。连不上（未运行、跨域被拒、超时）时 reachable 为 false */
async function callAria2(
  method: string,
  params: unknown[],
  timeoutMs: number,
  fetchImpl?: FetchLike
): Promise<Aria2CallResult> {
  const doFetch: FetchLike | null =
    fetchImpl ?? (typeof fetch === "function" ? (fetch as unknown as FetchLike) : null);
  if (!doFetch) return { reachable: false, error: "当前环境不能发起网络请求" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await doFetch(ARIA2_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `ztools-${Date.now()}`, method, params }),
      signal: controller.signal
    });
    let body: unknown = null;
    try {
      body = await resp.json();
    } catch {
      body = null;
    }
    const rpc = body && typeof body === "object" ? (body as { result?: unknown; error?: { message?: unknown } }) : null;
    if (rpc?.error) {
      return { reachable: true, error: String(rpc.error.message || "aria2 返回错误") };
    }
    if (!resp.ok) return { reachable: true, error: `aria2 返回 HTTP ${resp.status}` };
    if (!rpc || rpc.result === undefined) return { reachable: true, error: "aria2 返回的结果无法识别" };
    return { reachable: true, result: rpc.result };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeAria2JsonRpc(options: Aria2Options = {}): Promise<Aria2Status> {
  const res = await callAria2("aria2.getVersion", [], 1000, options.fetchImpl);
  if (!res.reachable) return { online: false, error: res.error };
  if (res.error) return { online: false, error: res.error };
  const version = (res.result as { version?: unknown } | undefined)?.version;
  return typeof version === "string" ? { online: true, version } : { online: false, error: "aria2 返回的结果无法识别" };
}

export async function readClipboardDownloadUrl(hostBridge?: unknown): Promise<{
  url: string;
  protocol: string;
  suggestedFileName: string;
}> {
  const ipcClip = await callHostTransport<unknown>("clipboard_read_text", {}, hostBridge);
  if (ipcClip.ok && ipcClip.data) {
    const data = ipcClip.data;
    const txt =
      typeof data === "string"
        ? data
        : typeof (data as { text?: unknown }).text === "string"
          ? String((data as { text: string }).text)
          : "";
    return detectDownloadUrlFromText(txt);
  }
  return { url: "", protocol: "剪贴板未检测到下载链接", suggestedFileName: "" };
}

export async function fetchMultiDownloadSnapshot(
  hostBridge?: unknown,
  options: Aria2Options = {}
): Promise<MultiDownloadSnapshot> {
  const paths = await resolveRealSpecialPaths(hostBridge);
  const downloadDir = paths.downloads || `${paths.userProfile}\\Downloads`;
  const driveLetter = (downloadDir.match(/^[A-Za-z]:/) || ["C:"])[0].toUpperCase();

  const [diskRes, sysRes, rawEntries, aria2Status, clipInfo] = await Promise.all([
    callHostTransport<{ total?: number; used?: number; available?: number; free?: number }>(
      "system_get_disk_usage",
      { drive: `${driveLetter}\\` },
      hostBridge
    ),
    invokeHostCapability<Record<string, unknown>>("system.info", { includeStorage: true }, hostBridge),
    scanRealDirectoryTree(downloadDir, { maxDepth: 2, maxFiles: 220, hostOverride: hostBridge }),
    probeAria2JsonRpc(options),
    readClipboardDownloadUrl(hostBridge)
  ]);

  let driveFreeBytes = 0;
  let driveTotalBytes = 0;
  if (diskRes.ok && diskRes.data) {
    driveTotalBytes = Number(diskRes.data.total || 0);
    const used = Number(diskRes.data.used || 0);
    driveFreeBytes = Number(
      diskRes.data.available ?? diskRes.data.free ?? Math.max(0, driveTotalBytes - used)
    );
  } else if (sysRes.ok && sysRes.data) {
    const storageArr = Array.isArray((sysRes.data as { storage?: unknown }).storage)
      ? ((sysRes.data as { storage: Array<Record<string, unknown>> }).storage)
      : [];
    const matchedDrive = storageArr.find((d) =>
      String(d.mount || d.fs || "").toUpperCase().startsWith(driveLetter)
    );
    if (matchedDrive) {
      driveTotalBytes = Number(matchedDrive.size || matchedDrive.total || 0);
      const used = Number(matchedDrive.used || 0);
      driveFreeBytes = Number(matchedDrive.available || matchedDrive.free || Math.max(0, driveTotalBytes - used));
    }
  }
  if (!Number.isFinite(driveFreeBytes) || driveFreeBytes < 0) driveFreeBytes = 0;
  if (!Number.isFinite(driveTotalBytes) || driveTotalBytes < 0) driveTotalBytes = 0;

  const files: DownloadedFileItem[] = [];
  let totalSizeBytes = 0;
  const catMap = new Map<DownloadFileCategory, { sizeBytes: number; count: number }>();
  for (const cat of DOWNLOAD_CATEGORIES) {
    catMap.set(cat.id, { sizeBytes: 0, count: 0 });
  }

  for (const entry of rawEntries.files) {
    const sz = Number(entry.sizeBytes ?? entry.size ?? 0);
    if (entry.isDirectory || sz <= 0) continue;
    const ext = String(entry.ext || "").toLowerCase();
    const catMeta = classifyDownloadedExtension(ext);
    totalSizeBytes += sz;
    const stat = catMap.get(catMeta.id);
    if (stat) {
      stat.sizeBytes += sz;
      stat.count += 1;
    }

    files.push({
      id: entry.path,
      name: entry.name,
      path: entry.path,
      ext,
      sizeBytes: sz,
      mtimeMs: Number(entry.mtimeMs || 0),
      category: catMeta.id,
      categoryName: catMeta.name,
      categoryColor: catMeta.color,
      categoryIcon: catMeta.icon
    });
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.sizeBytes - a.sizeBytes);

  const categoryStats = DOWNLOAD_CATEGORIES.map((c) => {
    const st = catMap.get(c.id) || { sizeBytes: 0, count: 0 };
    return {
      category: c.id,
      name: c.name,
      color: c.color,
      sizeBytes: st.sizeBytes,
      count: st.count
    };
  }).filter((s) => s.sizeBytes > 0);

  return {
    downloadDir,
    driveLetter,
    driveInfoAvailable: driveTotalBytes > 0,
    driveFreeBytes,
    driveTotalBytes,
    aria2RpcOnline: aria2Status.online,
    aria2Status,
    aria2Endpoint: ARIA2_ENDPOINT,
    sniffedClipboardUrl: clipInfo.url,
    sniffedProtocol: clipInfo.protocol,
    files,
    totalSizeBytes,
    categoryStats,
    updatedAt: new Date().toLocaleTimeString()
  };
}

/** 下载盘剩余空间不足 10% 时返回 true；读不到容量时返回 false */
export function isDriveLowOnSpace(snapshot: Pick<MultiDownloadSnapshot, "driveInfoAvailable" | "driveFreeBytes" | "driveTotalBytes">): boolean {
  return (
    snapshot.driveInfoAvailable &&
    snapshot.driveTotalBytes > 0 &&
    snapshot.driveFreeBytes / snapshot.driveTotalBytes < 0.1
  );
}

/**
 * 需要较长时间的宿主调用：客户端里通过带插件身份的通道把超时放宽到 timeoutMs；
 * 测试注入宿主替身或旧客户端没有该通道时，退回普通调用（默认超时）。
 */
async function callHostLongRunning<T>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  hostBridge?: unknown
): Promise<{ ok: boolean; data?: T; error?: string }> {
  if (!hostBridge) {
    // 旧客户端可能没有这个接口，此时退回普通调用
    const transport = typeof getHostTransport === "function" ? getHostTransport() : null;
    if (transport) {
      try {
        const data = await transport.call<T>(method, params, { timeoutMs });
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  return callHostTransport<T>(method, params, hostBridge);
}

interface SaveDialogResult {
  canceled?: boolean;
  filePath?: string;
}

interface HttpDownloadResult {
  path?: string;
  size?: number;
}

function isSupportedDownloadUrl(url: string): boolean {
  return /^(https?|ftp):\/\/\S+$/i.test(url) || /^magnet:\?\S+$/i.test(url);
}

/** 客户端单连接下载 HTTP(S) 链接：先弹保存对话框（同名文件由系统对话框确认是否替换），再下载到所选位置 */
async function downloadViaClient(
  url: string,
  downloadDir: string,
  aria2Reason: string,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  const parsed = detectDownloadUrlFromText(url);
  const ext = (parsed.suggestedFileName.match(/\.([A-Za-z0-9][A-Za-z0-9+_-]{0,31})$/) || [])[1];
  const dialogRes = await callHostTransport<SaveDialogResult>(
    "window_show_save_dialog",
    {
      title: "保存下载文件",
      ...(downloadDir ? { defaultPath: downloadDir } : {}),
      defaultName: parsed.suggestedFileName || "download",
      ...(ext ? { filters: `${ext.toUpperCase()} 文件|${ext}|所有文件|*` } : {})
    },
    hostBridge
  );
  if (!dialogRes.ok) {
    return failure("SAVE_DIALOG_FAILED", `无法打开保存对话框：${dialogRes.error || "客户端未返回原因"}`);
  }
  const savePath = typeof dialogRes.data?.filePath === "string" ? dialogRes.data.filePath : "";
  if (dialogRes.data?.canceled || !savePath) {
    return failure("CANCELED", "已取消下载");
  }
  if (FORBIDDEN_TARGET_PATTERN.test(savePath)) {
    return failure("FORBIDDEN_TARGET", FORBIDDEN_REASON);
  }

  const dl = await callHostLongRunning<HttpDownloadResult>(
    "network_http_download",
    { url, savePath },
    DIRECT_DOWNLOAD_TIMEOUT_MS,
    hostBridge
  );
  if (!dl.ok) {
    return failure("DOWNLOAD_FAILED", `下载失败：${dl.error || "客户端未返回原因"}`);
  }
  const finalPath = typeof dl.data?.path === "string" && dl.data.path ? dl.data.path : savePath;
  const size = Number(dl.data?.size);
  const sizeText = Number.isFinite(size) && size >= 0 ? `（${formatBytes(size)}）` : "";
  return {
    ok: true,
    code: 0,
    message: `未连接到本机 aria2（${aria2Reason}），已用客户端单连接下载到 ${finalPath}${sizeText}，线程档位未生效`,
    data: { engine: "client", path: finalPath, size: Number.isFinite(size) ? size : undefined }
  };
}

/**
 * 发起下载：优先交给本机 aria2 按档位多线程下载；连不上 aria2 时，
 * HTTP(S) 链接由客户端单连接下载（需用户在保存对话框中选位置），FTP 与磁力链接返回失败。
 */
export async function startMultiThreadDownloadTask(
  url: string,
  downloadDir: string,
  preset: ThreadSplitPreset,
  hostBridge?: unknown,
  options: Aria2Options = {}
): Promise<NativeInvocationResult> {
  const trimmed = String(url || "").trim();
  if (!trimmed || !isSupportedDownloadUrl(trimmed)) {
    return failure("INVALID_URL", "未提供有效的 HTTP/HTTPS/FTP/磁力链接，请先复制下载链接到剪贴板，或粘贴到搜索框");
  }

  const aria2 = await callAria2(
    "aria2.addUri",
    [
      [trimmed],
      {
        ...(downloadDir ? { dir: downloadDir } : {}),
        "max-connection-per-server": String(preset.threads),
        split: String(preset.threads),
        "min-split-size": preset.splitSize,
        continue: "true"
      }
    ],
    3000,
    options.fetchImpl
  );
  if (aria2.reachable) {
    if (aria2.error) {
      return failure("ARIA2_REJECTED", `aria2 没有接受这个任务：${aria2.error}`);
    }
    const gid = typeof aria2.result === "string" ? aria2.result : "";
    return {
      ok: true,
      code: 0,
      message: `已添加到本机 aria2（${preset.threads} 线程${gid ? `，任务 ${gid}` : ""}），下载进度请在 aria2 中查看`,
      data: { engine: "aria2", gid }
    };
  }

  if (!/^https?:/i.test(trimmed)) {
    const kind = /^magnet:/i.test(trimmed) ? "磁力链接" : "FTP 链接";
    return failure(
      "ARIA2_REQUIRED",
      `${kind}需要本机运行 aria2 并开启 RPC（未连接：${aria2.error}）；可在 Ctrl+K 中复制 aria2c 命令自行运行`
    );
  }
  return downloadViaClient(trimmed, downloadDir, aria2.error, hostBridge);
}

export function buildAria2cCommand(url: string, downloadDir: string, preset: ThreadSplitPreset): string {
  const dirArg = downloadDir ? ` -d "${downloadDir}"` : "";
  return `aria2c ${preset.aria2Flags}${dirArg} "${url}"`;
}

/** 生成 aria2c 命令并复制到剪贴板；插件不会运行它 */
export async function copyAria2cCommand(
  url: string,
  downloadDir: string,
  preset: ThreadSplitPreset,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  const trimmed = String(url || "").trim();
  if (!trimmed || !isSupportedDownloadUrl(trimmed)) {
    return failure("INVALID_URL", "未识别到下载链接");
  }
  const command = buildAria2cCommand(trimmed, downloadDir, preset);
  const copied = await writeRealClipboardText(command, hostBridge);
  if (!copied) {
    return failure("CLIPBOARD_WRITE_FAILED", "复制 aria2c 命令失败：无法写入剪贴板");
  }
  return {
    ok: true,
    code: 0,
    message: `已复制 aria2c 命令（${preset.name}）。插件不会运行它，请在已安装 aria2 的终端中运行`,
    data: { command }
  };
}

export interface TrashDownloadsResult {
  deletedCount: number;
  freedBytes: number;
  failed: Array<{ path: string; reason: string }>;
}

/** 逐个把传入的文件移入回收站；只处理传入的路径，失败的条目如实列出 */
export async function deleteDownloadedFiles(
  paths: string[],
  knownFiles: DownloadedFileItem[] = [],
  hostBridge?: unknown
): Promise<TrashDownloadsResult> {
  let deletedCount = 0;
  let freedBytes = 0;
  const failed: TrashDownloadsResult["failed"] = [];
  const sizeMap = new Map<string, number>();
  for (const item of knownFiles) {
    if (item && item.path) {
      sizeMap.set(item.path, Number(item.sizeBytes || 0));
    }
  }

  for (const targetPath of paths) {
    if (!targetPath) continue;
    if (FORBIDDEN_TARGET_PATTERN.test(targetPath)) {
      failed.push({ path: targetPath, reason: FORBIDDEN_REASON });
      continue;
    }
    const knownSize = sizeMap.get(targetPath) ?? (await getRealFileSize(targetPath, hostBridge));
    const res = await trashRealItem(targetPath, hostBridge);
    if (res.ok) {
      deletedCount += 1;
      freedBytes += knownSize;
    } else {
      failed.push({ path: targetPath, reason: res.error || "移入回收站失败" });
    }
  }
  return { deletedCount, freedBytes, failed };
}

export async function openDownloadedFileLocation(
  targetPath: string,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  if (!targetPath) return failure("EMPTY_PATH", "路径为空");
  const ok = await showRealItemInFolder(targetPath, hostBridge);
  return ok
    ? { ok: true, code: 0, message: `已在资源管理器中定位: ${targetPath}` }
    : failure("SHOW_IN_FOLDER_FAILED", `定位失败: ${targetPath}`);
}

export async function openDownloadedFile(
  targetPath: string,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  if (!targetPath) return failure("EMPTY_PATH", "路径为空");
  const ok = await openRealPath(targetPath, hostBridge);
  return ok
    ? { ok: true, code: 0, message: `已打开: ${targetPath}` }
    : failure("OPEN_FAILED", `打开失败: ${targetPath}`);
}
