import type { FileDiagnosticResult, LineEndingType, TargetEncodingType } from './types.js';
export declare function toHexHeaderPreview(bytes: Uint8Array, maxBytes?: number): string;
export declare function detectMagicSignature(bytes: Uint8Array, currentExtension: string): {
    realMimeType: string;
    realExtension: string;
    isKnownBinary: boolean;
};
export declare function detectTextEncodingAndBom(bytes: Uint8Array): {
    isText: boolean;
    detectedEncoding: string;
    confidence: number;
    hasBom: boolean;
};
export declare function detectLineEndingStyle(text: string): LineEndingType;
export declare function decodeTextBufferWithEncoding(bytes: Uint8Array, encoding: string): string;
export declare function inspectFileFromBuffer(bytes: Uint8Array, filePath?: string, overridePreviewEncoding?: string): FileDiagnosticResult;
export declare function convertTextBufferEncoding(bytes: Uint8Array, sourceEncoding: string, targetEncoding: TargetEncodingType, targetLineEnding?: 'CRLF' | 'LF'): Uint8Array;
export declare function fixFileExtension(filePath: string, correctExt: string, hostOverride?: unknown): Promise<{
    ok: boolean;
    newPath?: string;
    error?: string;
}>;
export declare function saveConvertedTextFile(filePath: string, encodedBytes: Uint8Array, hostOverride?: unknown): Promise<{
    ok: boolean;
    outputPath?: string;
    error?: string;
}>;
export declare function pickAndReadLocalFile(hostOverride?: unknown): Promise<{
    ok: boolean;
    filePath?: string;
    bytes?: Uint8Array;
    error?: string;
}>;
