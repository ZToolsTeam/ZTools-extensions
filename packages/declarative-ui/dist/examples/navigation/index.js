/**
 * Navigation (窗口切换与顶部菜单栏搜索中枢)
 *
 * 深度对齐 Raycast 官方 `navigation` 套件 (`Switch Windows` & `Search Menu Items`)：
 * - Switch Windows: 枚举当前桌面所有打开的活动窗口（含标题、所属应用、PID、显示器与状态），一键聚焦置顶或关闭窗口
 * - Search Menu Items: 搜索当前前台应用顶部菜单栏（macOS Menu Bar / Windows 应用菜单树），模糊匹配并一键触发原生点击
 */
import React from "../../index.js";
import { List, Detail, ActionPanel, Action, Icon, Color, Clipboard, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useEffect, useMemo } from "../../runtime/hooks.js";
import { callHostTransport, isRealElectronHost } from "../shared/native-ipc.js";
export const DEFAULT_NAVIGATION_WINDOWS = Object.freeze([
    {
        id: "win-vscode-main",
        handle: "hwnd-1001",
        title: "ZTools — macos-builtin-plugins-parity-checklist.md — Visual Studio Code",
        appName: "Visual Studio Code",
        pid: 14280,
        bundleId: "com.microsoft.VSCode",
        isFocused: true,
        workspace: "Desktop 1"
    },
    {
        id: "win-chrome-docs",
        handle: "hwnd-1002",
        title: "Raycast API Reference & Declarative UI Architecture — Google Chrome",
        appName: "Google Chrome",
        pid: 18520,
        bundleId: "com.google.Chrome",
        isFocused: false,
        workspace: "Desktop 1"
    },
    {
        id: "win-terminal-zsh",
        handle: "hwnd-1003",
        title: "geek@MacBook-Pro: ~/git/ZTools (zsh — 120×40)",
        appName: "Terminal",
        pid: 9640,
        bundleId: "com.apple.Terminal",
        isFocused: false,
        workspace: "Desktop 2"
    },
    {
        id: "win-finder-downloads",
        handle: "hwnd-1004",
        title: "Downloads — Finder",
        appName: "Finder",
        pid: 412,
        bundleId: "com.apple.finder",
        isFocused: false,
        workspace: "Desktop 1"
    },
    {
        id: "win-figma-design",
        handle: "hwnd-1005",
        title: "ZTools 2.0 Fluent & Mica Design System — Figma",
        appName: "Figma",
        pid: 22190,
        bundleId: "com.figma.Desktop",
        isFocused: false,
        workspace: "Desktop 2"
    }
]);
export const DEFAULT_NAVIGATION_MENU_ITEMS = Object.freeze([
    {
        id: "menu-edit-find-in-files",
        label: "Find in Files...",
        path: ["Edit", "Find", "Find in Files..."],
        appName: "Visual Studio Code",
        shortcut: "⇧⌘F",
        enabled: true
    },
    {
        id: "menu-selection-format-doc",
        label: "Format Document",
        path: ["Selection", "Format Document"],
        appName: "Visual Studio Code",
        shortcut: "⇧⌥F",
        enabled: true
    },
    {
        id: "menu-view-command-palette",
        label: "Command Palette...",
        path: ["View", "Command Palette..."],
        appName: "Visual Studio Code",
        shortcut: "⇧⌘P",
        enabled: true
    },
    {
        id: "menu-file-save-all",
        label: "Save All",
        path: ["File", "Save All"],
        appName: "Visual Studio Code",
        shortcut: "⌥⌘S",
        enabled: true
    },
    {
        id: "menu-window-zoom",
        label: "Zoom",
        path: ["Window", "Zoom"],
        appName: "Visual Studio Code",
        shortcut: "⌃⌘=",
        enabled: true
    },
    {
        id: "menu-terminal-new",
        label: "New Terminal",
        path: ["Terminal", "New Terminal"],
        appName: "Visual Studio Code",
        shortcut: "⌃⇧`",
        enabled: true
    }
]);
/**
 * 获取当前系统活动窗口列表（优先调用 navigation_list_windows IPC）
 */
