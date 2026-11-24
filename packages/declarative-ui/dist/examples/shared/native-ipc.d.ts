type DynamicBridge = ReturnType<typeof JSON.parse>;
export declare function nextMessageId(prefix?: string): string;
/**
 * 判断当前是否处于真实的 ZTools Electron 渲染进程宿主环境
 */
export declare function isRealElectronHost(hostOverride?: unknown): boolean;
/**
 * 调用 Electron Preload Transport 方法（自动封装合法的 alphanumeric messageId 与双层解包）
 */
export declare function callHostTransport<T = DynamicBridge>(method: string, params?: Record<string, unknown>, hostOverride?: DynamicBridge): Promise<{
    ok: boolean;
    data?: T;
    error?: string;
}>;
export interface RealDiskDriveInfo {
    drive: string;
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
}
/**
 * 探测本机全部真实挂载磁盘分区 (C:\ ~ Z:\ 或 macOS/POSIX 挂载点 '/')
 */
export declare function probeRealDiskDrives(candidateLetters?: string[], hostOverride?: DynamicBridge): Promise<RealDiskDriveInfo[]>;
/**
 * 获取本机真实系统特殊路径（支持 home 派生标准子目录兜底，自动兼容 Windows 与 macOS/POSIX）
 */
export declare function getRealSystemPath(name: 'home' | 'appData' | 'userData' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'temp' | 'cache', hostOverride?: DynamicBridge): Promise<string>;
export type RealDriveUsageInfo = RealDiskDriveInfo;
export interface RealIndexedFileEntry {
    name: string;
    path: string;
    ext: string;
    isDir: boolean;
    isDirectory: boolean;
    size: number;
    sizeBytes: number;
    mtime: number;
    mtimeMs: number;
    lastModifiedMs: number;
}
export interface RealDirectorySubdirSummary {
    name: string;
    path: string;
    fileCount: number;
    totalBytes: number;
    mtime: number;
    /** 体积不是完整统计（宿主扫描截断且独立统计超时 / 无权限），totalBytes 只是下限 */
    approximate?: boolean;
}
export interface RealDirectoryScanResult extends Iterable<RealIndexedFileEntry> {
    files: RealIndexedFileEntry[];
    totalFiles: number;
    fileCount: number;
    totalBytes: number;
    subdirs: RealDirectorySubdirSummary[];
    /** 宿主扫描达到条目上限后停止：files / totalFiles 只是已遍历部分的抽样 */
    truncated?: boolean;
    /** totalBytes 为近似值（下限） */
    approximate?: boolean;
    /** 宿主实际遍历的条目数 */
    visitedEntries?: number;
}
export interface ScanDirectoryTreeOptions {
    maxDepth?: number;
    maxFiles?: number;
    collectTopN?: number;
    filterExt?: RegExp;
    hostOverride?: DynamicBridge;
}
/**
 * 调用本机 Rust NTFS MFT 硬件级索引引擎 (ztools-indexer) 毫秒级检索真实文件
 */
export declare function searchRealIndexedFiles(query: string, limit?: number, hostOverride?: DynamicBridge): Promise<RealIndexedFileEntry[]>;
/**
 * 深度扫描指定真实物理目录树（支持符号链接穿透，如 AppData\Roaming\Tencent -> D:\Local\Roaming\Tencent）
 * 返回该目录下 Top 文件列表、全树真实文件总数、全树真实总字节数与一级子目录汇总
 */
export declare function scanRealDirectoryTree(dirPath: string, limitOrOptions?: number | ScanDirectoryTreeOptions, hostOverrideArg?: DynamicBridge): Promise<RealDirectoryScanResult>;
/** 目录读取不到任何条目（不存在 / 为空 / 无权限）时的错误码 */
export declare const DIRECTORY_EMPTY_OR_UNREADABLE = "DIRECTORY_EMPTY_OR_UNREADABLE";
export interface RealDirectoryListingResult {
    /** 目录内条目的完整路径；读取失败时为空数组 */
    entries: string[];
    /** 读取失败或目录为空时的错误码 / 宿主错误信息 */
    error?: string;
}
export interface RealDirectChildrenResult {
    /** 目录的直接子项（子目录在前），按路径去重 */
    entries: RealIndexedFileEntry[];
    /** 宿主扫描达到条目上限，可能只返回了部分直接子项 */
    partial: boolean;
    error?: string;
}
/**
 * 读取真实目录下的条目路径（真实宿主中优先走 dir: 扫描：一级子目录 + 全树 Top-N 大文件），并返回失败原因。
 * 目录不存在、为空或无权限时返回空列表与错误码，绝不用全盘关键词搜索结果冒充目录内容。
 */
