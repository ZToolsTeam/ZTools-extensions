import React, { Action, ActionPanel, Form, Icon, List, Toast, showToast, useEffect, useMemo, useState, useNavigation } from '../../index.js';
import { DEFAULT_QUICKLINKS, filterQuicklinks, getQuicklinks, importQuicklinksJson, launchQuicklink, saveQuicklinks, validateQuicklinkUrlPattern } from './quicklinks-storage.js';
export * from './types.js';
export * from './quicklinks-storage.js';
export function CreateQuicklinkForm({ onCreated }) {
    const { pop } = useNavigation();
    const [title, setTitle] = useState('');
    const [link, setLink] = useState('');
    const [keyword, setKeyword] = useState('');
    const [description, setDescription] = useState('');
    const handleSubmit = async () => {
        if (!title.trim()) {
            await showToast({ style: Toast.Style.Failure, title: '请输入快捷链接标题' });
            return;
        }
        const urlCheck = validateQuicklinkUrlPattern(link);
        if (!urlCheck.valid) {
            await showToast({
                style: Toast.Style.Failure,
                title: urlCheck.error || '请输入合法的 URL 地址'
            });
            return;
        }
        const current = await getQuicklinks();
        const newItem = {
            id: `ql-${Date.now()}-${current.length + 1}`,
            title: title.trim(),
            link: urlCheck.normalizedUrl,
            urlPattern: urlCheck.normalizedUrl,
            keyword: keyword.trim() || undefined,
            alias: keyword.trim() || undefined,
            category: /\{(query|argument|arg)\}/i.test(urlCheck.normalizedUrl) ? 'search' : 'direct',
            isGroup: false,
            description: description.trim() || undefined,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        const updated = [newItem, ...current];
        await saveQuicklinks(updated);
        await showToast({ style: Toast.Style.Success, title: '快捷链接创建成功' });
        onCreated?.(newItem);
        pop();
    };
    return (React.createElement(Form, { navigationTitle: "\u65B0\u5EFA\u5FEB\u6377\u94FE\u63A5", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u5FEB\u6377\u94FE\u63A5", onSubmit: handleSubmit })) },
        React.createElement(Form.TextField, { id: "title", title: "\u94FE\u63A5\u540D\u79F0", placeholder: "\u4F8B\u5982: GitHub \u4ED3\u5E93\u641C\u7D22", value: title, onChange: setTitle }),
        React.createElement(Form.TextField, { id: "link", title: "\u76EE\u6807 URL \u6A21\u677F", placeholder: "\u652F\u6301 {query} \u53D8\u91CF\uFF0C\u5982: https://github.com/search?q={query}", value: link, onChange: setLink }),
        React.createElement(Form.TextField, { id: "keyword", title: "\u89E6\u53D1\u522B\u540D (Alias)", placeholder: "\u4F8B\u5982: gh", value: keyword, onChange: setKeyword }),
        React.createElement(Form.TextField, { id: "description", title: "\u5907\u6CE8\u8BF4\u660E", placeholder: "\u9009\u586B\u63CF\u8FF0", value: description, onChange: setDescription })));
}
export function EditQuicklinkForm({ item, onUpdated }) {
    const { pop } = useNavigation();
    const [title, setTitle] = useState(item.title);
    const [link, setLink] = useState(item.link);
    const [keyword, setKeyword] = useState(item.alias || item.keyword || '');
    const [description, setDescription] = useState(item.description || '');
    const handleSubmit = async () => {
        const urlCheck = validateQuicklinkUrlPattern(link);
        if (!urlCheck.valid) {
            await showToast({
                style: Toast.Style.Failure,
                title: urlCheck.error || '请输入合法的 URL 地址'
            });
            return;
        }
        const updatedItem = {
            ...item,
            title: title.trim() || item.title,
            link: urlCheck.normalizedUrl,
            urlPattern: urlCheck.normalizedUrl,
            keyword: keyword.trim() || undefined,
            alias: keyword.trim() || undefined,
            description: description.trim() || undefined,
            updatedAt: Date.now()
        };
        onUpdated?.(updatedItem);
        pop();
    };
    return (React.createElement(Form, { navigationTitle: "\u7F16\u8F91\u5FEB\u6377\u94FE\u63A5", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u4FEE\u6539", onSubmit: handleSubmit })) },
        React.createElement(Form.TextField, { id: "title", title: "\u94FE\u63A5\u540D\u79F0", value: title, onChange: setTitle }),
        React.createElement(Form.TextField, { id: "link", title: "\u76EE\u6807 URL", value: link, onChange: setLink }),
        React.createElement(Form.TextField, { id: "keyword", title: "\u89E6\u53D1\u522B\u540D", value: keyword, onChange: setKeyword }),
        React.createElement(Form.TextField, { id: "description", title: "\u5907\u6CE8\u8BF4\u660E", value: description, onChange: setDescription })));
}
export function ImportQuicklinksForm({ onImported }) {
    const { pop } = useNavigation();
    const [jsonText, setJsonText] = useState('');
    const handleSubmit = async () => {
        const current = await getQuicklinks();
        const res = importQuicklinksJson(jsonText, current);
        if (!res.success) {
            await showToast({ style: Toast.Style.Failure, title: res.error || '导入失败' });
            return;
        }
        await saveQuicklinks(res.result);
        onImported?.(res.result);
        pop();
    };
    return (React.createElement(Form, { navigationTitle: "\u5BFC\u5165\u5FEB\u6377\u94FE\u63A5 JSON", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u786E\u8BA4\u5BFC\u5165", onSubmit: handleSubmit })) },
        React.createElement(Form.TextArea, { id: "json", title: "JSON \u5185\u5BB9", value: jsonText, onChange: setJsonText })));
}
function getHostnameLabel(rawUrl) {
    try {
        return new URL(rawUrl.replace(/\{(query|argument|arg)(?:\s+[^}]*)?\}/gi, 'q')).hostname;
    }
    catch {
        return rawUrl.slice(0, 28);
    }
}
export function QuicklinksCommand(props = {}) {
    const { push } = useNavigation();
    const [links, setLinks] = useState(props.initialLinks ?? DEFAULT_QUICKLINKS);
    const [selectedCategory, setSelectedCategory] = useState(() => {
        if (props.featureCode === 'quicklinks-search-engines')
            return 'search';
        if (props.featureCode === 'quicklinks-open-groups')
            return 'group';
        return 'all';
    });
    const [searchText, setSearchText] = useState('');
    useEffect(() => {
        if (!props.initialLinks) {
            void getQuicklinks().then(setLinks);
        }
    }, [props.initialLinks]);
    const filtered = useMemo(() => filterQuicklinks(links, searchText, selectedCategory), [links, searchText, selectedCategory]);
    const handleOpenLink = async (item) => {
        const queryArg = filtered.directMatch?.quicklink.id === item.id ? filtered.directMatch.queryArg : '';
        const urls = await launchQuicklink(item, queryArg);
        await showToast({
            style: Toast.Style.Success,
            title: item.isGroup ? `已并发打开 ${urls.length} 个工作流网页` : `已打开: ${urls[0]}`
        });
    };
    const handleResetDefaults = async () => {
        setLinks([...DEFAULT_QUICKLINKS]);
        await saveQuicklinks([...DEFAULT_QUICKLINKS]);
        await showToast({
            style: Toast.Style.Success,
            title: '已恢复默认预设快开列表'
        });
    };
    return (React.createElement(List, { navigationTitle: "\u7F51\u9875\u5FEB\u5F00", isLoading: false, isShowingDetail: false, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u5FEB\u6377\u94FE\u63A5\uFF0C\u6216\u8F93\u5165\u201C\u522B\u540D + \u7A7A\u683C + \u5173\u952E\u8BCD\u201D\uFF08\u5982\uFF1Agh react\uFF09...", searchBarAccessory: React.createElement(List.Dropdown, { value: selectedCategory, onChange: (val) => setSelectedCategory(val), tooltip: "\u6309\u7C7B\u578B\u7B5B\u9009" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u5FEB\u6377\u94FE\u63A5", value: "all", icon: Icon.Globe }),
            React.createElement(List.Dropdown.Item, { title: "\u641C\u7D22\u5E73\u53F0\uFF08\u5E26\u53C2\u6570\uFF09", value: "search", icon: Icon.Globe }),
            React.createElement(List.Dropdown.Item, { title: "\u76F4\u8FBE\u7F51\u9875", value: "direct", icon: Icon.ArrowRight }),
            React.createElement(List.Dropdown.Item, { title: "\u6279\u91CF\u7F51\u5740\u7EC4", value: "group", icon: Icon.Desktop })), filterBar: {
            summaryText: `共 ${filtered.matches.length} 个快开项 · 支持在搜索框输入别名快速带参检索`,
            actions: [
                {
                    id: 'create',
                    title: '新建快开',
                    onAction: () => push(React.createElement(CreateQuicklinkForm, { onCreated: (created) => setLinks((prev) => [created, ...prev]) }))
                },
                {
                    id: 'reset-default',
                    title: '恢复默认预设',
                    onAction: () => {
                        void handleResetDefaults();
                    }
                }
            ]
        } }, filtered.matches.map((item) => {
        const alias = item.alias || item.keyword;
        const pattern = item.urlPattern || item.link;
        const hasQuery = /\{(query|argument|arg)\}/i.test(pattern);
        return (React.createElement(List.Item, { key: item.id, id: item.id, title: item.title, subtitle: item.description || pattern, icon: item.isGroup ? Icon.Desktop : Icon.Globe, accessories: [
                alias ? { tag: `别名: ${alias}` } : {},
                {
                    text: item.isGroup
                        ? `含 ${item.urls?.length || 0} 个网页`
                        : getHostnameLabel(pattern)
                }
            ], actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: hasQuery ? '带参搜索 / 访问' : '在浏览器中打开', icon: Icon.Globe, onAction: () => handleOpenLink(item) }),
                React.createElement(Action, { title: "\u7F16\u8F91\u6B64\u5FEB\u6377\u94FE\u63A5", icon: Icon.Pencil, onAction: () => push(React.createElement(EditQuicklinkForm, { item: item, onUpdated: (u) => {
                            setLinks((prev) => {
                                const next = prev.map((x) => (x.id === u.id ? u : x));
                                void saveQuicklinks(next);
                                return next;
                            });
                        } })) }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u76EE\u6807\u7F51\u5740", content: pattern })) }));
    })));
}
export default QuicklinksCommand;
