import React from "../../index.js";
import { List, Detail, ActionPanel, Action, Icon, Color, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useMemo, useEffect } from "../../runtime/hooks.js";
import { isRealElectronHost } from "../shared/native-ipc.js";
import { defaultApplicationsManager, INITIAL_APPLICATIONS } from "./applications-service.js";
export * from "./types.js";
export * from "./applications-service.js";
/**
 * 格式化文件大小 (KB 转 MB/GB)
 */
function formatSizeKb(kb) {
    if (!kb || kb <= 0)
        return "—";
    if (kb < 1024)
        return `${kb} KB`;
    if (kb < 1024 * 1024)
        return `${(kb / 1024).toFixed(1)} MB`;
    return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
}
/**
 * 根据应用属性与分类获取视觉 Icon
 */
function getAppIcon(app) {
    if (app.isGame)
        return Icon.Star;
    if (app.category === "developer")
        return Icon.Code;
    if (app.isUwp)
        return Icon.AppWindow;
    if (app.category === "system")
        return Icon.Gear;
    return Icon.AppWindow;
}
/**
 * 应用程序详情视图 (Markdown 正文 + 右侧 Metadata 侧边栏)
 */
export function AppDetailView({ app, manager = defaultApplicationsManager }) {
    const [currentApp, setCurrentApp] = useState(app);
    const leftoversSection = currentApp.leftoverPaths && currentApp.leftoverPaths.length > 0
        ? `\n### 🧹 macOS 关联残留与缓存路径 (App Leftovers)\n${currentApp.leftoverPaths
            .map((p) => `- \`${p}\``)
            .join("\n")}\n`
        : "";
    const markdown = `
# ${currentApp.name}

> **发布者**: ${currentApp.publisher || "未知开发商"} | **版本**: \`v${currentApp.version || "1.0.0"}\` | **架构**: \`${currentApp.architecture.toUpperCase()}\`

---

### 📂 文件系统与执行路径
- **可执行文件路径**: \`${currentApp.path}\`
- **安装根目录**: \`${currentApp.installLocation || "系统默认或内置目录"}\`
- **磁盘占用估计**: \`${formatSizeKb(currentApp.estimatedSizeKb)}\`
- **包标识符 (Package / Bundle ID)**: \`${currentApp.bundleId || currentApp.id}\`

### ⚡ 进程与运行状态
- **当前运行状态**: ${currentApp.isRunning ? `🟢 **正在运行** (PID: \`${currentApp.pid}\`)` : "⚪ **已停止**"}
- **游戏模式标记**: ${currentApp.isGame ? "🎮 已作为游戏管理 (Treat as Game)" : "普通桌面程序"}
- **空闲自动退出**: ${currentApp.autoQuitEnabled ? "⏱️ 已启用" : "未开启"}
- **类型模式**: ${currentApp.isUwp ? "UWP 现代化应用 (AppContainer 沙箱)" : currentApp.path.endsWith(".app") ? "macOS Application Bundle (.app)" : "Win32 经典应用程序"}

### 🛠️ 卸载与治理信息
${currentApp.isSystemComponent && !currentApp.uninstallString
        ? "> ⚠️ 该应用程序属于操作系统受保护核心组件 (Windows System / macOS /System/Applications)，不可随意卸载。"
        : `- **卸载指令**: \`${currentApp.uninstallString || (currentApp.isUwp ? "Windows Store / Remove-AppxPackage" : currentApp.path.endsWith(".app") ? "Move .app & ~/Library Leftovers to Trash" : "未知")}\``}
