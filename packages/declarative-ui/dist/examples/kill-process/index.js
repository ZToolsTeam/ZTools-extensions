import React from "../../index.js";
import { List, Detail, ActionPanel, Action, Icon, Color, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useEffect } from "../../runtime/hooks.js";
import { isRealElectronHost } from "../shared/native-ipc.js";
import { SAMPLE_PROCESSES, fetchRealProcesses, filterAndSortProcesses, isSystemCriticalProcess, getKillCommandLine, inferProcessPlatform, terminateProcess, revealProcessInExplorer } from "./process-manager.js";
export * from "./process-manager.js";
/**
 * 进程详细监控视图 (极客双栏/独立详情视图)
 */
export function ProcessDetailView({ process, onKilled }) {
    const { pop } = useNavigation();
    const isCritical = process.isSystemCritical || isSystemCriticalProcess(process.name) || isSystemCriticalProcess(process.pid);
    // 命令按进程所在平台展示（由可执行文件路径推断，推断不出时按当前运行平台）
    const platform = inferProcessPlatform(process.path);
    const gracefulCmd = getKillCommandLine(process.pid, "graceful", { platform });
    const forceCmd = getKillCommandLine(process.pid, "force", { platform });
    const treeCmd = getKillCommandLine(process.pid, "tree", { platform });
    const markdown = `
# 进程详情: ${process.name} (PID: ${process.pid})

> **用户**: \`${process.user}\` | **状态**: \`${process.status.toUpperCase()}\` | **活动线程**: \`${process.threads}\` | **架构**: \`${process.arch || "x64"}\`

${isCritical
        ? `> [高危警告] **系统关键高危进程**: 该进程属于系统核心守护子系统 (Windows Kernel / macOS launchd & WindowServer)。若强行终结可能导致系统假死、桌面崩溃重启或内核宕机！\n`
        : ""}

---

### 资源占用规格
- **工作集物理内存**: \`${process.memoryMB.toFixed(1)} MB\` (${(process.memoryMB / 1024).toFixed(2)} GB)
- **CPU 即时占用率**: \`${process.cpuPercent.toFixed(1)}%\`
- **系统核心保护**: ${isCritical ? "已开启防护 (禁止误杀)" : "普通应用进程"}

---

### 可执行文件路径与启动指令
\`\`\`powershell
# 可执行文件完整路径
${process.path}

# 进程完整启动命令行
${process.commandLine}

# 优雅终结指令 (SIGTERM)
${gracefulCmd}

# 强制终结指令 (Kill -9)
${forceCmd}

# 级联终结进程树指令 (/T / pkill -P)
${treeCmd}
\`\`\`
  `;
    const handleExecuteKill = async (mode, allowCritical = false) => {
        const res = await terminateProcess(process, mode, allowCritical);
        if (!res.success) {
            await showToast(Toast.Style.Failure, "操作已拦截", res.message);
            return;
        }
        onKilled?.(process.pid);
        await showToast(Toast.Style.Success, "进程已终结", res.message);
        pop();
    };
    const handleReveal = async () => {
        const ok = await revealProcessInExplorer(process.path);
        if (ok) {
            await showToast(Toast.Style.Success, "已在资源管理器中定位", process.path);
        }
        else {
            await showToast(Toast.Style.Failure, "无法打开资源管理器", process.path);
        }
    };
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `${process.name} [PID: ${process.pid}]`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u8FDB\u7A0B\u6807\u8BC6 (PID)", text: String(process.pid), icon: Icon.Key }),
            React.createElement(Detail.Metadata.Label, { title: "CPU \u5360\u7528\u7387", text: `${process.cpuPercent.toFixed(1)}%`, icon: Icon.Clock }),
            React.createElement(Detail.Metadata.Label, { title: "\u5185\u5B58\u5360\u7528", text: `${process.memoryMB.toFixed(1)} MB`, icon: Icon.Document }),
            React.createElement(Detail.Metadata.Label, { title: "\u8FD0\u884C\u7528\u6237", text: process.user, icon: Icon.Pencil }),
            React.createElement(Detail.Metadata.Label, { title: "\u7EBF\u7A0B\u6570\u91CF", text: String(process.threads), icon: Icon.Pin }),
            React.createElement(Detail.Metadata.Label, { title: "\u4F53\u7CFB\u67B6\u6784", text: process.arch || "x64", icon: Icon.Gear }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.TagList, { title: "\u8FDB\u7A0B\u5B89\u5168\u72B6\u6001" },
                isCritical ? (React.createElement(Detail.Metadata.TagList.Item, { text: "\u7CFB\u7EDF\u6838\u5FC3\u4FDD\u62A4", color: Color.Red })) : (React.createElement(Detail.Metadata.TagList.Item, { text: "\u5E38\u89C4\u5E94\u7528\u8FDB\u7A0B", color: Color.SecondaryText })),
                React.createElement(Detail.Metadata.TagList.Item, { text: process.cpuPercent > 15 ? "高 CPU 负载" : "正常负载", color: process.cpuPercent > 15 ? Color.Red : Color.SecondaryText }))), actions: React.createElement(ActionPanel, { title: `进程操作: ${process.name} (PID: ${process.pid})` },
            React.createElement(Action, { title: "\u5E73\u7F13\u7EC8\u7ED3\u8FDB\u7A0B (Kill Process)", icon: Icon.Trash, onAction: () => handleExecuteKill("graceful") }),
            React.createElement(Action, { title: "\u5F3A\u5236\u7EC8\u6B62 (Force Kill -9)", icon: Icon.XMarkCircle, shortcut: { modifiers: ["ctrl"], key: "return" }, onAction: () => handleExecuteKill("force") }),
            React.createElement(Action, { title: "\u7EC8\u7ED3\u5B8C\u6574\u8FDB\u7A0B\u6811 (Kill Process Tree)", icon: Icon.Trash, shortcut: { modifiers: ["ctrl", "shift"], key: "backspace" }, onAction: () => handleExecuteKill("tree") }),
            React.createElement(Action, { title: "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D (Show in Explorer)", icon: Icon.Folder, shortcut: { modifiers: ["ctrl"], key: "o" }, onAction: handleReveal }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 PID", content: String(process.pid), icon: Icon.Key }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u53EF\u6267\u884C\u6587\u4EF6\u5B8C\u6574\u8DEF\u5F84", content: process.path, icon: Icon.Document }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5F3A\u5236\u7EC8\u6B62\u547D\u4EE4 (taskkill)", content: forceCmd, icon: Icon.CopyClipboard })) }));
}
/**
 * 系统级进程管理急救箱主命令
 */