export async function fetchNavigationWindows(query = "", hostOverride) {
    const realHost = isRealElectronHost(hostOverride);
    if (hostOverride || realHost) {
        const res = await callHostTransport("navigation_list_windows", { query: query.trim() }, hostOverride);
        const list = Array.isArray(res.data)
            ? res.data
            : Array.isArray(res.data?.windows)
                ? res.data.windows
                : null;
        if (res.ok && list) {
            return list.map((w, idx) => ({
                id: String(w.id || w.handle || w.hwnd || `win-${idx}`),
                handle: String(w.handle || w.hwnd || w.id || `hwnd-${idx}`),
                title: String(w.title || w.name || "Untitled Window"),
                appName: String(w.appName || w.processName || w.owner || "Application"),
                pid: Number(w.pid || w.processId || 0),
                bundleId: w.bundleId ? String(w.bundleId) : undefined,
                isMinimized: Boolean(w.isMinimized),
                isFocused: Boolean(w.isFocused ?? idx === 0),
                workspace: w.workspace ? String(w.workspace) : "Desktop 1"
            }));
        }
        throw new Error(res.error || "无法读取系统导航信息");
    }
    const q = query.trim().toLowerCase();
    if (!q)
        return [...DEFAULT_NAVIGATION_WINDOWS];
    return DEFAULT_NAVIGATION_WINDOWS.filter((w) => w.title.toLowerCase().includes(q) ||
        w.appName.toLowerCase().includes(q) ||
        String(w.pid).includes(q));
}
/**
 * 激活并聚焦指定窗口（优先调用 navigation_activate_window / navigation_switch_window IPC）
 */
export async function activateNavigationWindow(handleOrId, hostOverride) {
    const clean = (handleOrId || "").trim();
    if (!clean) {
        return { ok: false, message: "窗口句柄不能为空" };
    }
    if (hostOverride || isRealElectronHost()) {
        let res = await callHostTransport("navigation_activate_window", { handle: clean, id: clean, windowId: clean }, hostOverride);
        if (!res.ok) {
            res = await callHostTransport("navigation_switch_window", { handle: clean, id: clean, windowId: clean }, hostOverride);
        }
        if (res.ok) {
            return { ok: true, message: `已切换并置顶窗口 (${clean})` };
        }
        return { ok: false, message: res.error || "切换窗口失败" };
    }
    return { ok: true, message: `已聚焦活动窗口 (${clean})` };
}
/**
 * 对选中窗口执行快捷分屏/布局管理（先激活目标窗口，再调用 window_manage IPC）
 */
export async function manageNavigationWindow(handleOrId, preset, hostOverride) {
    const clean = (handleOrId || "").trim();
    const labelMap = {
        left_half: "左半屏分屏 (Left Half)",
        right_half: "右半屏分屏 (Right Half)",
        maximize: "最大化窗口 (Maximize)",
        center: "屏幕居中 (Center)"
    };
    if (hostOverride || isRealElectronHost()) {
        if (clean) {
            await activateNavigationWindow(clean, hostOverride);
        }
        const res = await callHostTransport("window_manage", { preset, action: preset, handle: clean || undefined }, hostOverride);
        if (res.ok) {
            return { ok: true, message: `已执行窗口布局: ${labelMap[preset] || preset}` };
        }
        return { ok: false, message: res.error || "窗口分屏操作失败" };
    }
    return { ok: true, message: `已执行窗口布局: ${labelMap[preset] || preset}` };
}
/**
 * 关闭指定窗口（优先调用 navigation_close_window IPC）
 */
export async function closeNavigationWindow(handleOrId, hostOverride) {
    const clean = (handleOrId || "").trim();
    if (!clean) {
        return { ok: false, message: "窗口句柄不能为空" };
    }
    if (hostOverride || isRealElectronHost()) {
        const res = await callHostTransport("navigation_close_window", { handle: clean, id: clean, windowId: clean }, hostOverride);
        if (res.ok) {
            return { ok: true, message: `已关闭窗口 (${clean})` };
        }
        return { ok: false, message: res.error || "关闭窗口失败" };
    }
    return { ok: true, message: `已请求关闭窗口 (${clean})` };
}
/**
 * 搜索当前前台应用的顶部菜单栏条目（优先调用 navigation_search_menu_items IPC）
 */
