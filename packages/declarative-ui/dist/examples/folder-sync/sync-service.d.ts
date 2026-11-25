import type { CompareFoldersResponse, DiffFilterType, ExecuteSyncResponse, FolderSyncDiffItem, SyncMode } from './types.js';
export declare function formatSyncBytes(bytes: number): string;
export declare function shortenFolderPath(dirPath: string): string;
export declare function areDirectoriesNestedOrIdentical(dirA: string, dirB: string): boolean;
export declare function isWithinFatTimestampTolerance(mtimeA: number, mtimeB: number, toleranceMs?: number): boolean;
export declare function filterSyncDiffItems(items: readonly FolderSyncDiffItem[], diffFilter?: DiffFilterType, query?: string): FolderSyncDiffItem[];
export declare function compareFolderTrees(options: {
    sourceDir: string;
    targetDir: string;
    syncMode?: SyncMode;
    ignoreDevJunk?: boolean;
    mockTargetFreeBytes?: number;
    hostOverride?: unknown;
}): Promise<CompareFoldersResponse>;
export declare function executeFolderSync(options: {
    sourceDir: string;
    targetDir: string;
    syncMode?: SyncMode;
    ignoreDevJunk?: boolean;
    selectedRelPaths?: string[];
    mockTargetFreeBytes?: number;
    simulateLockedRelPaths?: string[];
    hostOverride?: unknown;
}): Promise<ExecuteSyncResponse>;
