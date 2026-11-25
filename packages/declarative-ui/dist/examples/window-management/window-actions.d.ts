import { WindowActionDefinition, WindowFilterOptions, WindowManagementPreferences, WindowRect, WindowActionResult } from "./types.js";
export declare const DEFAULT_WINDOW_PREFERENCES: WindowManagementPreferences;
export declare function getWindowPreferences(): Promise<WindowManagementPreferences>;
export declare function saveWindowPreferences(prefs: Partial<WindowManagementPreferences>): Promise<WindowManagementPreferences>;
export declare const WINDOW_ACTIONS: WindowActionDefinition[];
/**
 * 过滤与搜索窗口动作
 */
export declare function filterWindowActions(actions: WindowActionDefinition[], options: WindowFilterOptions): WindowActionDefinition[];
/**
 * 窗口几何运算引擎 (Pure Geometry Calculator)
 * 依照 Raycast 官方栅格划分，完全兼容 innerGap 与 outerGap 边距调整
 */
export declare function calculateWindowGeometry(actionId: string, curWin: WindowRect, monRect: WindowRect, prefs?: Partial<WindowManagementPreferences>): WindowRect;
export declare function hasWindowBoundsChanged(a: WindowRect, b: WindowRect): boolean;
export declare function recordExternalForegroundWindow(windowId: string, bounds?: WindowRect, isZToolsSelf?: boolean): string;
export declare function getLastExternalForegroundWindow(): string;
export declare function saveWindowState(windowId: string, rect: WindowRect): void;
export declare function getSavedWindowState(windowId: string): WindowRect | undefined;
export declare function clearSavedWindowStates(): void;
/**
 * 执行窗口调度动作
 */
export declare function executeWindowAction(actionId: string, options?: {
    windowId?: string;
    isZToolsSelf?: boolean;
    curWin?: WindowRect;
    monRect?: WindowRect;
    preferences?: Partial<WindowManagementPreferences>;
    hostBridge?: any;
    hostOverride?: any;
}): Promise<WindowActionResult>;
