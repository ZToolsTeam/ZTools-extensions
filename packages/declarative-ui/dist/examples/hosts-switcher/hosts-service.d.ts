import type { HostRule, HostsProfile } from './types.js';
export declare function isValidIpAddress(ip: string): boolean;
export declare function isValidDomainName(domain: string): boolean;
export declare function parseHostsContent(rawContent: string): HostRule[];
/**
 * 合并多个已启用的 Hosts 方案（跳过语法错误行，同一域名后面的启用方案覆盖或去重）
 */
export declare function buildCombinedHostsContent(profiles: HostsProfile[]): {
    combinedContent: string;
    activeRulesCount: number;
    skippedInvalidCount: number;
};
export declare const DEFAULT_HOSTS_PROFILES: HostsProfile[];
export declare function readSystemHosts(options?: {
    customHostsPath?: string;
}, hostOverride?: unknown): Promise<{
    ok: boolean;
    content: string;
    path?: string;
}>;
export declare function applyCombinedHosts(content: string, options?: {
    customHostsPath?: string;
    simulateAccessDenied?: boolean;
    skipFlushDns?: boolean;
}, hostOverride?: unknown): Promise<{
    success: boolean;
    errorCode?: string;
    error?: string;
}>;
export declare function flushDnsCache(options?: {
    dryRun?: boolean;
    simulateTimeout?: boolean;
}, hostOverride?: unknown): Promise<{
    success: boolean;
    output: string;
    error?: string;
}>;
