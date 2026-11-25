/**
 * AI 视频补帧 (RIFE 60/120fps) 与画质超分增强业务逻辑层 (AiVideo Logic)
 */
import { formatBytes } from '../shared/native-ipc.js';
import { type ExampleImportRules, type ExampleImportedFile } from '../shared/file-import.js';
export { formatBytes };
export interface AiVideoModelPreset {
    id: string;
    title: string;
    subtitle: string;
    tag: string;
    modelEngine: string;
    defaultFps: '60fps' | '120fps' | 'source';
}
export interface AiVideoFileItem {
    id: string;
    name: string;
    path: string;
    parentDir: string;
    extension: string;
    sizeBytes: number;
    sourceFps: number;
    sourceResolution: string;
    outputSizeBytes?: number;
    outputPath?: string;
}
export interface AiVideoBatchConfig {
    modelId: string;
    targetFps: '60fps' | '120fps' | 'source';
    targetResolution: '4k_2160p' | '2k_1440p' | '1080p_fhd';
    videoEncoder: 'hevc_nvenc' | 'h264' | 'av1';
    sceneChangeProtection: boolean;
    outputDir?: string;
}
export interface AiVideoProcessedItemResult {
    inputPath: string;
    outputPath: string;
    sizeBytes: number;
    ok: boolean;
    error?: string;
}
export interface AiVideoBatchResult {
    ok: boolean;
    processedCount: number;
    modelId: string;
    targetFps: string;
    targetResolution: string;
    videoEncoder: string;
    totalOutputBytes: number;
    outputs: AiVideoProcessedItemResult[];
    error?: string;
    fromFallback?: boolean;
}
export declare const FORBIDDEN_VIDEO_PATH: RegExp;
export declare const AI_VIDEO_EXTENSIONS: readonly [".mp4", ".mkv", ".mov", ".avi", ".flv", ".webm", ".wmv", ".ts", ".m4v"];
export declare const AI_VIDEO_SUPPORTED_TEXT = ".mp4 / .mkv / .mov / .avi / .webm";
export declare const AI_VIDEO_IMPORT_RULES: ExampleImportRules;
export declare const AI_VIDEO_MODELS: AiVideoModelPreset[];
export declare function validateAiVideoPayload(config: Partial<AiVideoBatchConfig>): {
    valid: boolean;
    error?: string;
};
export type AiVideoQueueSnapshot = AiVideoFileItem[] & {
    scannedDirs: string[];
    files: AiVideoFileItem[];
    items: AiVideoFileItem[];
    models: AiVideoModelPreset[];
    error?: string;
};
export declare function toAiVideoFileItem(file: ExampleImportedFile, index?: number): AiVideoFileItem;
/**
 * 通过用户显式选择文件夹（window_show_select_folder_dialog + filesystem_get_directory_contents）导入待增强视频
 */
export declare function fetchAiVideoQueue(hostOverride?: unknown): Promise<AiVideoQueueSnapshot>;
export declare const fetchAiVideoWorkspace: typeof fetchAiVideoQueue;
export declare function executeAiVideoBatch(files: AiVideoFileItem[], config: AiVideoBatchConfig, hostOverride?: unknown): Promise<AiVideoBatchResult>;
export declare const runAiVideoBatch: typeof executeAiVideoBatch;
export declare function openAiVideoLocation(fullPath: string, hostOverride?: unknown): Promise<boolean>;
