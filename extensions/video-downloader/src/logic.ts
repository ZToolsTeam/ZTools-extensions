/**
 * 视频下载业务逻辑
 *
 * - 识别链接所属平台（`detectVideoPlatform`）：Bilibili 链接与 BV 号、抖音、快手、YouTube、微博，其余按通用链接处理
 * - 视频直链（.mp4 / .webm / .mkv / .mov / .flv / .m4v）：用户在保存对话框里选好位置后，由客户端 HTTP 下载
 * - 平台页面链接：客户端没有视频解析能力，插件不下载，只按所选档位生成 yt-dlp 命令，由用户复制后自行运行
 * - 扫描本机「视频」与「下载」文件夹里已保存的视频文件，可打开、定位，或在用户确认后移入回收站
 */

import { getHostTransport } from "@ztools/declarative-ui";
import {
  callHostTransport,
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
export const FORBIDDEN_REASON = "禁止操作 Windows 系统核心目录中的文件";

/** 客户端单次请求的最长等待时间（5 分钟）；客户端 HTTP 下载单个文件最大 1 GiB */
export const DIRECT_DOWNLOAD_TIMEOUT_MS = 300_000;

export type StreamPlatformId =
  | "bilibili"
  | "douyin"
  | "kuaishou"
  | "youtube"
  | "weibo"
  | "m3u8_direct";

export interface StreamPlatformMeta {
  id: StreamPlatformId;
  name: string;
  /** 界面上显示的处理方式标签 */
  handlerName: string;
  /** 界面上显示的可识别链接说明 */
  features: string;
}

export const STREAM_PLATFORMS: StreamPlatformMeta[] = [
  {
    id: "bilibili",
    name: "哔哩哔哩 (Bilibili)",
    handlerName: "复制 yt-dlp 命令",
    features: "识别 bilibili.com / b23.tv 链接与 BV 号"
  },
  {
    id: "douyin",
    name: "抖音 (Douyin)",
    handlerName: "复制 yt-dlp 命令",
    features: "识别 douyin.com / iesdouyin.com 分享链接"
  },
  {
    id: "kuaishou",
    name: "快手 (Kuaishou)",
    handlerName: "复制 yt-dlp 命令",
    features: "识别 kuaishou.com / chenzhongtech.com 分享链接"
  },
  {
    id: "youtube",
    name: "YouTube",
    handlerName: "复制 yt-dlp 命令",
    features: "识别 youtube.com / youtu.be 链接"
  },
  {
    id: "weibo",
    name: "微博视频 (Weibo)",
    handlerName: "复制 yt-dlp 命令",
    features: "识别 weibo.com / weibo.cn 视频链接"
  },
  {
    id: "m3u8_direct",
    name: "视频直链与其他链接",
    handlerName: "直链可下载",
    features: ".mp4 / .webm / .mkv / .mov / .flv / .m4v 直链可直接下载；M3U8 等其他链接只能复制 yt-dlp 命令"
  }
];

export type VideoQualityPresetId =
  | "q_4k_mp4"
  | "q_1080p_mp4"
  | "q_720p_mp4"
  | "q_audio_mp3"
  | "q_audio_flac"
  | "q_with_subs";

export interface VideoQualityPreset {
  id: VideoQualityPresetId;
  name: string;
  badge: string;
  ytDlpArgs: string;
  description: string;
}

/** 档位只影响生成的 yt-dlp 命令；视频直链按原文件下载，不区分档位 */
export const VIDEO_QUALITY_PRESETS: VideoQualityPreset[] = [
  {
    id: "q_4k_mp4",
    name: "最高可用画质 (MP4)",
    badge: "最高画质",
    ytDlpArgs: '-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best" --merge-output-format mp4',
    description: "取网站提供的最高画质视频流和音频流，合并为 MP4（合并需要 FFmpeg）"
  },
  {
    id: "q_1080p_mp4",
    name: "不超过 1080P (MP4)",
    badge: "1080P",
    ytDlpArgs: '-f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]" --merge-output-format mp4',
    description: "画面高度不超过 1080，优先 MP4 视频流和 M4A 音频流"
  },
  {
    id: "q_720p_mp4",
    name: "不超过 720P (MP4)",
    badge: "720P",
    ytDlpArgs: '-f "bestvideo[height<=720]+bestaudio/best[height<=720]" --merge-output-format mp4',
    description: "画面高度不超过 720，文件比高画质小"
  },
  {
    id: "q_audio_mp3",
    name: "仅音频 (MP3)",
    badge: "MP3",
    ytDlpArgs: "-x --audio-format mp3 --audio-quality 0 --embed-thumbnail --add-metadata",
    description: "只保留音轨，转为最高质量的 MP3，并写入封面和标题（需要 FFmpeg）"
  },
  {
    id: "q_audio_flac",
    name: "仅音频 (FLAC)",
    badge: "FLAC",
    ytDlpArgs: "-x --audio-format flac --audio-quality 0",
    description: "只保留音轨并转为 FLAC 格式，音质不会高于网站提供的原始音频（需要 FFmpeg）"
  },
  {
    id: "q_with_subs",
    name: "不超过 1080P + 字幕 + 封面",
    badge: "含字幕封面",
    ytDlpArgs:
      '-f "bestvideo[height<=1080]+bestaudio/best" --merge-output-format mp4 --write-subs --write-auto-subs --sub-langs "zh.*,en.*" --write-thumbnail',
    description: "下载视频的同时保存中英文字幕和封面图，格式取决于网站"
  }
];

export interface LocalMediaVideoItem {
  id: string;
  name: string;
  path: string;
  ext: string;
  sizeBytes: number;
  mtimeMs: number;
  sourceDirLabel: string;
}

export interface VideoDownloaderSnapshot {
  saveDir: string;
  clipboardUrl: string;
  detectedPlatform: StreamPlatformMeta;
  videos: LocalMediaVideoItem[];
  totalSizeBytes: number;
  updatedAt: string;
}

export interface VideoLinkInfo {
  url: string;
  platform: StreamPlatformMeta;
  /** 视频直链的扩展名（不含点）；不是直链时为空字符串 */
  directExt: string;
}

export function detectVideoPlatform(rawText: string): {
  url: string;
  platform: StreamPlatformMeta;
} {
  const text = String(rawText || "").trim();
  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
  const bvMatch = text.match(/\b(BV[0-9A-Za-z]{10})\b/);
  const extractedUrl = urlMatch
    ? urlMatch[0]
    : bvMatch
      ? `https://www.bilibili.com/video/${bvMatch[1]}`
      : "";

  const lower = (extractedUrl || text).toLowerCase();
  if (lower.includes("bilibili.com") || lower.includes("b23.tv") || bvMatch) {
    return { url: extractedUrl, platform: STREAM_PLATFORMS[0] };
  }
  if (lower.includes("douyin.com") || lower.includes("iesdouyin.com")) {
    return { url: extractedUrl, platform: STREAM_PLATFORMS[1] };
  }
  if (lower.includes("kuaishou.com") || lower.includes("chenzhongtech.com")) {
    return { url: extractedUrl, platform: STREAM_PLATFORMS[2] };
  }
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    return { url: extractedUrl, platform: STREAM_PLATFORMS[3] };
  }
  if (lower.includes("weibo.com") || lower.includes("weibo.cn")) {
    return { url: extractedUrl, platform: STREAM_PLATFORMS[4] };
  }
  return { url: extractedUrl, platform: STREAM_PLATFORMS[5] };
}

