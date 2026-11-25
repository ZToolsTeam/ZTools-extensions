/**
 * 微信专项深度清理业务逻辑与真实环境契约层 (WechatCleaner Logic)
 * 与 Windows 原生插件 wechat-cleaner 的清理规则一致：9 大专项清理分类 (owner 107~115)：
 * - 穿透扫描 Documents\xwechat_files、WeChat Files、AppData\Roaming\Tencent\xwechat (含多盘符自定义存储目录与符号链接穿透) 与 LocalLow\TENCENT\WeType
 * - 严格保护聊天文字数据库 (MSG*.db / MicroMsg.db / db_storage\*.db)
 * - 支持多微信账号 (wxid) 维度与修改时间范围 (全部/7天前/30天前/半年前) 多维过滤及三级复选框联动
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
export type WechatOwnerId = 107 | 108 | 109 | 110 | 111 | 112 | 113 | 114 | 115 | 999;
export interface WechatScannedFileEntry {
    id: string;
    name: string;
    path: string;
    parentDir: string;
    ownerId: WechatOwnerId;
    ownerName: string;
    accountId: string;
    sizeBytes: number;
    mtime: number;
    isProtected: boolean;
}
export interface WechatCleanCategoryItem {
    id: string;
    ownerId: WechatOwnerId;
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
    files: WechatScannedFileEntry[];
    description: string;
}
export interface WechatAccountStat {
    accountId: string;
    label: string;
    rootDir: string;
    fileCount: number;
    totalBytes: number;
}
export interface WechatScanSnapshot {
    baseDirectories: string[];
    detectedAccounts: string[];
    accountStats: WechatAccountStat[];
    categories: WechatCleanCategoryItem[];
    allFiles: WechatScannedFileEntry[];
    totalScannableBytes: number;
    checkedBytes: number;
    protectedDbBytes: number;
    systemDiskFreeBytes: number;
    systemDiskTotalBytes: number;
    wechatRunning: boolean;
    wechatVersionLabel: string;
}
export declare const DLL_PLUGIN_NAME = "WechatCleanerPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u5FAE\u4FE1\u6838\u5FC3\u804A\u5929\u6587\u5B57\u4E0E\u8054\u7CFB\u4EBA\u6570\u636E\u5E93 (MSG.db / MicroMsg.db / db_storage/*.db) \u53D7\u5230\u4E25\u683C\u786C\u4EF6\u7EA7\u4FDD\u62A4\uFF0C\u4E25\u7981\u7EB3\u5165\u6E05\u7406\u8303\u56F4";
export interface OfficialWechatOwnerRule {
    ownerId: WechatOwnerId;
    id: string;
    name: string;
    shortName: string;
    color: string;
    category: WechatCleanCategoryItem['category'];
    riskLevel: WechatCleanCategoryItem['riskLevel'];
    defaultChecked: boolean;
    description: string;
}
/**
 * 9 大专项清理分类 (owner 107~115) + 1 项核心聊天数据库保护区 (999)
 */
export declare const OFFICIAL_WECHAT_OWNER_RULES: OfficialWechatOwnerRule[];
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function formatDateTime(mtimeSeconds: number): string;
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: any): Promise<NativeInvocationResult>;
/**
 * 根据微信文件的完整真实路径，将其精准归入 9 大专项分类 (107~115) 或 999 聊天数据库保护区，
 * 并提取所属微信号 (accountId)
 */
export declare function classifyWechatFilePath(fullPath: string, knownAccounts: string[]): {
    ownerId: WechatOwnerId;
    accountId: string;
    isProtected: boolean;
};
/**
 * 探测并深度扫描本机真实微信存储路径、微信号账号、9 大专项分类与聊天数据库保护区
 */
export declare function fetchWechatCleanSnapshot(hostOverride?: any): Promise<WechatScanSnapshot>;
/**
 * 执行微信缓存安全清理（严格拦截聊天数据库文件，走真实回收站移除）
 */
export declare function executeWechatCleanup(categoriesOrPaths: WechatCleanCategoryItem[] | string[], hostOverride?: any, explicitFilePaths?: string[]): Promise<{
    ok: boolean;
    deletedCount: number;
    freedBytes: number;
    skippedProtected: number;
    deletedPaths: string[];
    skippedPaths: string[];
    error?: string;
}>;
export declare function openWechatDirectory(dirPath: string, hostOverride?: any): Promise<boolean>;
export declare function openWechatFileDefault(filePath: string, hostOverride?: any): Promise<boolean>;
