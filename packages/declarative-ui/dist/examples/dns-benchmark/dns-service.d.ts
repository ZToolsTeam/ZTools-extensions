import type { ActiveNetworkAdapter, DnsActionResponse, DnsBenchmarkItem, DnsProviderPreset } from './types.js';
export declare const PUBLIC_DNS_PRESETS: readonly DnsProviderPreset[];
export declare function isValidIpv4Address(ip: string): boolean;
export declare function isSafeAdapterName(name: string): boolean;
export declare function getActiveNetworkAdapters(hostOverride?: unknown): Promise<ActiveNetworkAdapter[]>;
export declare function sortAndMarkDnsItems(presets: readonly DnsProviderPreset[], probeResults: ReadonlyArray<{
    id?: string;
    primary?: string;
    avgMs?: number;
    primaryMs?: number | null;
    secondaryMs?: number | null;
    timeout?: boolean;
}>, activeDnsList?: readonly string[]): DnsBenchmarkItem[];
export declare function runDnsBenchmark(activeDnsList?: readonly string[], hostOverride?: unknown, presets?: readonly DnsProviderPreset[]): Promise<{
    items: DnsBenchmarkItem[];
    fastestDns: DnsBenchmarkItem | null;
    allTimeout: boolean;
}>;
export declare function applyAdapterDns(adapterName: string, primary: string, secondary?: string, hostOverride?: unknown): Promise<DnsActionResponse>;
export declare function resetAdapterToDhcp(adapterName: string, hostOverride?: unknown): Promise<DnsActionResponse>;
export declare function flushSystemDnsCache(hostOverride?: unknown): Promise<DnsActionResponse>;
