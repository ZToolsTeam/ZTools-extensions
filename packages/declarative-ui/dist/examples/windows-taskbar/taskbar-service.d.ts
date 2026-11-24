import { TaskbarState, TaskbarActionResult, TaskbarAlignment, TaskbarPosition } from "./types.js";
/** 测试或调用方注入的宿主对象（方法名 → 实现），透传给 callHostTransport */
export type TaskbarHostOverride = Record<string, unknown>;
/** 插件关心的三类平台；识别不出时为 undefined */
export type TaskbarPlatform = "win32" | "darwin" | "linux";
export interface WindowsTaskbarManagerOptions {
    /** 运行平台，默认自动识别；单测注入后可在任意宿主上验证 Windows / macOS 两套行为 */
    readonly platform?: TaskbarPlatform | undefined;
}
/**
 * 识别当前平台：Node 环境读 process.platform，渲染进程（无 process）读 userAgent
 */
export declare function detectTaskbarPlatform(): TaskbarPlatform | undefined;
/**
 * 当前平台上宿主真正实现了的任务栏能力。界面只展示这里为 true 的动作，避免提供每次都失败的按钮。
 * - Windows：只有显示 / 隐藏（taskbar_show / taskbar_hide / taskbar_status）；
 *   自动隐藏、图标对齐、重启资源管理器宿主均未实现；
 * - macOS：Dock 自动隐藏（即显示 / 隐藏）、停靠位置、重启 Dock；
 * - 其他或识别不出：只保留显示 / 隐藏，由宿主如实返回结果。
 */
export interface TaskbarCapabilities {
    readonly visibility: boolean;
    readonly autoHide: boolean;
    readonly dockPosition: boolean;
    readonly restartDock: boolean;
    readonly restartExplorer: boolean;
    readonly alignment: boolean;
}
export declare function getTaskbarCapabilities(platform: TaskbarPlatform | undefined): TaskbarCapabilities;
export declare class WindowsTaskbarManager {
    private currentState;
    private initialized;
    private readonly platformOverride;
    constructor(options?: WindowsTaskbarManagerOptions);
    private get platform();
    /** 当前平台可用的动作（界面据此隐藏宿主未实现的动作） */
    getCapabilities(): TaskbarCapabilities;
    getTaskbarState(): Promise<TaskbarState>;
    private saveState;
    /**
     * 调用宿主方法。只有宿主确认成功才算成功；没有宿主时如实返回不可达，绝不假装成功
     */
    private callHost;
    /** 失败结果：不改动已保存的状态，visible / autoHide 取当前保存的值，message 给用户看，error 保留宿主原始原因 */
    private failure;
    private unreachableMessage;
    /**
     * 显式显示或隐藏：Windows 隐藏任务栏窗口，macOS 对应 Dock 常驻 / 自动隐藏。
     * 调用 taskbar_show / taskbar_hide 而不是 toggle，避免宿主真实状态与本地缓存不一致时方向反转
     */
    private applyVisible;
    /** 读取宿主的真实显隐状态；读不到时回退到本地缓存 */
    private readHostVisible;
    /**
     * 一键切换任务栏显隐 / macOS Dock 自动隐藏 (Toggle Taskbar & Dock Visibility)
     */
    toggleTaskbarVisibility(hostOverride?: TaskbarHostOverride): Promise<TaskbarActionResult>;
    showTaskbar(hostOverride?: TaskbarHostOverride): Promise<TaskbarActionResult>;
    hideTaskbar(hostOverride?: TaskbarHostOverride): Promise<TaskbarActionResult>;
    /**
     * 设置自动隐藏：宿主目前只在 macOS 上提供（Dock 自动隐藏 = taskbar_hide），
     * Windows 任务栏自动隐藏宿主尚未实现，如实返回不支持
     */
    setTaskbarAutoHide(autoHide: boolean, hostOverride?: TaskbarHostOverride): Promise<TaskbarActionResult>;
    /**
     * 切换任务栏 / macOS Dock 自动隐藏 (Toggle Taskbar / Dock Auto-Hide)
     */
    toggleTaskbarAutoHide(hostOverride?: TaskbarHostOverride): Promise<TaskbarActionResult>;
    /**
     * 设置任务栏对齐方式 (Windows 11 TaskbarAl)：宿主尚未提供写注册表的能力，如实返回不支持，不改动保存的状态
     */
    setTaskbarAlignment(alignment: TaskbarAlignment): Promise<TaskbarActionResult>;
    /**
     * 设置任务栏 / macOS Dock 停靠位置：宿主只支持 macOS Dock 的底部 / 左侧 / 右侧，结果以宿主返回为准
     */
    setTaskbarPosition(position: TaskbarPosition, hostOverride?: TaskbarHostOverride): Promise<TaskbarActionResult>;
    /**
     * 设置 macOS Dock 屏幕停靠位置 (Bottom / Left / Right)
     */
    setDockPosition(position: "bottom" | "left" | "right", hostOverride?: TaskbarHostOverride): Promise<TaskbarActionResult>;
    /**
     * 重启 macOS 程序坞 (killall Dock)，结果以宿主返回为准
     */
    restartDock(hostOverride?: TaskbarHostOverride): Promise<TaskbarActionResult>;
    /**
     * 重启桌面壳层：macOS 重启 Dock；Windows 重启资源管理器宿主尚未实现，如实返回不支持
     */
    restartExplorer(hostOverride?: TaskbarHostOverride): Promise<TaskbarActionResult>;
}
export declare const defaultWindowsTaskbarManager: WindowsTaskbarManager;
/** 供界面层统一展示的 Toast 文案：失败时标题为 message，详情为宿主原始原因（与 message 相同则省略） */
export declare function describeTaskbarFailure(res: TaskbarActionResult): string | undefined;
