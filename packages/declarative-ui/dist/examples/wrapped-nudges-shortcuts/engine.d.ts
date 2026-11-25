/**
 * Wrapped, Nudges & Shortcuts 引擎实现
 * 本地极客统计与勋章生成、特权侧车与 SLA 延迟监控、Windows 快捷指令与 .lnk 执行器
 */
import { WrappedUsageStats, FeatureNudgeItem, SystemPrivilegeDiagnostic, WindowsShortcutItem, AppleShortcutItem } from "./types.js";
export declare const WRAPPED_STORAGE_KEY = "ztools_wrapped_stats_v1";
export declare const SHORTCUTS_STORAGE_KEY = "ztools_custom_windows_shortcuts_v1";
/**
 * 辅助：渲染 ASCII / Unicode 进度图表条
 */
export declare function renderAsciiBar(percentage: number, barLength?: number): string;
/**
 * 辅助：根据段位生成极客勋章 Markdown 卡片
 */
export declare function generateBadgeCard(tier: string, totalLaunches: number, timeSavedHours: number): string;
/**
 * 个人极客使用年度统计计算引擎
 */
export declare function calculateWrappedStats(yearOrStats?: number | any): any;
/**
 * 清洗并防御非法或被篡改的 Wrapped 统计数据
 */
export declare function sanitizeWrappedStats(raw: any, defaultYear?: number): WrappedUsageStats;
/**
 * 特权与能力引导 (Trial Nudges / Feature Highlights)
 */
export declare const FEATURE_NUDGES: FeatureNudgeItem[];
/**
 * 获取系统特权穿透与底层侧车健康度诊断数据
 */
export declare function getSystemPrivilegeDiagnostic(): Promise<SystemPrivilegeDiagnostic>;
/**
 * 重启底层预编译侧车进程
 */
export declare function restartSidecar(sidecarBinary: string): Promise<{
    success: boolean;
    newPid: number;
    message: string;
}>;
/**
 * 预设 Windows 快捷方式与系统运维自动化指令 (Windows Shortcuts)
 */
export declare const DEFAULT_WINDOWS_SHORTCUTS: WindowsShortcutItem[];
/**
 * 预设 macOS Apple Shortcuts 样本集 (离线/测试降级兜底)
 */
export declare const DEFAULT_APPLE_SHORTCUTS: AppleShortcutItem[];
/**
 * 获取 macOS 原生「快捷指令 (/usr/bin/shortcuts list)」列表
 */
export declare function getAppleShortcuts(hostOverride?: any): Promise<AppleShortcutItem[]>;
/**
 * 运行指定的 macOS 快捷指令 (/usr/bin/shortcuts run <name>)
 */
export declare function executeAppleShortcut(name: string, input?: string, hostOverride?: any): Promise<{
    success: boolean;
    output?: string;
    message: string;
}>;
/**
 * 在 macOS「快捷指令.app」中查看并编辑指定快捷指令 (/usr/bin/shortcuts view <name>)
 */
export declare function openShortcutInApp(name: string, hostOverride?: any): Promise<{
    success: boolean;
    message: string;
}>;
/**
 * 获取快捷指令列表（在真实宿主中若检测到 shortcuts_list 返回数据也自动融合）
 */
export declare function getWindowsShortcuts(hostOverride?: any): Promise<WindowsShortcutItem[]>;
/**
 * 执行 Windows / 跨端快捷指令
 */
export declare function executeWindowsShortcut(shortcut: WindowsShortcutItem, options?: {
    runAsAdmin?: boolean;
    input?: string;
    hostOverride?: any;
}): Promise<{
    success: boolean;
    message: string;
}>;
/**
 * 在资源管理器中定位快捷方式目标路径
 */
export declare function revealShortcutInExplorer(shortcut: WindowsShortcutItem): Promise<{
    success: boolean;
    message: string;
}>;
