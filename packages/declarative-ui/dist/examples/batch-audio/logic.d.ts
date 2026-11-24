/**
 * 批量音频转换、响度标准化与音效工坊业务逻辑层 (BatchAudio 2.0 Logic)
 * 提供 12 大核心音频批处理能力，Windows 下通过 dllplugin_call 调用原生插件 batch-audio
 */
import { type ExampleImportRules, type ExampleImportedFile } from '../shared/file-import.js';
export { formatBytes } from '../shared/native-ipc.js';
export interface CapabilityActionItem {
    id: string;
    title: string;
    subtitle: string;
    tag: string;
    method: string;
    params: Record<string, unknown>;
    ffmpegFilter?: string;
}
export interface NativeInvocationResult {
    ok: boolean;
    pluginName: string;
    method: string;
    data?: unknown;
    error?: string;
    fromFallback?: boolean;
}
export interface RealAudioFileItem {
    id: string;
    name: string;
    path: string;
    parentDir: string;
    extension: string;
    sizeBytes: number;
}
export declare const DLL_PLUGIN_NAME = "BatchAudioPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u97F3\u9891\u6279\u5904\u7406\u8F93\u51FA\u8DEF\u5F84\u4E0D\u53EF\u6307\u5411\u7CFB\u7EDF\u53D7\u4FDD\u62A4\u76EE\u5F55\u6216\u5305\u542B\u8DEF\u5F84\u7A7F\u8D8A";
export declare const BATCH_AUDIO_EXTENSIONS: readonly ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.wma', '.opus', '.aiff'];
export declare const BATCH_AUDIO_SUPPORTED_TEXT = ".mp3 / .flac / .wav / .aac / .m4a / .ogg / .wma / .opus / .aiff";
export declare const BATCH_AUDIO_IMPORT_RULES: ExampleImportRules;
/**
 * 12 大核心音频处理模式
 */
export declare const AUDIO_WORKSHOP_MODES: CapabilityActionItem[];
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: unknown): Promise<NativeInvocationResult>;
export type AudioWorkspaceSnapshot = RealAudioFileItem[] & {
    scannedDirs: string[];
    files: RealAudioFileItem[];
    items: RealAudioFileItem[];
    presets: CapabilityActionItem[];
    error?: string;
};
export declare function toRealAudioFileItem(file: ExampleImportedFile, index?: number): RealAudioFileItem;
/**
 * 通过用户显式选择文件夹（window_show_select_folder_dialog + filesystem_get_directory_contents）导入音频工作区
 */
export declare function fetchRealAudioWorkspace(hostOverride?: unknown): Promise<AudioWorkspaceSnapshot>;
export declare const scanLocalAudioQueue: typeof fetchRealAudioWorkspace;
export declare function openAudioFileLocation(fullPath: string, hostOverride?: unknown): Promise<boolean>;
