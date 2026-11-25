/**
 * Windows Run Dialog (极客运行中枢)
 *
 * 功能概览：
 * - 系统命令与可执行文件检索 (PATH / System32 / MSC / CPL)
 * - 命令参数化执行 (如 ping 1.1.1.1 或 code .)
 * - 运行历史记录入库与排序
 * - ActionPanel 动作集：
 *   - Run (普通启动)
 *   - Run as Administrator (提权以管理员身份运行)
 *   - Run in PowerShell (在 PowerShell 中执行并保持窗口)
 *   - Run in Command Prompt (CMD) (在 CMD 中执行)
 *   - Copy Command (复制完整命令行)
 *   - Clear Run History (清空运行历史)
 */
export * from "./types.js";
export * from "./run-service.js";
export default function WindowsRunCommand(): JSX.Element;
