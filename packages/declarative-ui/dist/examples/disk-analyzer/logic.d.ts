/**
 * 磁盘空间深度分析业务逻辑与真实环境契约层 (DiskAnalyzer Logic)
 * 对接 Electron 真实磁盘分区探针 (system_get_disk_usage)、MFT + 真实目录深度扫描、
 * 10 大官方 FileTypeGroup 分类体系与二级扩展名下钻统计
 */
export { formatBytes, isRealElectronHost } from '../shared/native-ipc.js';
export interface CapabilityActionItem {
    id: string;
    title: string;
    subtitle: string;
    tag: string;
    method: string;
    params: Record<string, unknown>;
}
export interface NativeInvocationResult {
    ok: boolean;
    pluginName: string;
    method: string;
    data?: unknown;
    error?: string;
    fromFallback?: boolean;
}
export interface DiskDriveItem {
    drive: string;
    label: string;
    fileSystem: string;
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
    status: 'normal' | 'warning' | 'danger';
}
/**
 * 10 大官方文件类型分组 (与 Windows 原生插件 disk-analyzer 一致)
 */
export type OfficialFileTypeGroupId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 99;
export interface OfficialFileTypeGroupMeta {
    groupId: OfficialFileTypeGroupId;
    name: string;
    shortName: string;
    color: string;
    legacyCategory: DiskFileEntry['category'];
    description: string;
    sampleQueries: string[];
}
export declare const OFFICIAL_FILE_TYPE_GROUPS: OfficialFileTypeGroupMeta[];
export interface DiskFileEntry {
    id: string;
    name: string;
    path: string;
    parentDir: string;
    drive: string;
    extension: string;
    category: 'video' | 'archive' | 'installer' | 'document' | 'temp' | 'other';
    groupId: OfficialFileTypeGroupId;
    groupName: string;
    groupColor: string;
    sizeBytes: number;
    mtime: number;
    isProtected: boolean;
}
export interface DiskExtStat {
    extension: string;
    groupId: OfficialFileTypeGroupId;
    categoryLabel: string;
    fileCount: number;
    totalSizeBytes: number;
    sharePercent: number;
}
export interface DiskGroupStat {
    groupId: OfficialFileTypeGroupId;
    name: string;
    shortName: string;
    color: string;
    description: string;
    fileCount: number;
    totalSizeBytes: number;
    sharePercent: number;
    topExtensions: DiskExtStat[];
}
export interface DiskAnalysisSnapshot {
    drives: DiskDriveItem[];
    files: DiskFileEntry[];
    extStats: DiskExtStat[];
    groupStats: DiskGroupStat[];
    topDirectories?: Array<{
        name: string;
        path: string;
        drive: string;
        sizeBytes: number;
        fileCount: number;
    }>;
    totalCapacityBytes: number;
    totalUsedBytes: number;
    totalAvailableBytes: number;
}
export declare const DLL_PLUGIN_NAME = "AnalyzerPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u7CFB\u7EDF\u6838\u5FC3\u76EE\u5F55\u4E0E\u5377\u5F71\u526F\u672C\u533A\u53D7\u4FDD\u62A4\uFF0C\u7981\u6B62\u901A\u8FC7\u5206\u6790\u5668\u76F4\u63A5\u6E05\u7406";
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function formatDateTime(mtimeSeconds: number): string;
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: {
    dllplugin?: {
        call?: (plugin: string, fn: string, payload: unknown) => Promise<unknown>;
    };
    __isRealHost?: boolean;
}): Promise<NativeInvocationResult>;
export declare function getGroupMetaById(groupId: OfficialFileTypeGroupId): OfficialFileTypeGroupMeta;
/**
 * 10 大官方分类判定规则
 */
export declare function classifyFileExtension(filePath: string): {
    extension: string;
    category: DiskFileEntry['category'];
    categoryLabel: string;
    groupId: OfficialFileTypeGroupId;
    groupName: string;
    groupColor: string;
};
export declare function computeExtStats(files: DiskFileEntry[]): DiskExtStat[];
/**
 * 汇总 10 大官方分类统计及其内部二级扩展名占比
 */
export declare function computeGroupStats(files: DiskFileEntry[]): DiskGroupStat[];
/**
 * 采集本机真实磁盘分区、10 大分类分布与热点大文件全景快照
 */
export declare function fetchDiskAnalysisSnapshot(hostOverride?: any): Promise<DiskAnalysisSnapshot>;
/**
 * 安全删除磁盘大文件（移入系统回收站，拦截系统保护目录）
 */
export declare function deleteDiskFileItem(filePath: string, hostOverride?: any): Promise<{
    ok: boolean;
    error?: string;
}>;
/**
 * 批量将选中的磁盘文件安全移入系统回收站
 */
export declare function batchDeleteDiskFileItems(filePaths: string[], hostOverride?: any): Promise<{
    succeeded: string[];
    failed: Array<{
        path: string;
        error: string;
    }>;
}>;
/**
 * 在资源管理器中定位文件或分区
 */
export declare function openDiskItemLocation(targetPath: string, hostOverride?: any): Promise<boolean>;
/**
 * 使用系统默认应用直接打开文件
 */
export declare function openDiskFileDefault(targetPath: string, hostOverride?: any): Promise<boolean>;