${leftoversSection}`;
    const handleOpen = async (runAsAdmin = false) => {
        const res = await manager.openApplication(currentApp, { runAsAdmin });
        if (res.success) {
            if (res.app)
                setCurrentApp(res.app);
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleTerminate = async (force = false) => {
        const res = await manager.terminateApplication(currentApp, force);
        if (res.success) {
            if (res.app)
                setCurrentApp(res.app);
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleRestart = async () => {
        const res = await manager.restartApplication(currentApp);
        if (res.success) {
            if (res.app)
                setCurrentApp(res.app);
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleUninstall = async () => {
        const res = await manager.uninstallApplication(currentApp);
        if (res.success) {
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleToggleGame = () => {
        const res = manager.toggleGameStatus(currentApp);
        if (res.app)
            setCurrentApp(res.app);
        void showToast(Toast.Style.Success, res.message);
    };
    const handleToggleAutoQuit = () => {
        const res = manager.toggleAutoQuit(currentApp);
        if (res.app)
            setCurrentApp(res.app);
        void showToast(Toast.Style.Success, res.message);
    };
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `应用详情: ${currentApp.name}`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u5E94\u7528\u540D\u79F0", text: currentApp.name, icon: getAppIcon(currentApp) }),
            React.createElement(Detail.Metadata.Label, { title: "\u53D1\u5E03\u5546", text: currentApp.publisher, icon: Icon.Globe }),
            React.createElement(Detail.Metadata.Label, { title: "\u7248\u672C\u53F7", text: currentApp.version, icon: Icon.Document }),
            React.createElement(Detail.Metadata.Label, { title: "\u7CFB\u7EDF\u67B6\u6784", text: currentApp.architecture.toUpperCase(), icon: Icon.HardDrive }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.Label, { title: "\u8FDB\u7A0B\u72B6\u6001", text: currentApp.isRunning ? `运行中 (PID: ${currentApp.pid})` : "已停止", icon: currentApp.isRunning ? Icon.Checkmark : Icon.XMarkCircle }),
            React.createElement(Detail.Metadata.Label, { title: "\u78C1\u76D8\u5360\u7528", text: formatSizeKb(currentApp.estimatedSizeKb), icon: Icon.HardDrive }),
            React.createElement(Detail.Metadata.TagList, { title: "\u5206\u7C7B\u6807\u7B7E" },
                React.createElement(Detail.Metadata.TagList.Item, { text: currentApp.category.toUpperCase(), color: currentApp.category === "developer" ? Color.Purple : Color.Blue }),
                currentApp.isRunning && (React.createElement(Detail.Metadata.TagList.Item, { text: "RUNNING", color: Color.Green })),
                currentApp.isGame && (React.createElement(Detail.Metadata.TagList.Item, { text: "GAME", color: Color.Yellow })),
                currentApp.isUwp && (React.createElement(Detail.Metadata.TagList.Item, { text: "UWP", color: Color.Orange })))), actions: React.createElement(ActionPanel, { title: currentApp.name },
            React.createElement(ActionPanel.Section, { title: "\u5E38\u89C4\u52A8\u4F5C" },
                React.createElement(Action, { title: "\u6253\u5F00\u5E94\u7528", icon: Icon.AppWindow, onAction: () => handleOpen(false) }),
                React.createElement(Action, { title: "\u4EE5\u7BA1\u7406\u5458\u8EAB\u4EFD\u8FD0\u884C", icon: Icon.Shield, shortcut: { modifiers: ["ctrl", "shift"], key: "enter" }, onAction: () => handleOpen(true) }),
                React.createElement(Action, { title: "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D", icon: Icon.Folder, shortcut: { modifiers: ["ctrl"], key: "enter" }, onAction: async () => {
                        const res = await manager.revealApplication(currentApp);
                        await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                    } })),
            React.createElement(ActionPanel.Section, { title: "\u5FEB\u6377\u590D\u5236" },
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5B89\u88C5\u8DEF\u5F84", content: currentApp.path, shortcut: { modifiers: ["ctrl", "shift"], key: "c" } }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5E94\u7528\u540D\u79F0", content: currentApp.name, shortcut: { modifiers: ["ctrl"], key: "c" } }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5305\u6807\u8BC6\u7B26", content: currentApp.bundleId || currentApp.id, shortcut: { modifiers: ["ctrl", "shift"], key: "b" } })),
            React.createElement(ActionPanel.Section, { title: "\u8FDB\u7A0B\u4E0E\u751F\u547D\u5468\u671F" },
                React.createElement(Action, { title: "\u4F18\u96C5\u9000\u51FA\u5E94\u7528", icon: Icon.XMarkCircle, shortcut: { modifiers: ["ctrl"], key: "q" }, onAction: () => handleTerminate(false) }),
                React.createElement(Action, { title: "\u5F3A\u5236\u7ED3\u675F\u8FDB\u7A0B", icon: Icon.Trash, shortcut: { modifiers: ["ctrl", "shift"], key: "q" }, onAction: () => handleTerminate(true) }),
                React.createElement(Action, { title: "\u91CD\u542F\u5E94\u7528\u7A0B\u5E8F", icon: Icon.Repeat, shortcut: { modifiers: ["ctrl"], key: "r" }, onAction: handleRestart }),
                React.createElement(Action, { title: currentApp.autoQuitEnabled ? "禁用空闲自动退出" : "启用空闲自动退出", icon: Icon.Clock, onAction: handleToggleAutoQuit }),
                React.createElement(Action, { title: currentApp.isGame ? "取消游戏标记" : "标记为游戏 (Treat as Game)", icon: Icon.Star, onAction: handleToggleGame })),
            React.createElement(ActionPanel.Section, { title: "\u7CFB\u7EDF\u6CBB\u7406" },
                React.createElement(Action, { title: "\u542F\u52A8\u5B98\u65B9\u5378\u8F7D\u7A0B\u5E8F", icon: Icon.Trash, style: "destructive", shortcut: { modifiers: ["ctrl"], key: "backspace" }, onAction: handleUninstall }))) }));
}
/**
 * 根命令：已安装应用程序管理中枢
 */
export default function ApplicationsCommand({ manager = defaultApplicationsManager } = {}) {
    const [searchText, setSearchText] = useState("");
    const [category, setCategory] = useState("all");
    const [apps, setApps] = useState(() => isRealElectronHost() ? [] : INITIAL_APPLICATIONS);
    const [isLoading, setIsLoading] = useState(() => isRealElectronHost());
    const [selectedId, setSelectedId] = useState(null);
    const { push } = useNavigation();
    useEffect(() => {
        let mounted = true;
        setIsLoading(true);
        void manager.getApplications().then((loaded) => {
            if (mounted) {
                setApps(loaded);
                setIsLoading(false);
            }
        });
        return () => {
            mounted = false;
        };
    }, [manager]);
    const filteredApps = useMemo(() => {
        return manager.filterAndSearch(apps, searchText, category);
    }, [apps, searchText, category, manager]);
    const activeApp = useMemo(() => {
        return filteredApps.find((a) => a.id === selectedId) || filteredApps[0];
    }, [filteredApps, selectedId]);
    const handleRescan = async () => {
        setIsLoading(true);
        try {
            const loaded = await manager.getApplications(true);
            setApps(loaded);
            await showToast(Toast.Style.Success, `已重新扫描应用程序 (${loaded.length} 款)`);
        }
        finally {
            setIsLoading(false);
        }
    };
    const handleOpenApp = async (app, runAsAdmin = false) => {
        const res = await manager.openApplication(app, { runAsAdmin });
        if (res.success) {
            if (res.app) {
                setApps((prev) => prev.map((a) => (a.id === app.id ? res.app : a)));
            }
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleTerminateApp = async (app, force = false) => {
        const res = await manager.terminateApplication(app, force);
        if (res.success) {
            if (res.app) {
                setApps((prev) => prev.map((a) => (a.id === app.id ? res.app : a)));
            }
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleRestartApp = async (app) => {
        const res = await manager.restartApplication(app);
        if (res.success) {
            if (res.app) {
                setApps((prev) => prev.map((a) => (a.id === app.id ? res.app : a)));
            }
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleUninstallApp = async (app) => {
        const res = await manager.uninstallApplication(app);
        if (res.success) {
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleToggleGame = (app) => {
        const res = manager.toggleGameStatus(app);
        if (res.app) {
            setApps((prev) => prev.map((a) => (a.id === app.id ? res.app : a)));
        }
        void showToast(Toast.Style.Success, res.message);
    };
    const handleToggleAutoQuit = (app) => {
        const res = manager.toggleAutoQuit(app);
        if (res.app) {
            setApps((prev) => prev.map((a) => (a.id === app.id ? res.app : a)));
        }
        void showToast(Toast.Style.Success, res.message);
    };
    return (React.createElement(List, { isLoading: isLoading, searchBarPlaceholder: "\u641C\u7D22\u5DF2\u5B89\u88C5\u5E94\u7528 (\u652F\u6301\u540D\u79F0\u3001\u62FC\u97F3\u4E0E\u5206\u7C7B\u7B5B\u9009)...", onSearchTextChange: setSearchText, onSelectionChange: setSelectedId, filterBar: {
            summaryText: `已安装应用 ${filteredApps.length} 款 · 当前筛选状态: ${category.toUpperCase()}`,
            actions: [
                {
                    id: "rescan-apps",
                    label: "重新扫描",
                    title: "重新扫描",
                    style: "secondary",
                    onAction: () => {
                        void handleRescan();
                    }
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u5E94\u7528\u5206\u7C7B\u4E0E\u7B5B\u9009", value: category, onChange: (val) => setCategory(val) },
            React.createElement(List.Dropdown.Section, { title: "\u5206\u7C7B\u7B5B\u9009" },
                React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u5E94\u7528 (All)", value: "all" }),
                React.createElement(List.Dropdown.Item, { title: "\u7528\u6237\u81EA\u88C5\u5E94\u7528 (Installed)", value: "installed" }),
                React.createElement(List.Dropdown.Item, { title: "\u7CFB\u7EDF\u7EC4\u4EF6\u4E0E\u5DE5\u5177 (System Tools)", value: "system" }),
                React.createElement(List.Dropdown.Item, { title: "\u5F00\u53D1\u8005\u5DE5\u5177 (Developer)", value: "developer" }),
                React.createElement(List.Dropdown.Item, { title: "\u6E38\u620F\u4E0E\u5A31\u4E50 (Games)", value: "game" }),
                React.createElement(List.Dropdown.Item, { title: "\u6B63\u5728\u8FD0\u884C\u5E94\u7528 (Running)", value: "running" }))) }, filteredApps.map((app) => {
        const appIcon = getAppIcon(app);
        const subtitleText = app.publisher ? `${app.publisher} • v${app.version}` : `v${app.version}`;
        const accessories = [
            { text: app.architecture.toUpperCase() }
        ];
        if (app.isRunning) {
            accessories.push({
                text: "运行中",
                icon: Icon.Checkmark
            });
        }
        if (app.isGame) {
            accessories.push({
                text: "游戏",
                icon: Icon.Star
            });
        }
        if (app.isUwp) {
            accessories.push({
                text: "UWP"
            });
        }
        return (React.createElement(List.Item, { key: app.id, id: app.id, title: app.name, subtitle: subtitleText, icon: appIcon, accessories: accessories, actions: React.createElement(ActionPanel, { title: app.name },
                React.createElement(ActionPanel.Section, { title: "\u5E38\u89C4\u52A8\u4F5C" },
                    React.createElement(Action, { title: "\u6253\u5F00\u5E94\u7528", icon: Icon.AppWindow, onAction: () => handleOpenApp(app, false) }),
                    React.createElement(Action, { title: "\u4EE5\u7BA1\u7406\u5458\u8EAB\u4EFD\u8FD0\u884C", icon: Icon.Shield, shortcut: { modifiers: ["ctrl", "shift"], key: "enter" }, onAction: () => handleOpenApp(app, true) }),
                    React.createElement(Action, { title: "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D", icon: Icon.Folder, shortcut: { modifiers: ["ctrl"], key: "enter" }, onAction: async () => {
                            const res = await manager.revealApplication(app);
                            await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                        } }),
                    React.createElement(Action.Push, { title: "\u67E5\u770B\u5E94\u7528\u8BE6\u7EC6\u5C5E\u6027", icon: Icon.Eye, shortcut: { modifiers: ["ctrl", "shift"], key: "i" }, target: React.createElement(AppDetailView, { app: app, manager: manager }) })),
                React.createElement(ActionPanel.Section, { title: "\u5FEB\u6377\u590D\u5236" },
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5B89\u88C5\u8DEF\u5F84", content: app.path, shortcut: { modifiers: ["ctrl", "shift"], key: "c" } }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5E94\u7528\u540D\u79F0", content: app.name, shortcut: { modifiers: ["ctrl"], key: "c" } }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5305\u6807\u8BC6\u7B26", content: app.bundleId || app.id, shortcut: { modifiers: ["ctrl", "shift"], key: "b" } })),
                React.createElement(ActionPanel.Section, { title: "\u8FDB\u7A0B\u4E0E\u751F\u547D\u5468\u671F" },
                    React.createElement(Action, { title: "\u4F18\u96C5\u9000\u51FA\u5E94\u7528", icon: Icon.XMarkCircle, shortcut: { modifiers: ["ctrl"], key: "q" }, onAction: () => handleTerminateApp(app, false) }),
                    React.createElement(Action, { title: "\u5F3A\u5236\u7ED3\u675F\u8FDB\u7A0B", icon: Icon.Trash, shortcut: { modifiers: ["ctrl", "shift"], key: "q" }, onAction: () => handleTerminateApp(app, true) }),
                    React.createElement(Action, { title: "\u91CD\u542F\u5E94\u7528\u7A0B\u5E8F", icon: Icon.Repeat, shortcut: { modifiers: ["ctrl"], key: "r" }, onAction: () => handleRestartApp(app) }),
                    React.createElement(Action, { title: app.autoQuitEnabled ? "禁用空闲自动退出" : "启用空闲自动退出", icon: Icon.Clock, onAction: () => handleToggleAutoQuit(app) }),
                    React.createElement(Action, { title: app.isGame ? "取消游戏标记" : "标记为游戏 (Treat as Game)", icon: Icon.Star, onAction: () => handleToggleGame(app) })),
                React.createElement(ActionPanel.Section, { title: "\u7CFB\u7EDF\u6CBB\u7406" },
                    React.createElement(Action, { title: "\u542F\u52A8\u5B98\u65B9\u5378\u8F7D\u7A0B\u5E8F", icon: Icon.Trash, style: "destructive", shortcut: { modifiers: ["ctrl"], key: "backspace" }, onAction: () => handleUninstallApp(app) }))) }));
    })));
}
