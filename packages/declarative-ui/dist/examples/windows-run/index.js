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
import React from "../../index.js";
import { List, ActionPanel, Action, Icon, showToast, Toast, Clipboard } from "../../index.js";
import { useState, useMemo, useEffect } from "../../runtime/hooks.js";
import { defaultWindowsRunManager, parseCommandLine } from "./run-service.js";
export * from "./types.js";
export * from "./run-service.js";
export default function WindowsRunCommand() {
    const [searchText, setSearchText] = useState("");
    const [history, setHistory] = useState([]);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    useEffect(() => {
        let active = true;
        defaultWindowsRunManager.getHistory().then((h) => {
            if (active)
                setHistory(h);
        });
        return () => {
            active = false;
        };
    }, [refreshTrigger]);
    const reloadHistory = () => {
        setRefreshTrigger((prev) => prev + 1);
    };
    const handleExecute = async (cmdLine, options = {}) => {
        const raw = cmdLine.trim();
        if (!raw) {
            await showToast(Toast.Style.Failure, "请输入需要执行的命令");
            return;
        }
        try {
            const res = await defaultWindowsRunManager.execute(raw, options);
            if (res.success) {
                await showToast(Toast.Style.Success, res.message, options.asAdministrator ? "管理员特权启动" : options.shell ? `终端: ${options.shell.toUpperCase()}` : "");
                reloadHistory();
            }
            else {
                await showToast(Toast.Style.Failure, "执行失败", res.error || res.message);
            }
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "执行命令异常", err.message || String(err));
        }
    };
    const handleCopy = async (cmdLine) => {
        await Clipboard.copy(cmdLine);
        await showToast(Toast.Style.Success, "已复制命令到剪贴板", cmdLine);
    };
    const handleClearHistory = async () => {
        await defaultWindowsRunManager.clearHistory();
        setHistory([]);
        await showToast(Toast.Style.Success, "运行历史已清空");
    };
    const handleDeleteHistoryItem = async (id) => {
        await defaultWindowsRunManager.deleteHistoryItem(id);
        reloadHistory();
        await showToast(Toast.Style.Success, "已从历史记录中移除");
    };
    // 搜索与过滤逻辑
    const query = searchText.trim();
    const parsed = useMemo(() => parseCommandLine(query), [query]);
    const searchData = useMemo(() => {
        const lower = query.toLowerCase();
        // 1. 匹配历史
        const matchedHistory = history.filter((h) => h.fullCommandLine.toLowerCase().includes(lower) ||
            h.command.toLowerCase().includes(lower));
        return {
            matchedHistory
        };
    }, [query, history]);
    // 构建动作面板
    const renderActionPanel = (cmdLine, historyId) => (React.createElement(ActionPanel, { title: `运行: ${cmdLine}` },
        React.createElement(Action, { title: "\u8FD0\u884C (Run)", icon: Icon.Play, onAction: () => handleExecute(cmdLine, { shell: "none" }) }),
        React.createElement(Action, { title: "\u4EE5\u7BA1\u7406\u5458\u8EAB\u4EFD\u8FD0\u884C (Run as Administrator)", icon: Icon.Shield, shortcut: { modifiers: ["ctrl", "shift"], key: "enter" }, onAction: () => handleExecute(cmdLine, { asAdministrator: true }) }),
        React.createElement(Action, { title: "\u5728 PowerShell \u4E2D\u8FD0\u884C (Run in PowerShell)", icon: Icon.Terminal, shortcut: { modifiers: ["ctrl"], key: "p" }, onAction: () => handleExecute(cmdLine, { shell: "powershell" }) }),
        React.createElement(Action, { title: "\u5728 CMD \u4E2D\u8FD0\u884C (Run in CMD)", icon: Icon.Terminal, shortcut: { modifiers: ["ctrl"], key: "c" }, onAction: () => handleExecute(cmdLine, { shell: "cmd" }) }),
        React.createElement(Action, { title: "\u590D\u5236\u5B8C\u6574\u547D\u4EE4 (Copy Command)", icon: Icon.Clipboard, shortcut: { modifiers: ["ctrl"], key: "y" }, onAction: () => handleCopy(cmdLine) }),
        historyId && (React.createElement(Action, { title: "\u4ECE\u5386\u53F2\u8BB0\u5F55\u5220\u9664", icon: Icon.Trash, onAction: () => handleDeleteHistoryItem(historyId) })),
        history.length > 0 && (React.createElement(Action, { title: "\u6E05\u7A7A\u8FD0\u884C\u5386\u53F2 (Clear Run History)", icon: Icon.Trash, shortcut: { modifiers: ["ctrl", "shift"], key: "x" }, onAction: handleClearHistory }))));
    return (React.createElement(List, { searchBarPlaceholder: "\u8F93\u5165\u547D\u4EE4\u6216\u8DEF\u5F84 (\u5982 ping 1.1.1.1, code ., regedit, ncpa.cpl)...", onSearchTextChange: setSearchText },
        query.length > 0 && (React.createElement(List.Section, { title: "\u6267\u884C\u8F93\u5165\u6307\u4EE4" },
            React.createElement(List.Item, { key: `direct-${query}`, title: query, subtitle: parsed.arguments
                    ? `命令: ${parsed.command} | 参数: ${parsed.arguments}`
                    : `直接运行命令: ${parsed.command}`, accessories: [{ text: parsed.kind.toUpperCase() }], actions: renderActionPanel(query) }))),
        searchData.matchedHistory.length > 0 && (React.createElement(List.Section, { title: "\u6700\u8FD1\u8FD0\u884C\u5386\u53F2 (Recent History)" }, searchData.matchedHistory.map((item) => (React.createElement(List.Item, { key: item.id, title: item.fullCommandLine, subtitle: item.runCount > 1
                ? `运行 ${item.runCount} 次 • ${new Date(item.executedAt).toLocaleTimeString()}`
                : `最近执行 • ${new Date(item.executedAt).toLocaleTimeString()}`, accessories: [
                ...(item.asAdmin ? [{ text: "ADMIN" }] : []),
                ...(item.shell ? [{ text: item.shell.toUpperCase() }] : []),
                { text: "历史" }
            ], actions: renderActionPanel(item.fullCommandLine, item.id) }))))),
        React.createElement(List.Section, { title: "\u7CFB\u7EDF\u7BA1\u7406\u4E0E\u63A7\u5236\u53F0 (System & Management)" },
            React.createElement(List.Item, { key: "item-regedit", title: "regedit", subtitle: "\u6CE8\u518C\u8868\u7F16\u8F91\u5668 (Registry Editor)", accessories: [{ text: "系统管理" }], actions: renderActionPanel("regedit.exe") }),
            React.createElement(List.Item, { key: "item-taskmgr", title: "taskmgr", subtitle: "\u4EFB\u52A1\u7BA1\u7406\u5668 (Task Manager)", accessories: [{ text: "系统管理" }], actions: renderActionPanel("taskmgr.exe") }),
            React.createElement(List.Item, { key: "item-services", title: "services.msc", subtitle: "\u7CFB\u7EDF\u540E\u53F0\u670D\u52A1\u7BA1\u7406 (Windows Services)", accessories: [{ text: "MMC 控制台" }], actions: renderActionPanel("services.msc") }),
            React.createElement(List.Item, { key: "item-gpedit", title: "gpedit.msc", subtitle: "\u672C\u5730\u7EC4\u7B56\u7565\u7F16\u8F91\u5668 (Group Policy)", accessories: [{ text: "MMC 控制台" }], actions: renderActionPanel("gpedit.msc") }),
            React.createElement(List.Item, { key: "item-compmgmt", title: "compmgmt.msc", subtitle: "\u8BA1\u7B97\u673A\u7BA1\u7406\u4E2D\u67A2 (Computer Management)", accessories: [{ text: "MMC 控制台" }], actions: renderActionPanel("compmgmt.msc") }),
            React.createElement(List.Item, { key: "item-devmgmt", title: "devmgmt.msc", subtitle: "\u8BBE\u5907\u7BA1\u7406\u5668\u9A71\u52A8\u6CBB\u7406 (Device Manager)", accessories: [{ text: "MMC 控制台" }], actions: renderActionPanel("devmgmt.msc") }),
            React.createElement(List.Item, { key: "item-dxdiag", title: "dxdiag", subtitle: "DirectX \u8BCA\u65AD\u786C\u4EF6\u5DE5\u5177", accessories: [{ text: "硬件诊断" }], actions: renderActionPanel("dxdiag.exe") }),
            React.createElement(List.Item, { key: "item-cleanmgr", title: "cleanmgr", subtitle: "\u78C1\u76D8\u5783\u573E\u6E05\u7406\u5DE5\u5177 (Disk Cleanup)", accessories: [{ text: "磁盘清理" }], actions: renderActionPanel("cleanmgr.exe") }),
            React.createElement(List.Item, { key: "item-perfmon", title: "perfmon", subtitle: "\u6027\u80FD\u76D1\u89C6\u5668 (Performance Monitor)", accessories: [{ text: "性能诊断" }], actions: renderActionPanel("perfmon.exe") }),
            React.createElement(List.Item, { key: "item-msconfig", title: "msconfig", subtitle: "\u7CFB\u7EDF\u5F15\u5BFC\u914D\u7F6E\u4E0E\u542F\u52A8\u9879 (System Configuration)", accessories: [{ text: "引导配置" }], actions: renderActionPanel("msconfig.exe") })),
        React.createElement(List.Section, { title: "\u63A7\u5236\u9762\u677F\u4E13\u9879 (Control Panel Applets)" },
            React.createElement(List.Item, { key: "item-ncpa", title: "ncpa.cpl", subtitle: "\u7F51\u7EDC\u8FDE\u63A5\u4E0E\u7F51\u5361\u9002\u914D\u5668\u7BA1\u7406", accessories: [{ text: "CPL 插件" }], actions: renderActionPanel("ncpa.cpl") }),
            React.createElement(List.Item, { key: "item-sysdm", title: "sysdm.cpl", subtitle: "\u7CFB\u7EDF\u5C5E\u6027\u4E0E\u73AF\u5883\u53D8\u91CF\u8BBE\u7F6E", accessories: [{ text: "CPL 插件" }], actions: renderActionPanel("sysdm.cpl") }),
            React.createElement(List.Item, { key: "item-appwiz", title: "appwiz.cpl", subtitle: "\u7A0B\u5E8F\u548C\u529F\u80FD (\u8F6F\u4EF6\u5378\u8F7D\u7BA1\u7406)", accessories: [{ text: "CPL 插件" }], actions: renderActionPanel("appwiz.cpl") }),
            React.createElement(List.Item, { key: "item-firewall", title: "firewall.cpl", subtitle: "Windows \u9632\u706B\u5899\u5B89\u5168\u8BBE\u7F6E", accessories: [{ text: "CPL 插件" }], actions: renderActionPanel("firewall.cpl") })),
        React.createElement(List.Section, { title: "\u7EC8\u7AEF\u4E0E\u5F00\u53D1\u73AF\u5883 (Terminals & Developer)" },
            React.createElement(List.Item, { key: "item-cmd", title: "cmd", subtitle: "\u547D\u4EE4\u63D0\u793A\u7B26 (Command Prompt)", accessories: [{ text: "CLI 终端" }], actions: renderActionPanel("cmd.exe") }),
            React.createElement(List.Item, { key: "item-powershell", title: "powershell", subtitle: "PowerShell \u73B0\u4EE3\u7EC8\u7AEF", accessories: [{ text: "CLI 终端" }], actions: renderActionPanel("powershell.exe") }),
            React.createElement(List.Item, { key: "item-wt", title: "wt", subtitle: "Windows \u5B98\u65B9\u73B0\u4EE3\u7EC8\u7AEF (Windows Terminal)", accessories: [{ text: "CLI 终端" }], actions: renderActionPanel("wt.exe") }),
            React.createElement(List.Item, { key: "item-code", title: "code .", subtitle: "\u5728\u5F53\u524D\u76EE\u5F55\u6253\u5F00 VS Code", accessories: [{ text: "代码开发" }], actions: renderActionPanel("code .") }))));
}