/** 返回视频直链的扩展名（mp4 / webm / mkv / mov / flv / m4v）；不是 HTTP(S) 视频直链时返回空字符串 */
export function directVideoExtension(url: string): string {
  let pathname = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    pathname = parsed.pathname;
  } catch {
    return "";
  }
  const match = pathname.match(/\.(mp4|webm|mkv|mov|flv|m4v)$/i);
  return match ? match[1].toLowerCase() : "";
}

export function describeVideoLink(rawText: string): VideoLinkInfo {
  const detected = detectVideoPlatform(rawText);
  return { ...detected, directExt: detected.url ? directVideoExtension(detected.url) : "" };
}

/** 从直链地址取保存对话框里的默认文件名，非法字符替换为下划线 */
export function suggestVideoFileName(url: string, ext: string): string {
  let base = "";
  try {
    base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {
    base = "";
  }
  const safe = base.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").trim();
  return safe || `video.${ext || "mp4"}`;
}

export function buildYtDlpCommand(url: string, saveDir: string, preset: VideoQualityPreset): string {
  const dirArg = saveDir ? ` -P "${saveDir}"` : "";
  return `yt-dlp ${preset.ytDlpArgs}${dirArg} -o "%(title)s [%(id)s].%(ext)s" "${url}"`;
}

function failure(error: string, message: string): NativeInvocationResult {
  return { ok: false, code: -1, error, message };
}

export async function readClipboardStreamUrl(hostBridge?: unknown): Promise<{
  url: string;
  platform: StreamPlatformMeta;
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
    const detected = detectVideoPlatform(txt);
    if (detected.url) return detected;
  }
  return { url: "", platform: STREAM_PLATFORMS[STREAM_PLATFORMS.length - 1] };
}

