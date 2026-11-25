import React, { List, Form, ActionPanel, Action, Icon, Clipboard, LocalStorage, showToast, Toast, useNavigation, useState, useEffect, useMemo, useCallback, useRef } from '../../index.js';
import { getSnippetCategoryLabel, resolveMacroTemplate, validateSnippetInput } from './macro-engine.js';
export * from './types.js';
export * from './macro-engine.js';
const SNIPPETS_STORAGE_KEY = 'ztools.snippets.items.v1';
function getCategoryIcon(category) {
    switch (category) {
        case 'invoice':
            return Icon.Document;
        case 'address':
            return Icon.Pin;
        case 'customer_service':
            return Icon.Text;
        case 'code':
            return Icon.Code;
        default:
            return Icon.List;
    }
}
export function SnippetEditForm({ initialData, onSave }) {
    const { pop } = useNavigation();
    const [title, setTitle] = useState(initialData?.title || '');
    const [category, setCategory] = useState(initialData?.category || 'general');
    const [keyword, setKeyword] = useState(initialData?.keyword || '');
    const [content, setContent] = useState(initialData?.content || '');
    const handleSubmit = useCallback(async () => {
        const payload = {
            id: initialData?.id,
            title,
            category,
            keyword,
            content
        };
        const check = validateSnippetInput(payload);
        if (!check.valid) {
            await showToast({
                style: Toast.Style.Failure,
                title: '无法保存短语',
                message: check.error
            });
            return;
        }
        await onSave(payload);
        pop();
    }, [initialData, title, category, keyword, content, onSave, pop]);
    return (React.createElement(Form, { navigationTitle: initialData ? '编辑快捷短语' : '新建快捷短语', actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u77ED\u8BED", icon: Icon.CheckCircle, onSubmit: handleSubmit }),
            React.createElement(Action, { title: "\u53D6\u6D88\u8FD4\u56DE", onAction: pop })) },
        React.createElement(Form.TextField, { id: "title", title: "\u77ED\u8BED\u6807\u9898", value: title, onChange: setTitle, placeholder: "\u5982\uFF1A\u516C\u53F8\u5F00\u7968\u62AC\u5934\u3001\u5317\u4EAC\u529E\u516C\u5730\u5740" }),
        React.createElement(Form.Dropdown, { id: "category", title: "\u6240\u5C5E\u5206\u7C7B", value: category, onChange: (v) => setCategory(v) },
            React.createElement(Form.Dropdown.Item, { title: "\u901A\u7528\u77ED\u8BED", value: "general" }),
            React.createElement(Form.Dropdown.Item, { title: "\u53D1\u7968\u4E0E\u5F00\u7968\u4FE1\u606F", value: "invoice" }),
            React.createElement(Form.Dropdown.Item, { title: "\u5E38\u7528\u5730\u5740\u4E0E\u8054\u7CFB\u4EBA", value: "address" }),
            React.createElement(Form.Dropdown.Item, { title: "\u5BA2\u670D\u4E0E\u5546\u52A1\u8BDD\u672F", value: "customer_service" }),
            React.createElement(Form.Dropdown.Item, { title: "\u5F00\u53D1\u4E0E\u4EE3\u7801\u7247\u6BB5", value: "code" })),
        React.createElement(Form.TextField, { id: "keyword", title: "\u89E6\u53D1\u7F29\u5199\uFF08\u53EF\u9009\uFF09", value: keyword, onChange: setKeyword, placeholder: "\u5982\uFF1A!shuihao\u3001!addr" }),
        React.createElement(Form.TextArea, { id: "content", title: "\u77ED\u8BED\u6A21\u677F\u5185\u5BB9", value: content, onChange: setContent, placeholder: "\u652F\u6301\u5B8F\u53D8\u91CF\uFF1A{date}\u3001{time}\u3001{clipboard}\u3001{cursor}..." }),
        React.createElement(Form.Description, { title: "\u5B8F\u53D8\u91CF\u63D0\u793A", text: "{date}=\u5E74\u6708\u65E5  {time}=\u65F6\u5206\u79D2  {clipboard}=\u5F53\u524D\u526A\u8D34\u677F  {cursor}=\u4E0A\u5C4F\u540E\u5149\u6807\u505C\u7559\u4F4D\u7F6E" })));
}
export function Snippets({ featureCode = 'snippets-all', initialSnippets } = {}) {
    const { push } = useNavigation();
    const [isLoading, setIsLoading] = useState(!initialSnippets);
    const [snippets, setSnippets] = useState(initialSnippets || []);
    const [searchText, setSearchText] = useState('');
    const [categoryFilter, setCategoryFilter] = useState(() => {
        if (featureCode === 'snippets-invoice')
            return 'invoice';
        if (featureCode === 'snippets-address')
            return 'address';
        return 'all';
    });
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);
    useEffect(() => {
        if (initialSnippets) {
            return;
        }
        let active = true;
        (async () => {
            try {
                const raw = await LocalStorage.getItem(SNIPPETS_STORAGE_KEY);
                if (!active || !mountedRef.current)
                    return;
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        setSnippets(parsed);
                    }
                }
            }
            catch {
                // Ignore storage read error
            }
            finally {
                if (active && mountedRef.current) {
                    setIsLoading(false);
                }
            }
        })();
        return () => {
            active = false;
        };
    }, [initialSnippets]);
    const persistSnippets = useCallback(async (nextList) => {
        await LocalStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(nextList));
        if (mountedRef.current) {
            setSnippets(nextList);
        }
    }, []);
    const handleSaveSnippet = useCallback(async (input) => {
        const check = validateSnippetInput(input);
        if (!check.valid) {
            throw new Error(check.error);
        }
        const now = Date.now();
        const content = input.content.trim();
        const previewText = content.replace(/\s+/g, ' ').slice(0, 72);
        let next;
        if (input.id) {
            next = snippets.map((s) => s.id === input.id
                ? {
                    ...s,
                    title: input.title.trim(),
                    category: input.category,
                    categoryLabel: getSnippetCategoryLabel(input.category),
                    keyword: input.keyword?.trim() || undefined,
                    content,
                    previewText,
                    updatedAt: now
                }
                : s);
        }
        else {
            const created = {
                id: `snip-${now}`,
                title: input.title.trim(),
                category: input.category,
                categoryLabel: getSnippetCategoryLabel(input.category),
                keyword: input.keyword?.trim() || undefined,
                content,
                previewText,
                useCount: 0,
                updatedAt: now
            };
            next = [created, ...snippets];
        }
        await persistSnippets(next);
        await showToast({
            style: Toast.Style.Success,
            title: '短语已保存',
            message: input.title.trim()
        });
    }, [snippets, persistSnippets]);
    const handleDeleteSnippet = useCallback(async (id) => {
        const next = snippets.filter((s) => s.id !== id);
        await persistSnippets(next);
        await showToast({
            style: Toast.Style.Success,
            title: '已删除该快捷短语'
        });
    }, [snippets, persistSnippets]);
    const handleInsertSnippet = useCallback(async (item) => {
        const clipText = (await Clipboard.readText()) || '';
        const resolved = resolveMacroTemplate(item.content, clipText);
        await Clipboard.copy(resolved.text);
        try {
            const g = globalThis;
            const win = (typeof window !== 'undefined' ? window : g);
            const electron = win.__ztoolsElectron;
            if (typeof electron?.transport?.invoke === 'function') {
                await electron.transport.invoke('clipboard_hide_and_paste_text', {
                    text: resolved.text
                });
            }
        }
        catch {
            // Fallback to clipboard copy already completed
        }
        const next = snippets.map((s) => s.id === item.id ? { ...s, useCount: (s.useCount || 0) + 1 } : s);
        await persistSnippets(next);
        await showToast({
            style: Toast.Style.Success,
            title: '已解析动态宏并上屏/写入剪贴板',
            message: resolved.text.slice(0, 48)
        });
    }, [snippets, persistSnippets]);
    const filteredSnippets = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        return snippets.filter((item) => {
            if (categoryFilter !== 'all' && item.category !== categoryFilter) {
                return false;
            }
            if (!q)
                return true;
            return (item.title.toLowerCase().includes(q) ||
                (item.keyword || '').toLowerCase().includes(q) ||
                item.content.toLowerCase().includes(q));
        });
    }, [snippets, searchText, categoryFilter]);
    if (featureCode === 'snippets-new') {
        return React.createElement(SnippetEditForm, { onSave: handleSaveSnippet });
    }
    return (React.createElement(List, { isLoading: isLoading, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u77ED\u8BED\u6807\u9898\u3001\u89E6\u53D1\u8BCD\u6216\u5185\u5BB9\uFF08\u5982\uFF1A\u7A0E\u53F7\u3001\u5730\u5740\u3001\u9000\u6B3E\uFF09...", searchBarAccessory: React.createElement(List.Dropdown, { value: categoryFilter, onChange: setCategoryFilter, tooltip: "\u6309\u77ED\u8BED\u5206\u7C7B\u7B5B\u9009" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u77ED\u8BED", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u53D1\u7968\u4E0E\u5F00\u7968\u4FE1\u606F", value: "invoice", icon: Icon.Document }),
            React.createElement(List.Dropdown.Item, { title: "\u5E38\u7528\u5730\u5740\u4E0E\u8054\u7CFB\u4EBA", value: "address", icon: Icon.Pin }),
            React.createElement(List.Dropdown.Item, { title: "\u5BA2\u670D\u4E0E\u5546\u52A1\u8BDD\u672F", value: "customer_service", icon: Icon.Text }),
            React.createElement(List.Dropdown.Item, { title: "\u5F00\u53D1\u4E0E\u4EE3\u7801\u7247\u6BB5", value: "code", icon: Icon.Code })), filterBar: {
            summaryText: `共 ${filteredSnippets.length} 条快捷短语 · 支持 {date} / {clipboard} / {cursor} 动态宏变量`,
            actions: [
                {
                    id: 'new-snippet',
                    title: '新建短语',
                    onAction: () => push(React.createElement(SnippetEditForm, { onSave: handleSaveSnippet }))
                }
            ]
        } }, filteredSnippets.map((item) => (React.createElement(List.Item, { key: item.id, id: item.id, title: item.title, subtitle: item.previewText, icon: getCategoryIcon(item.category), accessories: [
            { tag: item.keyword ? `缩写: ${item.keyword}` : item.categoryLabel },
            { text: `使用 ${item.useCount || 0} 次` }
        ], actions: React.createElement(ActionPanel, null,
            React.createElement(Action, { title: "\u76F4\u63A5\u4E0A\u5C4F\u7C98\u8D34", icon: Icon.ArrowUp, onAction: () => handleInsertSnippet(item) }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u89E3\u6790\u540E\u7684\u6587\u672C", content: resolveMacroTemplate(item.content, '').text, shortcut: { modifiers: ['cmd'], key: 'enter' } }),
            React.createElement(Action, { title: "\u7F16\u8F91\u77ED\u8BED", icon: Icon.Pencil, shortcut: { modifiers: ['cmd'], key: 'e' }, onAction: () => push(React.createElement(SnippetEditForm, { initialData: item, onSave: handleSaveSnippet })) }),
            React.createElement(Action, { title: "\u65B0\u5EFA\u77ED\u8BED", icon: Icon.Plus, shortcut: { modifiers: ['cmd'], key: 'n' }, onAction: () => push(React.createElement(SnippetEditForm, { onSave: handleSaveSnippet })) }),
            React.createElement(Action, { title: "\u5220\u9664\u77ED\u8BED", icon: Icon.Trash, style: Action.Style.Destructive, shortcut: { modifiers: ['ctrl'], key: 'backspace' }, onAction: () => handleDeleteSnippet(item.id) })) })))));
}
export const SnippetsCommand = Snippets;
export default Snippets;
export function SnippetArgumentFormView({ snippet }) {
    return (React.createElement(Form, { navigationTitle: "\u586B\u5199\u77ED\u8BED\u52A8\u6001\u53C2\u6570" },
        React.createElement(Form.TextField, { id: "arg_text", title: "\u6587\u672C\u53C2\u6570" }),
        React.createElement(Form.Dropdown, { id: "arg_dropdown", title: "\u4E0B\u62C9\u9009\u9879" },
            React.createElement(Form.Dropdown.Item, { value: "opt1", title: "\u9009\u9879 1" })),
        React.createElement(Form.PasswordField, { id: "arg_password", title: "\u5BC6\u7801\u53C2\u6570" })));
}
export const CreateSnippetForm = SnippetEditForm;
export function SnippetDetailView({ snippet }) {
    return (React.createElement(Form, { navigationTitle: "\u77ED\u8BED\u8BE6\u60C5" },
        React.createElement(Form.TextField, { id: "detail", title: "\u77ED\u8BED\u5185\u5BB9", value: String(snippet?.content || '') })));
}
export { expandSnippetTemplate, filterSnippets, SAMPLE_SNIPPETS } from './macro-engine.js';
