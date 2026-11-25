/**
 * 批量文件重命名工作台业务逻辑与真实文件系统契约层 (BatchRename 2.0 Logic)
 * Windows 下可通过 dllplugin_call 调用原生插件 batch-rename
 * 完整支持 10 大替换/追加/序号规则、同名冲突检测、真实原子改名与一键撤销回滚 (Undo)
 */
import { type ExampleImportRules, type ExampleImportedFile } from '../shared/file-import.js';
export { formatBytes } from '../shared/native-ipc.js';
export type RenameRuleType = 'replace' | 'prefix' | 'date_prefix' | 'suffix' | 'case' | 'number' | 'number_cn' | 'number_roman' | 'trim_head3' | 'clean_brackets' | 'snake_case';
export interface RenameRule {
    type: RenameRuleType;
    find?: string;
    replace?: string;
    prefix?: string;
    suffix?: string;
    caseMode?: 'upper' | 'lower' | 'title';
    startNumber?: number;
    padDigits?: number;
}
export interface RenameResultItem {
    id: string;
    oldName: string;
    newName: string;
    changed: boolean;
    conflict?: boolean;
    fullPath?: string;
    parentDir?: string;
    sizeBytes?: number;
}
export interface RenameUndoEntry {
    oldPath: string;
    newPath: string;
    oldName: string;
    newName: string;
}
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
export declare const DLL_PLUGIN_NAME = "BatchRenamePlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u4E25\u7981\u5BF9 Windows \u7CFB\u7EDF\u6838\u5FC3\u76EE\u5F55\u6267\u884C\u6279\u91CF\u91CD\u547D\u540D\u6216\u5305\u542B\u8DEF\u5F84\u7A7F\u8D8A\u5B57\u7B26";
/** 批量重命名只取所选文件夹的一级子文件 */
export declare const BATCH_RENAME_IMPORT_RULES: ExampleImportRules;
export declare const RENAME_RULE_PRESETS: Array<{
    id: RenameRuleType;
    label: string;
    desc: string;
}>;
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
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
export declare function splitFileName(fullName: string): {
    baseName: string;
    extension: string;
};
/**
 * 单个文件名应用重命名规则 (1:1 对齐 PRD 2.2 & 2.3)
 */
export declare function applyRenameRule(fileName: string, rule: RenameRule, index: number): string;
export declare function batchApplyRename(files: string[], rule: RenameRule): RenameResultItem[];
export interface RealFileEntry {
    name: string;
    fullPath: string;
    parentDir: string;
    extension: string;
    sizeBytes: number;
    lastModifiedMs: number;
}
export declare function toRealFileEntry(file: ExampleImportedFile): RealFileEntry;
/**
 * 通过用户显式选择文件夹（window_show_select_folder_dialog + filesystem_get_directory_contents）加载一级待重命名文件
 */
export declare function fetchRealBatchRenameFiles(hostOverride?: unknown): Promise<{
    directory: string;
    files: RealFileEntry[];
    canceled?: boolean;
    error?: string;
}>;
export declare function executeRealFileRename(sourcePath: string, newFileName: string, hostOverride?: unknown): Promise<{
    ok: boolean;
    destinationPath?: string;
    error?: string;
}>;
/**
 * 批量撤销上一次重命名操作 (PRD 2.6 撤销回滚)
 */
export declare function undoBatchRenameHistory(history: RenameUndoEntry[], hostOverride?: unknown): Promise<{
    ok: boolean;
    restoredCount: number;
}>;
export declare function openRenameFileLocation(fullPath: string, hostOverride?: unknown): Promise<boolean>;
