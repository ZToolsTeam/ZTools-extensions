/**
 * PDF 多功能转换、合并拆分与加密工具箱业务逻辑层 (Pdf 2.0 Logic)
 * 提供 3 大分类 12 项核心 PDF 工具能力，Windows 下通过 dllplugin_call 调用原生插件 pdf
 */
import { type ExampleImportRules, type ExampleImportedFile } from '../shared/file-import.js';
export { formatBytes } from '../shared/native-ipc.js';
export type PdfToolCategory = 'pdf_to_other' | 'other_to_pdf' | 'pdf_ops';
export interface CapabilityActionItem {
    id: string;
    title: string;
    subtitle: string;
    tag: string;
    method: string;
    category?: PdfToolCategory;
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
export interface RealPdfDocItem {
    id: string;
    name: string;
    path: string;
    parentDir: string;
    extension: string;
    docType: 'pdf' | 'word' | 'excel' | 'ppt' | 'image' | 'other';
    sizeBytes: number;
    estimatedPages: number;
}
export declare const DLL_PLUGIN_NAME = "PdfPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "PDF \u8F6C\u6362\u8F93\u51FA\u8DEF\u5F84\u7981\u6B62\u5305\u542B\u76EE\u5F55\u7A7F\u8D8A\u6216\u8986\u76D6\u7CFB\u7EDF\u6838\u5FC3\u76EE\u5F55";
export declare const PDF_TOOLBOX_EXTENSIONS: readonly [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".md", ".txt", ".png", ".jpg", ".jpeg"];
export declare const PDF_TOOLBOX_SUPPORTED_TEXT = ".pdf / Word / Excel / PPT / Markdown / \u56FE\u7247";
export declare const PDF_TOOLBOX_IMPORT_RULES: ExampleImportRules;
/**
 * 3 大分类 12 项核心 PDF 工具
 */
export declare const PDF_TOOLBOX_MODES: CapabilityActionItem[];
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: unknown): Promise<NativeInvocationResult>;
export type PdfWorkspaceSnapshot = RealPdfDocItem[] & {
    scannedDirs: string[];
    files: RealPdfDocItem[];
    items: RealPdfDocItem[];
    presets: CapabilityActionItem[];
    error?: string;
};
export declare function toRealPdfDocItem(file: ExampleImportedFile, index?: number): RealPdfDocItem;
/**
 * 通过用户显式选择文件夹（window_show_select_folder_dialog + filesystem_get_directory_contents）导入 PDF 及相关文档
 */
export declare function fetchRealPdfWorkspace(hostOverride?: unknown): Promise<PdfWorkspaceSnapshot>;
export declare const scanLocalPdfQueue: typeof fetchRealPdfWorkspace;
export declare function openPdfFileLocation(fullPath: string, hostOverride?: unknown): Promise<boolean>;
export declare function openPdfDocument(fullPath: string, hostOverride?: unknown): Promise<boolean>;
