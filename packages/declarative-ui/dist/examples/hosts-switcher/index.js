import React, { Action, ActionPanel, Form, Icon, List, Toast, showToast, useMemo, useState, useNavigation } from '../../index.js';
import { DEFAULT_HOSTS_PROFILES, applyCombinedHosts, buildCombinedHostsContent, flushDnsCache, parseHostsContent, readSystemHosts } from './hosts-service.js';
export * from './types.js';
export * from './hosts-service.js';
export function HostsProfileForm({ initialProfile, onSave }) {
    const { pop } = useNavigation();
    const [name, setName] = useState(initialProfile?.name ?? '');
    const [rawContent, setRawContent] = useState(initialProfile?.rawContent ?? '127.0.0.1       example.local');
    const handleSubmit = async () => {
        if (!name.trim()) {
            await showToast({ style: Toast.Style.Failure, title: '方案名称不能为空' });
            return;
        }
        const rules = parseHostsContent(rawContent);
        const validCount = rules.filter((r) => r.isValid).length;
        const invalidCount = rules.filter((r) => !r.isValid).length;
        onSave({
            id: initialProfile?.id || `hosts-${Date.now()}`,
            name: name.trim(),
            isEnabled: initialProfile?.isEnabled ?? true,
            isSystem: initialProfile?.isSystem ?? false,
            rawContent,
            rulesCount: validCount,
            invalidCount,
            updatedAt: Date.now(),
            updatedAtFormatted: '刚刚更新'
        });
        await showToast({ style: Toast.Style.Success, title: `已保存方案: ${name.trim()}` });
        pop();
    };
    return (React.createElement(Form, { navigationTitle: initialProfile ? '编辑 Hosts 方案' : '新建 Hosts 环境方案', actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u65B9\u6848", icon: Icon.CheckCircle, onSubmit: handleSubmit })) },
        React.createElement(Form.TextField, { id: "name", title: "\u65B9\u6848\u540D\u79F0", placeholder: "\u5982\uFF1A\u6D4B\u8BD5\u73AF\u5883\u96C6\u7FA4 A", value: name, onChange: setName }),
        React.createElement(Form.TextArea, { id: "rawContent", title: "Hosts \u6620\u5C04\u89C4\u5219", placeholder: "\u6BCF\u884C\u4E00\u6761\uFF1AIP \u57DF\u540D # \u5907\u6CE8", value: rawContent, onChange: setRawContent })));
}
export function HostsSwitcherCommand(props = {}) {
    const { push } = useNavigation();
    const [profiles, setProfiles] = useState(props.initialProfiles ?? DEFAULT_HOSTS_PROFILES);
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchText, setSearchText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    React.useEffect(() => {
        if (!props.initialProfiles) {
            void (async () => {
                const sysRes = await readSystemHosts(undefined, props.hostOverride);
                if (sysRes.ok && sysRes.content.trim()) {
                    const rules = parseHostsContent(sysRes.content);
                    const validCount = rules.filter((r) => r.isValid).length;
                    const invalidCount = rules.filter((r) => !r.isValid).length;
                    setProfiles((prev) => prev.map((p) => p.id === 'hosts-system'
                        ? {
                            ...p,
                            rawContent: sysRes.content,
                            rulesCount: validCount,
                            invalidCount
                        }
                        : p));
                }
            })();
        }
    }, []);
    const filteredProfiles = useMemo(() => {
        const byStatus = profiles.filter((p) => {
            if (filterStatus === 'enabled')
                return p.isEnabled;
            if (filterStatus === 'disabled')
                return !p.isEnabled;
            return true;
        });
        const q = searchText.trim().toLowerCase();
        if (!q)
            return byStatus;
        return byStatus.filter((p) => p.name.toLowerCase().includes(q) || p.rawContent.toLowerCase().includes(q));
    }, [profiles, filterStatus, searchText]);
    const activeCount = useMemo(() => profiles.filter((p) => p.isEnabled).length, [profiles]);
    const handleToggleProfile = async (profileId) => {
        const next = profiles.map((p) => p.id === profileId ? { ...p, isEnabled: !p.isEnabled } : p);
        setProfiles(next);
        setIsLoading(true);
        try {
            const merged = buildCombinedHostsContent(next);
            const res = await applyCombinedHosts(merged.combinedContent, undefined, props.hostOverride);
            if (!res.success) {
                await showToast({
                    style: Toast.Style.Failure,
                    title: '写入系统 Hosts 受阻',
                    message: res.error
                });
                return;
            }
            await showToast({
                style: Toast.Style.Success,
                title: `已生效 (${merged.activeRulesCount} 条映射) 并刷新 DNS`
            });
        }
        finally {
            setIsLoading(false);
        }
    };
    const handleFlushDns = async () => {
        setIsLoading(true);
        try {
            const res = await flushDnsCache(undefined, props.hostOverride);
            if (!res.success) {
                await showToast({
                    style: Toast.Style.Failure,
                    title: '刷新 DNS 缓存失败',
                    message: res.error
                });
                return;
            }
            await showToast({
                style: Toast.Style.Success,
                title: '本地 DNS 缓存已成功刷新'
            });
        }
        finally {
            setIsLoading(false);
        }
    };
    const handleOpenCreateForm = () => {
        push(React.createElement(HostsProfileForm, { onSave: (created) => {
                setProfiles((prev) => [...prev, created]);
            } }));
    };
    const handleEditProfile = (profile) => {
        push(React.createElement(HostsProfileForm, { initialProfile: profile, onSave: (updated) => {
                setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            } }));
    };
    const handleDeleteProfile = async (id) => {
        setProfiles((prev) => prev.filter((p) => p.id !== id));
        await showToast({ style: Toast.Style.Success, title: '已删除该 Hosts 方案' });
    };
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u65B9\u6848\u540D\u3001\u89C4\u5219 IP \u6216\u57DF\u540D (\u5982: 127.0.0.1\u3001staging.ztools.cn) ...", searchBarAccessory: React.createElement(List.Dropdown, { value: filterStatus, onChange: (v) => setFilterStatus(v), tooltip: "\u6309\u542F\u7528\u72B6\u6001\u7B5B\u9009" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u65B9\u6848", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u67E5\u770B\u5DF2\u542F\u7528", value: "enabled", icon: Icon.CheckCircle }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u67E5\u770B\u5DF2\u7981\u7528", value: "disabled", icon: Icon.Circle })), filterBar: {
            summaryText: `共 ${profiles.length} 个方案（已激活 ${activeCount} 个） · 系统 DNS 缓存已处于最新状态`,
            actions: [
                { id: 'new-profile', title: '新建方案', onAction: handleOpenCreateForm },
                { id: 'flush-dns', title: '刷新 DNS', onAction: handleFlushDns }
            ]
        } }, filteredProfiles.map((profile) => (React.createElement(List.Item, { key: profile.id, id: profile.id, title: profile.name, subtitle: `${profile.rulesCount} 条规则`, icon: profile.isEnabled ? Icon.CheckCircle : Icon.Circle, accessories: [
            ...(profile.isSystem ? [{ tag: '系统源文件' }] : []),
            { text: profile.isEnabled ? '已启用' : '未激活' }
        ], detail: React.createElement(List.Item.Detail, { markdown: `\`\`\`ini\n${profile.rawContent}\n\`\`\``, metadata: React.createElement(List.Item.Detail.Metadata, null,
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u65B9\u6848\u540D\u79F0", text: profile.name }),
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u751F\u6548\u72B6\u6001", text: profile.isEnabled ? '正在生效中' : '已停用' }),
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u89C4\u5219\u6570\u91CF", text: `${profile.rulesCount} 条有效映射` }),
                React.createElement(List.Item.Detail.Metadata.Separator, null),
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6700\u540E\u66F4\u65B0", text: profile.updatedAtFormatted })) }), actions: React.createElement(ActionPanel, null,
            React.createElement(Action, { title: profile.isEnabled ? '禁用此方案' : '启用此方案', icon: profile.isEnabled ? Icon.XMarkCircle : Icon.CheckCircle, onAction: () => handleToggleProfile(profile.id) }),
            React.createElement(Action, { title: "\u7F16\u8F91\u65B9\u6848\u5185\u5BB9", icon: Icon.Pencil, shortcut: { modifiers: ['cmd'], key: 'e' }, onAction: () => handleEditProfile(profile) }),
            React.createElement(Action, { title: "\u7ACB\u5373\u5237\u65B0 DNS \u7F13\u5B58", icon: Icon.ArrowClockwise, shortcut: { modifiers: ['cmd'], key: 'r' }, onAction: handleFlushDns }),
            React.createElement(Action, { title: "\u65B0\u5EFA\u73AF\u5883\u65B9\u6848", icon: Icon.Plus, shortcut: { modifiers: ['cmd'], key: 'n' }, onAction: handleOpenCreateForm }),
            !profile.isSystem ? (React.createElement(Action, { title: "\u5220\u9664\u6B64\u65B9\u6848", icon: Icon.Trash, style: Action.Style.Destructive, shortcut: { modifiers: ['ctrl'], key: 'backspace' }, onAction: () => handleDeleteProfile(profile.id) })) : null) })))));
}
export default HostsSwitcherCommand;