export declare function listRealDirectoryContentsResult(dirPath: string, hostOverride?: DynamicBridge): Promise<RealDirectoryListingResult>;
/**
 * 读取真实目录下的条目路径（保持旧签名：失败时返回空数组，需要失败原因请用 listRealDirectoryContentsResult）
 */
export declare function listRealDirectoryContents(dirPath: string, hostOverride?: DynamicBridge): Promise<string[]>;
/**
 * 只列出目录的直接子项（子目录 + 直接位于该目录下的文件），用于文件夹预览、按目录改名等场景。
 * dir: 扫描结果中只保留 subdirs 与父目录等于 dirPath 的文件；扫描达到上限时 partial=true，由插件如实提示「仅显示部分」。
 */
export declare function listDirectChildren(dirPath: string, hostOverride?: DynamicBridge): Promise<RealDirectChildrenResult>;
/**
 * 获取真实文件字节大小（优先命中 MFT 硬件级索引实时缓存，再走 filesystem_get_file_size）
 */
export declare function getRealFileSize(filePath: string, hostOverride?: DynamicBridge): Promise<number>;
/**
 * 在 Windows Explorer 中定位并高亮文件/目录
 */
export declare function showRealItemInFolder(fullPath: string, hostOverride?: DynamicBridge): Promise<boolean>;
/**
 * 使用系统默认程序打开文件或目录
 */
export declare function openRealPath(fullPath: string, hostOverride?: DynamicBridge): Promise<boolean>;
/**
 * 将真实文件或目录移入系统回收站（安全可恢复删除）
 */
export declare function trashRealItem(fullPath: string, hostOverride?: DynamicBridge): Promise<{
    ok: boolean;
    error?: string;
}>;
export interface NativeInvocationResult<T = DynamicBridge> {
    ok: boolean;
    code: number;
    message: string;
    data?: T;
    error?: string;
}
export interface DllCapabilityResponse<T = DynamicBridge> {
    ok: boolean;
    code: number;
    data: T | null;
    message?: string;
    error?: string;
    pluginName: string;
    method: string;
    fromFallback?: boolean;
}
export declare function invokeDllPluginCapability<T = DynamicBridge>(pluginName: string, method: string, params?: Record<string, DynamicBridge>, hostBridge?: DynamicBridge, offlineFallback?: () => T | Promise<T>): Promise<DllCapabilityResponse<T>>;
export declare function formatBytes(bytes: number, decimals?: number): string;
export declare function joinWinPath(...segments: string[]): string;
export interface RealEnvPaths {
    home: string;
    userProfile: string;
    appData: string;
    localAppData: string;
    temp: string;
    downloads: string;
    documents: string;
    desktop: string;
    pictures: string;
    videos: string;
    music: string;
}
export declare function getRealEnvPaths(hostOverride?: DynamicBridge): Promise<RealEnvPaths>;
export declare const resolveRealSpecialPaths: typeof getRealEnvPaths;
export declare function readRealDirectory(dirPath: string, hostOverride?: DynamicBridge): Promise<RealIndexedFileEntry[]>;
export declare function moveRealFilesToTrash(paths: string[], hostOverride?: DynamicBridge): Promise<{
    ok: boolean;
    trashedCount: number;
    deletedCount: number;
    failedPaths: string[];
    error?: string;
}>;
export declare function invokeHostCapability<T = DynamicBridge>(capability: string, params?: Record<string, unknown>, hostOverride?: DynamicBridge): Promise<NativeInvocationResult<T>>;
export declare function invokePluginService<T = DynamicBridge>(pluginName: string, action: string, params?: Record<string, unknown>, hostOverride?: DynamicBridge): Promise<NativeInvocationResult<T>>;
/**
 * 标准 FIPS 180-4 SHA-256 真实字节摘要算法（返回 64 位小写 Hex）
 */
export declare function computeRealSha256Hex(input: string | Uint8Array): string;
/**
 * 读取本地文件真实字节并计算标准 SHA-256：宿主 filesearch_sha256（只接受 path 字段）优先，Windows 上再试 FileComparePlugin。
 * 都拿不到时返回空字符串，由调用方提示失败；不再把文件按 UTF-8 文本读出来再算（二进制文件会算出错误的值）。
 */
export declare function computeRealFileSha256(filePath: string, hostOverride?: DynamicBridge): Promise<string>;
export declare function readRealClipboardText(hostOverride?: DynamicBridge): Promise<string>;
export declare function writeRealClipboardText(text: string, hostOverride?: DynamicBridge): Promise<boolean>;
export declare function showRealToast(title: string, style?: 'success' | 'failure' | 'info'): Promise<void>;
export {};
