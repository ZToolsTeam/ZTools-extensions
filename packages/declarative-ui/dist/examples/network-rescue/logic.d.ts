/**
 * 网络断网诊断与一键急救箱 (NetworkRescue 2.0 Logic)
 * 针对 Windows / macOS 常见断网故障提供 8 大真实诊断与一键修复能力
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
export type RescueCategory = 'dns_proxy' | 'stack_reset' | 'connectivity';
export type RescueFilterMode = 'all' | 'warning' | 'dns_proxy' | 'stack_reset';
export interface NetworkRescueItem {
    id: string;
    title: string;
    subtitle: string;
    command: string;
    category: RescueCategory;
    categoryLabel: string;
    status: 'healthy' | 'warning' | 'error' | 'repaired';
    statusText: string;
    healthScore: number;
    requiresAdmin: boolean;
}
export interface NetworkDiagnosticSnapshot {
    items: NetworkRescueItem[];
    overallHealthScore: number;
    warningCount: number;
    latencyMs: number;
    proxyInterceptDetected: boolean;
}
export interface NetworkRepairResult {
    ok: boolean;
    itemId: string;
    command: string;
    message: string;
}
export declare const DLL_PLUGIN_NAME = "NetworkRescuePlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u4E25\u7981\u5220\u9664\u7CFB\u7EDF\u6838\u5FC3\u7F51\u7EDC\u9A71\u52A8\u6587\u4EF6\u6216\u7834\u574F\u5F15\u5BFC\u7F51\u5361\u914D\u7F6E";
export declare const NETWORK_RESCUE_ITEMS: NetworkRescueItem[];
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: any): Promise<NativeInvocationResult>;
export declare function runNetworkDiagnostics(hostOverride?: any): Promise<NetworkDiagnosticSnapshot>;
export declare const fetchNetworkDiagnostics: typeof runNetworkDiagnostics;
export declare function executeNetworkRepair(itemId: string, hostOverride?: any): Promise<NetworkRepairResult>;
export declare function batchExecuteNetworkRepairs(itemIds?: string[], hostOverride?: any): Promise<{
    ok: boolean;
    repairedCount: number;
    failedCount?: number;
    summary: string;
}>;
export declare function filterNetworkRescueItems(items: NetworkRescueItem[], query: string, filterMode?: RescueFilterMode | string): NetworkRescueItem[];
