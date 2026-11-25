/**
 * 本机网络接口与网卡配置透视中枢 (NetworkAdapter 2.0 Logic)
 * 探测以太网 Ethernet、WLAN Wi-Fi、Loopback 回环与虚拟隧道网卡 (VMware / WSL / Clash TUN)
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
export type AdapterCategory = 'physical' | 'virtual' | 'loopback';
export type AdapterFilterMode = 'all' | 'physical' | 'virtual' | 'connected';
export interface NetworkAdapterItem {
    id: string;
    name: string;
    description: string;
    category: AdapterCategory;
    typeLabel: string;
    status: 'up' | 'down';
    ipv4: string;
    ipv6: string;
    netmask: string;
    gateway: string;
    mac: string;
    dnsServers: string[];
    speedMbps: number;
    mtu: number;
    dhcpEnabled: boolean;
}
export interface NetworkAdapterSnapshot {
    adapters: NetworkAdapterItem[];
    activeCount: number;
    physicalCount: number;
    virtualCount: number;
    primaryIpv4: string;
    primaryGateway: string;
    primaryDns: string;
}
export declare const DLL_PLUGIN_NAME = "NetworkAdapterPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u7981\u6B62\u6279\u91CF\u7981\u7528\u5168\u90E8\u6D3B\u52A8\u7F51\u5361\u4EE5\u514D\u5BFC\u81F4\u8FDC\u7A0B\u4F1A\u8BDD\u6216\u7CFB\u7EDF\u7F51\u7EDC\u5F7B\u5E95\u4E2D\u65AD";
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: any): Promise<NativeInvocationResult>;
export declare function fetchNetworkAdapters(hostOverride?: any): Promise<NetworkAdapterSnapshot>;
export declare function applyDnsPreset(adapterIdOrName: string, primaryDns: string, secondaryDns?: string, hostOverride?: any): Promise<{
    ok: boolean;
    adapterId: string;
    dnsServers: string[];
    message: string;
}>;
export declare function flushSystemDnsCache(hostOverride?: any): Promise<{
    ok: boolean;
    message: string;
}>;
export declare const flushDnsCache: typeof flushSystemDnsCache;
export declare function copyAdapterInfo(adapter: NetworkAdapterItem, format?: 'ipv4' | 'mac' | 'json' | 'summary'): string;
export declare function filterNetworkAdapters(adapters: NetworkAdapterItem[], query: string, filterMode?: AdapterFilterMode | string): NetworkAdapterItem[];
