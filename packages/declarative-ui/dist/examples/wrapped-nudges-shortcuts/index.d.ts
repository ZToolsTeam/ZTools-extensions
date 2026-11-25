export * from "./types.js";
export * from "./engine.js";
/**
 * Raycast Wrapped 年度极客报告主入口
 */
export default function RaycastWrappedCommand(): JSX.Element;
/**
 * Trial Nudges 核心特权与技术方案诊断中枢
 */
export declare function TrialNudgesCommand(): JSX.Element;
/**
 * Windows 快捷指令与自动化调度管理器 (Shortcuts)
 */
export declare function WindowsShortcutsCommand(): JSX.Element;
/**
 * 带参数运行 macOS 快捷指令表单 (<RunShortcutWithInputForm>)
 */
export declare function RunShortcutWithInputForm({ shortcutName, onCompleted }: {
    shortcutName: string;
    onCompleted?: (output?: string) => void;
}): JSX.Element;
/**
 * P1-6: macOS 原生「快捷指令 (Apple Shortcuts)」直连主视图
 */
export declare function AppleShortcutsCommand(): JSX.Element;
