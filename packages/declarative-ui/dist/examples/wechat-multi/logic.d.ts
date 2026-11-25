/**
 * 微信多开与运行实例管理中枢 (WechatMulti 2.0 Logic)
 * 真实探测本机微信安装路径与运行中的 WeChat.exe / Weixin.exe / WeChatAppEx.exe 实例，支持拉起真实客户端进程
 */
import { formatBytes } from '../shared/native-ipc.js';
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
export type WechatProcessRole = 'launcher' | 'main' | 'applet' | 'helper';
export type WechatFilterMode = 'all' | 'main' | 'applet';
export interface WechatInstanceItem {
    id: string;
    pid: number;
    name: string;
    role: WechatProcessRole;
    roleLabel: string;
    executablePath: string;
    dataDir: string;
    memoryBytes: number;
    cpuPercent: number;
    uptimeText: string;
    mutexStatus: string;
    isActionRow?: boolean;
}
export interface WechatMultiSnapshot {
    items: WechatInstanceItem[];
    mainInstanceCount: number;
    appletCount: number;
    totalMemoryBytes: number;
    installPath: string;
    dataRootPath: string;
    installed?: boolean;
}
export declare const DLL_PLUGIN_NAME = "WeChatMultiPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u4E25\u7981\u4FEE\u6539\u6216\u6CE8\u5165 WeChatWin.dll \u6587\u4EF6\u4EE5\u514D\u89E6\u53D1\u8D26\u53F7\u5B89\u5168\u5C01\u7981\uFF0C\u4EC5\u5141\u8BB8\u6807\u51C6\u8FDB\u7A0B\u53E5\u67C4\u4E92\u65A5\u9501\u91CA\u653E\u4E0E\u591A\u8FDB\u7A0B\u542F\u52A8";
export declare const WECHAT_MUTEX_NAME = "_WeChat_App_Instance_Identity_Mutex_Name";
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: any): Promise<NativeInvocationResult>;
export declare function fetchWechatInstances(hostOverride?: any): Promise<WechatMultiSnapshot>;
export declare const fetchWeChatMultiSnapshot: typeof fetchWechatInstances;
export declare function launchNewWechatInstance(countOrExePath?: number | string, hostOverride?: any): Promise<{
    ok: boolean;
    launchedCount: number;
    pid?: number;
    executablePath: string;
    message: string;
}>;
export declare const launchNewWeChatInstance: typeof launchNewWechatInstance;
export declare function terminateWechatInstance(pid: number, hostOverride?: any): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function openWechatInstallLocation(filePath: string, hostOverride?: any): Promise<boolean>;
export declare function filterWechatInstances(items: WechatInstanceItem[], query: string, mode?: WechatFilterMode | string): WechatInstanceItem[];
