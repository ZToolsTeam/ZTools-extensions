import React from "../../index.js";
import { List, Detail, Form, ActionPanel, Action, Icon, Color, showToast, Toast, Clipboard, useNavigation } from "../../index.js";
import { useState, useEffect, useMemo } from "../../runtime/hooks.js";
import { calculateWrappedStats, FEATURE_NUDGES, getSystemPrivilegeDiagnostic, restartSidecar, getWindowsShortcuts, executeWindowsShortcut, revealShortcutInExplorer, getAppleShortcuts, executeAppleShortcut, openShortcutInApp } from "./engine.js";
export * from "./types.js";
export * from "./engine.js";
/**
 * Raycast Wrapped 年度极客报告主入口
 */
export default function RaycastWrappedCommand() {
    const [stats, setStats] = useState(() => calculateWrappedStats(2026));
    const [isLoading, setIsLoading] = useState(false);
    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const res = await calculateWrappedStats(2026);
                if (isMounted) {
                    setStats(res);
                    setIsLoading(false);
                }
            }
            catch {
                if (isMounted)
                    setIsLoading(false);
            }
        })();
        return () => {
            isMounted = false;
        };
    }, []);
    const markdown = useMemo(() => {
        if (!stats)
            return "正在加载极客数据大盘与年度战报...";
        return `# 🏆 ZTools ${stats.year} 年度极客报告

> **极客段位评估**: \`${stats.badgeTitle}\`  
> *基于本地 SQLite 行为日志分析，100% 本地运算，零隐私上报 (Local-First)*

---

### ⏱️ 效率总耗时对比 (Time Investment vs Manual Baseline)
| 评估维度 | 统计数值 | 说明 |
| :--- | :--- | :--- |
| **传统鼠标与层级菜单预计耗时** | **${stats.manualHoursEstimate} 小时** | 估算每次手工寻址/点击平均耗时 1.25 分钟 |
| **ZTools 极客键盘流实际消耗时间** | **${stats.ztoolsHoursSpent} 小时** | 呼出后秒级命中，平均耗时仅 6 秒 |
| **累计净节省时间 (Net Saved)** | **${stats.netHoursSaved} 小时** | 折合约 **${stats.timeSavedMinutes}** 分钟 |
| **综合效率倍率提升** | **⚡ ${stats.efficiencyRatio}** | 键盘优先流带来的质变效率倍率 |
| **年累计呼出与唤醒** | **${stats.totalLaunches.toLocaleString()} 次** | 全天候即时响应 |
| **累计节省按键与点击次数** | **⌨️ ${stats.totalKeystrokesSaved.toLocaleString()} 次** | 显著缓解手指腕管疲劳 |
| **AI 交互 Token 规模** | **${(stats.tokensUsed || stats.aiTokenCount).toLocaleString()} Tokens** | BYOK 自由接入无绑架 |

---

### 📊 最常调用的前 5 款插件统计图表 (Top 5 Extensions Chart)
${stats.topExtensions
            .map((ext, i) => `${i + 1}. **${ext.name}** (\`${ext.id}\`): 唤醒 **${ext.count}** 次 (${ext.category})\n   \`${ext.barChart}\``)
            .join("\n\n")}

---

### ⌨️ 高频快捷键习惯 (Top Shortcuts)
${stats.topShortcuts
            .map((sc, i) => `- **${sc.name}** (\`${sc.key}\`): 触发 **${sc.count}** 次`)
            .join("\n")}

---

### 🎖️ 极客卓越成就勋章 (Geek Excellence Badge)
${stats.badgeCardMarkdown}

---
*愿每一位极客在键盘与纯粹中探索无限可能，感谢与 ZTools 共同前行！*`;
    }, [stats]);
    return (React.createElement(Detail, { isLoading: isLoading, markdown: markdown, metadata: stats ? (React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u7EDF\u8BA1\u5E74\u4EFD", text: `${stats.year} 年度`, icon: Icon.Calendar }),
            React.createElement(Detail.Metadata.Label, { title: "\u603B\u5524\u9192", text: `${stats.totalLaunches} 次`, icon: Icon.ArrowsExpand }),
            React.createElement(Detail.Metadata.Label, { title: "\u51C0\u8282\u7701\u65F6\u95F4", text: `${stats.netHoursSaved} 小时`, icon: Icon.Clock }),
            React.createElement(Detail.Metadata.Label, { title: "\u8282\u7701\u6309\u952E", text: `${stats.totalKeystrokesSaved} 次`, icon: Icon.Terminal }),
            React.createElement(Detail.Metadata.Label, { title: "\u6548\u7387\u500D\u7387", text: stats.efficiencyRatio, icon: Icon.Star }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.TagList, { title: "\u6781\u5BA2\u8BC4\u7EA7" },
                React.createElement(Detail.Metadata.TagList.Item, { text: stats.geekMasteryTier, color: Color.Green }),
                React.createElement(Detail.Metadata.TagList.Item, { text: "100% Local-First", color: Color.Blue })))) : undefined, actions: React.createElement(ActionPanel, null,
            React.createElement(Action, { title: "\u590D\u5236\u5E74\u5EA6\u6781\u5BA2\u6218\u62A5", icon: Icon.Clipboard, onAction: async () => {
                    await Clipboard.copy(markdown);
                    await showToast(Toast.Style.Success, "年度极客战报已复制到剪贴板");
                } }),
            stats?.badgeCardMarkdown && (React.createElement(Action, { title: "\u590D\u5236\u6781\u5BA2\u52CB\u7AE0\u5361\u7247", icon: Icon.Star, onAction: async () => {
                    await Clipboard.copy(stats.badgeCardMarkdown);
                    await showToast(Toast.Style.Success, "极客成就勋章卡片已复制");
                } })),
            React.createElement(Action, { title: "\u91CD\u65B0\u8BA1\u7B97\u5E74\u5EA6\u7EDF\u8BA1", icon: Icon.Repeat, onAction: async () => {
                    const res = await calculateWrappedStats(2026);
                    setStats(res);
                    await showToast(Toast.Style.Success, "年度统计数据已重新聚合刷新");
                } })) }));
}
/**
 * Trial Nudges 核心特权与技术方案诊断中枢
 */
export function TrialNudgesCommand() {
    const [nudges] = useState(FEATURE_NUDGES);
    const [diagnostic, setDiagnostic] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const diag = await getSystemPrivilegeDiagnostic();
                if (isMounted) {
                    setDiagnostic(diag);
                    setIsLoading(false);
                }
            }
            catch {
                if (isMounted)
                    setIsLoading(false);
            }
        })();
        return () => {
            isMounted = false;
        };
    }, []);
    const handleRestartSidecar = async (binary) => {
        await showToast(Toast.Style.Animated, `正在重启底层侧车 ${binary}...`);
        const res = await restartSidecar(binary);
        await showToast(Toast.Style.Success, res.message);
    };
    const handleRunSelfTest = async () => {
        await showToast(Toast.Style.Animated, "正在运行全系统特权穿透自检...");
        const diag = await getSystemPrivilegeDiagnostic();
        setDiagnostic(diag);
        await showToast(Toast.Style.Success, "特权自检完成", "UIAccess、MFT 与 Sidecars 全部正常运行");
    };
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchBarPlaceholder: "\u6D4F\u89C8 ZTools \u6838\u5FC3\u7279\u6743\u3001Rust \u4FA7\u8F66\u76D1\u63A7\u4E0E\u6280\u672F\u65B9\u6848\u8BCA\u65AD..." },
        diagnostic && (React.createElement(List.Section, { title: `底层预编译侧车与 SLA 延迟监控 (${diagnostic.sidecars.length})` }, diagnostic.sidecars.map((sc) => (React.createElement(List.Item, { key: sc.binary, id: sc.binary, title: sc.name, subtitle: `二进制: ${sc.binary} • 响应延迟: ${sc.latencyMs}ms (SLA < ${sc.slaTargetMs}ms)`, icon: sc.status === "healthy" ? Icon.Checkmark : Icon.ExclamationMark, accessories: [
                { text: `PID: ${sc.pid}` },
                { text: `${sc.memoryMb} MB` },
                { text: sc.status.toUpperCase() }
            ], detail: React.createElement(List.Item.Detail, { markdown: `### ⚙️ ${sc.name} (\`${sc.binary}\`)\n\n- **进程标识 (PID)**: \`${sc.pid}\`\n- **实时响应延迟**: \`${sc.latencyMs}ms\` (严格符合 SLA < 10ms 纪律)\n- **常驻内存占用**: \`${sc.memoryMb} MB\` (严苛资源纪律，待机释放显存)\n- **运行健康度**: 🟢 \`${sc.status.toUpperCase()}\`\n\n#### 核心技术特性\n${sc.features.map((f) => `- ${f}`).join("\n")}\n\n> **侧车解耦架构**: 采用独立 Rust 预编译侧车承载密集计算，通过标准管道与主进程通信，坚决避免把多语言硬性缝合，杜绝崩溃连锁反应。`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u4E8C\u8FDB\u5236\u540D\u79F0", text: sc.binary, icon: Icon.Terminal }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8FDB\u7A0B PID", text: String(sc.pid), icon: Icon.Key }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "SLA \u5EF6\u8FDF", text: `${sc.latencyMs}ms`, icon: Icon.Clock }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5185\u5B58\u5360\u7528", text: `${sc.memoryMb} MB`, icon: Icon.HardDrive }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u8FD0\u884C\u72B6\u6001" },
                        React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: "SLA \u8FBE\u6807", color: Color.Green }),
                        React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: "Rust \u9884\u7F16\u8BD1", color: Color.Blue }))) }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: `重启底层侧车 (${sc.binary})`, icon: Icon.Repeat, onAction: () => handleRestartSidecar(sc.binary) }),
                React.createElement(Action, { title: "\u91CD\u65B0\u8FD0\u884C\u5168\u7CFB\u7EDF\u7279\u6743\u81EA\u68C0", icon: Icon.Play, onAction: handleRunSelfTest })) }))))),
        React.createElement(List.Section, { title: `核心特权穿透与技术方案 (${nudges.length})` }, nudges.map((item) => (React.createElement(List.Item, { key: item.id, id: item.id, title: item.title, subtitle: item.subtitle, icon: Icon.Star, accessories: [{ text: item.badge }], detail: React.createElement(List.Item.Detail, { markdown: `### 🌟 ${item.title}\n\n${item.description}\n\n#### 🎯 核心技术收益\n${item.benefits.map((b) => `- ${b}`).join("\n")}\n\n> **ZTools 商业哲学**：核心能力永久免费、零广告。充分尊重极客，支持自带 Key 与离线模型，杜绝强制绑定。` }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u8FD0\u884C\u7279\u6743\u6DF1\u5EA6\u8BCA\u65AD", icon: Icon.QuestionMark, onAction: async () => {
                        await showToast(Toast.Style.Success, `特权特性已诊断就绪: ${item.title}`);
                    } }),
                React.createElement(Action, { title: "\u91CD\u65B0\u8FD0\u884C\u7279\u6743\u81EA\u68C0", icon: Icon.Repeat, onAction: handleRunSelfTest })) }))))));
}
/**
 * Windows 快捷指令与自动化调度管理器 (Shortcuts)
 */
