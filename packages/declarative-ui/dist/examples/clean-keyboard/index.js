import React, { Action, ActionPanel, Color, Detail, Form, Icon, List, Toast, showToast, useEffect, useNavigation, useState } from '../../index.js';
import { CLEAN_DURATION_PRESETS, defaultKeyboardLockManager, formatCleanDuration } from './keyboard-lock-service.js';
export * from './types.js';
export * from './keyboard-lock-service.js';
export function CleanKeyboardDetailView({ preset, onStateChange, hostOverride }) {
    const state = defaultKeyboardLockManager.getState();
    const stats = defaultKeyboardLockManager.getStats();
    const markdown = `
# ${state.status === 'locked' ? '键盘正在锁定清洁中' : `键盘清洁防误触锁 (${preset?.title || '就绪'})`}

> **紧急解锁热键**: 随时按下 \`${state.emergencyShortcut.display}\` 即可立即解除键盘锁定。

---

### 当前状态
- **锁状态**: \`${state.status.toUpperCase()}\`
- **剩余时间**: \`${state.status === 'locked' ? formatCleanDuration(state.remainingSeconds) : formatCleanDuration(preset?.seconds)}\`
- **本次已拦截误触按键**: \`${state.blockedKeystrokes} 次\` ${state.lastBlockedKey ? `(最近拦截: \`${state.lastBlockedKey}\`)` : ''}

### 历史清洁统计
- **累计清洁次数**: \`${stats.totalSessions} 次\`
- **累计锁定时长**: \`${formatCleanDuration(stats.totalCleanedSeconds)}\`
- **累计防误触拦截**: \`${stats.totalBlockedKeystrokes} 次按键\`
`;
    return (React.createElement(Detail, { navigationTitle: "\u952E\u76D8\u6E05\u6D01\u9501\u8BE6\u60C5", markdown: markdown, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.TagList, { title: "\u9501\u5B9A\u72B6\u6001" },
                React.createElement(Detail.Metadata.TagList.Item, { text: state.status === 'locked' ? 'LOCKED (已锁定)' : 'UNLOCKED (正常输入)', color: state.status === 'locked' ? Color.Red : Color.SecondaryText })),
            React.createElement(Detail.Metadata.Label, { title: "\u7D27\u6025\u89E3\u9501\u70ED\u952E", text: state.emergencyShortcut.display, icon: Icon.Key }),
            React.createElement(Detail.Metadata.Label, { title: "\u672C\u6B21\u62E6\u622A\u6309\u952E", text: `${state.blockedKeystrokes} 次`, icon: Icon.Shield }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.Label, { title: "\u7D2F\u8BA1\u6E05\u6D01\u4F1A\u8BDD", text: `${stats.totalSessions} 次`, icon: Icon.Clock }),
            React.createElement(Detail.Metadata.Label, { title: "\u7D2F\u8BA1\u62E6\u622A\u8BEF\u89E6", text: `${stats.totalBlockedKeystrokes} 次`, icon: Icon.Checkmark })), actions: React.createElement(ActionPanel, null, state.status === 'locked' ? (React.createElement(Action, { title: "\u7ACB\u5373\u89E3\u9501\u952E\u76D8 (Unlock Keyboard)", icon: Icon.Unlock, shortcut: { modifiers: ['ctrl'], key: 'u' }, onAction: async () => {
                const res = await defaultKeyboardLockManager.unlockKeyboard('manual', hostOverride);
                await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                onStateChange?.();
            } })) : (React.createElement(Action, { title: `立即锁定 (${preset?.title || '30 秒'})`, icon: Icon.Lock, onAction: async () => {
                const res = await defaultKeyboardLockManager.lockKeyboard(preset ? preset.seconds : 30, {
                    presetTitle: preset?.title,
                    icon: preset?.icon,
                    hostOverride
                });
                await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                onStateChange?.();
            } }))) }));
}
export function CustomDurationForm({ onLocked, hostOverride }) {
    const { pop } = useNavigation();
    return (React.createElement(Form, { navigationTitle: "\u81EA\u5B9A\u4E49\u952E\u76D8\u6E05\u6D01\u9501\u5B9A\u65F6\u957F", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u542F\u52A8\u952E\u76D8\u9501\u5B9A", icon: Icon.Lock, onSubmit: async (values) => {
                    const seconds = Number(values.seconds);
                    const res = await defaultKeyboardLockManager.lockKeyboard(seconds, {
                        presetTitle: `自定义 ${seconds} 秒清洁锁`,
                        icon: 'custom',
                        hostOverride
                    });
                    if (!res.success) {
                        await showToast(Toast.Style.Failure, res.message);
                        return;
                    }
                    await showToast(Toast.Style.Success, res.message);
                    onLocked?.();
                    pop();
                } })) },
        React.createElement(Form.TextField, { id: "seconds", title: "\u9501\u5B9A\u65F6\u957F (\u79D2)", placeholder: "\u8F93\u5165\u6B63\u6574\u6570\u79D2\u6570\uFF0C\u5982 45\u300190\u3001180...", defaultValue: "45" })));
}
export function CleanKeyboardCommand(props) {
    const [, setTickVersion] = useState(0);
    const refresh = () => setTickVersion((v) => v + 1);
    const { push } = useNavigation();
    const state = defaultKeyboardLockManager.getState();
    const stats = defaultKeyboardLockManager.getStats();
    // 锁定期间每秒推进倒计时，并在组件卸载时成对清理定时器
    useEffect(() => {
        if (state.status !== 'locked' || state.remainingSeconds === null) {
            return;
        }
        const timer = setInterval(() => {
            void defaultKeyboardLockManager.tick(1).then(() => {
                refresh();
            });
        }, 1000);
        return () => {
            clearInterval(timer);
        };
    }, [state.status, state.remainingSeconds]);
    return (React.createElement(List, { navigationTitle: "\u952E\u76D8\u6E05\u6D01\u9632\u8BEF\u89E6\u9501 (Clean Keyboard)", searchBarPlaceholder: "\u9009\u62E9\u952E\u76D8\u9501\u5B9A\u65F6\u957F (\u6E05\u6D01\u952E\u76D8\u3001\u64E6\u5C4F\u5E55\u3001\u9632\u732B\u8E29\u952E\u76D8)...", filterBar: {
            summaryText: state.status === 'locked'
                ? `键盘锁定中 (剩余 ${formatCleanDuration(state.remainingSeconds)}) | 本次已拦截 ${state.blockedKeystrokes} 次按键`
                : `键盘正常输入未锁定 | 累计防误触拦截 ${stats.totalBlockedKeystrokes} 次按键`,
            actions: state.status === 'locked'
                ? [
                    {
                        id: 'unlock-now',
                        title: '立即解锁键盘 (Ctrl+U)',
                        style: 'danger',
                        onAction: async () => {
                            const res = await defaultKeyboardLockManager.unlockKeyboard('manual', props?.hostOverride);
                            await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                            refresh();
                        }
                    },
                    {
                        id: 'view-stats',
                        title: '查看清洁统计',
                        style: 'secondary',
                        onAction: () => {
                            push(React.createElement(CleanKeyboardDetailView, { onStateChange: refresh, hostOverride: props?.hostOverride }));
                        }
                    }
                ]
                : [
                    {
                        id: 'lock-30s',
                        title: '立即锁定 30 秒',
                        style: 'primary',
                        onAction: async () => {
                            const res = await defaultKeyboardLockManager.lockKeyboard(30, {
                                presetTitle: '30 秒标准清洁',
                                icon: '30s',
                                hostOverride: props?.hostOverride
                            });
                            await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                            refresh();
                        }
                    },
                    {
                        id: 'lock-2m',
                        title: '锁定 2 分钟',
                        style: 'secondary',
                        onAction: async () => {
                            const res = await defaultKeyboardLockManager.lockKeyboard(120, {
                                presetTitle: '2 分钟键帽清理',
                                icon: '2m',
                                hostOverride: props?.hostOverride
                            });
                            await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                            refresh();
                        }
                    }
                ]
        } },
        state.status === 'locked' && (React.createElement(List.Section, { title: "\u5F53\u524D\u5904\u4E8E\u952E\u76D8\u9501\u5B9A\u72B6\u6001 (\u6309 Ctrl+U \u7D27\u6025\u89E3\u9501)" },
            React.createElement(List.Item, { id: "active-lock-banner", icon: { source: Icon.Lock, tintColor: Color.Red }, title: `正在执行: ${state.activePresetTitle || '键盘清洁锁'}`, subtitle: `剩余时间: ${formatCleanDuration(state.remainingSeconds)} · 已拦截误触: ${state.blockedKeystrokes} 次`, accessories: [
                    { tag: { value: 'LOCKED', color: Color.Red } },
                    { text: `按 ${state.emergencyShortcut.display} 立即解锁` }
                ], actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: "\u7ACB\u5373\u89E3\u9501\u952E\u76D8 (Unlock Now)", icon: Icon.Unlock, shortcut: { modifiers: ['ctrl'], key: 'u' }, onAction: async () => {
                            const res = await defaultKeyboardLockManager.unlockKeyboard('manual', props?.hostOverride);
                            await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                            refresh();
                        } }),
                    React.createElement(Action.Push, { title: "\u67E5\u770B\u9501\u5B9A\u8BE6\u60C5\u770B\u677F", icon: Icon.Eye, target: React.createElement(CleanKeyboardDetailView, { onStateChange: refresh, hostOverride: props?.hostOverride }) })) }))),
        React.createElement(List.Section, { title: "\u9884\u8BBE\u6E05\u6D01\u9501\u5B9A\u65F6\u957F (Lock Duration Presets)", subtitle: `共 ${CLEAN_DURATION_PRESETS.length} 个档位` }, CLEAN_DURATION_PRESETS.map((preset) => (React.createElement(List.Item, { key: preset.id, id: preset.id, icon: Icon.Clock, title: preset.title, subtitle: preset.subtitle, accessories: [
                ...(preset.recommended ? [{ tag: '推荐' }] : []),
                { text: preset.display }
            ], actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: `锁定键盘: ${preset.display}`, icon: Icon.Lock, onAction: async () => {
                        const res = await defaultKeyboardLockManager.lockKeyboard(preset.seconds, {
                            presetTitle: preset.title,
                            icon: preset.icon,
                            hostOverride: props?.hostOverride
                        });
                        await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                        refresh();
                    } }),
                React.createElement(Action.Push, { title: "\u81EA\u5B9A\u4E49\u4EFB\u610F\u9501\u5B9A\u65F6\u957F...", icon: Icon.Clock, shortcut: { modifiers: ['ctrl'], key: 't' }, target: React.createElement(CustomDurationForm, { onLocked: refresh, hostOverride: props?.hostOverride }) }),
                React.createElement(Action.Push, { title: "\u67E5\u770B\u6E05\u6D01\u9501\u8BE6\u60C5\u4E0E\u5386\u53F2\u7EDF\u8BA1", icon: Icon.BarChart, target: React.createElement(CleanKeyboardDetailView, { preset: preset, onStateChange: refresh, hostOverride: props?.hostOverride }) })) }))))));
}
export default CleanKeyboardCommand;
