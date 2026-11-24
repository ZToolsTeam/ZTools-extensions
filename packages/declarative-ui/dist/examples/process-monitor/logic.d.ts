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
export type ProcessSortKey = 'cpu' | 'memory' | 'name' | 'pid';
export type ProcessTerminateMode = 'force' | 'tree' | 'graceful';
export interface ProcessItem {
    pid: number;
    name: string;
    parentPid: number;
    threadCount: number;
    handleCount?: number;
    path: string;
    workingSetBytes: number;
    memoryBytes: number;
    privateBytes: number;
    cpuPercent: number;
    startTime?: number;
    isSystem: boolean;
    description?: string;
    companyName?: string;
    commandLine?: string;
}
export interface SystemInfoData {
    cpuUsagePercent: number;
    cpuCoreCount: number;
    totalMemoryBytes: number;
    usedMemoryBytes: number;
    availableMemoryBytes: number;
    totalMemory: number;
    availableMemory: number;
    memoryUsagePercent: number;
    processCount: number;
    threadCount: number;
}
export interface ProcessServiceInfo {
    name: string;
    serviceName: string;
    displayName: string;
    status: string | number;
    startType: string;
    description: string;
}
export interface ProcessDetailInfo {
    pid: number;
    name: string;
    path: string;
    commandLine: string;
    companyName: string;
    fileDescription: string;
    fileVersion: string;
    productName: string;
    signerName: string;
    startTime: string;
    handleCount: number;
    peakMemoryBytes: number;
    memoryBytes: number;
    privateBytes: number;
    threadCount: number;
    parentPid: number;
}
export interface ResourceFocusSummary {
    topCpu: ProcessItem | null;
    topMemory: ProcessItem | null;
}
export declare const DLL_PLUGIN_NAME = "ProcessMonitorPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u7CFB\u7EDF\u5185\u6838\u4E0E\u4F1A\u8BDD\u7BA1\u7406\u5173\u952E\u8FDB\u7A0B\u53D7\u4FDD\u62A4\uFF0C\u4E25\u7981\u5F3A\u5236\u7EC8\u6B62\u4EE5\u514D\u5F15\u53D1\u84DD\u5C4F (BSOD)";
export declare const CRITICAL_PROCESS_NAMES: string[];
export declare function getCapabilityItems(): CapabilityActionItem[];
export declare function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[];
export declare function validateInvocationPayload(method: string, params: unknown): {
    valid: boolean;
    error?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostBridge?: any): Promise<NativeInvocationResult>;
export declare function normalizeProcessItem(raw: any): ProcessItem;
export declare function getMockProcesses(): ProcessItem[];
export declare function getMockSystemInfo(): SystemInfoData;
export declare function getMockProcessDetail(pid: number): ProcessDetailInfo;
export declare function getMockServicesByPID(pid: number): ProcessServiceInfo[];
export declare function fetchProcesses(host?: any): Promise<ProcessItem[]>;
export declare function fetchSystemInfo(host?: any): Promise<SystemInfoData>;
export declare function fetchProcessDetail(pid: number, host?: any): Promise<ProcessDetailInfo | null>;
export declare function fetchServicesByPID(pid: number, host?: any): Promise<ProcessServiceInfo[]>;
export declare function terminateProcess(pid: number, name: string, modeOrHost?: ProcessTerminateMode | any, maybeHost?: any): Promise<{
    ok: boolean;
    error?: string;
    mode?: ProcessTerminateMode;
}>;
export declare function openFileLocation(filePath: string, host?: any): Promise<boolean>;
export declare function getResourceFocus(list: ProcessItem[]): ResourceFocusSummary;
export declare function filterProcesses(list: ProcessItem[], query: string, tab?: string, sortBy?: ProcessSortKey): ProcessItem[];