export async function searchNavigationMenuItems(query = "", hostOverride) {
    const realHost = isRealElectronHost(hostOverride);
    if (hostOverride || realHost) {
        const res = await callHostTransport("navigation_search_menu_items", { query: query.trim() }, hostOverride);
        const list = Array.isArray(res.data)
            ? res.data
            : Array.isArray(res.data?.items)
                ? res.data.items
                : null;
        if (res.ok && list) {
            return list.map((m, idx) => {
                const pathArr = Array.isArray(m.path)
                    ? m.path.map(String)
                    : typeof m.path === "string"
                        ? m.path.split(/\s*[▸>]\s*/)
                        : [String(m.label || m.title || "Menu")];
                return {
                    id: String(m.id || `menu-${idx}`),
                    label: String(m.label || m.title || pathArr[pathArr.length - 1] || "Menu Item"),
                    path: pathArr,
                    appName: String(m.appName || "Frontmost App"),
                    shortcut: m.shortcut ? String(m.shortcut) : undefined,
                    enabled: m.enabled !== false
                };
            });
        }
        throw new Error(res.error || "无法读取系统导航信息");
    }
    const q = query.trim().toLowerCase();
    if (!q)
        return [...DEFAULT_NAVIGATION_MENU_ITEMS];
    return DEFAULT_NAVIGATION_MENU_ITEMS.filter((m) => m.label.toLowerCase().includes(q) ||
        m.path.join(" ▸ ").toLowerCase().includes(q) ||
        m.appName.toLowerCase().includes(q));
}
/**
 * 触发点击指定应用菜单项（优先调用 navigation_click_menu_item IPC）
 */
