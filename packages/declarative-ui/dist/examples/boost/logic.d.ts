/**
 * 系统极速加速、大内存进程治理与开机启动项管理 (Boost 2.0 Logic)
 * Windows 下通过 dllplugin_call 调用原生插件 boost 管理进程与开机启动项
 * 真实采集物理内存工作集、CPU 负载、高占用后台进程、Windows 开机启动项与 %TEMP% 热点缓存
 */
export { formatBytes } from '../shared/native-ipc.js';
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
export interface BoostCandidateItem {
    id: string;
    type: 'process' | 'startup_item' | 'temp_cache';
    pid?: number;
    name: string;
    path: string;
    memoryOrSizeBytes: number;
    cpuPercent: number;
    isProtected: boolean;
    startupScope?: '用户启动目录 (Startup)' | '公共启动目录 (Common Startup)' | '注册表后台常驻';
    impactLevel?: '高耗时影响' | '中等影响' | '低影响';
    recommendation: string;
}
export interface BoostSnapshot {
    totalMemoryBytes: number;
    usedMemoryBytes: number;
    availableMemoryBytes: number;
    memoryUsagePercent: number;
    cpuUsagePercent: number;
    reclaimableEstimateBytes: number;
    startupItemCount: number;
    candidates: BoostCandidateItem[];
}
export declare const DLL_PLUGIN_NAME = "BoostPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u7CFB\u7EDF\u5B89\u5168\u4E0E\u6838\u5FC3\u5F15\u5BFC\u542F\u52A8\u9879\u53D7\u4FDD\u62A4\uFF0C\u4E25\u7981\u7981\u7528";
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: {
    dllplugin?: {
        call?: (plugin: string, fn: string, payload: unknown) => Promise<unknown>;
    };
    __isRealHost?: boolean;
}): Promise<NativeInvocationResult>;
/**
 * 采集本机真实内存工作集、CPU 负载、开机启动项与可优化高占用候选列表
 */
export declare function fetchBoostSnapshot(hostOverride?: any): Promise<BoostSnapshot>;
export declare function terminateBoostProcess(pid: number, name: string, hostOverride?: any): Promise<{
    ok: boolean;
    error?: string;
}>;
export declare function executeQuickBoostCleanup(candidates: BoostCandidateItem[], hostOverride?: any): Promise<{
    ok: boolean;
    cleanedCount: number;
    freedBytes: number;
}>;
export declare function openBoostItemLocation(path: string, hostOverride?: any): Promise<boolean>;
