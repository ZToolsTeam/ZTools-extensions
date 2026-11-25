import type { MonitorActionResult, MonitorDisplayInfo, MonitorFilterValue, MonitorProtocol, MonitorScanResult } from './types.js';
export declare const MONITOR_CONTROL_PLUGIN_NAME = "MonitorControlPlugin";
export declare const BRIGHTNESS_PRESETS: ReadonlyArray<{
    id: string;
    label: string;
    value: number;
    shortcutKey: '1' | '2' | '3' | '4';
}>;
export declare function clampBrightnessValue(value: number): {
    valid: boolean;
    clamped: number;
    errorCode?: string;
    error?: string;
};
export declare function formatProtocolLabel(protocol: MonitorProtocol): string;
export declare function normalizeMonitorDisplay(raw: Record<string, unknown>, idx?: number): MonitorDisplayInfo;
export declare function listMonitorDisplays(hostOverride?: unknown, extraParams?: Record<string, unknown>): Promise<MonitorScanResult>;
export declare function filterMonitorDisplays(displays: MonitorDisplayInfo[], filterValue: MonitorFilterValue, query: string): MonitorDisplayInfo[];
export declare function setMonitorBrightness(display: MonitorDisplayInfo, targetBrightness: number, currentDisplays: MonitorDisplayInfo[], hostOverride?: unknown): Promise<MonitorActionResult>;
export declare function syncAllMonitorsBrightness(targetBrightness: number, currentDisplays: MonitorDisplayInfo[], hostOverride?: unknown): Promise<MonitorActionResult>;
export declare function triggerSleepAllMonitors(hostOverride?: unknown, dryRun?: boolean): Promise<MonitorActionResult>;
