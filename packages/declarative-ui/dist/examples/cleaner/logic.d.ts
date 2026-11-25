/**
 * 系统垃圾与深度空间清理大师 (Cleaner 2.0 Logic)
 * 6 大 CleanClass 与 18 项细粒度规则组，Windows 下通过 dllplugin_call 调用原生插件 cleaner
 * 严格遵循零模拟数据铁律：在真实 Electron 宿主中 100% 穿透扫描本机真实目录与样本文件
 */
export { formatBytes } from '../shared/native-ipc.js';
export interface CleanSampleFile {
    path: string;
    sizeBytes: number;
    lastModifiedMs?: number;
}
export interface CleanClassMeta {
    classId: number;
    name: string;
    shortName: string;
    color: string;
    category: 'system' | 'browser' | 'app';
}
export declare const CLEAN_CLASSES: CleanClassMeta[];
export interface CleanGroupItem {
    id: string;
    classId: number;
    groupId: number;
    className: string;
    name: string;
    category: 'system' | 'browser' | 'app';
    description: string;
    riskLevel: 'safe' | 'recommended' | 'caution';
    pathHint: string;
    fileCount: number;
    totalSizeBytes: number;
    checked: boolean;
    defaultChecked: boolean;
    isProtected?: boolean;
    sampleFiles: CleanSampleFile[];
}
export interface CleanSummaryData {
    totalSizeBytes: number;
    checkedSizeBytes: number;
    totalFileCount: number;
    checkedFileCount: number;
    diskFreeSizeBytes: number;
    diskTotalSizeBytes: number;
    recycleBinSizeBytes: number;
}
export interface CleanExecutionResult {
    ok: boolean;
    deletedCount: number;
    deletedSizeBytes: number;
    failedCount: number;
    failedFiles: string[];
    fromFallback?: boolean;
    error?: string;
}
export interface NativeInvocationResult {
    ok: boolean;
    pluginName: string;
    method: string;
    data?: unknown;
    error?: string;
    fromFallback?: boolean;
}
export declare const DLL_PLUGIN_NAME = "CleanerPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u4E25\u7981\u5C06 Windows \u7CFB\u7EDF\u6838\u5FC3\u914D\u7F6E\u5E93\u6216\u7528\u6237\u4E2A\u4EBA\u6587\u6863\u76EE\u5F55\u52A0\u5165\u5783\u573E\u6E05\u7406\u8303\u56F4";
export declare function getMockCleanGroups(): CleanGroupItem[];
export declare function getMockCleanSummary(groups?: CleanGroupItem[]): CleanSummaryData;
export declare function validateCleanPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: unknown): Promise<NativeInvocationResult>;
export declare function fetchSystemDiskInfo(hostOverride?: unknown): Promise<{
    diskFreeBytes: number;
    diskTotalBytes: number;
    recycleBinBytes: number;
}>;
/**
 * 执行系统 6 大 CleanClass 深度扫描并拉取全量 18 项清理规则组
 */
export declare function fetchCleanRulesAndScan(hostOverride?: unknown): Promise<{
    groups: CleanGroupItem[];
    summary: CleanSummaryData;
}>;
export declare function executeCleanGroups(groups: CleanGroupItem[], hostOverride?: unknown): Promise<CleanExecutionResult>;
export declare function cleanSelectedSampleFiles(filePaths: string[], hostOverride?: unknown): Promise<{
    ok: boolean;
    trashedCount: number;
    error?: string;
}>;
export declare function emptyRecycleBin(hostOverride?: unknown): Promise<{
    ok: boolean;
    freedBytes: number;
    error?: string;
}>;
export declare function filterCleanGroups(groups: CleanGroupItem[], query: string, category: 'all' | 'system' | 'browser' | 'app', classIdFilter?: number, riskFilter?: string): CleanGroupItem[];
