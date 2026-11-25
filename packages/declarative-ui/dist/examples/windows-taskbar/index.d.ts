/**
 * Windows Taskbar (任务栏治理中枢)
 *
 * 功能概览：
 * - Win32 原生动作：Toggle Taskbar Visibility (一键显示/隐藏任务栏，基于 FindWindow("Shell_TrayWnd") + ShowWindow)
 * - Toggle Taskbar Auto-Hide (切换任务栏自动隐藏)
 * - 任务栏位置与对齐方式检视 (Windows 11 居中 / 靠左对齐)
 * - 快捷动作反馈与 Toast 提示
 * - 完善的多显示器协同与资源管理器刷新急救
 */
import { WindowsTaskbarManager } from "./taskbar-service.js";
export * from "./types.js";
export * from "./taskbar-service.js";
export default function WindowsTaskbarCommand(props?: {
    manager?: WindowsTaskbarManager;
} | null): JSX.Element;
