import React, { Action, ActionPanel, Color, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { BRIGHTNESS_PRESETS, filterMonitorDisplays, listMonitorDisplays, setMonitorBrightness, syncAllMonitorsBrightness, triggerSleepAllMonitors } from './monitor-service.js';
export * from './types.js';
export * from './monitor-service.js';
export function MonitorControlCommand(props) {
    const [displays, setDisplays] = useState([]);
    const [filterValue, setFilterValue] = useState('all');
    const [searchText, setSearchText] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const reloadDisplays = async () => {
        setIsLoading(true);
        try {
            const res = await listMonitorDisplays(props?.hostOverride);
            if (!res.ok) {
                await showToast({
                    style: Toast.Style.Failure,
                    title: '扫描显示器失败',
                    message: res.error || '无法读取系统显示器列表'
                });
                return;
            }
            setDisplays(res.displays);
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        let cancelled = false;
        let seq = 0;
        const init = async () => {
            const mySeq = ++seq;
            setIsLoading(true);
            try {
                if (props?.featureCode === 'monitor-sleep') {
                    const sleepRes = await triggerSleepAllMonitors(props?.hostOverride);
                    if (sleepRes.ok) {
                        await showToast({
                            style: Toast.Style.Success,
                            title: '已发送全屏熄屏信号',
                            message: '显示器背光已关闭，移动鼠标或按任意键即可唤醒'
                        });
                    }
                }
                const res = await listMonitorDisplays(props?.hostOverride);
                if (cancelled || mySeq !== seq)
                    return;
                if (res.ok) {
                    setDisplays(res.displays);
                }
            }
            finally {
                if (!cancelled && mySeq === seq) {
                    setIsLoading(false);
                }
            }
        };
        void init();
        return () => {
            cancelled = true;
        };
    }, [props?.featureCode, props?.hostOverride]);
    const supportedCount = useMemo(() => displays.filter((d) => d.supportsBrightness).length, [displays]);
    const filteredDisplays = useMemo(() => filterMonitorDisplays(displays, filterValue, searchText), [displays, filterValue, searchText]);
    const handleAdjustBrightness = async (display, targetBrightness) => {
        const res = await setMonitorBrightness(display, targetBrightness, displays, props?.hostOverride);
        if (!res.ok) {
            await showToast({
                style: Toast.Style.Failure,
                title: res.errorCode === 'DDC_UNSUPPORTED'
                    ? '该显示器不支持 DDC/CI 硬件调光'
                    : '调节亮度失败',
                message: res.error || '请检查显示器 OSD 菜单中 DDC/CI 开关是否已开启'
            });
            return;
        }
        if (res.updatedDisplays) {
            setDisplays(res.updatedDisplays);
        }
        await showToast({
            style: Toast.Style.Success,
            title: `${display.name} 亮度已设为 ${res.brightness}%`,
            message: display.protocolLabel
        });
    };
    const handleSyncAll = async (targetBrightness) => {
        const res = await syncAllMonitorsBrightness(targetBrightness, displays, props?.hostOverride);
        if (!res.ok) {
            await showToast({
                style: Toast.Style.Failure,
                title: '多屏亮度同步失败',
                message: res.error || '当前无支持硬件调光的显示器'
            });
            return;
        }
        if (res.updatedDisplays) {
            setDisplays(res.updatedDisplays);
        }
        await showToast({
            style: Toast.Style.Success,
            title: `已将全部受支持显示器同步设为 ${res.brightness}% 亮度`,
            message: `共更新 ${supportedCount} 台显示器`
        });
    };
    const handleSleepAll = async () => {
        const res = await triggerSleepAllMonitors(props?.hostOverride);
        if (!res.ok) {
            await showToast({
                style: Toast.Style.Failure,
                title: '关闭屏幕电源失败',
                message: res.error || '无法发送 SC_MONITORPOWER 指令'
            });
            return;
        }
        await showToast({
            style: Toast.Style.Success,
            title: '已关闭所有显示器电源',
            message: '后台任务继续运行，移动鼠标或按键即可亮屏'
        });
    };
    return (React.createElement(List, { isLoading: isLoading, searchBarPlaceholder: "\u641C\u7D22\u663E\u793A\u5668\u540D\u79F0\u3001\u5206\u8FA8\u7387\u6216\u63A7\u5236\u534F\u8BAE...", onSearchTextChange: setSearchText, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u7B5B\u9009\u663E\u793A\u5668\u7C7B\u578B", value: filterValue, onChange: (val) => setFilterValue(val) },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u663E\u793A\u5668", value: "all" }),
            React.createElement(List.Dropdown.Item, { title: "\u5916\u63A5 DDC/CI \u663E\u793A\u5668", value: "ddcci" }),
            React.createElement(List.Dropdown.Item, { title: "\u5185\u7F6E\u7B14\u8BB0\u672C\u5C4F\u5E55", value: "internal" })), filterBar: {
            summaryText: `已连接 ${displays.length} 台显示器（${supportedCount} 台支持硬件调光）`,
            actions: [
                {
                    id: 'sleep-all',
                    title: '立即熄屏省电',
                    style: 'primary',
                    onAction: () => {
                        void handleSleepAll();
                    }
                },
                {
                    id: 'sync-50',
                    title: '全屏统一 50% 亮度',
                    style: 'secondary',
                    onAction: () => {
                        void handleSyncAll(50);
                    }
                }
            ]
        } }, filteredDisplays.length === 0 ? (React.createElement(List.Section, { title: "\u68C0\u6D4B\u7ED3\u679C" },
        React.createElement(List.Item, { id: "empty-displays", icon: Icon.Monitor, title: "\u672A\u68C0\u6D4B\u5230\u5339\u914D\u7684\u663E\u793A\u5668", subtitle: "\u8BF7\u786E\u8BA4\u5916\u63A5\u663E\u793A\u5668\u7EBF\u6750\u5DF2\u8FDE\u63A5\uFF0C\u6216\u5207\u6362\u53F3\u4E0A\u89D2\u7B5B\u9009\u7C7B\u578B\u91CD\u8BD5", actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u91CD\u65B0\u626B\u63CF\u8FDE\u63A5\u7684\u663E\u793A\u5668", icon: Icon.ArrowClockwise, onAction: () => {
                        void reloadDisplays();
                    } }),
                React.createElement(Action, { title: "\u7ACB\u5373\u5173\u95ED\u6240\u6709\u5C4F\u5E55\u7535\u6E90\uFF08\u7184\u5C4F\uFF09", icon: Icon.Power, style: Action.Style.Destructive, onAction: () => {
                        void handleSleepAll();
                    } })) }))) : (React.createElement(List.Section, { title: "\u663E\u793A\u5668\u5217\u8868", subtitle: `${filteredDisplays.length} 台设备` }, filteredDisplays.map((display) => {
        const currentBri = display.brightness ?? 50;
        return (React.createElement(List.Item, { key: display.id, id: display.id, title: display.name, subtitle: `${display.resolution} · ${display.isPrimary ? '主显示器' : '扩展屏'}`, icon: Icon.Monitor, accessories: [
                display.supportsBrightness
                    ? { tag: display.protocolLabel }
                    : { tag: { value: '不支持 DDC/CI', color: Color.Red } },
                {
                    text: display.brightness !== null
                        ? `亮度 ${display.brightness}%`
                        : '仅支持系统熄屏'
                }
            ], actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u4EAE\u5EA6 +10%", icon: Icon.Plus, onAction: () => {
                        void handleAdjustBrightness(display, currentBri + 10);
                    } }),
                React.createElement(Action, { title: "\u4EAE\u5EA6 -10%", icon: Icon.Minus, shortcut: { modifiers: ['ctrl'], key: 'enter' }, onAction: () => {
                        void handleAdjustBrightness(display, currentBri - 10);
                    } }),
                BRIGHTNESS_PRESETS.map((preset) => (React.createElement(Action, { key: preset.id, title: preset.label, icon: Icon.Monitor, shortcut: { modifiers: ['ctrl'], key: preset.shortcutKey }, onAction: () => {
                        void handleAdjustBrightness(display, preset.value);
                    } }))),
                React.createElement(Action, { title: `所有显示器同步设为 ${currentBri}% 亮度`, icon: Icon.ArrowClockwise, shortcut: { modifiers: ['ctrl', 'shift'], key: 's' }, onAction: () => {
                        void handleSyncAll(currentBri);
                    } }),
                React.createElement(Action, { title: "\u7ACB\u5373\u5173\u95ED\u6240\u6709\u5C4F\u5E55\u7535\u6E90\uFF08\u7184\u5C4F\uFF09", icon: Icon.Power, style: Action.Style.Destructive, shortcut: { modifiers: ['ctrl', 'shift'], key: 'l' }, onAction: () => {
                        void handleSleepAll();
                    } }),
                React.createElement(Action, { title: "\u91CD\u65B0\u626B\u63CF\u8FDE\u63A5\u7684\u663E\u793A\u5668", icon: Icon.ArrowClockwise, shortcut: { modifiers: ['ctrl'], key: 'r' }, onAction: () => {
                        void reloadDisplays();
                    } })) }));
    })))));
}
export default MonitorControlCommand;
