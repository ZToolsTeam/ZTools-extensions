/**
 * 网络流量监控、进程连接审计与防火墙卫士 (FlowGuard 2.0 Logic)
 * Windows 下通过 dllplugin_call 调用原生插件 flow-guard 审计网络连接
 * 真实聚合 process_list_ports (TCP/UDP 五元组套接字) 与 process_list (进程路径/内存/CPU)
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
export type RemoteIpScope = 'public' | 'lan' | 'loopback' | 'listening';
export interface PortEndpointItem {
    protocol: string;
    localAddress: string;
    localPort: number;
    remoteAddress: string;
    remotePort: number;
    state: string;
    pid: number;
    processName: string;
    remoteScope?: RemoteIpScope;
}
export interface ProcessNetworkGroup {
    pid: number;
    processName: string;
    processPath: string;
    cpuPercent: number;
    memoryBytes: number;
    tcpCount: number;
    udpCount: number;
    establishedCount: number;
    listeningCount: number;
    publicCount: number;
    lanCount: number;
    loopbackCount: number;
    endpoints: PortEndpointItem[];
    isProtected: boolean;
}
export interface FlowGuardSnapshot {
    groups: ProcessNetworkGroup[];
    totalEndpoints: number;
    totalEstablished: number;
    totalListening: number;
    totalUdp: number;
    totalPublic: number;
    totalLan: number;
    totalLoopback: number;
}
export declare const DLL_PLUGIN_NAME = "FlowGuardPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u6838\u5FC3\u7CFB\u7EDF\u7F51\u7EDC\u670D\u52A1\u53D7\u4FDD\u62A4\uFF0C\u7981\u6B62\u65AD\u7F51\u62E6\u622A\u4EE5\u9632\u7CFB\u7EDF\u65AD\u8054";
/**
 * 识别远端地址所属网络域（公网外联 / 局域网 / 本机回环 / 监听）
 */
export declare function classifyRemoteIpScope(remoteAddress: string, state: string, protocol: string): RemoteIpScope;
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: any): Promise<NativeInvocationResult>;
/**
 * 采集本机真实活动网络连接与五元组端口画像
 */
export declare function fetchFlowGuardSnapshot(hostOverride?: any): Promise<FlowGuardSnapshot>;
export declare function terminateNetworkProcess(pid: number, processName: string, hostOverride?: any): Promise<{
    ok: boolean;
    error?: string;
}>;
export declare function openNetworkProcessLocation(processPath: string, hostOverride?: any): Promise<boolean>;
