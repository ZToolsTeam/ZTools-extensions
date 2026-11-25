/**
 * QQ / NTQQ / TIM 专项深度清理业务逻辑与真实环境契约层 (QQCleaner Logic)
 * 与 Windows 原生插件 qq-cleaner 的清理规则一致：12 大官方专项分组 (Group 201~213) + 999 聊天数据库保护区：
 * - 穿透扫描 Documents\Tencent Files、AppData\Roaming\Tencent (Users / QQ / TIM / Logs，含多盘符自定义存储目录与符号链接穿透)、
 *   AppData\Roaming\QQ (NTQQ) 与 AppData\Local\Tencent
 * - 自动识别本机全部真实登录 QQ 号 (UIN)
 * - 严格保护聊天消息加密数据库 (Msg3.0.db / Msg3.0index.db / nt_msg.db / Registry.db / Info.db)
 * - 支持多 QQ 号维度与修改时间范围 (0:全部 / 1:7天前 / 2:30天前 / 3:180天前) 多维过滤及三级复选框联动
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
/**
 * 官方清理分组 ID (201~213) + 999 聊天核心数据库保护区
 */
export type QQGroupId = 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 209 | 211 | 212 | 213 | 999;
export interface QQScannedFileEntry {
    id: string;
    name: string;
    path: string;
    parentDir: string;
    groupId: QQGroupId;
    groupName: string;
    accountId: string;
    clientType: 'ClassicQQ' | 'QQNT' | 'TIM' | 'Shared';
    sizeBytes: number;
    mtime: number;
    isProtected: boolean;
}
export interface QQCleanCategoryItem {
    id: string;
    groupId: QQGroupId;
    name: string;
    shortName: string;
    color: string;
    category: 'cache' | 'media' | 'files' | 'logs' | 'protected';
    riskLevel: 'safe' | 'recommended' | 'caution' | 'protected';
    safetyLevel?: 'safe' | 'recommended' | 'caution' | 'protected';
    targetDir: string;
    existsOnDisk: boolean;
    fileCount: number;
    totalSizeBytes: number;
    checked: boolean;
    sampleFiles: Array<{
        path: string;
        sizeBytes: number;
        mtime?: number;
        accountId?: string;
    }>;
    files: QQScannedFileEntry[];
    description: string;
}
export interface QQAccountStat {
    accountId: string;
    label: string;
    clientType: string;
    rootDir: string;
    fileCount: number;
    totalBytes: number;
}
export interface QQScanSnapshot {
    baseDirectories: string[];
    detectedAccounts: string[];
    accountStats: QQAccountStat[];
    categories: QQCleanCategoryItem[];
    allFiles: QQScannedFileEntry[];
    totalScannableBytes: number;
    checkedBytes: number;
    protectedDbBytes: number;
    systemDiskFreeBytes: number;
    systemDiskTotalBytes: number;
    qqVariantSummary: string;
}
export declare const DLL_PLUGIN_NAME = "QQCleanerPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "QQ \u6838\u5FC3\u804A\u5929\u8BB0\u5F55\u4E0E\u8D26\u6237\u914D\u7F6E\u52A0\u5BC6\u6570\u636E\u5E93 (Msg3.0.db / nt_msg.db / Registry.db / Info.db) \u53D7\u786C\u4EF6\u7EA7\u4FDD\u62A4\uFF0C\u4E25\u7981\u7EB3\u5165\u6E05\u7406\u8303\u56F4";
export interface OfficialQQGroupRule {
    groupId: QQGroupId;
    id: string;
    name: string;
    shortName: string;
    color: string;
    category: QQCleanCategoryItem['category'];
    riskLevel: QQCleanCategoryItem['riskLevel'];
    defaultChecked: boolean;
    description: string;
}
/**
 * 12 大官方清理分组 (201~213) + 999 核心聊天数据库保护区
 */
export declare const OFFICIAL_QQ_GROUP_RULES: OfficialQQGroupRule[];
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function formatDateTime(mtimeSeconds: number): string;
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: any): Promise<NativeInvocationResult>;
/**
 * 根据 QQ / NTQQ / TIM 文件的真实路径，精准归入 12 大官方分组 (201~213) 或 999 聊天数据库保护区，
 * 并提取所属 QQ 号 (UIN) 与客户端类型
 */
export declare function classifyQQFilePath(fullPath: string): {
    groupId: QQGroupId;
    accountId: string;
    clientType: 'ClassicQQ' | 'QQNT' | 'TIM' | 'Shared';
    isProtected: boolean;
};
/**
 * 探测并深度扫描本机真实 QQ / NTQQ / TIM 存储路径、登录 QQ 号 (UIN)、12 大官方清理分组与核心聊天数据库保护区
 */
export declare function fetchQQCleanSnapshot(hostOverride?: any): Promise<QQScanSnapshot>;
/**
 * 执行 QQ / TIM 缓存安全清理（硬件级拦截 Msg3.0.db / nt_msg.db / Registry.db 等聊天数据库，走系统回收站安全移除）
 */
export declare function executeQQCleanup(categoriesOrPaths: QQCleanCategoryItem[] | string[], hostOverride?: any, explicitFilePaths?: string[]): Promise<{
    ok: boolean;
    deletedCount: number;
    freedBytes: number;
    skippedProtected: number;
    deletedPaths: string[];
    skippedPaths: string[];
    error?: string;
}>;
export declare function openQQDirectory(dirPath: string, hostOverride?: any): Promise<boolean>;
export declare function openQQFileDefault(filePath: string, hostOverride?: any): Promise<boolean>;
