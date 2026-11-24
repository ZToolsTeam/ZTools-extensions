import { WindowsRunItem, WindowsRunItemKind, RunHistoryRecord, ExecuteRunOptions, CommandLineParsed, RunExecutionResult } from "./types.js";
/**
 * 运行输入的识别规则：环境变量、URI 协议头
 */
export declare const RUN_REGEX: {
    envVarFull: RegExp;
    envVarShort: RegExp;
    uri: RegExp;
    rootedPath: RegExp;
    envVarPath: RegExp;
    executableExt: RegExp;
    executableWithArgs: RegExp;
    cpl: RegExp;
    msc: RegExp;
    exe: RegExp;
};
export declare const RUN_KIND_LABELS: Record<WindowsRunItemKind, string>;
export declare const RUN_KIND_ICONS: Record<WindowsRunItemKind, string>;
/**
 * 命令行解析器
 * 支持双引号包裹、URI 协议头、环境变量、路径参数及通用命令参数解析
 */
export declare function parseCommandLine(raw: string): CommandLineParsed;
export declare function detectKind(cmd: string): WindowsRunItemKind;
/**
 * 35+ 款高频 Windows 极客运行指令全景库（含 System32、治理 MSC、控制面板 CPL、常用开发终端）
 */
export declare const BUILTIN_RUN_ITEMS: readonly WindowsRunItem[];
export declare class WindowsRunManager {
    /** 测试注入的假宿主；缺省走真实宿主通道 */
    private readonly hostOverride;
    private historyCache;
    private pathExecutablesCache;
    private pathCacheTimestamp;
    constructor(options?: {
        hostOverride?: unknown;
    });
    getHistory(): Promise<RunHistoryRecord[]>;
    recordExecution(command: string, args?: string, options?: {
        asAdmin?: boolean;
        shell?: string;
    }): Promise<RunHistoryRecord>;
    deleteHistoryItem(id: string): Promise<boolean>;
    clearHistory(): Promise<void>;
    /**
     * 搜索运行命令与可执行文件
     */
    search(query: string): Promise<{
        items: WindowsRunItem[];
        historyMatches: RunHistoryRecord[];
        directItem?: WindowsRunItem | undefined;
    }>;
    /**
     * 执行指令流水线
     */
    execute(commandOrCommandLine: string, options?: ExecuteRunOptions): Promise<RunExecutionResult>;
}
export declare const defaultWindowsRunManager: WindowsRunManager;
