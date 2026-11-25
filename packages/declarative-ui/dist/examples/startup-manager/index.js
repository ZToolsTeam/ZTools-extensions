import React, { Action, ActionPanel, Color, Icon, List, Toast, confirmAlert, showToast, useEffect, useMemo, useState } from '../../index.js';
import { copyStartupCommandToClipboard, filterStartupItems, removeBrokenStartupItems, resolveInitialStartupFilter, revealStartupExeInFolder, scanStartupItems, setStartupItemEnabled } from './startup-service.js';
function renderStartupItemActions(params) {
    const { item, onToggle, onRevealExe, onCopyCommand, onRemoveBroken, onRescan } = params;
    return (React.createElement(ActionPanel, null,
        React.createElement(Action, { title: item.enabled ? '禁用此开机自启项' : '启用此开机自启项', icon: item.enabled ? Icon.XMarkCircle : Icon.CheckCircle, onAction: () => {
                onToggle(item);
            } }),
        item.exePath && (React.createElement(Action, { title: "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D\u7A0B\u5E8F", icon: Icon.Folder, onAction: () => {
                onRevealExe(item.exePath);
            } })),
        React.createElement(Action, { title: "\u590D\u5236\u542F\u52A8\u547D\u4EE4\u884C", icon: Icon.Clipboard, shortcut: { modifiers: ['ctrl'], key: 'c' }, onAction: () => {
                onCopyCommand(item.command);
            } }),
        item.fileMissing && (React.createElement(Action, { title: "\u5F7B\u5E95\u79FB\u9664\u6B64\u65E0\u6548\u6B8B\u7559\u9879", icon: Icon.Trash, style: Action.Style.Destructive, shortcut: { modifiers: ['ctrl'], key: 'backspace' }, onAction: () => {
                onRemoveBroken(item);
            } })),
        React.createElement(Action, { title: "\u91CD\u65B0\u626B\u63CF\u5168\u90E8\u542F\u52A8\u9879", icon: Icon.ArrowClockwise, shortcut: { modifiers: ['ctrl'], key: 'r' }, onAction: onRescan })));
}
export default function StartupManagerCommand(props) {
    const [items, setItems] = useState([]);
    const [sourceFilter, setSourceFilter] = useState(resolveInitialStartupFilter(props?.featureCode));
    const [searchText, setSearchText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const reloadItems = async () => {
        setIsLoading(true);
        try {
            const res = await scanStartupItems(props?.hostOverride);
            if (!res.ok) {
                await showToast({
                    style: Toast.Style.Failure,
                    title: '扫描启动项失败',
                    message: res.error || '请检查系统服务与注册表访问权限'
                });
                return;
            }
            setItems(res.items);
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
                const res = await scanStartupItems(props?.hostOverride);
                if (cancelled || mySeq !== seq)
                    return;
                if (res.ok) {
                    setItems(res.items);
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
    }, [props?.hostOverride]);
    useEffect(() => {
        if (props?.featureCode) {
            setSourceFilter(resolveInitialStartupFilter(props.featureCode));
        }
    }, [props?.featureCode]);
    const enabledCount = useMemo(() => items.filter((i) => i.enabled).length, [items]);
    const serviceCount = useMemo(() => items.filter((i) => i.source === 'service').length, [items]);
    const brokenCount = useMemo(() => items.filter((i) => i.fileMissing).length, [items]);
    const filteredItems = useMemo(() => filterStartupItems(items, sourceFilter, searchText), [items, sourceFilter, searchText]);
    const handleToggleItem = async (item) => {
        const targetEnabled = !item.enabled;
        const res = await setStartupItemEnabled(item, targetEnabled, items, props?.hostOverride);
        if (!res.ok) {
            await showToast({
                style: Toast.Style.Failure,
                title: res.errorCode === 'ADMIN_REQUIRED'
                    ? '需要管理员权限'
                    : '修改开机自启状态失败',
                message: res.error || '当前启动项状态保持不变'
            });
            return;
        }
        if (res.updatedItems) {
            setItems(res.updatedItems);
        }
        await showToast({
            style: Toast.Style.Success,
            title: targetEnabled
                ? `已恢复启用: ${item.name}`
                : `已禁用自启: ${item.name}`,
            message: `${item.sourceLabel} · ${targetEnabled ? '开机自动运行' : '已阻止后台自启'}`
        });
    };
    const handleRemoveSingleBroken = async (item) => {
        if (!item.fileMissing) {
            await showToast({
                style: Toast.Style.Failure,
                title: '仅允许清理无效残留项',
                message: '正常启动项请使用「禁用」功能，以保证操作可逆'
            });
            return;
        }
        const confirmed = await confirmAlert({
            title: `确认彻底清除无效残留启动项「${item.name}」？`,
            message: `目标可执行文件已丢失: ${item.exePath || item.command}`
        });
        if (!confirmed)
            return;
        const res = await removeBrokenStartupItems([item], items, props?.hostOverride);
        if (!res.ok) {
            await showToast({
                style: Toast.Style.Failure,
                title: '清理无效残留项失败',
                message: res.error || '请尝试使用管理员权限重试'
            });
            return;
        }
        if (res.remainingItems) {
            setItems(res.remainingItems);
        }
        await showToast({
            style: Toast.Style.Success,
            title: `已彻底移除残留项: ${item.name}`
        });
    };
    const handleCleanAllBroken = async () => {
        const brokenList = items.filter((i) => i.fileMissing);
        if (brokenList.length === 0) {
            await showToast({
                style: Toast.Style.Animated,
                title: '未发现无效残留启动项',
                message: '当前所有启动项指向的可执行文件均有效存在'
            });
            return;
        }
        const confirmed = await confirmAlert({
            title: `确认一键清理 ${brokenList.length} 个无效残留启动项？`,
            message: '这些启动项指向的程序已被卸载或丢失，清理后可保持系统注册表与任务列表整洁。'
        });
        if (!confirmed)
            return;
        const res = await removeBrokenStartupItems(brokenList, items, props?.hostOverride);
        if (!res.ok) {
            await showToast({
                style: Toast.Style.Failure,
                title: '批量清理残留启动项失败',
                message: res.error || '部分系统级条目需要管理员权限'
            });
            return;
        }
        if (res.remainingItems) {
            setItems(res.remainingItems);
        }
        await showToast({
            style: Toast.Style.Success,
            title: `已清理 ${res.removedCount} 个无效残留启动项`
        });
    };
    return (React.createElement(List, { navigationTitle: "\u542F\u52A8\u7BA1\u7406", isLoading: isLoading, isShowingDetail: false, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u81EA\u542F\u8F6F\u4EF6\u540D\u3001\u670D\u52A1\u540D\u3001\u53EF\u6267\u884C\u8DEF\u5F84\u6216\u5382\u5546...", searchBarAccessory: React.createElement(List.Dropdown, { value: sourceFilter, onChange: (val) => setSourceFilter(val), tooltip: "\u6309\u81EA\u542F\u4F4D\u7F6E\u6216\u72B6\u6001\u7B5B\u9009" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u81EA\u542F\u6E90", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u6CE8\u518C\u8868\u4E0E\u542F\u52A8\u76EE\u5F55", value: "app", icon: Icon.Window }),
            React.createElement(List.Dropdown.Item, { title: "\u7B2C\u4E09\u65B9\u540E\u53F0\u670D\u52A1 (Services)", value: "service", icon: Icon.Gear }),
            React.createElement(List.Dropdown.Item, { title: "\u7B2C\u4E09\u65B9\u8BA1\u5212\u4EFB\u52A1 (Tasks)", value: "task", icon: Icon.Clock }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u770B\u5DF2\u542F\u7528\u9879", value: "enabled", icon: Icon.CheckCircle }),
            React.createElement(List.Dropdown.Item, { title: "\u6B8B\u7559\u65E0\u6548\u542F\u52A8\u9879", value: "broken", icon: Icon.ExclamationMark })), filterBar: {
            summaryText: `共发现 ${items.length} 个自启项（已启用 ${enabledCount} 项 · 第三方服务 ${serviceCount} 项 · 无效残留 ${brokenCount} 项）`,
            actions: [
                {
                    id: 'rescan',
                    title: '重新扫描',
                    onAction: () => {
                        void reloadItems();
                    }
                },
                {
                    id: 'clean-broken',
                    title: '清理无效残留',
                    style: 'destructive',
                    onAction: () => {
                        void handleCleanAllBroken();
                    }
                }
            ]
        } }, filteredItems.length === 0 ? (React.createElement(List.Section, { title: "\u626B\u63CF\u7ED3\u679C" },
        React.createElement(List.Item, { id: "empty-startup", icon: Icon.CheckCircle, title: "\u5F53\u524D\u7B5B\u9009\u6761\u4EF6\u4E0B\u672A\u53D1\u73B0\u5F00\u673A\u81EA\u542F\u9879", subtitle: "\u53EF\u5207\u6362\u53F3\u4E0A\u89D2\u7B5B\u9009\u5206\u7C7B\uFF0C\u6216\u6309 Ctrl+R \u91CD\u65B0\u7A7F\u900F\u626B\u63CF", actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u91CD\u65B0\u626B\u63CF\u5168\u90E8\u542F\u52A8\u9879", icon: Icon.ArrowClockwise, shortcut: { modifiers: ['ctrl'], key: 'r' }, onAction: () => {
                        void reloadItems();
                    } })) }))) : (React.createElement(List.Section, { title: "\u5F00\u673A\u81EA\u542F\u4E0E\u540E\u53F0\u9A7B\u7559\u9879", subtitle: `${filteredItems.length} 项` }, filteredItems.map((item) => {
        const accessories = [
            ...(item.fileMissing ? [{ tag: { value: '文件已丢失', color: Color.Red } }] : []),
            { tag: item.sourceLabel },
            { text: item.enabled ? '已启用' : '已禁用' }
        ];
        return (React.createElement(List.Item, { key: item.id, id: item.id, title: item.name, subtitle: `${item.publisher ? `[${item.publisher}] ` : ''}${item.command}`, icon: item.enabled ? Icon.CheckCircle : Icon.Circle, accessories: accessories, actions: renderStartupItemActions({
                item,
                onToggle: (entry) => {
                    void handleToggleItem(entry);
                },
                onRevealExe: (exePath) => {
                    void revealStartupExeInFolder(exePath, props?.hostOverride);
                },
                onCopyCommand: async (cmd) => {
                    await copyStartupCommandToClipboard(cmd, props?.hostOverride);
                    await showToast({
                        style: Toast.Style.Success,
                        title: '已复制启动命令行'
                    });
                },
                onRemoveBroken: (entry) => {
                    void handleRemoveSingleBroken(entry);
                },
                onRescan: () => {
                    void reloadItems();
                }
            }) }));
    })))));
}
