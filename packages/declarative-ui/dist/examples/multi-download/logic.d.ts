/**
 * ZTools 2.0 标杆原生插件: 多线程分块高速下载工作台 (Multi-Download 2.0，基于 Aria2 多线程分块引擎，真实宿主驱动)
 *
 * 严格遵循 ZTools Declarative UI 2.0 零模拟数据规范：
 * 1. 与 Windows 原生插件 multi-download 能力一致：
 *    - 16 / 8 / 4 线程分块并发下载配置 (`-x16 -s16 -k1M`)
 *    - 真实探测 Aria2 JSON-RPC 守护进程 (`http://127.0.0.1:6800/jsonrpc`) 与本机下载环境
 *    - 真实读取本机剪贴板自动嗅探 HTTP/HTTPS/FTP/Magnet/Torrent 下载链接
 *    - 支持显式导入本地下载目录或文件（选择文件 / 选择文件夹 / 拖入文件夹）
 *    - 真实探测下载盘符剩余可用空间，防止磁盘写满
 *    - 支持三态勾选批量移入回收站、打开文件、在 Explorer 中定位文件与发起真实下载任务
 */
import { formatBytes, type NativeInvocationResult } from "../shared/native-ipc.js";
import { type ExampleImportResult, type ExampleImportRules, type ExampleImportedFile } from "../shared/file-import.js";
export declare const MULTI_DOWNLOAD_IMPORT_RULES: ExampleImportRules;
export { formatBytes };
export type { NativeInvocationResult };
export declare const DLL_PLUGIN_NAME = "MultiDownloadPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u7981\u6B62\u64CD\u4F5C Windows \u7CFB\u7EDF\u6838\u5FC3\u76EE\u5F55\u4E2D\u7684\u53D7\u4FDD\u62A4\u6587\u4EF6";
export type DownloadFileCategory = "all" | "installer" | "archive" | "media" | "iso_image" | "document" | "other";
export interface DownloadCategoryMeta {
    id: DownloadFileCategory;
    name: string;
    icon: string;
    color: string;
    exts: string[];
}
export declare const DOWNLOAD_CATEGORIES: DownloadCategoryMeta[];
export type ThreadSplitPresetId = "threads_16" | "threads_8" | "threads_4" | "threads_1";
export interface ThreadSplitPreset {
    id: ThreadSplitPresetId;
    name: string;
    threads: number;
    splitSize: string;
    aria2Flags: string;
    description: string;
}
export declare const THREAD_SPLIT_PRESETS: ThreadSplitPreset[];
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
export interface MultiDownloadSnapshot {
    downloadDir: string;
    driveLetter: string;
    driveFreeBytes: number;
    driveTotalBytes: number;
    aria2RpcOnline: boolean;
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
export declare function classifyDownloadedExtension(extRaw: string): DownloadCategoryMeta;
export declare function detectDownloadUrlFromText(rawText: string): {
    url: string;
    protocol: string;
    suggestedFileName: string;
};
export declare function probeAria2JsonRpc(endpoint?: string): Promise<boolean>;
export declare function readClipboardDownloadUrl(hostBridge?: unknown): Promise<{
    url: string;
    protocol: string;
    suggestedFileName: string;
}>;
export declare function toDownloadedFileItem(entry: ExampleImportedFile): DownloadedFileItem;
export declare function computeDownloadCategoryStats(files: DownloadedFileItem[]): MultiDownloadSnapshot["categoryStats"];
export declare function ensureMultiDownloadDirectory(currentDir: string, hostBridge?: unknown): Promise<string>;
export declare function importMultiDownloadFolder(hostBridge?: unknown): Promise<Omit<ExampleImportResult, "files"> & {
    files: DownloadedFileItem[];
    downloadDir: string;
}>;
export declare function fetchMultiDownloadSnapshot(hostBridge?: unknown, downloadDirHint?: string): Promise<MultiDownloadSnapshot>;
export declare function startMultiThreadDownloadTask(url: string, downloadDir: string, preset: ThreadSplitPreset, hostBridge?: unknown): Promise<NativeInvocationResult>;
export declare function deleteDownloadedFiles(paths: string[], knownFiles?: DownloadedFileItem[], hostBridge?: unknown): Promise<{
    deletedCount: number;
    freedBytes: number;
}>;
export declare function openDownloadedFileLocation(targetPath: string, hostBridge?: unknown): Promise<NativeInvocationResult>;
export declare function openDownloadedFile(targetPath: string, hostBridge?: unknown): Promise<NativeInvocationResult>;
