import type { ImageMetadata, PresetTemplate, WatermarkOptions, WatermarkRenderResult } from './types.js';
export declare function formatWatermarkDate(now?: Date): string;
export declare function resolveTemplate(rawText: string, businessName?: string, fixedDate?: string): string;
export declare function getPresetWatermarkTemplates(businessName?: string, fixedDate?: string): PresetTemplate[];
export declare function validateImageBufferHeader(bytes: Uint8Array): {
    valid: boolean;
    mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
    error?: string;
};
export declare function wrapWatermarkLines(text: string, maxCharsPerLine?: number): string[];
export declare function computeAdaptiveWatermarkLayout(width: number, height: number, options: WatermarkOptions): {
    effectiveFontSizePx: number;
    effectiveGapPx: number;
    wrappedLines: string[];
    tileCount: number;
};
/**
 * 纯本地离线合成斜向平铺防盗水印，保持原始图像精确宽高不变
 */
export declare function renderWatermarkOnImage(imageInput: ImageMetadata | {
    width: number;
    height: number;
    fileName?: string;
    rawBytes?: Uint8Array;
}, options: WatermarkOptions): Promise<WatermarkRenderResult>;