export async function triggerNavigationMenuItem(menuItem, hostOverride) {
    if (!menuItem || (!menuItem.id && (!menuItem.path || menuItem.path.length === 0))) {
        return { ok: false, message: "菜单项路径不能为空" };
    }
    if (hostOverride || isRealElectronHost()) {
        const res = await callHostTransport("navigation_click_menu_item", {
            id: menuItem.id,
            appName: menuItem.appName,
            path: menuItem.path ? [...menuItem.path] : []
        }, hostOverride);
        if (res.ok) {
            return {
                ok: true,
                message: `已执行菜单动作: ${(menuItem.path || []).join(" ▸ ") || menuItem.id}`
            };
        }
        return { ok: false, message: res.error || "执行菜单命令失败" };
    }
    return {
        ok: true,
        message: `已触发菜单项: ${(menuItem.path || []).join(" ▸ ") || menuItem.id}`
    };
}
export const fetchActiveWindows = fetchNavigationWindows;
export const switchToWindow = activateNavigationWindow;
export const closeAppWindow = closeNavigationWindow;
export const fetchMenuBars = searchNavigationMenuItems;
export const triggerMenuItem = triggerNavigationMenuItem;
export function NavigationWindowDetailView({ win }) {
    const markdown = [
        `# 🪟 ${win.title}`,
        `**所属应用**: \`${win.appName}\` &nbsp;&nbsp;|&nbsp;&nbsp; **进程 PID**: \`${win.pid}\``,
        `---`,
        `### 窗口详情`,
        `- **窗口句柄 (Handle)**: \`${win.handle}\``,
        `- **Bundle ID**: \`${win.bundleId || "N/A"}\``,
        `- **所在桌面空间**: \`${win.workspace || "Desktop 1"}\``,
        `- **焦点状态**: \`${win.isFocused ? "当前前台窗口 (Active)" : "后台运行中"}\``
    ].join("\n\n");
    return (React.createElement(Detail, { navigationTitle: `窗口详情: ${win.appName}`, markdown: markdown, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u5E94\u7528\u540D\u79F0", text: win.appName, icon: Icon.AppWindow }),
            React.createElement(Detail.Metadata.Label, { title: "\u8FDB\u7A0B PID", text: String(win.pid), icon: Icon.Cpu }),
            React.createElement(Detail.Metadata.Label, { title: "\u7A97\u53E3\u53E5\u67C4", text: win.handle, icon: Icon.Key }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                React.createElement(Detail.Metadata.TagList.Item, { text: win.isFocused ? "Active" : "Background", color: win.isFocused ? Color.Green : Color.SecondaryText }))), actions: React.createElement(ActionPanel, null,
            React.createElement(Action, { title: "\u805A\u7126\u5E76\u7F6E\u9876\u6B64\u7A97\u53E3", icon: Icon.Window, onAction: async () => {
                    const res = await activateNavigationWindow(win.handle);
                    await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.message);
                } }),
            React.createElement(Action, { title: "\u7A97\u53E3\u5DE6\u534A\u5C4F\u5206\u5C4F (Left Half)", icon: Icon.SidebarLeft, onAction: async () => {
                    const res = await manageNavigationWindow(win.handle, "left_half");
                    await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.message);
                } }),
            React.createElement(Action, { title: "\u7A97\u53E3\u53F3\u534A\u5C4F\u5206\u5C4F (Right Half)", icon: Icon.SidebarRight, onAction: async () => {
                    const res = await manageNavigationWindow(win.handle, "right_half");
                    await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.message);
                } }),
            React.createElement(Action, { title: "\u6700\u5927\u5316\u6B64\u7A97\u53E3 (Maximize)", icon: Icon.Maximize, onAction: async () => {
                    const res = await manageNavigationWindow(win.handle, "maximize");
                    await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.message);
                } }),
            React.createElement(Action, { title: "\u5C45\u4E2D\u6B64\u7A97\u53E3 (Center)", icon: Icon.AppWindow, onAction: async () => {
                    const res = await manageNavigationWindow(win.handle, "center");
                    await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.message);
                } }),
            React.createElement(Action, { title: "\u590D\u5236\u7A97\u53E3\u6807\u9898", icon: Icon.CopyClipboard, onAction: async () => {
                    await Clipboard.copy(win.title);
                    await showToast(Toast.Style.Success, "已复制窗口标题");
                } })) }));
}
// 只认明确的"缺少权限"：宿主旧版本把超时等所有菜单失败都写成"请检查辅助功能与自动化权限"，不能据此判为权限问题
const PERMISSION_ERROR_PATTERN = /PERMISSION_DENIED|ACCESSIBILITY_(?:REQUIRED|DENIED|PERMISSION)|(?:未授权|未授予|没有|缺少|需要|未开启|未允许)[^，。,.;；]{0,12}(?:辅助功能|权限)|not (?:allowed|authori[sz]ed|trusted)|permission denied/i;
/** 宿主返回的错误是否是缺少辅助功能等系统权限 */
export function isNavigationPermissionError(error) {
    if (!error)
        return false;
    const code = typeof error === "object" ? String(error.code ?? "") : "";
    const message = error instanceof Error ? error.message : String(error);
    return PERMISSION_ERROR_PATTERN.test(`${code} ${message}`);
}
/**
 * 汇总窗口列表与菜单查询的失败信息；都成功时返回 null。
 * 任何一侧是权限错误时提示去授权辅助功能（重试无用，必须用户在系统设置里授权）。
 */
