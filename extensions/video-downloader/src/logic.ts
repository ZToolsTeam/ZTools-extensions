/**
 * 视频下载业务逻辑
 *
 * - 识别链接所属平台（`detectVideoPlatform`）：Bilibili 链接与 BV 号、抖音、快手、YouTube、微博，其余按通用链接处理
 * - 视频直链（.mp4 / .webm / .mkv / .mov / .flv / .m4v）：用户在保存对话框里选好位置后，由客户端 HTTP 下载并加入列表
 * - 平台页面链接：客户端没有视频解析能力，插件不下载，只按所选档位生成 yt-dlp 命令，由用户复制后自行运行
 * - 支持通过「选择文件」「选择文件夹」或拖入导入视频文件，可打开、定位、从列表移除，或在用户确认后移入回收站
 */

import { getHostTransport } from "@ztools/declarative-ui";
import {
  callHostTransport,
  getRealSystemPath,
  openRealPath,
  showRealItemInFolder,
  trashRealItem,
  writeRealClipboardText,
  formatBytes,
  type NativeInvocationResult
} from "./native-ipc.js";
import type { FileImportRules, FileImportTransport, ImportedFile } from "./file-import.js";
import { t } from "./i18n.js";

export { formatBytes };
export type { NativeInvocationResult };

export const FORBIDDEN_TARGET_PATTERN =
  /(^|[\\/])(Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|Boot|Recovery)($|[\\/])/i;
export const FORBIDDEN_REASON = t("forbiddenReason");

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

export function getStreamPlatforms(): StreamPlatformMeta[] {
  return [
    {
      id: "bilibili",
      name: t("platBiliName"),
      handlerName: t("handlerCopyCmd"),
      features: t("platBiliFeat")
    },
    {
      id: "douyin",
      name: t("platDouyinName"),
      handlerName: t("handlerCopyCmd"),
      features: t("platDouyinFeat")
    },
    {
      id: "kuaishou",
      name: t("platKuaishouName"),
      handlerName: t("handlerCopyCmd"),
      features: t("platKuaishouFeat")
    },
    {
      id: "youtube",
      name: t("platYoutubeName"),
      handlerName: t("handlerCopyCmd"),
      features: t("platYoutubeFeat")
    },
    {
      id: "weibo",
      name: t("platWeiboName"),
      handlerName: t("handlerCopyCmd"),
      features: t("platWeiboFeat")
    },
    {
      id: "m3u8_direct",
      name: t("platDirectName"),
      handlerName: t("platDirectHandler"),
      features: t("platDirectFeat")
    }
  ];
}
export const STREAM_PLATFORMS: StreamPlatformMeta[] = getStreamPlatforms();

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
export function getVideoQualityPresets(): VideoQualityPreset[] {
  return [
    {
      id: "q_4k_mp4",
      name: t("q4kName"),
      badge: t("q4kBadge"),
      ytDlpArgs: '-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best" --merge-output-format mp4',
      description: t("q4kDesc")
    },
    {
      id: "q_1080p_mp4",
      name: t("q1080Name"),
      badge: "1080P",
      ytDlpArgs: '-f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]" --merge-output-format mp4',
      description: t("q1080Desc")
    },
    {
      id: "q_720p_mp4",
      name: t("q720Name"),
      badge: "720P",
      ytDlpArgs: '-f "bestvideo[height<=720]+bestaudio/best[height<=720]" --merge-output-format mp4',
      description: t("q720Desc")
    },
    {
      id: "q_audio_mp3",
      name: t("qMp3Name"),
      badge: "MP3",
      ytDlpArgs: "-x --audio-format mp3 --audio-quality 0 --embed-thumbnail --add-metadata",
      description: t("qMp3Desc")
    },
    {
      id: "q_audio_flac",
      name: t("qFlacName"),
      badge: "FLAC",
      ytDlpArgs: "-x --audio-format flac --audio-quality 0",
      description: t("qFlacDesc")
    },
    {
      id: "q_with_subs",
      name: t("qSubsName"),
      badge: t("qSubsBadge"),
      ytDlpArgs:
        '-f "bestvideo[height<=1080]+bestaudio/best" --merge-output-format mp4 --write-subs --write-auto-subs --sub-langs "zh.*,en.*" --write-thumbnail',
      description: t("qSubsDesc")
    }
  ];
}
export const VIDEO_QUALITY_PRESETS: VideoQualityPreset[] = getVideoQualityPresets();

