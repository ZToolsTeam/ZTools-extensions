/**
 * 多语言离线屏幕与批量图片 OCR 文字提取业务逻辑层 (Ocr Logic)
 */
import { formatBytes } from '../shared/native-ipc.js';
import { type ExampleImportRules, type ExampleImportedFile } from '../shared/file-import.js';
export { formatBytes };
export interface OcrLanguagePreset {
    id: string;
    title: string;
    subtitle: string;
    tag: string;
    engineCode: string;
    avgLatencyMs: number;
}
export interface OcrQueueItem {
    id: string;
    name: string;
    path: string;
    parentDir: string;
    extension: string;
    sizeBytes: number;
    sampleText: string;
    confidencePercent: number;
}
export interface OcrBatchConfig {
    languageModelId?: string;
    lang?: string;
    layoutStrategy?: 'natural_paragraph' | 'single_line' | 'markdown_table';
    postAction?: 'copy_clipboard' | 'export_file' | 'copy_and_export';
    filterStampNoise?: boolean;
}
export interface OcrBatchResult {
    ok: boolean;
    recognizedCount: number;
    failedCount?: number;
    failedPaths?: string[];
    exportedFiles?: string[];
    combinedText: string;
    averageLatencyMs: number;
    items?: OcrQueueItem[];
    error?: string;
    fromFallback?: boolean;
}
export declare const OCR_IMAGE_EXTENSIONS: readonly ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff'];
export declare const OCR_SUPPORTED_TEXT = ".png / .jpg / .jpeg / .webp / .bmp / .gif / .tiff";
/** OCR 文件夹导入规则：单次上限 100 张图片 */
export declare const OCR_IMPORT_RULES: ExampleImportRules;
export declare const OCR_LANGUAGE_MODELS: OcrLanguagePreset[];
export declare function cleanOcrStampNoise(text: string, enableFilter?: boolean): string;
export declare function formatOcrOutputByStrategy(items: OcrQueueItem[], strategy?: OcrBatchConfig['layoutStrategy']): string;
export declare function toOcrQueueItem(file: ExampleImportedFile, index?: number): OcrQueueItem;
/**
 * 通过用户显式选择文件夹（window_show_select_folder_dialog + filesystem_get_directory_contents）导入待识别图片（最多 100 张）
 */
export declare function fetchOcrQueueSnapshot(hostOverride?: unknown): Promise<OcrQueueItem[] & {
    scannedDirs: string[];
    items: OcrQueueItem[];
    files: OcrQueueItem[];
    models: OcrLanguagePreset[];
    error?: string;
}>;
export declare const fetchOcrWorkspace: typeof fetchOcrQueueSnapshot;
export declare function executeBatchOcr(items: OcrQueueItem[], config?: OcrBatchConfig, hostOverride?: unknown): Promise<OcrBatchResult>;
export declare function captureScreenAreaOcr(hostOverride?: unknown): Promise<{
    ok: boolean;
    text: string;
    message: string;
    error?: string;
}>;
export declare function openOcrFileLocation(fullPath: string, hostOverride?: unknown): Promise<boolean>;
