/**
 * AI 图像超分放大、人像/商品去背景与画质修复业务逻辑层 (AiImage Logic)
 */
import { formatBytes } from '../shared/native-ipc.js';
import { type ExampleImportRules, type ExampleImportedFile } from '../shared/file-import.js';
export { formatBytes };
export interface AiImageEnginePreset {
    id: string;
    title: string;
    subtitle: string;
    tag: string;
    modelName: string;
    defaultScale: '1x' | '2x' | '4x';
}
export interface AiImageFileItem {
    id: string;
    name: string;
    path: string;
    parentDir: string;
    extension: string;
    sizeBytes: number;
    width: number;
    height: number;
    outputSizeBytes?: number;
    outputPath?: string;
}
export interface AiImageBatchConfig {
    engineId: string;
    taskMode?: string;
    scaleFactor: '1x' | '2x' | '4x';
    denoiseStrength: 'light' | 'standard' | 'strong';
    outputFormat: 'png' | 'webp' | 'jpg';
    gpuAccel?: boolean;
    outputDir?: string;
}
export interface AiImageProcessedItemResult {
    inputPath: string;
    outputPath: string;
    sizeBytes: number;
    ok: boolean;
    error?: string;
}
export interface AiImageBatchResult {
    ok: boolean;
    processedCount: number;
    engineId: string;
    targetResolution: string;
    outputFormat: string;
    totalOutputBytes: number;
    outputs: AiImageProcessedItemResult[];
    error?: string;
    fromFallback?: boolean;
}
export declare const FORBIDDEN_PATH_PATTERN: RegExp;
export declare const AI_IMAGE_EXTENSIONS: readonly ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
export declare const AI_IMAGE_SUPPORTED_TEXT = ".png / .jpg / .jpeg / .webp / .bmp";
export declare const AI_IMAGE_IMPORT_RULES: ExampleImportRules;
export declare const AI_IMAGE_ENGINES: AiImageEnginePreset[];
export declare function estimateTargetResolution(width: number, height: number, scale: '1x' | '2x' | '4x'): string;
export declare function validateAiImagePayload(config: Partial<AiImageBatchConfig>): {
    valid: boolean;
    error?: string;
};
export type AiImageQueueSnapshot = AiImageFileItem[] & {
    scannedDirs: string[];
    files: AiImageFileItem[];
    items: AiImageFileItem[];
    engines: AiImageEnginePreset[];
    error?: string;
};
export declare function toAiImageFileItem(file: ExampleImportedFile, index?: number): AiImageFileItem;
/**
 * 通过用户显式选择文件夹（window_show_select_folder_dialog + filesystem_get_directory_contents）导入待处理图像
 */
export declare function fetchAiImageQueue(hostOverride?: unknown): Promise<AiImageQueueSnapshot>;
export declare const fetchAiImageWorkspace: typeof fetchAiImageQueue;
export declare function executeAiImageBatch(files: AiImageFileItem[], config: AiImageBatchConfig, hostOverride?: unknown): Promise<AiImageBatchResult>;
export declare const runAiImageBatch: typeof executeAiImageBatch;
export declare function openAiImageLocation(fullPath: string, hostOverride?: unknown): Promise<boolean>;
