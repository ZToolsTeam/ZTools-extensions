import type { MediaMetadataSummary, MediaParamItem } from './types.js';
/**
 * 构造带有真实 JPEG SOI (FF D8)、APP1 Exif 段（含设备与 GPS JSON/TIFF 载荷）与 SOS 图像扫描数据的测试/验证用 JPEG 缓冲
 */
export declare function buildSyntheticJpegWithMetadata(meta: {
    deviceModel?: string;
    dateTimeOriginal?: string;
    exposureInfo?: string;
    gpsLatitude?: number;
    gpsLongitude?: number;
    gpsLocationLabel?: string;
    pixelPayload?: Uint8Array;
}): Uint8Array;
export declare function extractJpegPixelScanPayload(bytes: Uint8Array): Uint8Array;
export declare function inspectMediaBuffer(bytes: Uint8Array, filePath?: string): {
    summary: MediaMetadataSummary;
    params: MediaParamItem[];
};
/**
 * 纯二进制无损抹除 JPEG 中的 GPS 定位信息，保留相机型号与曝光参数，且图像扫描数据 1:1 零损保真
 */
export declare function stripGpsOnlyFromBuffer(bytes: Uint8Array): Uint8Array;
/**
 * 纯二进制无损彻底剥离 JPEG 全部 APP1/EXIF 元数据段，图像像素扫描区 100% 原始保真
 */
export declare function stripAllMetadataFromBuffer(bytes: Uint8Array): Uint8Array;
export declare function saveCleanedMediaToDisk(outputPath: string, cleanedBytes: Uint8Array, hostOverride?: unknown): Promise<{
    ok: boolean;
    outputPath?: string;
    error?: string;
}>;
export declare function pickAndReadMediaFile(hostOverride?: unknown): Promise<{
    ok: boolean;
    filePath?: string;
    bytes?: Uint8Array;
    error?: string;
}>;