export default function KillProcessCommand() {
    const [processes, setProcesses] = useState(() => isRealElectronHost() ? [] : SAMPLE_PROCESSES);
    const [isLoading, setIsLoading] = useState(() => isRealElectronHost());
    const [sortBy, setSortBy] = useState("memory");
    const [searchText, setSearchText] = useState("");
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [selectedId, setSelectedId] = useState(null);
    const { push } = useNavigation();
    useEffect(() => {
        let active = true;
        const hasCustomHost = Boolean(globalThis.window?.ztools?.dllplugin?.call ||
            globalThis.ztools?.dllplugin?.call);
        if (!isRealElectronHost() && !hasCustomHost) {
            return () => {
                active = false;
            };
        }
        let inFlight = false;
        const syncProcesses = async () => {
            if (inFlight || !active)
                return;
            inFlight = true;
            try {
                const list = await fetchRealProcesses();
                if (active && (list.length > 0 || isRealElectronHost())) {
                    setProcesses(list);
                    setIsLoading(false);
                }
            }
            finally {
                if (active)
                    setIsLoading(false);
                inFlight = false;
            }
        };
        void syncProcesses();
        if (!autoRefresh) {
            return () => {
                active = false;
            };
        }
        const timer = setInterval(() => {
            void syncProcesses();
        }, 2000);
        if (typeof timer?.unref === "function") {
            timer.unref();
        }
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [autoRefresh]);
    const sortedList = filterAndSortProcesses(processes, searchText, sortBy);
    const activeProcess = sortedList.find((p) => `proc_${p.pid}` === selectedId || String(p.pid) === selectedId) ||
        sortedList[0];
    const handleKill = async (proc, mode = "force") => {
        const isCritical = proc.isSystemCritical || isSystemCriticalProcess(proc.name);
        if (isCritical) {
            await showToast(Toast.Style.Failure, "系统关键进程受安全保护", `拒绝终结 ${proc.name} (PID: ${proc.pid})，以防系统崩溃`);
            return;
        }
        const res = await terminateProcess(proc, mode, false);
        if (res.success) {
            setProcesses(prev => prev.filter(p => p.pid !== proc.pid));
            await showToast(Toast.Style.Success, res.message, `已释放 ${proc.memoryMB.toFixed(1)} MB 内存`);
        }
        else {
            await showToast(Toast.Style.Failure, "终止失败", res.message);
        }
    };
    const handleReveal = async (proc) => {
        const ok = await revealProcessInExplorer(proc.path);
        if (ok) {
            await showToast(Toast.Style.Success, "已在资源管理器中定位", proc.path);
        }
        else {
            await showToast(Toast.Style.Failure, "无法定位可执行文件", proc.path);
        }
    };
    const handleRefresh = async () => {
        const hasCustomHost = Boolean(globalThis.window?.ztools?.dllplugin?.call ||
            globalThis.ztools?.dllplugin?.call);
        if (isRealElectronHost() || hasCustomHost) {
            const list = await fetchRealProcesses();
            setProcesses(list);
            await showToast(Toast.Style.Success, "进程列表已刷新", `当前活跃进程: ${list.length}`);
            return;
        }
        await showToast(Toast.Style.Success, "进程列表已刷新", `当前活跃进程: ${processes.length}`);
    };
    const totalMemory = sortedList.reduce((acc, cur) => acc + cur.memoryMB, 0);
    return (React.createElement(List, { isLoading: isLoading, navigationTitle: "\u8FDB\u7A0B\u7BA1\u7406\u6025\u6551\u7BB1", searchBarPlaceholder: "\u641C\u7D22\u8FDB\u7A0B\u540D\u3001PID\u3001\u62FC\u97F3 (\u5982 guge / weiruan / ziyuan) \u6216\u53EF\u6267\u884C\u8DEF\u5F84...", searchText: searchText, onSearchTextChange: setSearchText, onSelectionChange: setSelectedId, filterBar: {
            summaryText: `实时活动进程 ${sortedList.length} 个 · 物理内存合计 ${(totalMemory / 1024).toFixed(2)} GB · ${autoRefresh ? "2s 自动监控中" : "已暂停监控"}`,
            actions: [
                {
                    id: "toggle-auto-refresh",
                    label: autoRefresh ? "暂停自动刷新" : "开启自动刷新",
                    style: "secondary",
                    onAction: () => {
                        setAutoRefresh(prev => !prev);
                    }
                },
                {
                    id: "refresh-proc",
                    label: "立即刷新",
                    style: "secondary",
                    onAction: () => {
                        void handleRefresh();
                    }
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6392\u5E8F\u6307\u6807", value: sortBy, onChange: newVal => setSortBy(newVal) },
            React.createElement(List.Dropdown.Item, { title: "\u6309\u5185\u5B58\u5360\u7528\u964D\u5E8F (Memory)", value: "memory" }),
            React.createElement(List.Dropdown.Item, { title: "\u6309 CPU \u5360\u7528\u7387\u964D\u5E8F (CPU)", value: "cpu" }),
            React.createElement(List.Dropdown.Item, { title: "\u6309\u8FDB\u7A0B\u540D\u79F0\u6392\u5E8F (Name)", value: "name" }),
            React.createElement(List.Dropdown.Item, { title: "\u6309 PID \u5347\u5E8F (PID)", value: "pid" })), actions: React.createElement(ActionPanel, { title: "\u5168\u5C40\u64CD\u4F5C" },
            React.createElement(Action, { title: "\u5237\u65B0\u7CFB\u7EDF\u8FDB\u7A0B (Refresh List)", icon: Icon.Repeat, onAction: handleRefresh }),
            React.createElement(Action, { title: autoRefresh ? "暂停 2s 自动刷新" : "恢复 2s 自动刷新", icon: autoRefresh ? Icon.Clock : Icon.Bolt, shortcut: { modifiers: ["ctrl", "shift"], key: "r" }, onAction: () => setAutoRefresh(prev => !prev) })) },
        React.createElement(List.Section, { title: `活动进程 (${sortedList.length})` }, sortedList.map(proc => {
            const isHighCpu = proc.cpuPercent >= 15;
            const isHighMem = proc.memoryMB >= 1000;
            const isCritical = proc.isSystemCritical || isSystemCriticalProcess(proc.name);
            return (React.createElement(List.Item, { key: proc.pid, id: `proc_${proc.pid}`, title: `${proc.name} [PID: ${proc.pid}]`, subtitle: `${proc.memoryMB.toFixed(1)} MB • CPU ${proc.cpuPercent.toFixed(1)}% • ${proc.threads} 线程 • ${proc.arch || "x64"}`, icon: isCritical ? Icon.Shield : isHighCpu ? Icon.ExclamationMark : Icon.Terminal, accessories: [
                    ...(isCritical ? [{ tag: { value: "系统关键" } }] : []),
                    ...(isHighMem ? [{ tag: { value: "高内存" } }] : []),
                    ...(isHighCpu ? [{ tag: { value: "高 CPU", color: Color.Red } }] : []),
                    { text: `${proc.memoryMB.toFixed(0)} MB` },
                    { text: `CPU ${proc.cpuPercent.toFixed(1)}%` }
                ], actions: React.createElement(ActionPanel, { title: `${proc.name} (PID: ${proc.pid})` },
                    React.createElement(Action, { title: "\u4F18\u96C5\u7EC8\u7ED3\u8FDB\u7A0B (Kill Process)", icon: Icon.Trash, onAction: () => handleKill(proc, "graceful") }),
                    React.createElement(Action, { title: "\u4E00\u952E\u5F3A\u5236\u7ED3\u675F\u8FDB\u7A0B", icon: Icon.XMarkCircle, style: Action.Style.Destructive, shortcut: { modifiers: ["ctrl"], key: "return" }, onAction: () => handleKill(proc, "force") }),
                    React.createElement(Action, { title: "\u7EC8\u7ED3\u8FDB\u7A0B\u6811 (Kill Process Tree)", icon: Icon.Trash, style: Action.Style.Destructive, shortcut: { modifiers: ["ctrl", "shift"], key: "backspace" }, onAction: () => handleKill(proc, "tree") }),
                    React.createElement(Action.Push, { title: "\u67E5\u770B\u8FDB\u7A0B\u8BE6\u60C5\u4E0E\u547D\u4EE4\u884C (Details)", icon: Icon.Eye, shortcut: { modifiers: ["ctrl"], key: "d" }, target: React.createElement(ProcessDetailView, { process: proc, onKilled: pid => setProcesses(prev => prev.filter(p => p.pid !== pid)) }) }),
                    React.createElement(Action, { title: "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D (Show in Explorer)", icon: Icon.Folder, shortcut: { modifiers: ["ctrl"], key: "o" }, onAction: () => handleReveal(proc) }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 PID", content: String(proc.pid), icon: Icon.Key, shortcut: { modifiers: ["ctrl"], key: "c" } }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u53EF\u6267\u884C\u6587\u4EF6\u5B8C\u6574\u8DEF\u5F84", content: proc.path, icon: Icon.Document, shortcut: { modifiers: ["ctrl", "shift"], key: "c" } }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 taskkill \u547D\u4EE4", content: `taskkill /F /PID ${proc.pid}`, icon: Icon.CopyClipboard }),
                    React.createElement(Action, { title: "\u5237\u65B0\u8FDB\u7A0B\u5217\u8868 (Refresh)", icon: Icon.Repeat, shortcut: { modifiers: ["ctrl"], key: "r" }, onAction: handleRefresh })) }));
        }))));
}
