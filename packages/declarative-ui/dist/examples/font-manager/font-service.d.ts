import type { FontLicenseFilter, LicenseType, SystemFontInfo } from './types.js';
export declare function matchFontLicense(family: string, postScriptName?: string): {
    licenseType: LicenseType;
    licenseName?: string;
    licenseUrl?: string;
    foundry?: string;
    chineseName?: string;
};
/**
 * 解析 TTF / OTF 二进制缓冲区的 OpenType `name` 表，对 0 字节或损坏文件安全返回 null
 */
export declare function parseOpenTypeNameTable(buffer: Uint8Array): {
    family: string;
    subfamily: string;
    postScriptName?: string;
    chineseName?: string;
    copyright?: string;
} | null;
/**
 * 构造符合 OpenType 规范的最小化真实二进制字体头（含 `name` 表，供集成测试校验解析器）
 */
export declare function buildSyntheticOpenTypeFontBuffer(meta: {
    family: string;
    subfamily?: string;
    postScriptName?: string;
    chineseName?: string;
    copyright?: string;
}): Uint8Array;
export declare function sanitizePreviewSampleText(input: string, maxLen?: number): string;
export declare function filterInstalledFonts(fonts: SystemFontInfo[], licenseFilter: FontLicenseFilter, searchText: string): SystemFontInfo[];
export declare function scanInstalledFonts(hostOverride?: unknown): Promise<SystemFontInfo[]>;