export interface LocalMediaVideoItem {
  id: string;
  name: string;
  path: string;
  ext: string;
  sizeBytes: number | null;
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

  const platforms = getStreamPlatforms();
  const lower = (extractedUrl || text).toLowerCase();
  if (lower.includes("bilibili.com") || lower.includes("b23.tv") || bvMatch) {
    return { url: extractedUrl, platform: platforms[0] };
  }
  if (lower.includes("douyin.com") || lower.includes("iesdouyin.com")) {
    return { url: extractedUrl, platform: platforms[1] };
  }
  if (lower.includes("kuaishou.com") || lower.includes("chenzhongtech.com")) {
    return { url: extractedUrl, platform: platforms[2] };
  }
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    return { url: extractedUrl, platform: platforms[3] };
  }
  if (lower.includes("weibo.com") || lower.includes("weibo.cn")) {
    return { url: extractedUrl, platform: platforms[4] };
  }
  return { url: extractedUrl, platform: platforms[5] };
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
  return { url: "", platform: getStreamPlatforms()[5] };
}

export const VIDEO_EXT_SET = new Set([".mp4", ".mkv", ".mov", ".webm", ".flv", ".avi", ".m4v", ".ts"]);
export const VIDEO_IMPORT_EXTENSIONS = Array.from(VIDEO_EXT_SET);
export const VIDEO_IMPORT_SUPPORTED_TEXT = "MP4 / MKV / MOV / WEBM / FLV / AVI / M4V / TS";
export const VIDEO_IMPORT_RULES: FileImportRules = {
  extensions: VIDEO_IMPORT_EXTENSIONS,
  forbiddenPath: FORBIDDEN_TARGET_PATTERN
};

export function createVideoImportTransport(hostBridge?: unknown): FileImportTransport {
  return (method, params) => callHostTransport(method, params, hostBridge);
}

export function toLocalMediaVideoItem(file: ImportedFile, sourceDirLabel = t("sourceManualImport")): LocalMediaVideoItem {
  return {
    id: file.path,
    name: file.name,
    path: file.path,
    ext: file.extension,
    sizeBytes: file.sizeBytes,
    mtimeMs: file.lastModifiedMs ?? 0,
    sourceDirLabel
  };
}

export function createDownloadedVideoItem(filePath: string, sizeBytes?: number): LocalMediaVideoItem {
  const name = filePath.split(/[\\/]/).pop() || filePath;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  const validSize = typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : null;
  return {
    id: filePath,
    name,
    path: filePath,
    ext,
    sizeBytes: validSize,
    mtimeMs: Date.now(),
    sourceDirLabel: t("sourceThisDownload")
  };
}

/**
 * 读取默认视频保存目录与剪贴板视频链接（只解析路径字符串，不扫描本机目录）
 */
