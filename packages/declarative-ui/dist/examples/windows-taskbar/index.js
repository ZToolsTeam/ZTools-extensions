/**
 * Windows Taskbar (任务栏治理中枢)
 *
 * 功能概览：
 * - Win32 原生动作：Toggle Taskbar Visibility (一键显示/隐藏任务栏，基于 FindWindow("Shell_TrayWnd") + ShowWindow)
 * - Toggle Taskbar Auto-Hide (切换任务栏自动隐藏)
 * - 任务栏位置与对齐方式检视 (Windows 11 居中 / 靠左对齐)
 * - 快捷动作反馈与 Toast 提示
 * - 完善的多显示器协同与资源管理器刷新急救
 */
import React from "../../index.js";
import { List, ActionPanel, Action, Icon, showToast, Toast } from "../../index.js";
import { useState, useEffect } from "../../runtime/hooks.js";
import { WindowsTaskbarManager, defaultWindowsTaskbarManager, describeTaskbarFailure } from "./taskbar-service.js";
export * from "./types.js";
export * from "./taskbar-service.js";
export default function WindowsTaskbarCommand(props) {
    // 宿主渲染命令时可能传入启动参数或 null，只认测试注入的 manager
    const manager = props?.manager instanceof WindowsTaskbarManager ? props.manager : defaultWindowsTaskbarManager;
    // 只展示当前平台宿主真正实现了的动作（Windows：显示 / 隐藏；macOS：Dock 自动隐藏、停靠位置、重启 Dock）
    const caps = manager.getCapabilities();
    const [state, setState] = useState({
        visible: true,
        autoHide: false,
        position: "bottom",
        alignment: "center",
        size: "regular",
        multiMonitorEnabled: true,
        secondaryTrayCount: 1,
        lastModifiedAt: Date.now()
    });
    const [refreshCount, setRefreshCount] = useState(0);
    useEffect(() => {
        let active = true;
        manager.getTaskbarState().then((s) => {
            if (active)
                setState(s);
        });
        return () => {
            active = false;
        };
    }, [refreshCount]);
    const reloadState = () => {
        setRefreshCount((c) => c + 1);
    };
    /**
     * 统一展示操作结果：只有宿主确认成功才弹成功提示，失败时弹失败提示并附上真实原因
     */
    const reportResult = async (res, successDetail) => {
        setState(res.state);
        if (res.success) {
            await showToast(Toast.Style.Success, res.message, successDetail);
        }
        else {
            await showToast(Toast.Style.Failure, res.message, describeTaskbarFailure(res));
        }
    };
    const runAction = async (action, failureTitle, successDetail) => {
        try {
            const res = await action();
            await reportResult(res, successDetail?.(res));
        }
        catch (err) {
            await showToast(Toast.Style.Failure, failureTitle, err instanceof Error ? err.message : String(err));
        }
    };
    const handleToggleVisibility = () => runAction(() => manager.toggleTaskbarVisibility(), "切换任务栏显隐失败", (res) => (res.visible ? "任务栏 / Dock 已恢复显示" : "任务栏 / Dock 已隐藏"));
    const handleToggleAutoHide = () => runAction(() => manager.toggleTaskbarAutoHide(), "切换自动隐藏失败", (res) => (res.autoHide ? "鼠标移出后自动隐藏" : "保持常驻显示"));
    const handleForceShow = () => runAction(() => manager.showTaskbar(), "显示任务栏失败");
    const handleForceHide = () => runAction(() => manager.hideTaskbar(), "隐藏任务栏失败");
    const handleSetAlignment = (alignment) => runAction(() => manager.setTaskbarAlignment(alignment), "设置对齐方式失败");
    const handleSetDockPosition = (position) => runAction(() => manager.setDockPosition(position), "切换停靠位置失败");
    const handleRestartDock = async () => {
        await showToast(Toast.Style.Animated, "正在重启 macOS Dock 程序坞...");
        await runAction(() => manager.restartDock(), "重启 Dock 失败");
    };
    const handleRestartExplorer = async () => {
        await showToast(Toast.Style.Animated, "正在重启系统桌面壳层 (Explorer / Dock)...");
        await runAction(() => manager.restartExplorer(), "重启资源管理器失败");
    };
    return (React.createElement(List, { searchBarPlaceholder: "\u6CBB\u7406\u7CFB\u7EDF\u4EFB\u52A1\u680F\u4E0E macOS \u7A0B\u5E8F\u575E (Dock) \u663E\u9690\u3001\u81EA\u52A8\u9690\u85CF\u3001\u505C\u9760\u4F4D\u7F6E...", filterBar: {
            summaryText: `任务栏/Dock 状态: ${state.visible ? "显示中 (Visible)" : "已隐藏 (Hidden)"}${caps.autoHide ? ` · 自动隐藏: ${state.autoHide ? "已开启" : "常驻"}` : ""}`,
            actions: [
                {
                    id: "tb-act-visibility",
                    label: "切换任务栏/Dock显隐",
                    title: "切换任务栏/Dock显隐",
                    style: "primary",
                    onAction: () => {
                        void handleToggleVisibility();
                    }
                },
                caps.autoHide && {
                    id: "tb-act-autohide",
                    label: "切换自动隐藏",
                    title: "切换自动隐藏",
                    style: "secondary",
                    onAction: () => {
                        void handleToggleAutoHide();
                    }
                },
                caps.alignment && {
                    id: "tb-act-align-left",
                    label: "靠左对齐",
                    title: "靠左对齐",
                    style: "secondary",
                    onAction: () => {
                        void handleSetAlignment("start");
                    }
                },
                caps.alignment && {
                    id: "tb-act-align-center",
                    label: "居中对齐",
                    title: "居中对齐",
                    style: "secondary",
                    onAction: () => {
                        void handleSetAlignment("center");
                    }
                },
                (caps.restartExplorer || caps.restartDock) && {
                    id: "tb-act-restart",
                    label: caps.restartExplorer ? "重启 Explorer" : "重启 Dock",
                    title: caps.restartExplorer ? "重启 Explorer" : "重启 Dock",
                    style: "danger",
                    onAction: () => {
                        void (caps.restartExplorer ? handleRestartExplorer() : handleRestartDock());
                    }
                }
            ].filter((action) => Boolean(action))
        } },
        React.createElement(List.Section, { title: "Win32 \u539F\u751F\u6CBB\u7406\u52A8\u4F5C (Core Actions)" },
            React.createElement(List.Item, { key: "item-toggle-visibility", title: "\u5207\u6362\u4EFB\u52A1\u680F\u663E\u9690 / \u7A0B\u5E8F\u575E\u663E\u9690 (Toggle Taskbar & Dock)", subtitle: `当前状态: ${state.visible ? "显示中 (Visible)" : "已隐藏 (Hidden)"} — Win32 ShowWindow / macOS Dock Autohide`, accessories: [
                    {
                        text: state.visible ? "VISIBLE" : "HIDDEN"
                    }
                ], actions: React.createElement(ActionPanel, { title: "\u4EFB\u52A1\u680F\u4E0E Dock \u663E\u9690" },
                    React.createElement(Action, { title: "\u7ACB\u5373\u5207\u6362\u4EFB\u52A1\u680F/Dock \u663E\u9690", icon: Icon.Eye, onAction: handleToggleVisibility }),
                    React.createElement(Action, { title: "\u5F3A\u5236\u663E\u793A\u4EFB\u52A1\u680F", icon: Icon.Window, onAction: handleForceShow }),
                    React.createElement(Action, { title: "\u6C89\u6D78\u5F0F\u9690\u85CF\u4EFB\u52A1\u680F", icon: Icon.XMarkCircle, onAction: handleForceHide })) }),
            caps.autoHide && (React.createElement(List.Item, { key: "item-toggle-autohide", title: "\u5207\u6362\u4EFB\u52A1\u680F / Dock \u81EA\u52A8\u9690\u85CF (Toggle Auto-Hide)", subtitle: `当前状态: ${state.autoHide ? "已启用自动隐藏 (Auto-Hide)" : "常驻显示 (Always Visible)"} — SHAppBarMessage / Dock Preferences`, accessories: [
                    {
                        text: state.autoHide ? "AUTO-HIDE ON" : "ALWAYS ON"
                    }
                ], actions: React.createElement(ActionPanel, { title: "\u81EA\u52A8\u9690\u85CF\u63A7\u5236" },
                    React.createElement(Action, { title: "\u5207\u6362\u81EA\u52A8\u9690\u85CF\u72B6\u6001", icon: Icon.ArrowDown, onAction: handleToggleAutoHide })) })),
            React.createElement(List.Item, { key: "item-show-taskbar", title: "\u5F3A\u5236\u663E\u793A\u4EFB\u52A1\u680F (Show Taskbar)", subtitle: "\u8FD8\u539F\u4E3B\u5C4F (Shell_TrayWnd) \u4E0E\u526F\u5C4F (Shell_SecondaryTrayWnd) \u4EFB\u52A1\u680F\u7A97\u53E3", accessories: [{ text: "SHOW" }], actions: React.createElement(ActionPanel, { title: "\u663E\u793A\u4EFB\u52A1\u680F" },
                    React.createElement(Action, { title: "\u5F3A\u5236\u663E\u793A\u4EFB\u52A1\u680F", icon: Icon.Window, onAction: handleForceShow })) }),
            React.createElement(List.Item, { key: "item-hide-taskbar", title: "\u6C89\u6D78\u5F0F\u9690\u85CF\u4EFB\u52A1\u680F (Hide Taskbar)", subtitle: "\u9690\u85CF\u6240\u6709\u663E\u793A\u5668\u7684\u7CFB\u7EDF\u4EFB\u52A1\u680F\uFF0C\u4EAB\u53D7\u6781\u81F4\u65E0\u8FB9\u6846\u6C89\u6D78\u4F53\u9A8C", accessories: [{ text: "HIDE" }], actions: React.createElement(ActionPanel, { title: "\u9690\u85CF\u4EFB\u52A1\u680F" },
                    React.createElement(Action, { title: "\u6C89\u6D78\u5F0F\u9690\u85CF\u4EFB\u52A1\u680F", icon: Icon.XMarkCircle, onAction: handleForceHide })) })),
        caps.dockPosition && (React.createElement(List.Section, { title: "macOS Dock \u4E0E\u4EFB\u52A1\u680F\u4F4D\u7F6E\u6CBB\u7406 (Dock Position & Alignment)" },
            React.createElement(List.Item, { key: "item-dock-bottom", title: "\u505C\u9760\u4E8E\u5C4F\u5E55\u5E95\u90E8 (Set Dock Position: Bottom)", subtitle: "\u5C06 macOS \u7A0B\u5E8F\u575E / \u4EFB\u52A1\u680F\u505C\u9760\u5728\u5C4F\u5E55\u5E95\u8FB9", accessories: [{ text: state.position === "bottom" ? "ACTIVE" : "BOTTOM" }], actions: React.createElement(ActionPanel, { title: "\u505C\u9760\u4F4D\u7F6E" },
                    React.createElement(Action, { title: "\u505C\u9760\u5728\u5E95\u90E8 (Bottom)", icon: Icon.ArrowDown, onAction: () => handleSetDockPosition("bottom") }),
                    React.createElement(Action, { title: "\u505C\u9760\u5728\u5DE6\u4FA7 (Left)", icon: Icon.SidebarLeft, onAction: () => handleSetDockPosition("left") }),
                    React.createElement(Action, { title: "\u505C\u9760\u5728\u53F3\u4FA7 (Right)", icon: Icon.SidebarRight, onAction: () => handleSetDockPosition("right") })) }),
            React.createElement(List.Item, { key: "item-dock-left", title: "\u505C\u9760\u4E8E\u5C4F\u5E55\u5DE6\u4FA7 (Set Dock Position: Left)", subtitle: "\u5C06 macOS \u7A0B\u5E8F\u575E\u505C\u9760\u5728\u5C4F\u5E55\u5DE6\u8FB9\u7F18\uFF0C\u91CA\u653E\u7EB5\u5411\u4EE3\u7801\u9605\u8BFB\u89C6\u91CE", accessories: [{ text: state.position === "left" ? "ACTIVE" : "LEFT" }], actions: React.createElement(ActionPanel, { title: "\u505C\u9760\u4F4D\u7F6E" },
                    React.createElement(Action, { title: "\u505C\u9760\u5728\u5DE6\u4FA7 (Left)", icon: Icon.SidebarLeft, onAction: () => handleSetDockPosition("left") })) }),
            React.createElement(List.Item, { key: "item-dock-right", title: "\u505C\u9760\u4E8E\u5C4F\u5E55\u53F3\u4FA7 (Set Dock Position: Right)", subtitle: "\u5C06 macOS \u7A0B\u5E8F\u575E\u505C\u9760\u5728\u5C4F\u5E55\u53F3\u8FB9\u7F18", accessories: [{ text: state.position === "right" ? "ACTIVE" : "RIGHT" }], actions: React.createElement(ActionPanel, { title: "\u505C\u9760\u4F4D\u7F6E" },
                    React.createElement(Action, { title: "\u505C\u9760\u5728\u53F3\u4FA7 (Right)", icon: Icon.SidebarRight, onAction: () => handleSetDockPosition("right") })) }))),
        (caps.restartExplorer || caps.restartDock) && (React.createElement(List.Section, { title: "\u7CFB\u7EDF\u7EA7\u8FD0\u7EF4\u4E0E\u6025\u6551 (Diagnostics & Recovery)" },
            caps.restartExplorer && (React.createElement(List.Item, { key: "item-restart-explorer", title: "\u91CD\u542F Windows \u8D44\u6E90\u7BA1\u7406\u5668 (Restart Explorer)", subtitle: "\u5F53\u4EFB\u52A1\u680F\u5361\u987F\u3001\u5047\u6B7B\u3001\u56FE\u6807\u7A7A\u767D\u6216\u663E\u9690\u5F02\u5E38\u65F6\u4E00\u952E\u91CD\u542F explorer.exe \u8FDB\u7A0B\u81EA\u6108", accessories: [{ text: "RELOAD" }], actions: React.createElement(ActionPanel, { title: "\u8D44\u6E90\u7BA1\u7406\u5668\u6CBB\u7406" },
                    React.createElement(Action, { title: "\u91CD\u542F\u8D44\u6E90\u7BA1\u7406\u5668\u8FDB\u7A0B", icon: Icon.RotateAntiClockwise, onAction: handleRestartExplorer })) })),
            caps.restartDock && (React.createElement(List.Item, { key: "item-restart-dock", title: "\u91CD\u542F macOS \u7A0B\u5E8F\u575E (Restart macOS Dock)", subtitle: "\u6267\u884C killall Dock \u91CD\u7F6E\u7A0B\u5E8F\u575E\u6E32\u67D3\u4E0E\u56FE\u6807\u7F13\u5B58", accessories: [{ text: "DOCK RELOAD" }], actions: React.createElement(ActionPanel, { title: "\u7A0B\u5E8F\u575E\u6025\u6551" },
                    React.createElement(Action, { title: "\u91CD\u542F macOS Dock", icon: Icon.RotateClockwise, onAction: handleRestartDock })) }))))));
}
