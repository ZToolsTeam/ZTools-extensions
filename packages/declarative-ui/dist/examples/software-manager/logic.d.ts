/**
 * 软件管理、智能分类、活跃度画像与卸载残留中心 (SoftwareManager 2.0 Logic)
 * 覆盖注册表读取、智能分类、活跃度分析与卸载残留清理，与 Windows 原生插件 software-manager 能力一致
 * 严格遵循零模拟数据铁律：在真实 Electron 宿主中 100% 读取真实注册表已安装应用与真实 AppData 目录
 */
export type SoftwareSmartCategoryId = 'dev_geek' | 'browser_net' | 'media_design' | 'office_doc' | 'game_platform' | 'security_driver' | 'runtime_system';
export interface SoftwareSmartCategoryMeta {
    id: SoftwareSmartCategoryId;
    name: string;
    shortName: string;
    color: string;
    description: string;
}
export declare const SOFTWARE_SMART_CATEGORIES: SoftwareSmartCategoryMeta[];
export interface SoftwareItem {
    id: string;
    name: string;
    version: string;
    publisher: string;
    installDate: string;
    estimatedSize: number;
    installLocation: string;
    uninstallString: string;
    quietUninstallString?: string;
    category: 'desktop' | 'store' | 'runtime' | 'other';
    smartCategory?: SoftwareSmartCategoryId;
    smartCategoryName?: string;
    installDrive?: string;
    activityStatus?: 'recent' | 'normal' | 'idle_large';
    daysSinceInstall?: number;
    isSystem: boolean;
    launchPath?: string;
    launchCount?: number;
    lastUsedTime?: number;
}
export interface AppDataResidualItem {
    id: string;
    folderName: string;
    fullPath: string;
    scope: 'AppData\\Roaming' | 'AppData\\Local';
    sizeBytes: number;
    fileCount: number;
    matchedSoftwareName?: string;
    isOrphaned: boolean;
    lastModifiedMs: number;
}
export interface SoftwareSummaryData {
    totalCount: number;
    totalSizeBytes: number;
    recentInstalledCount: number;
    silentSupportedCount: number;
    idleLargeCount?: number;
    residualTotalBytes?: number;
}
export interface NativeInvocationResult {
    ok: boolean;
    pluginName: string;
    method: string;
    data?: unknown;
    error?: string;
    fromFallback?: boolean;
}
export declare const DLL_PLUGIN_NAME = "SoftwareManagerPlugin";
export declare const PROTECTED_SYSTEM_SOFTWARE_PATTERN: RegExp;
export declare const FORBIDDEN_SOFTWARE_PATTERN: RegExp;
export declare const FORBIDDEN_UNINSTALL_REASON = "\u7CFB\u7EDF\u5185\u6838\u4E0E\u64CD\u4F5C\u7CFB\u7EDF\u5FC5\u5907\u5E95\u5EA7\u53D7 Windows \u5B89\u5168\u4FDD\u62A4\uFF0C\u4E25\u7981\u5F3A\u5236\u5378\u8F7D";
/**
 * 软件智能分类算法
 */
export declare function classifySoftwareSmartCategory(name: string, publisher: string, installLocation: string, isSystem: boolean): SoftwareSmartCategoryId;
export declare function getSmartCategoryMeta(id?: SoftwareSmartCategoryId): SoftwareSmartCategoryMeta;
/**
 * 提取软件所在安装盘符
 */
export declare function extractInstallDrive(installLocation: string, uninstallString: string): string;
/**
 * 解析安装日期与闲置天数
 */
export declare function parseInstallDays(installDate: string): number;
export declare function getMockSoftwareList(): SoftwareItem[];
export declare function getMockSoftwareSummary(list?: SoftwareItem[]): SoftwareSummaryData;
export declare function formatBytes(bytes: number): string;
export declare function invokeNativeCapability(method: string, params?: Record<string, unknown>, hostOverride?: any): Promise<NativeInvocationResult>;
export declare function mapRecordToSoftwareItem(rec: any, index: number): SoftwareItem;
/**
 * 拉取本机已安装软件列表
 */
export declare function fetchSoftwareList(host?: any, forceRefresh?: boolean): Promise<SoftwareItem[]>;
/**
 * 扫描本机 %APPDATA% 与 %LOCALAPPDATA% 软件缓存与卸载残留目录
 */
export declare function probeSoftwareAppDataResiduals(softwareList: SoftwareItem[], host?: any): Promise<AppDataResidualItem[]>;
export declare function cleanAppDataResiduals(items: AppDataResidualItem[], host?: any): Promise<{
    ok: boolean;
    cleanedCount: number;
    freedBytes: number;
    error?: string;
}>;
/**
 * 拉取统计概览
 */
export declare function fetchSoftwareSummary(host?: any, list?: SoftwareItem[]): Promise<SoftwareSummaryData>;
export declare function uninstallSoftware(item: SoftwareItem, isQuiet?: boolean, host?: any): Promise<{
    ok: boolean;
    error?: string;
}>;
export declare function openSoftwareLocation(installLocation: string, host?: any): Promise<boolean>;
export declare function launchSoftware(launchPath: string, host?: any): Promise<boolean>;
/**
 * 多维过滤与排序（向后兼容旧签名，同时支持 7 大智能分类与安装盘符过滤）
 */
export declare function filterSoftwareList(list: SoftwareItem[], query: string, tab: string, smartCatFilter?: string, driveFilter?: string): SoftwareItem[];
