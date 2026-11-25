/**
 * 高清屏幕录制、系统声音 WASAPI 内录与录像队列业务逻辑层 (Record Logic)
 * 真实扫描本机 Videos / Videos\Captures / Desktop 目录下的录像文件，对接 RecordPlugin 与录制状态栏
 */
import { formatBytes } from '../shared/native-ipc.js';
export { formatBytes };
export interface RecordSourcePreset {
    id: string;
    title: string;
    subtitle: string;
    tag: string;
    captureMode: 'fullscreen' | 'window' | 'region' | 'audio_only';
    defaultResolution: string;
}
export interface RecordedVideoItem {
    id: string;
    name: string;
    path: string;
    parentDir: string;
    extension: string;
    sizeBytes: number;
    durationText: string;
    resolutionText: string;
    fps: number;
}
export interface RecordSessionConfig {
    sourceModeId: string;
    fps: '60' | '30' | '15';
    codecContainer: 'mp4_h264' | 'mp4_hevc' | 'gif_hd';
    wasapiLoopback: boolean;
    micMix: boolean;
    cursorHighlight: boolean;
    saveDir?: string;
}
export interface RecordActionResult {
    ok: boolean;
    sessionId: string;
    message: string;
    estimatedMbPerMin: number;
    saveDir: string;
    outputPath?: string;
    error?: string;
    fromFallback?: boolean;
}
export declare const RECORD_SOURCE_MODES: RecordSourcePreset[];
export declare const INITIAL_RECORDED_VIDEOS: RecordedVideoItem[];
export declare function estimateMbPerMinute(fps: '60' | '30' | '15', codec: 'mp4_h264' | 'mp4_hevc' | 'gif_hd'): number;
export type RecordWorkspaceSnapshot = RecordedVideoItem[] & {
    scannedDirs: string[];
    recordings: RecordedVideoItem[];
    sourceModes: RecordSourcePreset[];
    isRecording?: boolean;
};
export declare function fetchRecordWorkspace(hostOverride?: any): Promise<RecordWorkspaceSnapshot>;
export declare function startScreenRecording(config: RecordSessionConfig, hostOverride?: any): Promise<RecordActionResult>;
export declare function stopScreenRecording(hostOverride?: any): Promise<{
    ok: boolean;
    message: string;
    outputPath?: string;
    error?: string;
}>;
export declare function openRecordedVideo(fullPath: string, hostOverride?: any): Promise<boolean>;
export declare function openRecordFileLocation(fullPath: string, hostOverride?: any): Promise<boolean>;
