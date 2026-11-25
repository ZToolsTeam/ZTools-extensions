/**
 * ZTools 2.0 标杆原生插件: 全平台流媒体音视频解析与下载工坊 (Video Downloader 2.0，真实宿主驱动)
 *
 * 严格遵循 ZTools Declarative UI 2.0 零模拟数据规范：
 * 1. 与 Windows 原生插件 video-downloader 能力一致：
 *    - 6 大流媒体平台智能探测器 (`detectVideoPlatform`：Bilibili BV/av号、抖音分享口令、快手、微博视频、YouTube、通用 M3U8/MP4 直链)
 *    - 6 大画质与音轨封装档位（4K 60fps 原画合并、1080P 高码率 MP4、720P 轻量流畅、仅提取 320kbps MP3 音频、导出无损 FLAC 音轨、连同字幕与封面打包）
 *    - 支持显式导入本地已保存视频库（选择文件 / 选择文件夹 / 拖入文件夹）
 *    - 支持用户主动读取剪贴板中的分享口令并一键解析下载、打开播放与定位目录
 */
import { formatBytes, type NativeInvocationResult } from "../shared/native-ipc.js";
import { type ExampleImportResult, type ExampleImportRules, type ExampleImportedFile } from "../shared/file-import.js";
export declare const VIDEO_DOWNLOADER_IMPORT_RULES: ExampleImportRules;
export { formatBytes };
export type { NativeInvocationResult };
export declare const DLL_PLUGIN_NAME = "VideoDownloaderPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u7981\u6B62\u64CD\u4F5C Windows \u7CFB\u7EDF\u6838\u5FC3\u76EE\u5F55\u4E2D\u7684\u6587\u4EF6";
export type StreamPlatformId = "auto" | "bilibili" | "douyin" | "kuaishou" | "youtube" | "weibo" | "m3u8_direct";
export interface StreamPlatformMeta {
    id: StreamPlatformId;
    name: string;
    icon: string;
    color: string;
    handlerName: string;
    features: string;
}
export declare const STREAM_PLATFORMS: StreamPlatformMeta[];
export type VideoQualityPresetId = "q_4k_mp4" | "q_1080p_mp4" | "q_720p_mp4" | "q_audio_mp3" | "q_audio_flac" | "q_with_subs";
export interface VideoQualityPreset {
    id: VideoQualityPresetId;
    name: string;
    badge: string;
    ytDlpArgs: string;
    description: string;
}
export declare const VIDEO_QUALITY_PRESETS: VideoQualityPreset[];
export interface LocalMediaVideoItem {
    id: string;
    name: string;
    path: string;
    ext: string;
    sizeBytes: number;
    mtimeMs: number;
    sourceDirLabel: string;
    resolutionTier: "large_hd" | "standard" | "short_clip";
    resolutionLabel: string;
    color: string;
}
export interface VideoDownloaderSnapshot {
    saveDir: string;
    driveLetter: string;
    driveFreeBytes: number;
    clipboardUrl: string;
    detectedPlatform: StreamPlatformMeta;
    videos: LocalMediaVideoItem[];
    totalSizeBytes: number;
    tierStats: Array<{
        tier: string;
        label: string;
        color: string;
        sizeBytes: number;
        count: number;
    }>;
    updatedAt: string;
}
export declare function detectVideoPlatform(rawText: string): {
    url: string;
    platform: StreamPlatformMeta;
};
export declare function readClipboardStreamUrl(hostBridge?: unknown): Promise<{
    url: string;
    platform: StreamPlatformMeta;
}>;
export declare function toLocalMediaVideoItem(entry: ExampleImportedFile, sourceDirLabel?: string): LocalMediaVideoItem;
export declare function computeVideoTierStats(videos: LocalMediaVideoItem[]): VideoDownloaderSnapshot["tierStats"];
export declare function ensureVideoSaveDirectory(currentDir: string, hostBridge?: unknown): Promise<string>;
export declare function importVideoDownloaderFolder(hostBridge?: unknown): Promise<ExampleImportResult & {
    videos: LocalMediaVideoItem[];
    saveDir: string;
}>;
export declare function fetchVideoDownloaderSnapshot(hostBridge?: unknown, saveDirHint?: string): Promise<VideoDownloaderSnapshot>;
export declare function parseAndDownloadStreamVideo(rawInput: string, saveDir: string, qualityPreset: VideoQualityPreset, hostBridge?: unknown): Promise<NativeInvocationResult>;
export declare function trashLocalVideoFiles(paths: string[], knownVideos?: LocalMediaVideoItem[], hostBridge?: unknown): Promise<{
    deletedCount: number;
    freedBytes: number;
}>;
export declare function openLocalVideoFile(targetPath: string, hostBridge?: unknown): Promise<NativeInvocationResult>;
export declare function openLocalVideoFolder(targetPath: string, hostBridge?: unknown): Promise<NativeInvocationResult>;
