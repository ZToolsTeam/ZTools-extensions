import type { ContainerSummary } from './types.js';
/**
 * 清洗日志中的 ANSI 颜色与退格控制字符，确保 Markdown 代码块纯净渲染
 */
export declare function cleanContainerLogText(rawText: string): string;
/**
 * 解析 Docker Engine REST API 或 `docker ps --format json` 的端口映射并智能推导 Web URL
 */
export declare function parseDockerPortMappings(portsInput: unknown): {
    primaryPort?: string;
    webUrl?: string;
    portsDisplay: string;
};
export declare function normalizeDockerContainerRecord(raw: Record<string, unknown>): ContainerSummary;
export declare function listContainers(options?: {
    rawContainers?: Array<Record<string, unknown>>;
    simulateDaemonOffline?: boolean;
}, hostOverride?: unknown): Promise<ContainerSummary[]>;
export declare function controlContainer(id: string, action: 'start' | 'stop' | 'restart' | 'remove', options?: {
    dryRun?: boolean;
}, hostOverride?: unknown): Promise<{
    ok: boolean;
    command?: string;
    error?: string;
}>;
export declare function getContainerTailLogs(id: string, lines?: number, rawLogs?: string, hostOverride?: unknown): Promise<string>;
