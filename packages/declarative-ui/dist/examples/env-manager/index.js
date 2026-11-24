import React, { Action, ActionPanel, Clipboard, Color, Form, Icon, List, Toast, showToast, useEffect, useMemo, useState, useNavigation } from '../../index.js';
import { cleanInvalidPathEntries, exportEnvSnapshot, filterEnvItems, loadAllEnvVariables, writeEnvVariable } from './env-service.js';
export * from './types.js';
export * from './env-service.js';
export function EnvVarForm({ initialItem, onSaved }) {
    const { pop } = useNavigation();
    const [key, setKey] = useState(initialItem?.key ?? '');
    const [value, setValue] = useState(initialItem?.value ?? '');
    const [scope, setScope] = useState(initialItem?.scope ?? 'user');
    const handleSubmit = async () => {
        if (!key.trim()) {
            await showToast({ style: Toast.Style.Failure, title: '变量名不能为空' });
            return;
        }
        onSaved({
            key: key.trim(),
            value: value.trim(),
            scope,
            isPathItem: initialItem?.isPathItem ?? false,
            index: initialItem?.index,
            isInvalid: false
        });
        await showToast({ style: Toast.Style.Success, title: `已保存变量 ${key.trim()}` });
        pop();
    };
    return (React.createElement(Form, { navigationTitle: initialItem ? '编辑环境变量' : '新建环境变量', actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u73AF\u5883\u53D8\u91CF", icon: Icon.CheckCircle, onSubmit: handleSubmit })) },
        React.createElement(Form.TextField, { id: "key", title: "\u53D8\u91CF\u540D", placeholder: "\u5982\uFF1AJAVA_HOME", value: key, onChange: setKey }),
        React.createElement(Form.TextField, { id: "value", title: "\u53D8\u91CF\u503C", placeholder: "\u5982\uFF1AC:\\Program Files\\Java\\jdk-21", value: value, onChange: setValue }),
        React.createElement(Form.Dropdown, { id: "scope", title: "\u4F5C\u7528\u57DF", value: scope, onChange: (v) => setScope(v) },
            React.createElement(Form.Dropdown.Item, { title: "\u5F53\u524D\u7528\u6237\u53D8\u91CF (HKCU\\Environment)", value: "user" }),
            React.createElement(Form.Dropdown.Item, { title: "\u5168\u5C40\u7CFB\u7EDF\u53D8\u91CF (HKLM)", value: "system" }))));
}
export function EnvManagerCommand(props = {}) {
    const { push } = useNavigation();
    const defaultCategory = props.featureCode === 'env-path-clean' ? 'path-invalid' : 'all';
    const [envItems, setEnvItems] = useState(props.initialItems ?? []);
    const [filterCategory, setFilterCategory] = useState(defaultCategory);
    const [searchText, setSearchText] = useState('');
    const [isLoading, setIsLoading] = useState(!props.initialItems);
    useEffect(() => {
        if (!props.initialItems) {
            void (async () => {
                setIsLoading(true);
                try {
                    const loaded = await loadAllEnvVariables(undefined, props.hostOverride);
                    setEnvItems(loaded);
                }
                finally {
                    setIsLoading(false);
                }
            })();
        }
    }, []);
    const invalidCount = useMemo(() => envItems.filter((x) => x.isPathItem && x.isInvalid).length, [envItems]);
    const filteredItems = useMemo(() => filterEnvItems(envItems, searchText, filterCategory), [envItems, searchText, filterCategory]);
    const handleCleanInvalidPaths = async () => {
        const rawPath = envItems
            .filter((x) => x.isPathItem)
            .map((x) => x.value)
            .join(';');
        const res = await cleanInvalidPathEntries({ rawPath }, props.hostOverride);
        const removed = res.removedCount || envItems.filter((x) => x.isPathItem && x.isInvalid).length;
        setEnvItems((prev) => prev.filter((x) => !(x.isPathItem && x.isInvalid)));
        await showToast({
            style: Toast.Style.Success,
            title: `已清理 ${removed} 个失效的 PATH 幽灵路径`
        });
    };
    const handleExportBackup = async () => {
        const json = exportEnvSnapshot(envItems);
        await Clipboard.copy(json);
        await showToast({
            style: Toast.Style.Success,
            title: '环境变量 JSON 备份快照已复制到剪贴板'
        });
    };
    const handleOpenCreateForm = () => {
        push(React.createElement(EnvVarForm, { onSaved: async (item) => {
                const res = await writeEnvVariable(item.key, item.value, item.scope, undefined, props.hostOverride);
                if (!res.ok) {
                    await showToast({
                        style: Toast.Style.Failure,
                        title: '写入环境变量失败',
                        message: res.error
                    });
                    return;
                }
                setEnvItems((prev) => [item, ...prev.filter((x) => x.key !== item.key || x.isPathItem)]);
            } }));
    };
    return (React.createElement(List, { isLoading: isLoading, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u53D8\u91CF\u540D\u3001\u8DEF\u5F84\u5173\u952E\u8BCD (\u5982: JAVA_HOME\u3001npm\u3001python) ...", searchBarAccessory: React.createElement(List.Dropdown, { value: filterCategory, onChange: (v) => setFilterCategory(v), tooltip: "\u7B5B\u9009\u53D8\u91CF\u5206\u7C7B" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u53D8\u91CF\u4E0E PATH \u62C6\u89E3", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "PATH \u660E\u7EC6 (\u542B\u5931\u6548\u6807\u7EA2)", value: "path", icon: Icon.Folder }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u67E5\u770B\u5931\u6548 PATH \u5E7D\u7075\u8DEF\u5F84", value: "path-invalid", icon: Icon.ExclamationMark }),
            React.createElement(List.Dropdown.Item, { title: "\u7528\u6237\u53D8\u91CF (User)", value: "user", icon: Icon.Key }),
            React.createElement(List.Dropdown.Item, { title: "\u7CFB\u7EDF\u53D8\u91CF (System)", value: "system", icon: Icon.Desktop })), filterBar: {
            summaryText: `共 ${envItems.length} 个条目 · 发现 ${invalidCount} 个已失效的 PATH 幽灵路径`,
            actions: [
                { id: 'clean-invalid', title: '一键清理失效 PATH', onAction: handleCleanInvalidPaths },
                { id: 'backup-env', title: '导出备份快照', onAction: handleExportBackup }
            ]
        } }, filteredItems.map((item, idx) => (React.createElement(List.Item, { key: `${item.scope}:${item.key}:${item.index ?? idx}`, id: `${item.scope}:${item.key}:${item.index ?? idx}`, title: item.isPathItem ? item.value : item.key, subtitle: item.isPathItem ? `[PATH #${(item.index ?? idx) + 1}] ${item.key}` : item.value, icon: item.isInvalid ? Icon.XMarkCircle : item.isPathItem ? Icon.Folder : Icon.Gear, accessories: [
            item.isInvalid
                ? { tag: { value: '失效路径', color: Color.Red } }
                : { tag: item.scope === 'system' ? '系统变量' : '用户变量' },
            { text: item.isInvalid ? '磁盘上不存在' : '' }
        ], actions: React.createElement(ActionPanel, null,
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u53D8\u91CF\u503C / \u8DEF\u5F84", content: item.value, icon: Icon.Clipboard }),
            invalidCount > 0 ? (React.createElement(Action, { title: "\u4E00\u952E\u79FB\u9664\u6240\u6709\u5931\u6548 PATH \u9879", icon: Icon.Trash, style: Action.Style.Destructive, shortcut: { modifiers: ['ctrl', 'shift'], key: 'backspace' }, onAction: handleCleanInvalidPaths })) : null,
            React.createElement(Action, { title: "\u65B0\u5EFA\u73AF\u5883\u53D8\u91CF", icon: Icon.Plus, shortcut: { modifiers: ['cmd'], key: 'n' }, onAction: handleOpenCreateForm }),
            React.createElement(Action, { title: "\u5BFC\u51FA\u5168\u91CF\u73AF\u5883\u53D8\u91CF\u5907\u4EFD\u5FEB\u7167", icon: Icon.Download, shortcut: { modifiers: ['cmd'], key: 's' }, onAction: handleExportBackup })) })))));
}
export default EnvManagerCommand;
