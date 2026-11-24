/**
 * 批量视频转码、裁剪与动图工坊业务逻辑层 (BatchVideo 2.0 Logic)
 * 提供 12 大核心视频批处理能力，Windows 下通过 dllplugin_call 调用原生插件 batch-video
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
    ffmpegArgs?: string;
    ratioMultiplier?: number;
}
export interface NativeInvocationResult {
    ok: boolean;
    pluginName: string;
    method: string;
    data?: unknown;
    error?: string;
    fromFallback?: boolean;
}
export interface RealVideoFileItem {
    id: string;
    name: string;
    path: string;
    parentDir: string;
    extension: string;
    sizeBytes: number;
    estimatedCompressedBytes: number;
}
export declare const DLL_PLUGIN_NAME = "BatchVideoPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u89C6\u9891\u6279\u5904\u7406\u8F93\u51FA\u8DEF\u5F84\u4E0D\u53EF\u6307\u5411\u7CFB\u7EDF\u53D7\u4FDD\u62A4\u76EE\u5F55\u6216\u5305\u542B\u8DEF\u5F84\u7A7F\u8D8A";
export declare const BATCH_VIDEO_EXTENSIONS: readonly ['.mp4', '.mkv', '.mov', '.avi', '.flv', '.webm', '.wmv', '.ts', '.m4v', '.gif'];
export declare const BATCH_VIDEO_SUPPORTED_TEXT = ".mp4 / .mkv / .mov / .avi / .webm / .gif";
export declare const BATCH_VIDEO_IMPORT_RULES: ExampleImportRules;
/**
 * 12 大视频批处理模式
 */
export declare const VIDEO_WORKSHOP_MODES: CapabilityActionItem[];
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: unknown): Promise<NativeInvocationResult>;
export type VideoWorkspaceSnapshot = RealVideoFileItem[] & {
    scannedDirs: string[];
    files: RealVideoFileItem[];
    items: RealVideoFileItem[];
    presets: CapabilityActionItem[];
    error?: string;
};
export declare function toRealVideoFileItem(file: ExampleImportedFile, index?: number): RealVideoFileItem;
/**
 * 通过用户显式选择文件夹（window_show_select_folder_dialog + filesystem_get_directory_contents）导入视频工作区
 */
export declare function fetchRealVideoWorkspace(hostOverride?: unknown): Promise<VideoWorkspaceSnapshot>;
export declare const scanLocalVideoQueue: typeof fetchRealVideoWorkspace;
export declare function openVideoFileLocation(fullPath: string, hostOverride?: unknown): Promise<boolean>;
