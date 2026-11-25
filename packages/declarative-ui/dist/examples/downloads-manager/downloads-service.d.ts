import type { CleanResult, DownloadEntry, DownloadFileCategory, DownloadsDashboardSummary, DownloadSourceChannel, DownloadSourceDescriptor } from './types.js';
export declare function isDownloadTemporaryOrHiddenFile(fileName: string): boolean;
export declare function classifyDownloadFile(fileName: string): Exclude<DownloadFileCategory, 'all'>;
export declare function getDownloadCategoryLabel(category: DownloadFileCategory): string;
export declare function getDownloadChannelLabel(channel: DownloadSourceChannel): string;
export declare function validateCustomDownloadDirPath(rawPath: string): {
    ok: boolean;
    normalizedPath?: string;
    error?: string;
};
export declare function getCustomDownloadDirectories(): string[];
export declare function addCustomDownloadDirectory(rawDirPath: string, hostOverride?: unknown): Promise<{
    ok: boolean;
    path?: string;
    error?: string;
}>;
export declare function removeCustomDownloadDirectory(rawDirPath: string): boolean;
export declare function clearCustomDownloadDirectories(): void;
export declare function discoverAllDownloadSources(customDirs?: string[], hostOverride?: unknown): Promise<DownloadSourceDescriptor[]>;
export declare function scanDownloadsDirectory(customDirOrOptions?: string | {
    customDirs?: string[];
    maxFilesPerSource?: number;
}, hostOverride?: unknown): Promise<DownloadsDashboardSummary>;
export declare function computeDashboardSummary(downloadDir: string, entries: DownloadEntry[], sources?: DownloadSourceDescriptor[]): DownloadsDashboardSummary;
export declare function filterDownloadEntries(entries: DownloadEntry[], options: {
    filterValue?: string;
    channel?: DownloadSourceChannel;
    category?: DownloadFileCategory;
    query?: string;
    onlyLarge?: boolean;
    sortBy?: 'mtime' | 'size';
}): DownloadEntry[];
export declare function togglePinEntry(entries: DownloadEntry[], id: string): DownloadEntry[];
export declare function cleanRedundantInstallers(entries: DownloadEntry[], hostOverride?: unknown): Promise<CleanResult>;
export declare function cleanExpiredDownloads(entries: DownloadEntry[], daysThreshold?: number, minSizeBytes?: number, hostOverride?: unknown): Promise<CleanResult>;
export declare function trashDownloadItem(entries: DownloadEntry[], targetIdOrPath: string, hostOverride?: unknown): Promise<{
    ok: boolean;
    remainingEntries: DownloadEntry[];
    freedBytes: number;
    error?: string;
}>;
export declare function copyDownloadFileEntity(filePath: string, hostOverride?: unknown): Promise<{
    ok: boolean;
    error?: string;
}>;
export declare function copyDownloadFilePath(filePath: string, hostOverride?: unknown): Promise<boolean>;
export declare function openDownloadItem(filePath: string, hostOverride?: unknown): Promise<boolean>;
export declare function revealDownloadItem(filePath: string, hostOverride?: unknown): Promise<boolean>;
