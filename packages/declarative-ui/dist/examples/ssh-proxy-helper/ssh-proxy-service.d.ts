import type { ProxyStatus, SshHostEntry } from './types.js';
/**
 * 解析 `~/.ssh/config` 文本，跳过通配符 `Host *` 默认块，提取独立主机及其 `HostName`、`User`、`Port`、`IdentityFile`、`ProxyJump`
 */
export declare function parseSshConfigText(rawConfig: string): SshHostEntry[];
export declare function parseSshConfigFile(customConfigPath?: string, hostOverride?: unknown): Promise<SshHostEntry[]>;
export declare function getProxyStatus(options?: {
    mockListeningPorts?: number[];
    skipPortProbe?: boolean;
}, hostOverride?: unknown): Promise<ProxyStatus>;
export declare function setDevToolsProxy(port: number, options?: {
    requireListening?: boolean;
    mockListeningPorts?: number[];
    applySystemGit?: boolean;
}, hostOverride?: unknown): Promise<ProxyStatus>;
export declare function unsetDevToolsProxy(options?: {
    applySystemGit?: boolean;
}, hostOverride?: unknown): Promise<ProxyStatus>;
