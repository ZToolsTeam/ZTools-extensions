/**
 * 局域网免密快传与二维码投送中枢 (LanShare 2.0 Logic)
 * 支持显式导入文件与文件夹、局域网 IPv4 地址探测与标准 ISO/IEC 18004 QR Code 编码器生成可扫二维码
 */
import { formatBytes } from '../shared/native-ipc.js';
import { type ExampleImportRules, type ExampleImportedFile } from '../shared/file-import.js';
export declare const LAN_SHARE_IMPORT_RULES: ExampleImportRules;
export { formatBytes };
export interface CapabilityActionItem {
    id: string;
    title: string;
    subtitle: string;
    tag: string;
    method: string;
    params: Record<string, unknown>;
}
export interface NativeInvocationResult {
    ok: boolean;
    pluginName: string;
    method: string;
    data?: unknown;
    error?: string;
    fromFallback?: boolean;
}
export type LanShareCategory = 'portal' | 'clipboard' | 'files';
export type LanShareFilterMode = 'all' | 'clipboard' | 'files';
export interface LanShareItem {
    id: string;
    title: string;
    subtitle: string;
    category: LanShareCategory;
    categoryLabel: string;
    filePath: string;
    sizeBytes: number;
    shareUrl: string;
    qrCodeDataUri: string;
    isShared: boolean;
    downloadCount: number;
    textPreview?: string;
}
export interface LanShareSnapshot {
    items: LanShareItem[];
    lanIp: string;
    port: number;
    portalUrl: string;
    serverRunning?: boolean;
    sharedCount: number;
    totalSharedBytes: number;
}
export declare const DLL_PLUGIN_NAME = "LanSharePlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u4E25\u7981\u5C06\u7CFB\u7EDF SAM \u5BC6\u7801\u5E93\u6216\u79C1\u94A5\u6587\u4EF6\u66B4\u9732\u81F3\u5C40\u57DF\u7F51 HTTP \u5171\u4EAB\u670D\u52A1";
/**
 * 标准 ISO/IEC 18004 QR Code 矩阵生成函数（Byte 模式 + GF(256) Reed-Solomon 纠错码）
 */
export declare function encodeQrCodeMatrix(text: string): boolean[][];
/**
 * 根据输入 URL 生成符合 ISO/IEC 18004 标准的单色高对比度 QR 码内联 SVG Data URI
 */
export declare function generateQrCodeSvgDataUri(text: string): string;
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: unknown): Promise<NativeInvocationResult>;
export declare function toggleLanShareServer(enable?: boolean, port?: number, hostOverride?: unknown): Promise<{
    ok: boolean;
    running: boolean;
    lanIp: string;
    port: number;
    portalUrl: string;
    message: string;
}>;
export declare function addRealFileToShareQueue(filePath: string, hostOverride?: unknown): Promise<{
    ok: boolean;
    item?: LanShareItem;
    message: string;
}>;
export declare function toLanShareFileItem(entry: ExampleImportedFile, portalUrl?: string): LanShareItem;
export declare function createClipboardShareItem(hostOverride?: unknown): Promise<{
    ok: boolean;
    item?: LanShareItem;
    message: string;
}>;
export declare function syncLanShareItemsToHost(items: LanShareItem[], hostOverride?: unknown): Promise<{
    portalUrl: string;
    ok: boolean;
}>;
export declare function fetchLanShareSnapshot(hostOverride?: unknown): Promise<LanShareSnapshot>;
export declare function toggleFileShare(itemId: string, shared?: boolean, hostOverride?: unknown): Promise<{
    ok: boolean;
    isShared: boolean;
    shareUrl: string;
    message: string;
}>;
export declare function openSharedFileLocation(filePath: string, hostOverride?: unknown): Promise<boolean>;
export declare function filterLanShareItems(items: LanShareItem[], query: string, mode?: LanShareFilterMode | string): LanShareItem[];
