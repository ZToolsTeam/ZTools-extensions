import React, { List, Form, ActionPanel, Action, Icon, Clipboard, LocalStorage, showToast, Toast, useNavigation, useState, useEffect, useMemo, useCallback, useRef } from '../../index.js';
import { copySecretWithAutoClear, createVaultEntry, decryptVaultEntries, encryptVaultEntries, generateSecurePassword, validateMasterPassword, validateNewEntryInput } from './vault-crypto.js';
export * from './types.js';
export * from './vault-crypto.js';
const VAULT_STORAGE_KEY = 'ztools.password-vault.envelope.v1';
function getCategoryIcon(category) {
    switch (category) {
        case 'login':
            return Icon.Globe;
        case 'apikey':
            return Icon.Key;
        case 'server':
            return Icon.Terminal;
        case 'license':
            return Icon.Document;
        default:
            return Icon.Lock;
    }
}
export function VaultEntryForm({ initialPassword = '', onSave }) {
    const { pop } = useNavigation();
    const [title, setTitle] = useState('');
    const [category, setCategory] = useState('login');
    const [username, setUsername] = useState('');
    const [endpoint, setEndpoint] = useState('');
    const [secretPlain, setSecretPlain] = useState(initialPassword);
    const [note, setNote] = useState('');
    const handleGenerate = useCallback(async () => {
        const pwd = generateSecurePassword(20, true);
        setSecretPlain(pwd);
        await showToast({
            style: Toast.Style.Success,
            title: '已填入 20 位高强度随机密码'
        });
    }, []);
    const handleSubmit = useCallback(async () => {
        const input = {
            title,
            category,
            username,
            endpoint,
            secretPlain,
            note
        };
        const check = validateNewEntryInput(input);
        if (!check.valid) {
            await showToast({
                style: Toast.Style.Failure,
                title: '无法保存凭据',
                message: check.error
            });
            return;
        }
        await onSave(input);
        pop();
    }, [title, category, username, endpoint, secretPlain, note, onSave, pop]);
    return (React.createElement(Form, { navigationTitle: "\u65B0\u5EFA\u52A0\u5BC6\u51ED\u636E", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u52A0\u5BC6\u4FDD\u5B58\u81F3\u4FDD\u9669\u7BB1", icon: Icon.Lock, onSubmit: handleSubmit }),
            React.createElement(Action, { title: "\u751F\u6210 20 \u4F4D\u968F\u673A\u5BC6\u7801\u586B\u5165", icon: Icon.Wand, onAction: handleGenerate })) },
        React.createElement(Form.TextField, { id: "title", title: "\u51ED\u636E\u540D\u79F0", placeholder: "\u4F8B\u5982\uFF1AGitHub \u4E3B\u8D26\u53F7 / DeepSeek API Key / \u751F\u4EA7\u6570\u636E\u5E93", value: title, onChange: setTitle }),
        React.createElement(Form.Dropdown, { id: "category", title: "\u51ED\u636E\u5206\u7C7B", value: category, onChange: (v) => setCategory(v) },
            React.createElement(Form.Dropdown.Item, { value: "login", title: "\u7F51\u7AD9\u4E0E\u5E94\u7528\u8D26\u53F7", icon: Icon.Globe }),
            React.createElement(Form.Dropdown.Item, { value: "apikey", title: "API Key \u4E0E\u8BBF\u95EE\u4EE4\u724C", icon: Icon.Key }),
            React.createElement(Form.Dropdown.Item, { value: "server", title: "\u670D\u52A1\u5668\u4E0E\u6570\u636E\u5E93\u5BC6\u7801", icon: Icon.Terminal }),
            React.createElement(Form.Dropdown.Item, { value: "license", title: "\u8F6F\u4EF6\u6FC0\u6D3B\u7801\u4E0E\u5907\u5FD8", icon: Icon.Document })),
        React.createElement(Form.TextField, { id: "username", title: "\u7528\u6237\u540D / \u6807\u8BC6", placeholder: "\u8D26\u53F7\u3001\u90AE\u7BB1\u3001Key \u540D\u79F0\u6216 root", value: username, onChange: setUsername }),
        React.createElement(Form.TextField, { id: "endpoint", title: "\u7F51\u5740 / \u4E3B\u673A\u5730\u5740", placeholder: "\u4F8B\u5982\uFF1Ahttps://github.com \u6216 10.0.0.12:5432", value: endpoint, onChange: setEndpoint }),
        React.createElement(Form.PasswordField, { id: "secretPlain", title: "\u5BC6\u7801 / Secret", placeholder: "\u8F93\u5165\u654F\u611F\u5BC6\u7801\u3001API Secret \u6216\u6FC0\u6D3B\u7801\uFF08AES-256-GCM \u52A0\u5BC6\u5B58\u50A8\uFF09", value: secretPlain, onChange: setSecretPlain }),
        React.createElement(Form.TextArea, { id: "note", title: "\u52A0\u5BC6\u5907\u6CE8", placeholder: "\u4E24\u6B65\u9A8C\u8BC1\u6062\u590D\u7801\u6216\u5230\u671F\u63D0\u9192\u8BF4\u660E\uFF08\u968F\u5BC6\u6587\u4E00\u540C\u52A0\u5BC6\uFF09", value: note, onChange: setNote })));
}
export function PasswordVault({ featureCode = 'vault-list', initialUnlockedEntries, initialMasterPassword } = {}) {
    const { push } = useNavigation();
    const [isLoading, setIsLoading] = useState(!initialUnlockedEntries);
    const [hasExistingVault, setHasExistingVault] = useState(false);
    const [storedEnvelope, setStoredEnvelope] = useState(null);
    const [masterPassword, setMasterPassword] = useState(initialMasterPassword || '');
    const [passwordInput, setPasswordInput] = useState('');
    const [isUnlocked, setIsUnlocked] = useState(Boolean(initialUnlockedEntries));
    const [entries, setEntries] = useState(initialUnlockedEntries || []);
    const [searchText, setSearchText] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [revealedId, setRevealedId] = useState(null);
    const [authError, setAuthError] = useState('');
    const mountedRef = useRef(true);
    const clearTimersRef = useRef([]);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            for (const timer of clearTimersRef.current) {
                clearTimeout(timer);
            }
            clearTimersRef.current = [];
        };
    }, []);
    useEffect(() => {
        if (initialUnlockedEntries) {
            return;
        }
        let active = true;
        (async () => {
            try {
                const raw = await LocalStorage.getItem(VAULT_STORAGE_KEY);
                if (!active || !mountedRef.current)
                    return;
                if (raw) {
                    const parsed = JSON.parse(raw);
                    setStoredEnvelope(parsed);
                    setHasExistingVault(true);
                }
                else {
                    setHasExistingVault(false);
                }
            }
            catch {
                if (active && mountedRef.current) {
                    setHasExistingVault(false);
                }
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
    }, [initialUnlockedEntries]);
    const persistEntries = useCallback(async (pwd, nextEntries) => {
        const envelope = await encryptVaultEntries(pwd, nextEntries);
        await LocalStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(envelope));
        if (mountedRef.current) {
            setStoredEnvelope(envelope);
            setHasExistingVault(true);
        }
    }, []);
    const handleUnlockOrInitialize = useCallback(async () => {
        setAuthError('');
        const check = validateMasterPassword(passwordInput);
        if (!check.valid) {
            setAuthError(check.error || '主密码长度至少 6 位');
            await showToast({
                style: Toast.Style.Failure,
                title: '主密码格式不合法',
                message: check.error
            });
            return;
        }
        try {
            if (hasExistingVault && storedEnvelope) {
                const decrypted = await decryptVaultEntries(passwordInput, storedEnvelope);
                if (!mountedRef.current)
                    return;
                setMasterPassword(passwordInput);
                setEntries(decrypted);
                setIsUnlocked(true);
                setPasswordInput('');
                await showToast({
                    style: Toast.Style.Success,
                    title: '保险箱已解锁',
                    message: `成功解密 ${decrypted.length} 项凭据`
                });
            }
            else {
                await persistEntries(passwordInput, []);
                if (!mountedRef.current)
                    return;
                setMasterPassword(passwordInput);
                setEntries([]);
                setIsUnlocked(true);
                setPasswordInput('');
                await showToast({
                    style: Toast.Style.Success,
                    title: '加密保险箱初始化完成',
                    message: '所有凭据均使用 PBKDF2 + AES-256-GCM 离线加密存储'
                });
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (mountedRef.current) {
                setAuthError('主密码错误，无法解密保险箱数据');
            }
            await showToast({
                style: Toast.Style.Failure,
                title: '主密码错误，无法解密保险箱数据',
                message: msg
            });
        }
    }, [passwordInput, hasExistingVault, storedEnvelope, persistEntries]);
    const handleLockVault = useCallback(async () => {
        setIsUnlocked(false);
        setMasterPassword('');
        setEntries([]);
        setRevealedId(null);
        await showToast({
            style: Toast.Style.Success,
            title: '保险箱已锁定，内存密钥已销毁'
        });
    }, []);
    const handleSaveEntry = useCallback(async (input) => {
        const created = createVaultEntry(input);
        const next = [created, ...entries];
        if (masterPassword) {
            await persistEntries(masterPassword, next);
        }
        if (mountedRef.current) {
            setEntries(next);
        }
        await showToast({
            style: Toast.Style.Success,
            title: '凭据已加密保存',
            message: created.title
        });
    }, [entries, masterPassword, persistEntries]);
    const handleDeleteEntry = useCallback(async (id) => {
        const next = entries.filter((e) => e.id !== id);
        if (masterPassword) {
            await persistEntries(masterPassword, next);
        }
        if (mountedRef.current) {
            setEntries(next);
        }
        await showToast({
            style: Toast.Style.Success,
            title: '已从加密保险箱中移除该凭据'
        });
    }, [entries, masterPassword, persistEntries]);
    const handleCopySecretWithAutoClear = useCallback(async (item) => {
        await copySecretWithAutoClear(item.secretPlain, {
            copy: (text) => Clipboard.copy(text),
            readText: () => Clipboard.readText(),
            clear: () => Clipboard.clear()
        }, {
            ttlMs: 30000,
            scheduleTimer: (fn, ms) => {
                const timer = setTimeout(fn, ms);
                clearTimersRef.current.push(timer);
                return timer;
            }
        });
        await showToast({
            style: Toast.Style.Success,
            title: '已复制密码 / Secret',
            message: '将在 30 秒后自动清空剪贴板痕迹'
        });
    }, []);
    const handleQuickGeneratePassword = useCallback(async () => {
        const generated = generateSecurePassword(20, true);
        await copySecretWithAutoClear(generated, {
            copy: (text) => Clipboard.copy(text),
            readText: () => Clipboard.readText(),
            clear: () => Clipboard.clear()
        }, {
            ttlMs: 30000,
            scheduleTimer: (fn, ms) => {
                const timer = setTimeout(fn, ms);
                clearTimersRef.current.push(timer);
                return timer;
            }
        });
        await showToast({
            style: Toast.Style.Success,
            title: '已生成 20 位高强度随机密码并复制',
            message: '将在 30 秒后自动清空剪贴板痕迹'
        });
    }, []);
    const filteredEntries = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        return entries.filter((item) => {
            if (categoryFilter !== 'all' && item.category !== categoryFilter) {
                return false;
            }
            if (!q)
                return true;
            return (item.title.toLowerCase().includes(q) ||
                item.username.toLowerCase().includes(q) ||
                item.endpoint.toLowerCase().includes(q) ||
                item.note.toLowerCase().includes(q));
        });
    }, [entries, searchText, categoryFilter]);
    if (!isUnlocked) {
        return (React.createElement(Form, { isLoading: isLoading, navigationTitle: hasExistingVault ? '解锁密码保险箱' : '初始化密码保险箱', actions: React.createElement(ActionPanel, null,
                React.createElement(Action.SubmitForm, { title: hasExistingVault ? '解锁保险箱' : '设置主密码并创建保险箱', icon: Icon.Lock, onSubmit: handleUnlockOrInitialize }),
                React.createElement(Action, { title: "\u751F\u6210 20 \u4F4D\u968F\u673A\u5BC6\u7801\u590D\u5236\u5230\u526A\u8D34\u677F", icon: Icon.Wand, onAction: handleQuickGeneratePassword })) },
            React.createElement(Form.Description, { title: "\u52A0\u5BC6\u67B6\u6784\u8BF4\u660E", text: hasExistingVault
                    ? '请输入主密码以派生 AES-256-GCM 密钥解密本地保险箱。主密码绝不落盘或上传。'
                    : '首次使用请设置至少 6 位的主密码（PBKDF2 100,000 次迭代 + AES-256-GCM 本地零明文加密）。' }),
            React.createElement(Form.PasswordField, { id: "masterPassword", title: "\u4E3B\u5BC6\u7801 (Master Password)", placeholder: "\u8F93\u5165\u4E3B\u5BC6\u7801\u4EE5\u89E3\u9501\u6216\u521D\u59CB\u5316\u672C\u5730\u4FDD\u9669\u7BB1...", value: passwordInput, onChange: setPasswordInput, error: authError || undefined })));
    }
    return (React.createElement(List, { isLoading: isLoading, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u8D26\u53F7\u6807\u9898\u3001\u7528\u6237\u540D\u3001\u7F51\u5740\u57DF\u540D\u6216 API Key \u540D\u79F0...", searchBarAccessory: React.createElement(List.Dropdown, { value: categoryFilter, onChange: setCategoryFilter, tooltip: "\u6309\u51ED\u636E\u7C7B\u578B\u7B5B\u9009" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u52A0\u5BC6\u51ED\u636E", value: "all", icon: Icon.Lock }),
            React.createElement(List.Dropdown.Item, { title: "\u7F51\u7AD9\u4E0E\u5E94\u7528\u8D26\u53F7", value: "login", icon: Icon.Globe }),
            React.createElement(List.Dropdown.Item, { title: "API Key \u4E0E\u8BBF\u95EE\u4EE4\u724C", value: "apikey", icon: Icon.Key }),
            React.createElement(List.Dropdown.Item, { title: "\u670D\u52A1\u5668\u4E0E\u6570\u636E\u5E93\u5BC6\u7801", value: "server", icon: Icon.Terminal }),
            React.createElement(List.Dropdown.Item, { title: "\u8F6F\u4EF6\u6FC0\u6D3B\u7801\u4E0E\u5907\u5FD8", value: "license", icon: Icon.Document })), filterBar: {
            summaryText: `保险箱已解锁 (AES-256-GCM) · 共加密保管 ${entries.length} 项凭据 · 复制后 30 秒自动清剪贴板`,
            actions: [
                {
                    id: 'new-entry',
                    title: '新建凭据',
                    onAction: () => push(React.createElement(VaultEntryForm, { initialPassword: featureCode === 'vault-generator' ? generateSecurePassword(20, true) : '', onSave: handleSaveEntry }))
                },
                { id: 'lock-vault', title: '立即锁定', onAction: handleLockVault }
            ]
        } }, filteredEntries.map((item) => (React.createElement(List.Item, { key: item.id, id: item.id, title: item.title, subtitle: `${item.username || item.endpoint || '私密条目'}${item.note ? ` · ${item.note}` : ''}`, icon: getCategoryIcon(item.category), accessories: [
            { tag: item.categoryLabel },
            { text: revealedId === item.id ? item.secretPlain : '••••••••••••' },
            { text: item.updatedAtShort }
        ], actions: React.createElement(ActionPanel, null,
            React.createElement(Action, { title: "\u590D\u5236\u5BC6\u7801 / Secret\uFF0830\u79D2\u540E\u81EA\u52A8\u6E05\u526A\u8D34\u677F\uFF09", icon: Icon.Key, onAction: () => handleCopySecretWithAutoClear(item) }),
            item.username && (React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u7528\u6237\u540D / \u8D26\u53F7", content: item.username })),
            React.createElement(Action, { title: revealedId === item.id ? '隐藏明文密码' : '临时显示明文密码', icon: Icon.Eye, shortcut: { modifiers: ['cmd'], key: 'h' }, onAction: () => setRevealedId((cur) => (cur === item.id ? null : item.id)) }),
            React.createElement(Action.Push, { title: "\u65B0\u5EFA\u52A0\u5BC6\u51ED\u636E", icon: Icon.Plus, shortcut: { modifiers: ['cmd'], key: 'n' }, target: React.createElement(VaultEntryForm, { onSave: handleSaveEntry }) }),
            React.createElement(Action, { title: "\u7ACB\u5373\u751F\u6210 20 \u4F4D\u9AD8\u5F3A\u5EA6\u968F\u673A\u5BC6\u7801\u5E76\u590D\u5236", icon: Icon.Wand, shortcut: { modifiers: ['cmd'], key: 'g' }, onAction: handleQuickGeneratePassword }),
            React.createElement(Action, { title: "\u5220\u9664\u6B64\u51ED\u636E", icon: Icon.Trash, style: Action.Style.Destructive, shortcut: { modifiers: ['ctrl'], key: 'backspace' }, onAction: () => handleDeleteEntry(item.id) })) })))));
}
export const PasswordVaultCommand = PasswordVault;
export default PasswordVault;
export function VaultEntryDetailView(props) {
    return React.createElement(Form, { navigationTitle: "\u51ED\u636E\u8BE6\u60C5" });
}
export function VaultUnlockForm(props) {
    return React.createElement(Form, { navigationTitle: "\u89E3\u9501\u4FDD\u9669\u7BB1" });
}
export function VaultImportCsvForm(props) {
    return React.createElement(Form, { navigationTitle: "\u5BFC\u5165 CSV \u51ED\u636E" });
}