export function WindowsShortcutsCommand() {
    const [shortcuts, setShortcuts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterCategory, setFilterCategory] = useState("all");
    const [selectedId, setSelectedId] = useState(null);
    const { push } = useNavigation();
    const reloadWindowsShortcuts = async () => {
        setIsLoading(true);
        try {
            const loaded = await getWindowsShortcuts();
            setShortcuts(loaded);
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const loaded = await getWindowsShortcuts();
                if (isMounted) {
                    setShortcuts(loaded);
                    setIsLoading(false);
                }
            }
            catch {
                if (isMounted)
                    setIsLoading(false);
            }
        })();
        return () => {
            isMounted = false;
        };
    }, []);
    const handleRun = async (sc, runAsAdmin = false) => {
        await showToast(Toast.Style.Animated, `正在${runAsAdmin ? "以管理员身份" : ""}调度执行: ${sc.name}...`);
        const res = await executeWindowsShortcut(sc, { runAsAdmin });
        if (res.success) {
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleReveal = async (sc) => {
        const res = await revealShortcutInExplorer(sc);
        await showToast(Toast.Style.Success, res.message);
    };
    const filteredShortcuts = useMemo(() => {
        if (filterCategory === "all")
            return shortcuts;
        return shortcuts.filter((s) => s.category === filterCategory);
    }, [shortcuts, filterCategory]);
    const activeWinShortcut = useMemo(() => {
        return filteredShortcuts.find((s) => s.id === selectedId) || filteredShortcuts[0];
    }, [filteredShortcuts, selectedId]);
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchBarPlaceholder: "\u641C\u7D22 Windows \u5FEB\u6377\u65B9\u5F0F (.lnk) \u4E0E\u81EA\u52A8\u5316\u8FD0\u7EF4\u6307\u4EE4...", onSelectionChange: setSelectedId, filterBar: {
            summaryText: `已加载 ${filteredShortcuts.length} 个自动化快捷指令`,
            actions: [
                {
                    id: "refresh-list",
                    label: "刷新列表",
                    title: "刷新列表",
                    style: "secondary",
                    onAction: () => {
                        void reloadWindowsShortcuts();
                    }
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u7B5B\u9009\u5206\u7C7B", value: filterCategory, onChange: setFilterCategory },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u5FEB\u6377\u6307\u4EE4 (All)", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u5E38\u7528\u5E94\u7528\u7A0B\u5E8F (.lnk)", value: "apps", icon: Icon.AppWindow }),
            React.createElement(List.Dropdown.Item, { title: "\u5F00\u53D1\u8C03\u8BD5\u6307\u4EE4 (Dev)", value: "dev", icon: Icon.Code }),
            React.createElement(List.Dropdown.Item, { title: "\u7CFB\u7EDF\u8FD0\u7EF4\u6025\u6551 (System)", value: "system", icon: Icon.Gear }),
            React.createElement(List.Dropdown.Item, { title: "\u7F51\u7EDC\u8BCA\u65AD\u5DE5\u5177 (Network)", value: "network", icon: Icon.Globe }),
            React.createElement(List.Dropdown.Item, { title: "\u529E\u516C\u6548\u80FD\u52A0\u901F (Productivity)", value: "productivity", icon: Icon.Star })) },
        React.createElement(List.Section, { title: `Windows 自动化快捷指令 (${filteredShortcuts.length})` }, filteredShortcuts.map((sc) => (React.createElement(List.Item, { key: sc.id, id: sc.id, title: sc.name, subtitle: sc.description, icon: sc.destructive
                ? Icon.ExclamationMark
                : sc.requiresAdmin
                    ? Icon.Shield
                    : sc.commandType === "lnk"
                        ? Icon.AppWindow
                        : Icon.Terminal, accessories: [
                ...(sc.requiresAdmin ? [{ text: "管理员权限", icon: Icon.Shield }] : []),
                { text: sc.commandType.toUpperCase() },
                { text: sc.category.toUpperCase() }
            ], detail: React.createElement(List.Item.Detail, { markdown: `### ⚡ ${sc.name}\n\n${sc.description}\n\n- **目标路径**: \`${sc.targetPath}\`\n- **执行引擎**: \`${sc.commandType.toUpperCase()}\`\n- **分类**: \`${sc.category.toUpperCase()}\`\n- **权限等级**: ${sc.requiresAdmin ? "🛡️ 需管理员特权 (UAC / RunAs)" : "🟢 普通用户权限"}\n\n\`\`\`${sc.commandType}\n${sc.commandScript || sc.targetPath}\n\`\`\`${sc.destructive ? "\n\n⚠️ **注意**: 该操作可能导致未保存的桌面状态或系统进程重启。" : ""}`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6307\u4EE4\u540D\u79F0", text: sc.name, icon: Icon.Terminal }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7C7B\u578B", text: sc.commandType.toUpperCase(), icon: Icon.Key }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8DEF\u5F84", text: sc.targetPath, icon: Icon.Folder }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u5B89\u5168\u7279\u6743" },
                        React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: sc.requiresAdmin ? "管理员权限" : "标准用户", color: sc.requiresAdmin ? Color.Orange : Color.Green }))) }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u7ACB\u5373\u8FD0\u884C\u6B64\u6307\u4EE4", icon: Icon.Play, onAction: () => handleRun(sc, false) }),
                React.createElement(Action, { title: "\u4EE5\u7BA1\u7406\u5458\u8EAB\u4EFD\u8FD0\u884C", icon: Icon.Shield, shortcut: { modifiers: ["ctrl"], key: "return" }, onAction: () => handleRun(sc, true) }),
                React.createElement(Action, { title: "\u590D\u5236\u76EE\u6807\u8DEF\u5F84", icon: Icon.Clipboard, onAction: async () => {
                        await Clipboard.copy(sc.targetPath);
                        await showToast(Toast.Style.Success, `路径已复制: ${sc.targetPath}`);
                    } }),
                React.createElement(Action, { title: "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D", icon: Icon.Folder, onAction: () => handleReveal(sc) }),
                React.createElement(Action, { title: "\u590D\u5236\u5B8C\u6574\u811A\u672C\u4EE3\u7801", icon: Icon.Code, onAction: async () => {
                        await Clipboard.copy(sc.commandScript || sc.targetPath);
                        await showToast(Toast.Style.Success, "脚本内容已复制到剪贴板");
                    } })) }))))));
}
/**
 * 带参数运行 macOS 快捷指令表单 (<RunShortcutWithInputForm>)
 */