const VIDEO_EXT_SET = new Set([".mp4", ".mkv", ".mov", ".webm", ".flv", ".avi", ".m4v", ".ts"]);

export async function fetchVideoDownloaderSnapshot(hostBridge?: unknown): Promise<VideoDownloaderSnapshot> {
  const paths = await resolveRealSpecialPaths(hostBridge);
  const videosDir = paths.videos || `${paths.userProfile}\\Videos`;
  const downloadsDir = paths.downloads || `${paths.userProfile}\\Downloads`;

  const [videoEntries, downloadEntries, clipDetected] = await Promise.all([
    scanRealDirectoryTree(
      videosDir,
      { maxDepth: 3, maxFiles: 180, filterExt: /\.(?:mp4|mkv|mov|webm|flv|avi)$/i },
      hostBridge
    ),
    scanRealDirectoryTree(
      downloadsDir,
      { maxDepth: 2, maxFiles: 180, filterExt: /\.(?:mp4|mkv|mov|webm|flv|avi)$/i },
      hostBridge
    ),
    readClipboardStreamUrl(hostBridge)
  ]);

  const seenPaths = new Set<string>();
  const videos: LocalMediaVideoItem[] = [];
  let totalSizeBytes = 0;

  const mergeList = [
    ...videoEntries.files.map((e) => ({ entry: e, label: "视频文件夹" })),
    ...downloadEntries.files.map((e) => ({ entry: e, label: "下载文件夹" }))
  ];

  for (const { entry, label } of mergeList) {
    if (entry.isDirectory || entry.sizeBytes <= 0) continue;
    const ext = String(entry.ext || "").toLowerCase();
    if (!VIDEO_EXT_SET.has(ext)) continue;
    const normKey = entry.path.toLowerCase();
    if (seenPaths.has(normKey)) continue;
    seenPaths.add(normKey);

    totalSizeBytes += entry.sizeBytes;
    videos.push({
      id: entry.path,
      name: entry.name,
      path: entry.path,
      ext,
      sizeBytes: entry.sizeBytes,
      mtimeMs: entry.mtimeMs,
      sourceDirLabel: label
    });
  }

  videos.sort((a, b) => b.mtimeMs - a.mtimeMs || b.sizeBytes - a.sizeBytes);

  return {
    saveDir: videosDir,
    clipboardUrl: clipDetected.url,
    detectedPlatform: clipDetected.platform,
    videos,
    totalSizeBytes,
    updatedAt: new Date().toLocaleTimeString()
  };
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

/**
 * 下载视频直链：先弹出保存对话框（同名文件由系统对话框确认是否替换），再由客户端 HTTP 下载到所选位置。
 * 用户取消返回 error: "CANCELED"。
 */
export async function downloadDirectVideo(
  rawInput: string,
  saveDir: string,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  const link = describeVideoLink(rawInput);
  if (!link.url) {
    return failure("INVALID_STREAM_URL", "未识别到视频链接");
  }
  if (!link.directExt) {
    return failure(
      "NOT_DIRECT_VIDEO_URL",
      `「${link.platform.name}」链接不能直接下载：只有 .mp4 / .webm / .mkv / .mov / .flv / .m4v 视频直链可以下载，其他链接请复制 yt-dlp 命令自行下载`
    );
  }

  const dialogRes = await callHostTransport<SaveDialogResult>(
    "window_show_save_dialog",
    {
      title: "保存视频",
      ...(saveDir ? { defaultPath: saveDir } : {}),
      defaultName: suggestVideoFileName(link.url, link.directExt),
      filters: `视频|${link.directExt}|所有文件|*`
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
    { url: link.url, savePath },
    DIRECT_DOWNLOAD_TIMEOUT_MS,
    hostBridge
  );
  if (!dl.ok) {
    return failure("DOWNLOAD_FAILED", `下载失败：${dl.error || "客户端未返回原因"}`);
  }
  const finalPath = typeof dl.data?.path === "string" && dl.data.path ? dl.data.path : savePath;
  const size = Number(dl.data?.size);
  if (Number.isFinite(size) && size === 0) {
    return failure("EMPTY_FILE", `下载得到的是空文件（0 字节），请检查链接：${finalPath}`);
  }
  const sizeText = Number.isFinite(size) && size > 0 ? `（${formatBytes(size)}）` : "";
  return {
    ok: true,
    code: 0,
    message: `已下载到 ${finalPath}${sizeText}`,
    data: { path: finalPath, size: Number.isFinite(size) ? size : undefined }
  };
}

/** 生成 yt-dlp 命令并复制到剪贴板；插件本身不下载，需要用户自行安装并运行 yt-dlp */
export async function copyYtDlpCommand(
  rawInput: string,
  saveDir: string,
  qualityPreset: VideoQualityPreset,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  const link = describeVideoLink(rawInput);
  if (!link.url) {
    return failure("INVALID_STREAM_URL", "未识别到视频链接");
  }
  const command = buildYtDlpCommand(link.url, saveDir, qualityPreset);
  const copied = await writeRealClipboardText(command, hostBridge);
  if (!copied) {
    return failure("CLIPBOARD_WRITE_FAILED", "复制 yt-dlp 命令失败：无法写入剪贴板");
  }
  return {
    ok: true,
    code: 0,
    message: `已复制 yt-dlp 命令（${qualityPreset.badge}）。插件不会下载该链接，请在已安装 yt-dlp 的终端中运行`,
    data: { command }
  };
}

export interface TrashVideoResult {
  deletedCount: number;
  freedBytes: number;
  failed: Array<{ path: string; reason: string }>;
}

/** 逐个把传入的视频移入回收站；只处理传入的路径，失败的条目如实列出 */
export async function trashLocalVideoFiles(
  paths: string[],
  knownVideos: LocalMediaVideoItem[] = [],
  hostBridge?: unknown
): Promise<TrashVideoResult> {
  const sizeMap = new Map<string, number>();
  for (const v of knownVideos) {
    if (v?.path) sizeMap.set(v.path.toLowerCase(), Math.max(0, Number(v.sizeBytes || 0)));
  }

  let deletedCount = 0;
  let freedBytes = 0;
  const failed: TrashVideoResult["failed"] = [];
  for (const p of paths) {
    if (!p) continue;
    if (FORBIDDEN_TARGET_PATTERN.test(p)) {
      failed.push({ path: p, reason: FORBIDDEN_REASON });
      continue;
    }
    const trashed = await trashRealItem(p, hostBridge);
    if (trashed.ok) {
      deletedCount += 1;
      freedBytes += sizeMap.get(p.toLowerCase()) || 0;
    } else {
      failed.push({ path: p, reason: trashed.error || "移入回收站失败" });
    }
  }
  return { deletedCount, freedBytes, failed };
}

/** 用系统默认程序打开视频文件或文件夹 */
export async function openLocalVideoFile(targetPath: string, hostBridge?: unknown): Promise<NativeInvocationResult> {
  if (!targetPath) {
    return failure("EMPTY_PATH", "路径为空");
  }
  if (FORBIDDEN_TARGET_PATTERN.test(targetPath)) {
    return failure("FORBIDDEN_TARGET", FORBIDDEN_REASON);
  }
  const opened = await openRealPath(targetPath, hostBridge);
  return opened
    ? { ok: true, code: 0, message: `已打开: ${targetPath}` }
    : failure("OPEN_FAILED", `打开失败: ${targetPath}`);
}

export async function openLocalVideoFolder(targetPath: string, hostBridge?: unknown): Promise<NativeInvocationResult> {
  if (!targetPath) {
    return failure("EMPTY_PATH", "路径为空");
  }
  if (FORBIDDEN_TARGET_PATTERN.test(targetPath)) {
    return failure("FORBIDDEN_TARGET", FORBIDDEN_REASON);
  }
  const shown = await showRealItemInFolder(targetPath, hostBridge);
  return shown
    ? { ok: true, code: 0, message: `已在资源管理器中定位: ${targetPath}` }
    : failure("SHOW_IN_FOLDER_FAILED", `定位失败: ${targetPath}`);
}
