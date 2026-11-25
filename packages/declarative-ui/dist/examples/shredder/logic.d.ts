/**
 * ZTools 2.0 标杆原生插件: 军工级文件粉碎机 (Shredder 2.0 - DoD 5220.22-M / Gutmann 多轮扇区覆写不可逆销毁引擎)
 */
import { formatBytes, type NativeInvocationResult } from '../shared/native-ipc.js';
import { type ExampleImportRules, type ExampleImportedFile } from '../shared/file-import.js';
export { formatBytes };
export type { NativeInvocationResult };
export declare const DLL_PLUGIN_NAME = "ShredderPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u4E25\u7981\u7C89\u788E Windows \u7CFB\u7EDF\u6838\u5FC3\u76EE\u5F55\u4E0E\u53D7\u4FDD\u62A4\u5185\u6838\u6587\u4EF6";
export declare const SHREDDER_IMPORT_RULES: ExampleImportRules;
export type ShredStandardId = 'dod_3pass' | 'gutmann_7pass' | 'zero_1pass';
export interface ShredStandardMeta {
    id: ShredStandardId;
    name: string;
    passes: number;
    badge: string;
    description: string;
}
export declare const SHRED_STANDARDS: ShredStandardMeta[];
export type ShredCategory = 'all' | 'large_files' | 'normal_files';
export interface ShredCategoryMeta {
    id: ShredCategory;
    name: string;
    subtitle: string;
}
export declare const SHRED_CATEGORIES: ShredCategoryMeta[];
export interface ShredCandidateItem {
    id: string;
    name: string;
    path: string;
    category: ShredCategory;
    categoryName: string;
    sizeBytes: number;
    isSystemLocked: boolean;
    lockedReason?: string;
}
export interface ShredderSnapshot {
    candidates: ShredCandidateItem[];
    totalShreddableBytes: number;
    updatedAt: string;
}
export declare function createEmptyShredderSnapshot(): ShredderSnapshot;
export declare function toShredCandidateItem(file: ExampleImportedFile, index?: number): ShredCandidateItem;
export declare function validateInvocationPayload(method: string, params: Record<string, unknown>): {
    valid: boolean;
    reason?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostOverride?: unknown): Promise<NativeInvocationResult>;
/**
 * 通过用户显式选择文件夹（window_show_select_folder_dialog + filesystem_get_directory_contents）导入待粉碎候选文件
 */
export declare function fetchShredCandidates(hostBridge?: unknown): Promise<ShredderSnapshot>;
export declare function executeSecureShred(items: ShredCandidateItem[], standardId: ShredStandardId, hostOverride?: unknown): Promise<{
    ok: boolean;
    shreddedCount: number;
    shreddedBytes: number;
    message: string;
}>;
export declare function openShredCandidateLocation(targetPath: string, hostBridge?: unknown): Promise<boolean>;
