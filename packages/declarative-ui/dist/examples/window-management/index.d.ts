import { WindowActionDefinition, WindowManagementPreferences } from "./types.js";
export * from "./types.js";
export * from "./window-actions.js";
/**
 * 窗口偏好配置表单
 */
export declare function WindowPreferencesForm({ onSaved }?: {
    onSaved?: (prefs: WindowManagementPreferences) => void;
}): JSX.Element;
/**
 * 窗口动作详情视图
 */
export declare function WindowActionDetailView({ action, preferences }?: {
    action?: WindowActionDefinition;
    preferences?: WindowManagementPreferences;
}): JSX.Element;
/**
 * 官方内置核心能力: Window Management (窗口调度器)
 * 布局一：100% 全宽极简列表，一目了然展示分屏比例、描述与全局快捷键
 */
export default function WindowManagementCommand(): JSX.Element;