export async function fetchVideoDownloaderSnapshot(hostBridge?: unknown): Promise<VideoDownloaderSnapshot> {
  const [videosDir, clipDetected] = await Promise.all([
    getRealSystemPath("videos", hostBridge),
    readClipboardStreamUrl(hostBridge)
  ]);

  return {
    saveDir: videosDir,
    clipboardUrl: clipDetected.url,
    detectedPlatform: clipDetected.platform,
    videos: [],
    totalSizeBytes: 0,
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
    return failure("INVALID_STREAM_URL", t("errNoStreamUrl"));
  }
  if (!link.directExt) {
    return failure(
      "NOT_DIRECT_VIDEO_URL",
      t("errNotDirectUrl", { platform: link.platform.name })
    );
  }

  const dialogRes = await callHostTransport<SaveDialogResult>(
    "window_show_save_dialog",
    {
      title: t("saveDialogTitle"),
      ...(saveDir ? { defaultPath: saveDir } : {}),
      defaultName: suggestVideoFileName(link.url, link.directExt),
      filters: t("saveDialogFilters", { ext: link.directExt })
    },
    hostBridge
  );
  if (!dialogRes.ok) {
    return failure("SAVE_DIALOG_FAILED", t("errSaveDialogFailed", { err: dialogRes.error || t("errClientNoReason") }));
  }
  const savePath = typeof dialogRes.data?.filePath === "string" ? dialogRes.data.filePath : "";
  if (dialogRes.data?.canceled || !savePath) {
    return failure("CANCELED", t("msgDownloadCancelled"));
  }
  if (FORBIDDEN_TARGET_PATTERN.test(savePath)) {
    return failure("FORBIDDEN_TARGET", t("forbiddenReason"));
  }

  const dl = await callHostLongRunning<HttpDownloadResult>(
    "network_http_download",
    { url: link.url, savePath },
    DIRECT_DOWNLOAD_TIMEOUT_MS,
    hostBridge
  );
  if (!dl.ok) {
    return failure("DOWNLOAD_FAILED", t("errDownloadFailed", { err: dl.error || t("errClientNoReason") }));
  }
  const finalPath = typeof dl.data?.path === "string" && dl.data.path ? dl.data.path : savePath;
  const size = Number(dl.data?.size);
  if (Number.isFinite(size) && size === 0) {
    return failure("EMPTY_FILE", t("errEmptyFile", { path: finalPath }));
  }
  const sizeText = Number.isFinite(size) && size > 0 ? ` (${formatBytes(size)})` : "";
  return {
    ok: true,
    code: 0,
    message: t("msgDownloadedTo", { path: finalPath, size: sizeText }),
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
    return failure("INVALID_STREAM_URL", t("errNoStreamUrl"));
  }
  const command = buildYtDlpCommand(link.url, saveDir, qualityPreset);
  const copied = await writeRealClipboardText(command, hostBridge);
  if (!copied) {
    return failure("CLIPBOARD_WRITE_FAILED", t("errClipboardWriteFailed"));
  }
  return {
    ok: true,
    code: 0,
    message: t("msgCopiedYtDlp", { badge: qualityPreset.badge }),
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
    if (v?.path && typeof v.sizeBytes === "number" && Number.isFinite(v.sizeBytes)) {
      sizeMap.set(v.path.toLowerCase(), Math.max(0, v.sizeBytes));
    }
  }

  let deletedCount = 0;
  let freedBytes = 0;
  const failed: TrashVideoResult["failed"] = [];
  for (const p of paths) {
    if (!p) continue;
    if (FORBIDDEN_TARGET_PATTERN.test(p)) {
      failed.push({ path: p, reason: t("forbiddenReason") });
      continue;
    }
    const trashed = await trashRealItem(p, hostBridge);
    if (trashed.ok) {
      deletedCount += 1;
      freedBytes += sizeMap.get(p.toLowerCase()) || 0;
    } else {
      failed.push({ path: p, reason: trashed.error || t("errTrashFailed") });
    }
  }
  return { deletedCount, freedBytes, failed };
}

/** 用系统默认程序打开视频文件或文件夹 */
export async function openLocalVideoFile(targetPath: string, hostBridge?: unknown): Promise<NativeInvocationResult> {
  if (!targetPath) {
    return failure("EMPTY_PATH", t("errEmptyPath"));
  }
  if (FORBIDDEN_TARGET_PATTERN.test(targetPath)) {
    return failure("FORBIDDEN_TARGET", t("forbiddenReason"));
  }
  const opened = await openRealPath(targetPath, hostBridge);
  return opened
    ? { ok: true, code: 0, message: t("msgOpened", { path: targetPath }) }
    : failure("OPEN_FAILED", t("errOpenFailed", { path: targetPath }));
}

export async function openLocalVideoFolder(targetPath: string, hostBridge?: unknown): Promise<NativeInvocationResult> {
  if (!targetPath) {
    return failure("EMPTY_PATH", t("errEmptyPath"));
  }
  if (FORBIDDEN_TARGET_PATTERN.test(targetPath)) {
    return failure("FORBIDDEN_TARGET", t("forbiddenReason"));
  }
  const shown = await showRealItemInFolder(targetPath, hostBridge);
  return shown
    ? { ok: true, code: 0, message: t("msgRevealed", { path: targetPath }) }
    : failure("SHOW_IN_FOLDER_FAILED", t("errRevealFailed", { path: targetPath }));
}
