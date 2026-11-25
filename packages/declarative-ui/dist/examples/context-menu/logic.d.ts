/**
 * 系统右键菜单扩展管理中枢 (ContextMenu 2.0 Logic)
 * 支持一键切换 Windows 11 经典完整右键菜单，以及真实扫描与管理文件/文件夹/桌面背景右键 Shell 扩展项
 */
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
export type ContextMenuScope = 'system' | 'file' | 'directory' | 'background';
export type ContextMenuFilterMode = 'all' | 'file' | 'directory' | 'background' | 'disabled';
export interface ContextMenuEntry {
    id: string;
    title: string;
    publisher: string;
    scope: ContextMenuScope;
    scopeLabel: string;
    registryKey: string;
    command: string;
    enabled: boolean;
    isOrphaned?: boolean;
    isWin11ClassicToggle?: boolean;
}
export interface ContextMenuSnapshot {
    entries: ContextMenuEntry[];
    win11ClassicEnabled: boolean;
    enabledCount: number;
    disabledCount: number;
}
export declare const DLL_PLUGIN_NAME = "ContextMenuPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u7981\u6B62\u5220\u9664\u6216\u7BE1\u6539\u7CFB\u7EDF\u6839\u7EA7 HKCR / SAM \u5B89\u5168\u6CE8\u518C\u8868\u5206\u652F";
export declare const WIN11_CLASSIC_CLSID_KEY = "HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32";
export declare const DEFAULT_CONTEXT_MENU_ENTRIES: ContextMenuEntry[];
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: any): Promise<NativeInvocationResult>;
export declare function fetchContextMenuEntries(hostOverride?: any): Promise<ContextMenuSnapshot>;
export declare function switchWin11ClassicMenu(useClassic: boolean, hostOverride?: any): Promise<{
    ok: boolean;
    classicMode: boolean;
    message: string;
}>;
export declare function toggleContextMenuEntry(id: string, enabled?: boolean, hostOverride?: any, regPath?: string): Promise<{
    ok: boolean;
    enabled: boolean;
    message: string;
}>;
export declare function cleanOrphanedContextMenuEntries(regPaths?: string[], hostOverride?: any): Promise<{
    ok: boolean;
    cleanedCount: number;
    message: string;
}>;
export declare function filterContextMenuEntries(entries: ContextMenuEntry[], query: string, filterMode?: ContextMenuFilterMode | string): ContextMenuEntry[];
