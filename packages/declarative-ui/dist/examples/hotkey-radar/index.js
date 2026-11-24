import React, { Action, ActionPanel, Color, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { HIGH_CONFLICT_HOTKEY_PRESETS } from './cheatsheet-data.js';
import { filterCheatsheetItems, killHotkeySuspectProcess, parseAndNormalizeHotkeyCombo, probeGlobalHotkeys } from './hotkey-service.js';
export * from './types.js';
export * from './cheatsheet-data.js';
export * from './hotkey-service.js';
export function HotkeyRadarCommand(props = {}) {
    const initialMode = props.featureCode === 'hotkey-cheatsheet' ? 'sheet:all' : 'conflict';
    const [modeFilter, setModeFilter] = useState(initialMode);
    const [searchText, setSearchText] = useState('');
    const [probedKeys, setProbedKeys] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const reloadConflictScan = async (customCombo) => {
        setIsLoading(true);
        try {
            const results = await probeGlobalHotkeys(HIGH_CONFLICT_HOTKEY_PRESETS, customCombo, props.hostOverride);
            setProbedKeys(results);
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        void reloadConflictScan();
    }, []);
    const parsedCustomCombo = useMemo(() => {
        if (!searchText.includes('+'))
            return null;
        return parseAndNormalizeHotkeyCombo(searchText);
    }, [searchText]);
    const filteredConflictItems = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        const normalizedSearch = parsedCustomCombo?.valid
            ? parsedCustomCombo.normalized.toLowerCase()
            : q;
        return probedKeys.filter((item) => {
            if (modeFilter === 'conflict:occupied' && !item.isOccupied) {
                return false;
            }
            if (!normalizedSearch)
                return true;
            return `${item.keyCombo} ${item.title} ${item.subtitle} ${item.suspectApp ?? ''}`
                .toLowerCase()
                .includes(normalizedSearch);
        });
    }, [probedKeys, modeFilter, searchText, parsedCustomCombo]);
    const filteredSheetItems = useMemo(() => {
        if (!modeFilter.startsWith('sheet:'))
            return [];
        return filterCheatsheetItems(modeFilter, searchText);
    }, [modeFilter, searchText]);
    const occupiedCount = useMemo(() => probedKeys.filter((k) => k.isOccupied).length, [probedKeys]);
    const handleProbeSingleKey = async (combo) => {
        const parsed = parseAndNormalizeHotkeyCombo(combo);
        if (!parsed.valid) {
            await showToast({
                style: Toast.Style.Failure,
                title: parsed.error || '快捷键格式无效'
            });
            return;
        }
        await reloadConflictScan(parsed.normalized);
        await showToast({
            style: Toast.Style.Success,
            title: `已完成组合键 ${parsed.normalized} 实时占用探测`
        });
    };
    const handleKillSuspectProcess = async (item) => {
        const res = await killHotkeySuspectProcess(item, props.hostOverride);
        if (!res.ok) {
            await showToast({
                style: Toast.Style.Failure,
                title: res.error || '结束嫌疑占用进程失败'
            });
            return;
        }
        await showToast({
            style: Toast.Style.Success,
            title: `已结束占用热键 ${item.keyCombo} 的嫌疑进程 (${item.suspectApp})`
        });
        await reloadConflictScan();
    };
    const isConflictMode = modeFilter.startsWith('conflict');
    const summaryText = isConflictMode
        ? `已检测 ${probedKeys.length} 组高频全局热键 · 发现 ${occupiedCount} 组已被后台程序抢占`
        : `快捷键速查库 · 当前匹配 ${filteredSheetItems.length} 条高频生产力快捷键`;
    return (React.createElement(List, { navigationTitle: "\u70ED\u952E\u51B2\u7A81\u4FA6\u6D4B\u4E0E\u5FEB\u6377\u952E\u901F\u67E5", isLoading: isLoading, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u8F93\u5165\u8981\u6D4B\u8BD5\u7684\u7EC4\u5408\u952E\uFF08\u5982 Ctrl+Alt+A\uFF09\u6216\u641C\u7D22\u529F\u80FD\u540D\uFF08\u5982 \u51BB\u7ED3\u7A97\u683C\u3001\u5206\u5C4F\uFF09...", searchBarAccessory: React.createElement(List.Dropdown, { value: modeFilter, onChange: (val) => setModeFilter(val), tooltip: "\u5207\u6362\u51B2\u7A81\u4FA6\u6D4B\u6216\u5FEB\u6377\u952E\u901F\u67E5" },
            React.createElement(List.Dropdown.Section, { title: "\u70ED\u952E\u51B2\u7A81\u6392\u67E5" },
                React.createElement(List.Dropdown.Item, { title: "\u5168\u5C40\u70ED\u952E\u51B2\u7A81\u4FA6\u6D4B\u96F7\u8FBE", value: "conflict", icon: Icon.Terminal }),
                React.createElement(List.Dropdown.Item, { title: "\u4EC5\u770B\u5F53\u524D\u5DF2\u88AB\u5360\u7528\u7684\u51B2\u7A81\u70ED\u952E", value: "conflict:occupied", icon: Icon.ExclamationMark })),
            React.createElement(List.Dropdown.Section, { title: "\u9AD8\u9891\u5FEB\u6377\u952E\u901F\u67E5\u5B57\u5178" },
                React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u9AD8\u9891\u5FEB\u6377\u952E\u901F\u67E5", value: "sheet:all", icon: Icon.Document }),
                React.createElement(List.Dropdown.Item, { title: "Windows / macOS \u7CFB\u7EDF\u7EA7", value: "sheet:os", icon: Icon.Desktop }),
                React.createElement(List.Dropdown.Item, { title: "VS Code \u6781\u5BA2\u5F00\u53D1", value: "sheet:vscode", icon: Icon.Code }),
                React.createElement(List.Dropdown.Item, { title: "Excel \u804C\u573A\u529E\u516C", value: "sheet:excel", icon: Icon.Document }),
                React.createElement(List.Dropdown.Item, { title: "Photoshop \u8BBE\u8BA1", value: "sheet:ps", icon: Icon.Image }),
                React.createElement(List.Dropdown.Item, { title: "Chrome / Edge \u6D4F\u89C8\u5668", value: "sheet:browser", icon: Icon.Globe }))), filterBar: {
            summaryText,
            actions: [
                {
                    id: 'rescan',
                    title: '重新扫描占用',
                    onAction: () => {
                        void reloadConflictScan(parsedCustomCombo?.valid ? parsedCustomCombo.normalized : undefined);
                    }
                },
                {
                    id: 'switch-sheet',
                    title: isConflictMode ? '切至快捷键速查库' : '切至热键冲突雷达',
                    onAction: () => {
                        setModeFilter(isConflictMode ? 'sheet:all' : 'conflict');
                    }
                }
            ]
        } }, isConflictMode ? (React.createElement(List.Section, { title: "\u5168\u5C40\u70ED\u952E\u5B9E\u65F6\u51B2\u7A81\u63A2\u6D4B\u7ED3\u679C", subtitle: "\u975E\u4FB5\u5165\u5F0F\u77AC\u95F4\u63A2\u6D4B\u5E76\u7ACB\u5373\u91CA\u653E\u9501\uFF0C\u5DF2\u88AB\u5360\u7528\u7684\u51B2\u7A81\u70ED\u952E\u7F6E\u9876\u6807\u7EA2" },
        parsedCustomCombo && parsedCustomCombo.valid && (React.createElement(List.Item, { id: `probe-custom-${parsedCustomCombo.normalized}`, title: `立即实时探测组合键: ${parsedCustomCombo.normalized}`, subtitle: "\u6309 Enter \u8C03\u7528\u7CFB\u7EDF RegisterHotKey \u63A2\u6D4B\u8BE5\u7EC4\u5408\u952E\u662F\u5426\u7A7A\u95F2", icon: Icon.Terminal, accessories: [{ tag: '实时探测' }], actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: `探测 ${parsedCustomCombo.normalized} 占用状态`, icon: Icon.ArrowClockwise, onAction: () => handleProbeSingleKey(parsedCustomCombo.normalized) }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5FEB\u6377\u952E\u7EC4\u5408", content: parsedCustomCombo.normalized })) })),
        filteredConflictItems.map((item) => (React.createElement(List.Item, { key: item.id, id: item.id, title: `${item.keyCombo}  —  ${item.title}`, subtitle: item.subtitle, icon: item.isOccupied ? Icon.ExclamationMark : Icon.Terminal, accessories: [
                item.isOccupied
                    ? {
                        tag: {
                            value: `已被占用 (${item.suspectApp || '后台进程'})`,
                            color: Color.Red
                        }
                    }
                    : { tag: item.categoryLabel },
                { text: item.statusText }
            ], actions: React.createElement(ActionPanel, null,
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5FEB\u6377\u952E\u7EC4\u5408", content: item.keyCombo }),
                item.isOccupied && item.suspectPid && !item.isSystemReserved && (React.createElement(Action, { title: `结束嫌疑占用进程 (${item.suspectApp})`, icon: Icon.XMarkCircle, style: Action.Style.Destructive, onAction: () => handleKillSuspectProcess(item) })),
                React.createElement(Action, { title: "\u91CD\u65B0\u6D4B\u8BD5\u6B64\u7EC4\u5408\u952E\u72B6\u6001", icon: Icon.ArrowClockwise, onAction: () => handleProbeSingleKey(item.keyCombo) })) }))))) : (React.createElement(List.Section, { title: "\u4E94\u5927\u5E38\u7528\u8F6F\u4EF6\u9AD8\u9891\u5FEB\u6377\u952E\u79BB\u7EBF\u901F\u67E5\u5B57\u5178", subtitle: `匹配 ${filteredSheetItems.length} 条生产力快捷键` }, filteredSheetItems.map((sheet) => (React.createElement(List.Item, { key: sheet.id, id: sheet.id, title: `${sheet.keyCombo}  —  ${sheet.title}`, subtitle: sheet.subtitle, icon: Icon.Terminal, accessories: [
            { tag: sheet.categoryLabel },
            sheet.macKeyCombo ? { text: `macOS: ${sheet.macKeyCombo}` } : { text: '通用热键' }
        ], actions: React.createElement(ActionPanel, null,
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5FEB\u6377\u952E\u7EC4\u5408", content: sheet.keyCombo }),
            React.createElement(Action, { title: "\u63A2\u6D4B\u6B64\u5FEB\u6377\u952E\u662F\u5426\u88AB\u540E\u53F0\u8F6F\u4EF6\u62A2\u5360", icon: Icon.ExclamationMark, onAction: () => {
                    setModeFilter('conflict');
                    void handleProbeSingleKey(sheet.keyCombo);
                } })) })))))));
}
export default HotkeyRadarCommand;