export function describeNavigationFailure(windowError, menuError) {
    if (!windowError && !menuError)
        return null;
    if (isNavigationPermissionError(windowError) || isNavigationPermissionError(menuError)) {
        return {
            title: "需要辅助功能权限",
            message: "请在 系统设置 > 隐私与安全性 > 辅助功能 中允许 ZTools，然后刷新列表"
        };
    }
    const text = (error) => (error instanceof Error ? error.message : String(error));
    if (windowError && menuError)
        return { title: "无法读取窗口和菜单", message: text(windowError) };
    if (windowError)
        return { title: "无法读取窗口列表", message: text(windowError) };
    return { title: "无法读取应用菜单", message: text(menuError) };
}
export function NavigationCommand() {
    const realHost = isRealElectronHost();
    const [searchText, setSearchText] = useState("");
    const [filterMode, setFilterMode] = useState("all");
    const [selectedId, setSelectedId] = useState("");
    const [windows, setWindows] = useState(() => realHost ? [] : [...DEFAULT_NAVIGATION_WINDOWS]);
    const [menuItems, setMenuItems] = useState(() => realHost ? [] : [...DEFAULT_NAVIGATION_MENU_ITEMS]);
    const [isLoading, setIsLoading] = useState(realHost);
    const [refreshTick, setRefreshTick] = useState(0);
    const { push } = useNavigation();
    useEffect(() => {
        let active = true;
        setIsLoading(true);
        // 窗口与菜单互相独立：菜单查询超时或失败时窗口列表照常显示，反之亦然
        void Promise.allSettled([
            fetchNavigationWindows(searchText),
            searchNavigationMenuItems(searchText)
        ]).then(([winResult, menuResult]) => {
            if (!active)
                return;
            // 失败的一侧清空：窗口与菜单都随前台应用变化，保留上次结果会显示过时内容
            setWindows(winResult.status === "fulfilled" ? winResult.value : []);
            setMenuItems(menuResult.status === "fulfilled" ? menuResult.value : []);
            setIsLoading(false);
            const failure = describeNavigationFailure(winResult.status === "rejected" ? winResult.reason : undefined, menuResult.status === "rejected" ? menuResult.reason : undefined);
            if (failure)
                void showToast({ style: Toast.Style.Failure, title: failure.title, message: failure.message });
        });
        return () => {
            active = false;
        };
    }, [searchText, refreshTick]);
    const showWindows = filterMode === "all" || filterMode === "windows";
    const showMenus = filterMode === "all" || filterMode === "menus";
    const filteredWindows = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        if (!q)
            return windows;
        return windows.filter((w) => w.title.toLowerCase().includes(q) ||
            w.appName.toLowerCase().includes(q) ||
            String(w.pid).includes(q));
    }, [windows, searchText]);
    const filteredMenus = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        if (!q)
            return menuItems;
        return menuItems.filter((m) => m.label.toLowerCase().includes(q) ||
            m.path.join(" ▸ ").toLowerCase().includes(q) ||
            m.appName.toLowerCase().includes(q));
    }, [menuItems, searchText]);
    const activeWindow = filteredWindows.find((w) => w.id === selectedId) || filteredWindows[0] || null;
    const activeMenu = filteredMenus.find((m) => m.id === selectedId) ||
        (filterMode === "menus" ? filteredMenus[0] || null : null);
    const handleActivateWindow = async (win) => {
        const res = await activateNavigationWindow(win.handle);
        await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.ok ? `已切换到窗口: ${win.appName}` : "切换窗口失败", win.title);
        setRefreshTick((t) => t + 1);
    };
    const handleManageWindow = async (win, preset) => {
        const res = await manageNavigationWindow(win.handle, preset);
        await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.message, `${win.appName}: ${win.title}`);
        setRefreshTick((t) => t + 1);
    };
    const handleCloseWindow = async (win) => {
        const res = await closeNavigationWindow(win.handle);
        if (res.ok) {
            setWindows((prev) => prev.filter((item) => item.id !== win.id));
        }
        await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.message, win.title);
    };
    const handleClickMenu = async (menu) => {
        const res = await triggerNavigationMenuItem(menu);
        await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.ok ? `已触发菜单项: ${menu.label}` : "菜单触发失败", menu.path.join(" ▸ "));
    };
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchBarPlaceholder: "\u641C\u7D22\u6D3B\u52A8\u7A97\u53E3 (Switch Windows) \u6216\u5F53\u524D\u5E94\u7528\u9876\u90E8\u83DC\u5355\u9879 (Search Menu Items)...", onSearchTextChange: setSearchText, onSelectionChange: (id) => setSelectedId(id || ""), filterBar: {
            summaryText: `当前本机活动窗口 ${windows.length} 个 · 应用顶部菜单命令 ${menuItems.length} 项`,
            actions: [
                {
                    id: "nav-act-refresh",
                    label: "刷新列表",
                    title: "刷新列表",
                    style: "secondary",
                    onAction: () => {
                        setRefreshTick((t) => t + 1);
                    }
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u9009\u62E9\u5BFC\u822A\u6A21\u5F0F", value: filterMode, onChange: (val) => setFilterMode(val) },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u5BFC\u822A (Windows & Menu Items)", value: "all", icon: Icon.AppWindow }),
            React.createElement(List.Dropdown.Item, { title: `切换活动窗口 (Switch Windows: ${filteredWindows.length})`, value: "windows", icon: Icon.Window }),
            React.createElement(List.Dropdown.Item, { title: `搜索顶部菜单栏 (Search Menu Items: ${filteredMenus.length})`, value: "menus", icon: Icon.List })) },
        showWindows && (React.createElement(List.Section, { title: `活动窗口切换 (Switch Windows · ${filteredWindows.length})` }, filteredWindows.map((win) => (React.createElement(List.Item, { key: win.id, id: win.id, title: win.title, subtitle: `${win.appName} (PID: ${win.pid})`, icon: win.isFocused ? Icon.CheckCircle : Icon.Window, accessories: [
                { text: win.appName },
                { text: `PID ${win.pid}` },
                ...(win.isFocused ? [{ text: "ACTIVE", icon: Icon.Bolt }] : [])
            ], detail: React.createElement(List.Item.Detail, { markdown: [
                    `# 🪟 ${win.title}`,
                    `**所属应用**: \`${win.appName}\` &nbsp;|&nbsp; **PID**: \`${win.pid}\``,
                    `---`,
                    `- **句柄标识**: \`${win.handle}\``,
                    `- **Bundle ID**: \`${win.bundleId || "N/A"}\``,
                    `- **桌面工作区**: \`${win.workspace || "Desktop 1"}\``,
                    `- **当前状态**: ${win.isFocused ? "🟢 前台活动窗口 (AXRaise Ready)" : "⚪ 后台窗口"}`
                ].join("\n\n"), metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6240\u5C5E\u5E94\u7528", text: win.appName, icon: Icon.AppWindow }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8FDB\u7A0B PID", text: String(win.pid), icon: Icon.Cpu }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7A97\u53E3\u53E5\u67C4", text: win.handle, icon: Icon.Key }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5DE5\u4F5C\u533A", text: win.workspace || "Desktop 1", icon: Icon.Desktop })) }), actions: React.createElement(ActionPanel, { title: win.title },
                React.createElement(ActionPanel.Section, { title: "\u7A97\u53E3\u5207\u6362\u4E0E\u8BE6\u60C5" },
                    React.createElement(Action, { title: "\u5207\u6362\u5230\u6B64\u7A97\u53E3 (Switch to Window)", icon: Icon.Window, onAction: () => handleActivateWindow(win) }),
                    React.createElement(Action, { title: "\u67E5\u770B\u7A97\u53E3\u8BE6\u60C5", icon: Icon.Eye, onAction: () => push(React.createElement(NavigationWindowDetailView, { win: win })) }),
                    React.createElement(Action, { title: "\u5237\u65B0\u7A97\u53E3\u4E0E\u83DC\u5355\u5217\u8868", icon: Icon.ArrowClockwise, shortcut: { modifiers: ["ctrl"], key: "r" }, onAction: () => setRefreshTick((t) => t + 1) })),
                React.createElement(ActionPanel.Section, { title: "\u5FEB\u6377\u5206\u5C4F\u4E0E\u7A97\u53E3\u7BA1\u7406 (Window Snap)" },
                    React.createElement(Action, { title: "\u5C06\u6B64\u7A97\u53E3\u7F6E\u4E8E\u5DE6\u534A\u5C4F (Left Half)", icon: Icon.SidebarLeft, shortcut: { modifiers: ["ctrl", "alt"], key: "left" }, onAction: () => handleManageWindow(win, "left_half") }),
                    React.createElement(Action, { title: "\u5C06\u6B64\u7A97\u53E3\u7F6E\u4E8E\u53F3\u534A\u5C4F (Right Half)", icon: Icon.SidebarRight, shortcut: { modifiers: ["ctrl", "alt"], key: "right" }, onAction: () => handleManageWindow(win, "right_half") }),
                    React.createElement(Action, { title: "\u6700\u5927\u5316\u6B64\u7A97\u53E3 (Maximize Window)", icon: Icon.Maximize, shortcut: { modifiers: ["ctrl", "alt"], key: "up" }, onAction: () => handleManageWindow(win, "maximize") }),
                    React.createElement(Action, { title: "\u5C06\u6B64\u7A97\u53E3\u5C4F\u5E55\u5C45\u4E2D (Center Window)", icon: Icon.AppWindow, shortcut: { modifiers: ["ctrl", "alt"], key: "c" }, onAction: () => handleManageWindow(win, "center") })),
                React.createElement(ActionPanel.Section, { title: "\u5176\u4ED6\u64CD\u4F5C" },
                    React.createElement(Action, { title: "\u590D\u5236\u7A97\u53E3\u6807\u9898", icon: Icon.CopyClipboard, shortcut: { modifiers: ["ctrl"], key: "c" }, onAction: async () => {
                            await Clipboard.copy(win.title);
                            await showToast(Toast.Style.Success, "已复制窗口标题");
                        } }),
                    React.createElement(Action, { title: "\u5173\u95ED\u6B64\u7A97\u53E3 (Close Window)", icon: Icon.XMarkCircle, style: Action.Style.Destructive, shortcut: { modifiers: ["ctrl"], key: "w" }, onAction: () => handleCloseWindow(win) }))) }))))),
        showMenus && (React.createElement(List.Section, { title: `前台应用顶部菜单栏 (Search Menu Items · ${filteredMenus.length})` }, filteredMenus.map((menu) => {
            const breadcrumb = menu.path.join(" ▸ ");
            return (React.createElement(List.Item, { key: menu.id, id: menu.id, title: menu.label, subtitle: breadcrumb, icon: Icon.List, accessories: [
                    ...(menu.shortcut ? [{ text: menu.shortcut }] : []),
                    { text: menu.appName }
                ], detail: React.createElement(List.Item.Detail, { markdown: [
                        `# 📋 ${menu.label}`,
                        `**菜单层级路径**: \`${breadcrumb}\``,
                        `---`,
                        `- **所属前台应用**: \`${menu.appName}\``,
                        `- **绑定快捷键**: \`${menu.shortcut || "未绑定"}\``,
                        `- **可执行状态**: \`${menu.enabled ? "Enabled (可用)" : "Disabled (禁用)"}\``,
                        `> 按下 **Enter** 即可通过 macOS System Events / UIAutomation 直接原生触发此菜单项点击，免去长距离移动鼠标到屏幕顶栏。`
                    ].join("\n\n"), metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u83DC\u5355\u9879", text: menu.label, icon: Icon.List }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5C42\u7EA7\u8DEF\u5F84", text: breadcrumb, icon: Icon.ArrowRight }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5FEB\u6377\u952E", text: menu.shortcut || "无", icon: Icon.Key }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6240\u5C5E\u5E94\u7528", text: menu.appName, icon: Icon.AppWindow })) }), actions: React.createElement(ActionPanel, { title: menu.label },
                    React.createElement(Action, { title: "\u70B9\u51FB\u89E6\u53D1\u6B64\u83DC\u5355\u9879 (Click Menu Item)", icon: Icon.Play, onAction: () => handleClickMenu(menu) }),
                    React.createElement(Action, { title: "\u590D\u5236\u83DC\u5355\u8DEF\u5F84", icon: Icon.CopyClipboard, shortcut: { modifiers: ["ctrl"], key: "c" }, onAction: async () => {
                            await Clipboard.copy(breadcrumb);
                            await showToast(Toast.Style.Success, "已复制菜单路径", breadcrumb);
                        } }),
                    React.createElement(Action, { title: "\u5237\u65B0\u83DC\u5355\u6811", icon: Icon.ArrowClockwise, shortcut: { modifiers: ["ctrl"], key: "r" }, onAction: () => setRefreshTick((t) => t + 1) })) }));
        })))));
}
export default NavigationCommand;
