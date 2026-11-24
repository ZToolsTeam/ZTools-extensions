export interface ProcessInfo {
    pid: number;
    name: string;
    cpuPercent: number;
    memoryMB: number;
    user: string;
    threads: number;
    path: string;
    commandLine: string;
    status: "running" | "suspended";
    arch?: "x64" | "x86" | "arm64";
    isSystemCritical?: boolean;
    pinyin?: string;
}
export type ProcessSortBy = "memory" | "cpu" | "name" | "pid";
export type KillMode = "graceful" | "force" | "tree";
export declare const CRITICAL_PROCESSES: Set<string>;
/**
 * 判断是否为系统高危关键进程 (保护防误杀，含 Windows PID 0/4 与 macOS launchd PID 1)
 */
export declare function isSystemCriticalProcess(nameOrPid: string | number): boolean;
export type KillCommandPlatform = "win32" | "posix";
export interface KillCommandOptions {
    /** 目标进程所在的平台：win32 用 taskkill，darwin / linux 等用 kill / pkill；缺省按当前运行平台 */
    platform?: string;
}
/**
 * 根据可执行文件路径推断进程所属平台：盘符或 UNC 路径为 win32，以 / 开头为 darwin；无法判断时返回 undefined
 */
export declare function inferProcessPlatform(filePath?: string): string | undefined;
/**
 * 构建进程终止命令行 (Windows taskkill 与 macOS/POSIX kill/pkill)。
 * 第三个参数可传布尔值（true = POSIX，兼容旧调用）或 { platform }，便于测试与按进程路径展示。
 */
export declare function getKillCommandLine(pid: number, mode: KillMode, option?: boolean | KillCommandOptions): string;
/**
 * 从真实宿主拉取系统进程列表 (支持 ProcessMonitorPlugin 与 process_list 兜底)
 */
export declare function fetchRealProcesses(hostOverride?: any): Promise<ProcessInfo[]>;
type TerminateResult = {
    success: boolean;
    command: string;
    error?: string;
    message: string;
};
/** 测试注入的假宿主（方法名 → 实现），或带 dllplugin.call 的旧宿主对象；透传给 callHostTransport */
type KillProcessHost = Record<string, unknown>;
/**
 * 终结进程服务 (含高危防误杀拦截、宿主真实进程终结与状态返回)。
 *
 * 通道顺序：
 * 1. 宿主注入的 terminateProcess（process_terminate_pid，带插件身份，宿主内做保护名单与 pid 复用校验）；
 * 2. 直接调用 process_terminate_pid（宿主会校验调用方是否有 process 权限）；
 * 3. Windows 旧 DLL（ProcessMonitorPlugin.TerminateProcessByPID），内层失败如实返回。
 * 没有任何宿主时返回 success:false，不会假装成功。
 */
export declare function terminateProcess(proc: ProcessInfo | {
    pid: number;
    name: string;
    path?: string;
}, mode?: KillMode, allowCriticalKill?: boolean, hostOverride?: KillProcessHost, options?: KillCommandOptions): Promise<TerminateResult>;
/**
 * 在资源管理器 / 访达中定位可执行文件（shell_show_item_in_folder），按宿主返回判断成败
 */
export declare function revealProcessInExplorer(filePath: string, hostOverride?: KillProcessHost): Promise<boolean>;
export declare const SAMPLE_PROCESSES: ProcessInfo[];
export declare function filterAndSortProcesses(processes: ProcessInfo[], query: string, sortBy?: ProcessSortBy): ProcessInfo[];
export {};