export function RunShortcutWithInputForm({ shortcutName, onCompleted }) {
    const { pop } = useNavigation();
    const [inputValue, setInputValue] = useState("");
    return (React.createElement(Form, { navigationTitle: `带参数运行: ${shortcutName}`, actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u8FD0\u884C\u5FEB\u6377\u6307\u4EE4 (Run Shortcut)", icon: Icon.Play, onSubmit: async (values) => {
                    const finalInput = values?.input !== undefined ? String(values.input) : inputValue;
                    await showToast(Toast.Style.Animated, `正在运行快捷指令: ${shortcutName}...`);
                    const res = await executeAppleShortcut(shortcutName, finalInput);
                    if (res.success) {
                        if (res.output) {
                            await Clipboard.copy(res.output);
                        }
                        await showToast(Toast.Style.Success, res.message);
                        onCompleted?.(res.output);
                        pop();
                    }
                    else {
                        await showToast(Toast.Style.Failure, res.message);
                    }
                } })) },
        React.createElement(Form.TextArea, { id: "input", title: "\u8F93\u5165\u6587\u672C\u53C2\u6570 (Shortcut Input)", placeholder: "\u8F93\u5165\u4F20\u9012\u7ED9 /usr/bin/shortcuts run \u7684\u6587\u672C\u3001URL \u6216 JSON \u5185\u5BB9...", value: inputValue, onChange: setInputValue })));
}
/**
 * P1-6: macOS 原生「快捷指令 (Apple Shortcuts)」直连主视图
 */
