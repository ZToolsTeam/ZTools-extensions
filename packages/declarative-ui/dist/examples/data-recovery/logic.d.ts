/**
 * ZTools 2.0 标杆原生插件: 误删文件与回收站深度恢复工坊 (Data Recovery 2.0)
 *
 * 核心能力：
 * 1. 深度扫描本机回收站 ($Recycle.Bin)、%TEMP% 办公软件自动保存副本 (.asd / .wbk / ~$) 与近期下载残留
 * 2. 计算文件扇区完整度评分 (integrityScore: 0~1)，按「全部可恢复项 / 文档手稿 / 图片设计 / 视频音频 / 压缩包与代码」5 大分类组织
 * 3. 支持勾选批量恢复至安全导出目录（如 Desktop\ZToolsRecovered 或原始目录）
 */
import { formatBytes, type NativeInvocationResult } from "../shared/native-ipc.js";
export { formatBytes };
export type { NativeInvocationResult };
export declare const DLL_PLUGIN_NAME = "DataRecoveryPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u7981\u6B62\u5411\u7CFB\u7EDF\u6838\u5FC3\u4FDD\u62A4\u76EE\u5F55\u5199\u5165\u6062\u590D\u6587\u4EF6\u6216\u5305\u542B\u8DEF\u5F84\u7A7F\u8D8A\u5B57\u7B26";
export type RecoveryCategory = "all" | "documents" | "images" | "media" | "archives_code";
export interface RecoveryCategoryMeta {
    id: RecoveryCategory;
    name: string;
    subtitle: string;
    exts: string[];
}
export declare const RECOVERY_CATEGORIES: RecoveryCategoryMeta[];
export type ScanDepthMode = "quick_recycle" | "deep_sector" | "office_autosave";
export declare const SCAN_DEPTH_MODES: Array<{
    id: ScanDepthMode;
    label: string;
    desc: string;
}>;
export interface RecoverableFileItem {
    id: string;
    name: string;
    originalPath: string;
    cachePath: string;
    category: RecoveryCategory;
    categoryName: string;
    sizeBytes: number;
    deletedAt: string;
    integrityScore: number;
    integrityLabel: string;
}
export interface DataRecoverySnapshot {
    restoreTargetDir: string;
    scanMode: ScanDepthMode;
    items: RecoverableFileItem[];
    totalSizeBytes: number;
    highIntegrityCount: number;
    updatedAt: string;
}
export declare function validateInvocationPayload(method: string, params: Record<string, unknown>): {
    valid: boolean;
    reason?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostOverride?: any): Promise<NativeInvocationResult>;
export declare function createInitialRecoverySnapshot(): DataRecoverySnapshot;
export declare function fetchRecoverableFiles(scanMode?: ScanDepthMode, hostBridge?: any): Promise<DataRecoverySnapshot>;
export declare function restoreSelectedFiles(items: RecoverableFileItem[], restoreDir: string, hostOverride?: any): Promise<{
    ok: boolean;
    restoredCount: number;
    restoredBytes: number;
    message: string;
}>;
export declare function openRecoveryLocation(targetPath: string, hostBridge?: any): Promise<boolean>;
