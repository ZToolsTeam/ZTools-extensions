/**
 * 电脑硬件深度检测、实时监控、场景战力评测与配置报告中心 (HardwareInfo 2.0 Logic)
 * Windows 下通过 dllplugin_call 调用原生插件 hardware-info 采集硬件信息
 * 真实采集 CPU 微架构、物理内存、全量磁盘分区、多显示器、电源状态与 4 大场景战力评估
 */
import { RealDriveUsageInfo } from '../shared/native-ipc.js';
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
export interface HardwareSpecEntry {
    id: string;
    category: 'cpu' | 'memory' | 'storage' | 'display' | 'system' | 'benchmark';
    title: string;
    subtitle: string;
    value: string;
    tag: string;
    detailMarkdown: string;
}
export interface ScenarioCompatibilityItem {
    id: string;
    scenario: string;
    tier: '极致流畅' | '主力胜任' | '基本满足' | '瓶颈受限';
    score: number;
    summary: string;
    bottleneckHint: string;
}
export interface HardwareTelemetrySnapshot {
    cpuModel: string;
    logicalCpuCount: number;
    cpuUsagePercent: number;
    totalMemoryBytes: number;
    usedMemoryBytes: number;
    availableMemoryBytes: number;
    memoryUsagePercent: number;
    osName: string;
    osVersion: string;
    osBuild: number;
    osArch: string;
    driveCount: number;
    totalDiskBytes: number;
    usedDiskBytes: number;
    availableDiskBytes: number;
    drives: RealDriveUsageInfo[];
    displayCount: number;
    batteryPercent: number;
    isCharging: boolean;
    healthScore: number;
    scenarios: ScenarioCompatibilityItem[];
    entries: HardwareSpecEntry[];
}
export declare const DLL_PLUGIN_NAME = "HardwareInfoPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u7981\u6B62\u901A\u8FC7\u786C\u4EF6\u68C0\u6D4B\u63D2\u4EF6\u6267\u884C\u975E\u5B89\u5168\u7684\u5E95\u5C42 MSR \u5BC4\u5B58\u5668\u5199\u64CD\u4F5C\u6216\u8D85\u538B\u6307\u4EE4";
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: any): Promise<NativeInvocationResult>;
/**
 * 基于本机真实硬件规格计算 4 大应用场景兼容性评估
 */
export declare function evaluateHardwareScenarios(logicalCpuCountOrSnap: number | Partial<HardwareTelemetrySnapshot>, totalMemoryBytesArg?: number, availableDiskBytesArg?: number): ScenarioCompatibilityItem[];
/**
 * 导出整机硬件资产报告 (支持 Markdown / JSON / TXT 三种格式)
 */
export declare function exportHardwareReport(snap: HardwareTelemetrySnapshot, format?: 'markdown' | 'json' | 'txt'): string;
/**
 * 采集本机真实硬件配置与传感器状态快照
 */
export declare function fetchHardwareTelemetrySnapshot(hostOverride?: any): Promise<HardwareTelemetrySnapshot>;
