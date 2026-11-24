import React, { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { CAFFEINE_PRESETS, getCaffeineStatus, getDefaultInactiveStatus, startCaffeineSession, stopCaffeineSession, toggleCaffeineSession } from './caffeine-service.js';
export * from './types.js';
export * from './caffeine-service.js';
export function CaffeineCommand(props) {
    const [mode, setMode] = useState('display');
    const [status, setStatus] = useState(() => getDefaultInactiveStatus('display'));
    const [searchText, setSearchText] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const refreshStatus = async () => {
        const res = await getCaffeineStatus(props?.hostOverride);
        if (res.ok && res.status) {
            setStatus(res.status);
            setMode(res.status.mode);
        }
    };
    useEffect(() => {
        let cancelled = false;
        const init = async () => {
            setIsLoading(true);
            try {
                if (props?.featureCode === 'caffeine-toggle') {
                    const toggleRes = await toggleCaffeineSession(mode, props?.hostOverride);
                    if (!cancelled && toggleRes.ok && toggleRes.status) {
                        setStatus(toggleRes.status);
                        setMode(toggleRes.status.mode);
                        await showToast({
                            style: Toast.Style.Success,
                            title: toggleRes.status.active ? '已开启防休眠常亮' : '已关闭防休眠（恢复系统电源策略）',
                            message: toggleRes.status.active ? toggleRes.status.remainingText : undefined
                        });
                        return;
                    }
                }
                const res = await getCaffeineStatus(props?.hostOverride);
                if (!cancelled && res.ok && res.status) {
                    setStatus(res.status);
                    setMode(res.status.mode);
                }
            }
            finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };
        void init();
        return () => {
            cancelled = true;
        };
    }, [props?.featureCode, props?.hostOverride]);
    // 成对清理倒计时刷新定时器，严禁产生僵尸定时器
    useEffect(() => {
        if (!status.active || status.expiresAtMs === null) {
            return;
        }
        const timer = setInterval(() => {
            void refreshStatus();
        }, 1000);
        return () => {
            clearInterval(timer);
        };
    }, [status.active, status.expiresAtMs, props?.hostOverride]);
    const filteredPresets = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        if (!q)
            return CAFFEINE_PRESETS;
        return CAFFEINE_PRESETS.filter((p) => p.title.toLowerCase().includes(q) ||
            p.subtitle.toLowerCase().includes(q) ||
            String(p.minutes).includes(q));
    }, [searchText]);
    const handleStartPreset = async (preset, targetMode = mode) => {
        const res = await startCaffeineSession(preset.minutes, targetMode, props?.hostOverride);
        if (!res.ok || !res.status) {
            await showToast({
                style: Toast.Style.Failure,
                title: '开启防休眠失败',
                message: res.error || '无法设置系统电源执行状态'
            });
            return;
        }
        setStatus(res.status);
        await showToast({
            style: Toast.Style.Success,
            title: `已开启防休眠：${preset.title}`,
            message: targetMode === 'display'
                ? '保持屏幕常亮 + 阻止系统休眠'
                : '允许息屏但保持系统后台运行'
        });
    };
    const handleStop = async () => {
        const res = await stopCaffeineSession(props?.hostOverride);
        if (!res.ok || !res.status) {
            await showToast({
                style: Toast.Style.Failure,
                title: '停止防休眠失败',
                message: res.error || '无法恢复系统默认休眠策略'
            });
            return;
        }
        setStatus(res.status);
        await showToast({
            style: Toast.Style.Success,
            title: '已停止防休眠',
            message: '系统已恢复默认电源与锁屏策略'
        });
    };
    return (React.createElement(List, { isLoading: isLoading, searchBarPlaceholder: "\u9009\u62E9\u9632\u4F11\u7720\u6301\u7EED\u65F6\u95F4\uFF08\u56DE\u8F66\u7ACB\u5373\u751F\u6548\uFF09...", onSearchTextChange: setSearchText, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u9632\u4F11\u7720\u4FDD\u6D3B\u6A21\u5F0F", value: mode, onChange: (val) => setMode(val) },
            React.createElement(List.Dropdown.Item, { title: "\u4FDD\u6301\u5C4F\u5E55\u5E38\u4EAE + \u9632\u7CFB\u7EDF\u4F11\u7720\uFF08\u63A8\u8350\uFF09", value: "display" }),
            React.createElement(List.Dropdown.Item, { title: "\u5141\u8BB8\u606F\u5C4F\u4F46\u4FDD\u6301\u7CFB\u7EDF\u540E\u53F0\u8FD0\u884C\uFF08\u4E0B\u8F7D/\u7F16\u8BD1\u4E13\u7528\uFF09", value: "system" })), filterBar: {
            summaryText: status.active
                ? `状态：防休眠已开启 | 剩余时间：${status.remainingText}`
                : '状态：未开启（系统按默认电源策略休眠）',
            actions: status.active
                ? [
                    {
                        id: 'stop-caffeine',
                        title: '立即停止防休眠',
                        style: 'primary',
                        onAction: () => {
                            void handleStop();
                        }
                    }
                ]
                : [
                    {
                        id: 'start-infinite',
                        title: '开启无限期常亮',
                        style: 'primary',
                        onAction: () => {
                            const inf = CAFFEINE_PRESETS[0];
                            void handleStartPreset(inf, mode);
                        }
                    },
                    {
                        id: 'start-60m',
                        title: '开启 1 小时常亮',
                        style: 'secondary',
                        onAction: () => {
                            const p60 = CAFFEINE_PRESETS.find((p) => p.minutes === 60) ?? CAFFEINE_PRESETS[3];
                            void handleStartPreset(p60, mode);
                        }
                    }
                ]
        } },
        React.createElement(List.Section, { title: "\u9632\u4F11\u7720\u65F6\u957F\u9884\u8BBE", subtitle: "\u5230\u671F\u540E\u81EA\u52A8\u6062\u590D\u7CFB\u7EDF\u9ED8\u8BA4\u4F11\u7720\u4E0E\u606F\u5C4F\u8BBE\u7F6E" }, filteredPresets.map((preset) => {
            const isCurrentActive = status.active && status.durationMinutes === preset.minutes;
            return (React.createElement(List.Item, { key: preset.id, id: preset.id, title: preset.title, subtitle: preset.subtitle, icon: isCurrentActive ? Icon.CheckCircle : Icon.Clock, accessories: [
                    isCurrentActive
                        ? { tag: `生效中 · ${status.remainingText}` }
                        : { text: preset.minutes === 0 ? '手动关闭' : '自动到期恢复' }
                ], actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: `开启：${preset.title}`, icon: Icon.Bolt, onAction: () => {
                            void handleStartPreset(preset, mode);
                        } }),
                    status.active && (React.createElement(Action, { title: "\u505C\u6B62\u9632\u4F11\u7720\uFF08\u6062\u590D\u7CFB\u7EDF\u9ED8\u8BA4\u8BBE\u7F6E\uFF09", icon: Icon.XMarkCircle, shortcut: { modifiers: ['ctrl'], key: 'x' }, onAction: () => {
                            void handleStop();
                        } }))) }));
        }))));
}
export default CaffeineCommand;
