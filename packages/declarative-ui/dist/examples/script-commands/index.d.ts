/**
 * Script Commands (极客自定义脚本命令工作台)
 *
 * 深度对齐 Raycast 官方 `script-commands` 规范：
 * - 100% 兼容 `@raycast.schemaVersion 1`、`@raycast.title`、`@raycast.mode` (`compact` | `fullOutput` | `inline` | `silent`)、`@raycast.packageName` 元数据注释解析
 * - 支持 Bash / Zsh / AppleScript / Python / Node.js / PowerShell 多语言脚本模板生成与一键执行
 * - 对接主进程 `script_commands_list`、`script_commands_execute`、`script_commands_create`、`script_commands_reload` IPC
 */
export type ScriptOutputMode = "compact" | "fullOutput" | "inline" | "silent";
export type ScriptRuntimeLanguage = "bash" | "zsh" | "applescript" | "python" | "node" | "powershell";
export interface ScriptCommandMetadata {
    readonly id: string;
    readonly title: string;
    readonly mode: ScriptOutputMode;
    readonly packageName: string;
    readonly description: string;
    readonly author?: string;
    readonly language: ScriptRuntimeLanguage;
    readonly filePath: string;
    readonly sourceCode: string;
    readonly lastOutput?: string;
    readonly lastRunAt?: number;
}
export declare const DEFAULT_SCRIPT_COMMANDS: readonly ScriptCommandMetadata[];
/**
 * 解析脚本头部的 `@raycast.*` 元数据注释
 */
export declare function parseRaycastScriptHeaders(sourceCode: string): {
    title: string;
    mode: ScriptOutputMode;
    packageName: string;
    description: string;
    schemaVersion: number;
};
/**
 * 根据语言与参数生成标准 `@raycast.*` 脚本模板源码
 */
export declare function buildScriptCommandTemplate(input: {
    title: string;
    mode?: ScriptOutputMode;
    packageName?: string;
    description?: string;
    language?: ScriptRuntimeLanguage;
    body?: string;
}): string;
export interface ScriptExecutionResult {
    readonly ok: boolean;
    readonly output: string;
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
    readonly durationMs: number;
    readonly executedAt: number;
}
/**
 * 加载脚本命令列表（对接 script_commands_list / script_commands_reload IPC）
 */
export declare function fetchScriptCommands(forceReload?: boolean, hostOverride?: any): Promise<ScriptCommandMetadata[]>;
/**
 * 执行指定脚本命令（对接 script_commands_execute IPC）
 */
export declare function executeScriptCommand(script: ScriptCommandMetadata | {
    id: string;
    filePath?: string;
    args?: string[];
}, hostOverride?: any): Promise<ScriptExecutionResult>;
/**
 * 从模板创建新脚本命令（对接 script_commands_create IPC）
 */
export declare function createScriptCommand(input: {
    title: string;
    mode?: ScriptOutputMode;
    packageName?: string;
    description?: string;
    language?: ScriptRuntimeLanguage;
    body?: string;
}, hostOverride?: any): Promise<ScriptCommandMetadata>;
export declare const parseScriptCommandMetadata: typeof parseRaycastScriptHeaders;
export declare const generateScriptCommandTemplate: typeof buildScriptCommandTemplate;
export declare const listScriptCommandsFromHost: typeof fetchScriptCommands;
export declare const runScriptCommandOnHost: typeof executeScriptCommand;
export declare const createScriptCommandOnHost: typeof createScriptCommand;
export declare function RunScriptWithArgsForm({ script, onExecuted }: {
    script: ScriptCommandMetadata;
    onExecuted?: (res: ScriptExecutionResult) => void;
}): JSX.Element;
export declare function CreateScriptCommandForm({ onCreated }: {
    onCreated?: (created: ScriptCommandMetadata) => void;
}): JSX.Element;
export declare function ScriptCommandOutputDetailView({ script, output, executionResult }: {
    script: ScriptCommandMetadata;
    output: string;
    executionResult?: ScriptExecutionResult;
}): JSX.Element;
export declare function ScriptCommandsCommand(): JSX.Element;
export default ScriptCommandsCommand;