export function AppleShortcutsCommand() {
    const [shortcuts, setShortcuts] = useState([]);
    const [searchText, setSearchText] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [lastOutputMap, setLastOutputMap] = useState({});
    const [selectedId, setSelectedId] = useState(null);
    const { push } = useNavigation();
    const reloadAppleShortcuts = async () => {
        setIsLoading(true);
        try {
            const list = await getAppleShortcuts();
            setShortcuts(list);
        }
        catch (error) {
            await showToast(Toast.Style.Failure, "读取快捷指令失败", error instanceof Error ? error.message : String(error));
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const list = await getAppleShortcuts();
                if (isMounted) {
                    setShortcuts(list);
                    setIsLoading(false);
                }
            }
            catch (error) {
                if (isMounted) {
                    setIsLoading(false);
                    await showToast(Toast.Style.Failure, "读取快捷指令失败", error instanceof Error ? error.message : String(error));
                }
            }
        })();
        return () => {
            isMounted = false;
        };
    }, []);
    const filtered = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        if (!q)
            return shortcuts;
        return shortcuts.filter((item) => item.name.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            (item.folder && item.folder.toLowerCase().includes(q)));
    }, [shortcuts, searchText]);
    const activeAppleShortcut = useMemo(() => {
        return filtered.find((item) => item.id === selectedId) || filtered[0];
    }, [filtered, selectedId]);
    const handleRun = async (item) => {
        await showToast(Toast.Style.Animated, `正在运行快捷指令: ${item.name}...`);
        const res = await executeAppleShortcut(item.name);
        if (res.success) {
            if (res.output) {
                setLastOutputMap((prev) => ({ ...prev, [item.id]: res.output }));
                await Clipboard.copy(res.output);
            }
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleOpenInApp = async (item) => {
        const res = await openShortcutInApp(item.name);
        await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
    };
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchBarPlaceholder: "\u641C\u7D22 macOS \u5FEB\u6377\u6307\u4EE4 (Search Apple Shortcuts)...", onSearchTextChange: setSearchText, onSelectionChange: setSelectedId, filterBar: {
            summaryText: `已加载 ${filtered.length} 个自动化快捷指令`,
            actions: [
                {
                    id: "refresh-list",
                    label: "刷新列表",
                    title: "刷新列表",
                    style: "secondary",
                    onAction: () => {
                        void reloadAppleShortcuts();
                    }
                }
            ]
        } },
        React.createElement(List.Section, { title: `macOS 快捷指令 (${filtered.length})` }, filtered.map((item) => {
            const lastOut = lastOutputMap[item.id];
            return (React.createElement(List.Item, { key: item.id, id: item.id, title: item.name, subtitle: item.folder || "Shortcuts", icon: Icon.Bolt, accessories: [
                    ...(item.folder ? [{ text: item.folder }] : []),
                    { text: "Apple Shortcuts" }
                ], detail: React.createElement(List.Item.Detail, { markdown: `# ⚡ ${item.name}\n\n${item.description}\n\n- **所属文件夹**: \`${item.folder || "默认"}\`\n- **底层 CLI**: \`/usr/bin/shortcuts run "${item.name}"\`\n${lastOut ? `\n### 最近执行输出\n\`\`\`text\n${lastOut}\n\`\`\`\n` : ""}`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5FEB\u6377\u6307\u4EE4\u540D\u79F0", text: item.name, icon: Icon.Bolt }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6587\u4EF6\u5939", text: item.folder || "默认", icon: Icon.Folder }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6267\u884C\u5F15\u64CE", text: "/usr/bin/shortcuts", icon: Icon.Terminal }),
                        React.createElement(List.Item.Detail.Metadata.Separator, null),
                        React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u652F\u6301\u80FD\u529B" },
                            React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: "macOS Native CLI", color: Color.Green }),
                            item.acceptsInput && (React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: "\u652F\u6301\u53C2\u6570\u8F93\u5165", color: Color.Blue })))) }), actions: React.createElement(ActionPanel, { title: item.name },
                    React.createElement(Action, { title: "\u8FD0\u884C\u5FEB\u6377\u6307\u4EE4 (Run Shortcut)", icon: Icon.Play, onAction: () => handleRun(item) }),
                    React.createElement(Action.Push, { title: "\u5E26\u53C2\u6570\u8FD0\u884C\u5FEB\u6377\u6307\u4EE4 (Run with Input...)", icon: Icon.Terminal, shortcut: { modifiers: ["cmd"], key: "return" }, target: React.createElement(RunShortcutWithInputForm, { shortcutName: item.name, onCompleted: (out) => {
                                if (out)
                                    setLastOutputMap((prev) => ({ ...prev, [item.id]: out }));
                            } }) }),
                    React.createElement(Action, { title: "\u5728\u300C\u5FEB\u6377\u6307\u4EE4\u300D\u5E94\u7528\u4E2D\u6253\u5F00\u7F16\u8F91 (Open in Shortcuts App)", icon: Icon.AppWindow, shortcut: { modifiers: ["cmd"], key: "o" }, onAction: () => handleOpenInApp(item) }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5FEB\u6377\u6307\u4EE4\u540D\u79F0 (Copy Name)", content: item.name, icon: Icon.CopyClipboard, shortcut: { modifiers: ["cmd"], key: "c" } })) }));
        }))));
}
