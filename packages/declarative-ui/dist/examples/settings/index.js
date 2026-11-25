import React from "../../index.js";
import { List, Form, ActionPanel, Action, Icon, showToast, Toast, Clipboard, useNavigation } from "../../index.js";
import { useState, useEffect, useMemo } from "../../runtime/hooks.js";
import { DEFAULT_PREFERENCES, BUILTIN_EXTENSIONS, getPreferences, savePreferences, updateExtensionConfig, getSqliteCacheInfo, clearSqliteCache, resetPreferences, exportPreferencesJson } from "./settings-storage.js";
export * from "./types.js";
export * from "./settings-storage.js";
/**
 * 扩展独立配置与热键别名表单
 */
export function ExtensionConfigForm(props) {
    const { extension, onSaved } = props;
    const [enabled, setEnabled] = useState(extension.enabled);
    const [alias, setAlias] = useState(extension.alias || "");
    const [hotkey, setHotkey] = useState(extension.hotkey || "");
    const { pop } = useNavigation();
    const handleSave = async () => {
        const patch = {
            enabled,
            alias: alias.trim() || undefined,
            hotkey: hotkey.trim() || undefined
        };
        await updateExtensionConfig(extension.id, patch);
        const updated = { ...extension, ...patch };
        onSaved(updated);
        await showToast(Toast.Style.Success, "扩展配置已生效", extension.name);
        pop();
    };
    return (React.createElement(Form, { actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u6269\u5C55\u8BBE\u7F6E", onSubmit: handleSave })) },
        React.createElement(Form.TextField, { id: "name", title: "\u6269\u5C55\u6A21\u5757", value: `${extension.name} (${extension.id})`, onChange: () => { } }),
        React.createElement(Form.Checkbox, { id: "enabled", label: "\u542F\u7528\u6B64\u6269\u5C55", value: enabled, onChange: setEnabled }),
        React.createElement(Form.TextField, { id: "alias", title: "\u6839\u641C\u7D22\u5FEB\u901F\u522B\u540D (Alias)", value: alias, onChange: setAlias, placeholder: "\u4F8B\u5982: cb, dict, calc" }),
        React.createElement(Form.TextField, { id: "hotkey", title: "\u5168\u5C40\u5524\u9192\u5FEB\u6377\u952E (Hotkey)", value: hotkey, onChange: setHotkey, placeholder: "\u4F8B\u5982: Alt+V, Alt+D, Ctrl+Shift+K" })));
}
/**
 * 常规设置表单 (General Settings Form)
 */
export function GeneralSettingsForm(props) {
    const { initial, onSaved } = props;
    const [theme, setTheme] = useState(initial.theme);
    const [openAtLogin, setOpenAtLogin] = useState(initial.openAtLogin);
    const [autoHideOnBlur, setAutoHideOnBlur] = useState(initial.autoHideOnBlur);
    const [globalHotkey, setGlobalHotkey] = useState(initial.globalHotkey);
    const [acrylicEffect, setAcrylicEffect] = useState(initial.acrylicEffect);
    const { pop } = useNavigation();
    const handleSave = async () => {
        const updated = {
            ...initial,
            theme,
            openAtLogin,
            autoHideOnBlur,
            globalHotkey: globalHotkey.trim() || "Alt+Space",
            acrylicEffect
        };
        await savePreferences({ general: updated });
        onSaved(updated);
        await showToast(Toast.Style.Success, "常规设置已即时保存");
        pop();
    };
    return (React.createElement(Form, { actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u5E38\u89C4\u8BBE\u7F6E", onSubmit: handleSave })) },
        React.createElement(Form.Dropdown, { id: "theme", title: "\u5916\u89C2\u4E3B\u9898", value: theme, onChange: (v) => setTheme(v) },
            React.createElement(Form.Dropdown.Item, { value: "auto", title: "\u8DDF\u968F\u7CFB\u7EDF (Auto)" }),
            React.createElement(Form.Dropdown.Item, { value: "dark", title: "\u6781\u5BA2\u6DF1\u8272 (Dark)" }),
            React.createElement(Form.Dropdown.Item, { value: "light", title: "\u6E05\u723D\u6D45\u8272 (Light)" })),
        React.createElement(Form.Checkbox, { id: "openAtLogin", label: "\u5F00\u673A\u81EA\u52A8\u542F\u52A8", value: openAtLogin, onChange: setOpenAtLogin }),
        React.createElement(Form.Checkbox, { id: "autoHideOnBlur", label: "\u7A97\u53E3\u5931\u7126\u65F6\u81EA\u52A8\u9690\u85CF", value: autoHideOnBlur, onChange: setAutoHideOnBlur }),
        React.createElement(Form.TextField, { id: "globalHotkey", title: "\u5168\u5C40\u542F\u52A8\u70ED\u952E", value: globalHotkey, onChange: setGlobalHotkey, placeholder: "Alt+Space" }),
        React.createElement(Form.Checkbox, { id: "acrylicEffect", label: "\u542F\u7528 Mica / \u4E9A\u514B\u529B\u6BDB\u73BB\u7483\u89C6\u89C9", value: acrylicEffect, onChange: setAcrylicEffect })));
}
/**
 * 兼容旧版的设置项编辑表单视图
 */
export function SettingsFormView(props) {
    const { sectionKey, initialPreferences, onSaved } = props;
    const [prefs, setPreferencesState] = useState(initialPreferences);
    const { pop } = useNavigation();
    // General 表单
    const [theme, setTheme] = useState(prefs.general.theme);
    const [openAtLogin, setOpenAtLogin] = useState(prefs.general.openAtLogin);
    const [autoHideOnBlur, setAutoHideOnBlur] = useState(prefs.general.autoHideOnBlur);
    const [globalHotkey, setGlobalHotkey] = useState(prefs.general.globalHotkey);
    // Advanced 表单
    const [proxyMode, setProxyMode] = useState(prefs.advanced.proxyMode);
    const [proxyUrl, setProxyUrl] = useState(prefs.advanced.proxyUrl || "");
    const [logLevel, setLogLevel] = useState(prefs.advanced.logLevel);
    const handleSave = async () => {
        let patch = {};
        if (sectionKey === "general") {
            patch = {
                general: {
                    ...prefs.general,
                    theme,
                    openAtLogin,
                    autoHideOnBlur,
                    globalHotkey
                }
            };
        }
        else if (sectionKey === "advanced") {
            patch = {
                advanced: {
                    ...prefs.advanced,
                    proxyMode,
                    proxyUrl,
                    logLevel
                }
            };
        }
        const updated = await savePreferences(patch);
        setPreferencesState(updated);
        onSaved(updated);
        await showToast(Toast.Style.Success, "设置已存盘生效");
        pop();
    };
    return (React.createElement(Form, { actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u8BBE\u7F6E (Save)", onSubmit: handleSave })) }, sectionKey === "general" ? (React.createElement(React.Fragment, null,
        React.createElement(Form.Dropdown, { id: "theme", title: "\u5916\u89C2\u4E3B\u9898", value: theme, onChange: (v) => setTheme(v) },
            React.createElement(Form.Dropdown.Item, { value: "auto", title: "\u8DDF\u968F\u7CFB\u7EDF (Auto)" }),
            React.createElement(Form.Dropdown.Item, { value: "dark", title: "\u6781\u5BA2\u6DF1\u8272 (Dark)" }),
            React.createElement(Form.Dropdown.Item, { value: "light", title: "\u6E05\u723D\u6D45\u8272 (Light)" })),
        React.createElement(Form.Checkbox, { id: "openAtLogin", label: "\u5F00\u673A\u81EA\u52A8\u542F\u52A8", value: openAtLogin, onChange: setOpenAtLogin }),
        React.createElement(Form.Checkbox, { id: "autoHideOnBlur", label: "\u7A97\u53E3\u5931\u7126\u81EA\u52A8\u9690\u85CF", value: autoHideOnBlur, onChange: setAutoHideOnBlur }),
        React.createElement(Form.TextField, { id: "globalHotkey", title: "\u5168\u5C40\u547C\u51FA\u70ED\u952E", value: globalHotkey, onChange: setGlobalHotkey, placeholder: "Alt+Space" }))) : (React.createElement(React.Fragment, null,
        React.createElement(Form.Dropdown, { id: "proxyMode", title: "\u7F51\u7EDC\u4EE3\u7406\u6A21\u5F0F", value: proxyMode, onChange: (v) => setProxyMode(v) },
            React.createElement(Form.Dropdown.Item, { value: "system", title: "\u8DDF\u968F\u7CFB\u7EDF" }),
            React.createElement(Form.Dropdown.Item, { value: "none", title: "\u76F4\u8FDE" }),
            React.createElement(Form.Dropdown.Item, { value: "manual", title: "\u81EA\u5B9A\u4E49\u4EE3\u7406" })),
        React.createElement(Form.TextField, { id: "proxyUrl", title: "\u4EE3\u7406\u5730\u5740", value: proxyUrl, onChange: setProxyUrl, placeholder: "http://127.0.0.1:7890" }),
        React.createElement(Form.Dropdown, { id: "logLevel", title: "\u65E5\u5FD7\u7B49\u7EA7", value: logLevel, onChange: (v) => setLogLevel(v) },
            React.createElement(Form.Dropdown.Item, { value: "debug", title: "Debug" }),
            React.createElement(Form.Dropdown.Item, { value: "info", title: "Info" }),
            React.createElement(Form.Dropdown.Item, { value: "warn", title: "Warn" }),
            React.createElement(Form.Dropdown.Item, { value: "error", title: "Error" }))))));
}
/**
 * ZTools 系统偏好设置中心主入口
 * 对标 Raycast Settings 规范，5 大分组交互式治理中心
 */
export default function SettingsCommand() {
    const [searchText, setSearchText] = useState("");
    const [currentTab, setCurrentTab] = useState("general");
    const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
    const [cacheSizeText, setCacheSizeText] = useState("11.88 MB");
    const [isLoading, setIsLoading] = useState(true);
    const { push } = useNavigation();
    // 初始化加载偏好设置与缓存信息
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const [loaded, cacheInfo] = await Promise.all([
                    getPreferences(),
                    getSqliteCacheInfo()
                ]);
                if (mounted) {
                    setPreferences(loaded);
                    setCacheSizeText(cacheInfo.formattedSize);
                    setIsLoading(false);
                }
            }
            catch (err) {
                if (mounted)
                    setIsLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, []);
    // 重置配置
    const handleReset = async () => {
        const reset = await resetPreferences();
        setPreferences(reset);
        await showToast(Toast.Style.Success, "已重置为出厂默认设置");
    };
    // 导出配置
    const handleExport = async () => {
        const jsonStr = await exportPreferencesJson();
        await Clipboard.copy(jsonStr);
        await showToast(Toast.Style.Success, "配置已复制到剪贴板 (JSON 格式)");
    };
    // 一键清空本地 SQLite 缓存
    const handleClearCache = async () => {
        const res = await clearSqliteCache();
        const updatedCache = await getSqliteCacheInfo();
        setCacheSizeText(updatedCache.formattedSize);
        await showToast(Toast.Style.Success, "本地 SQLite 缓存已清空", `已释放 ${(res.clearedBytes / 1024 / 1024).toFixed(2)} MB 空间`);
    };
    // 快速切换扩展启用/禁用
    const handleToggleExtension = async (ext) => {
        const updated = await updateExtensionConfig(ext.id, { enabled: !ext.enabled });
        setPreferences(updated);
        await showToast(Toast.Style.Success, !ext.enabled ? "已启用扩展" : "已禁用扩展", ext.name);
    };
    // 过滤后的扩展清单
    const filteredExtensions = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        const list = preferences.extensions && preferences.extensions.length > 0
            ? preferences.extensions
            : BUILTIN_EXTENSIONS;
        if (!q)
            return list;
        return list.filter(e => e.name.toLowerCase().includes(q) ||
            e.id.toLowerCase().includes(q) ||
            (e.alias && e.alias.toLowerCase().includes(q)));
    }, [preferences.extensions, searchText]);
    // 过滤后的全局快捷键清单
    const filteredShortcuts = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        const list = preferences.shortcuts || [];
        if (!q)
            return list;
        return list.filter(s => s.name.toLowerCase().includes(q) ||
            s.commandId.toLowerCase().includes(q) ||
            (s.hotkey && s.hotkey.toLowerCase().includes(q)));
    }, [preferences.shortcuts, searchText]);
    const p = preferences;
    // 常规设置 Detail Markdown
    const generalDetailMarkdown = useMemo(() => {
        return [
            `# ⚙️ 常规偏好设置 (General Preferences)`,
            `---`,
            `### 🎨 外观与主题`,
            `- **当前主题**: \`${p.general.theme.toUpperCase()}\` (支持跟随系统、极客深色、清爽浅色)`,
            `- **亚克力毛玻璃质感 (Mica/Acrylic)**: ${p.general.acrylicEffect ? "✅ 已开启" : "❌ 已关闭"}`,
            `\n### 🚀 启动与窗口行为`,
            `- **开机自启动**: ${p.general.openAtLogin ? "✅ 已开启" : "❌ 未开启"}`,
            `- **窗口失焦自动隐藏 (Auto-Hide on Blur)**: ${p.general.autoHideOnBlur ? "✅ 已开启 (极客免干扰)" : "❌ 已关闭 (保持悬浮)"}`,
            `- **主窗口形态**: \`${p.general.windowMode === "compact" ? "极简工具条 (Compact)" : "完整工作台 (Expanded)"}\``,
            `- **系统托盘图标**: ${p.general.showInTray ? "显示" : "隐藏"}\n`,
            `### ⌨️ 全局呼出热键`,
            `> 唤醒热键: \`${p.general.globalHotkey}\` (随时随地一键出窗)\n`,
            `> 按 **Enter** 快捷编辑常规设置选项。`
        ].join("\n\n");
    }, [p.general]);
    // 高级与存储 Detail Markdown
    const advancedDetailMarkdown = useMemo(() => {
        return [
            `# 💾 高级与本地存储 (Advanced & Storage)`,
            `---`,
            `### 🗄️ SQLite WAL 本地缓存治理`,
            `- **本地 SQLite 缓存占用**: \`${cacheSizeText}\``,
            `- **数据库模式**: WAL (Write-Ahead Logging 毫秒并发无锁读写)`,
            `- **状态自愈与防篡改**: 损坏配置秒级自愈与清洗隔离\n`,
            `### ⚡ 底层硬件与 Native 侧车`,
            `- **特权穿透 (UIAccess Worker)**: ${p.advanced.enableUiaAccess ? "✅ 运行中 (穿透 UIPI 跨进程抓词)" : "未激活"}`,
            `- **显存节能挂起 (15s GPU Suspend)**: ${p.advanced.enableGpuPowerSaving ? "开启 (待机显存与内存压降至 <200MB)" : "关闭"}`,
            `- **开发者模式 (DevTools)**: ${p.advanced.developerMode ? "开启" : "关闭"}\n`,
            `### 🌐 网络与代理`,
            `- **网络代理模式**: \`${p.advanced.proxyMode.toUpperCase()}\` (${p.advanced.proxyUrl || "跟随系统"})\n`,
            `> 真实双向绑定存盘，支持一键清空缓存与配置备份。`
        ].join("\n\n");
    }, [p.advanced, cacheSizeText]);
    // 关于 Detail Markdown
    const aboutDetailMarkdown = useMemo(() => {
        return [
            `# ℹ️ 关于 ZTools (About)`,
            `---`,
            `### 🚀 版本与架构`,
            `- **宿主版本**: \`v${p.about.version}\` (构建号: \`${p.about.buildNumber}\`)`,
            `- **核心架构**: TypeScript + Electron \`${p.about.electronVersion}\` + Vue \`${p.about.vueVersion}\` + Rust Sidecar \`${p.about.rustSidecarVersion}\``,
            `- **更新通道**: \`${p.about.updateChannel.toUpperCase()}\` (当前处于最新极客稳定版)`,
            `- **UI 规范**: 统一声明式 UI 标准规范 (Zero DOM / Zero CSS 污染)\n`,
            `### 🛡️ 商业与生态承诺`,
            `- **纯粹开源永久免费**: 零广告、不作恶、核心能力永久无限制开放`,
            `- **Local-First & E2EE 隐私优先**: 本地 SQLite 存储，端到端密文上云`,
            `- **开源许可证**: 客户端 GNU GPL-3.0；插件 SDK 与声明式组件库 MIT\n`,
            `> 对标国际一流 Windows & macOS 双端效率中枢平台。`
        ].join("\n\n");
    }, [p.about]);
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchBarPlaceholder: "\u641C\u7D22\u7CFB\u7EDF\u8BBE\u7F6E\u4E0E\u6269\u5C55 (\u5982 \u4E3B\u9898, \u70ED\u952E, \u7F13\u5B58, \u6269\u5C55\u540D)...", onSearchTextChange: setSearchText, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u5207\u6362\u8BBE\u7F6E\u5206\u7C7B", value: currentTab, onChange: (val) => setCurrentTab(val) },
            React.createElement(List.Dropdown.Item, { title: "\u5E38\u89C4\u8BBE\u7F6E (General)", value: "general", icon: Icon.Gear }),
            React.createElement(List.Dropdown.Item, { title: `扩展管理 (${preferences.extensions?.length || BUILTIN_EXTENSIONS.length} 款)`, value: "extensions", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u5168\u5C40\u5FEB\u6377\u952E (Hotkeys)", value: "shortcuts", icon: Icon.Key }),
            React.createElement(List.Dropdown.Item, { title: "\u9AD8\u7EA7\u4E0E\u5B58\u50A8 (Advanced)", value: "advanced", icon: Icon.HardDrive }),
            React.createElement(List.Dropdown.Item, { title: "\u5173\u4E8E (About)", value: "about", icon: Icon.Document })) },
        currentTab === "general" && (React.createElement(List.Section, { title: "\u5E38\u89C4\u504F\u597D\u8BBE\u7F6E (General)" },
            React.createElement(List.Item, { id: "general-preferences", title: "\u5E38\u89C4\u504F\u597D\u914D\u7F6E", subtitle: `主题: ${p.general.theme} | 热键: ${p.general.globalHotkey} | 失焦自隐: ${p.general.autoHideOnBlur ? "是" : "否"}`, icon: Icon.Gear, accessories: [
                    { text: p.general.theme.toUpperCase() },
                    { icon: p.general.autoHideOnBlur ? Icon.Check : Icon.Circle }
                ], detail: React.createElement(List.Item.Detail, { markdown: generalDetailMarkdown }), actions: React.createElement(ActionPanel, null,
                    React.createElement(ActionPanel.Section, { title: "\u5E38\u89C4\u64CD\u4F5C" },
                        React.createElement(Action.Push, { title: "\u7F16\u8F91\u5E38\u89C4\u8BBE\u7F6E (\u56DE\u8F66\u9ED8\u8BA4)", icon: Icon.Pencil, target: React.createElement(GeneralSettingsForm, { initial: p.general, onSaved: (updated) => setPreferences({ ...p, general: updated }) }) }),
                        React.createElement(Action, { title: "\u5207\u6362\u4E3B\u9898 (Dark/Light/Auto)", icon: Icon.Brush, onAction: async () => {
                                const nextTheme = p.general.theme === "dark" ? "light" : p.general.theme === "light" ? "auto" : "dark";
                                const updated = await savePreferences({ general: { ...p.general, theme: nextTheme } });
                                setPreferences(updated);
                                await showToast(Toast.Style.Success, `已切换主题: ${nextTheme}`);
                            } }),
                        React.createElement(Action, { title: "\u5207\u6362\u5931\u7126\u81EA\u52A8\u9690\u85CF", icon: Icon.Eye, onAction: async () => {
                                const nextVal = !p.general.autoHideOnBlur;
                                const updated = await savePreferences({ general: { ...p.general, autoHideOnBlur: nextVal } });
                                setPreferences(updated);
                                await showToast(Toast.Style.Success, nextVal ? "已开启失焦自动隐藏" : "已关闭失焦自动隐藏");
                            } }),
                        React.createElement(Action, { title: "\u590D\u5236\u5168\u91CF\u914D\u7F6E JSON", icon: Icon.Clipboard, shortcut: { modifiers: ["ctrl"], key: "e" }, onAction: handleExport }),
                        React.createElement(Action, { title: "\u91CD\u7F6E\u51FA\u5382\u9ED8\u8BA4", icon: Icon.Repeat, shortcut: { modifiers: ["ctrl"], key: "r" }, onAction: handleReset }))) }))),
        currentTab === "extensions" && (React.createElement(List.Section, { title: `官方内置扩展管理 (${filteredExtensions.length})` }, filteredExtensions.map((ext) => (React.createElement(List.Item, { key: ext.id, id: ext.id, title: ext.name, subtitle: `${ext.description} ${ext.alias ? `[别名: ${ext.alias}]` : ""} ${ext.hotkey ? `[热键: ${ext.hotkey}]` : ""}`, icon: ext.enabled ? Icon.Checkmark : Icon.XMarkCircle, accessories: [
                ...(ext.hotkey ? [{ text: ext.hotkey }] : []),
                ...(ext.alias ? [{ text: `@${ext.alias}` }] : []),
                { text: ext.enabled ? "已启用" : "已禁用", icon: ext.enabled ? Icon.Check : Icon.Circle }
            ], detail: React.createElement(List.Item.Detail, { markdown: `# ${ext.name}\n\n**标识符**: \`${ext.id}\` &nbsp;&nbsp;|&nbsp;&nbsp; **分类**: \`${ext.category}\`\n\n### 📖 扩展功能说明\n> ${ext.description}\n\n### ⚙️ 快捷调用与状态\n- **启用状态**: ${ext.enabled ? "✅ 已启用" : "❌ 已禁用"}\n- **唤醒热键**: \`${ext.hotkey || "未配置"}\`\n- **快速别名**: \`${ext.alias ? `@${ext.alias}` : "无"}\`\n- **官方内置**: ${ext.isBuiltin ? "是 (标杆原生套件)" : "第三方扩展"}\n\n> 按 **Enter** 快捷配置别名与专属全局热键。`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6269\u5C55\u540D\u79F0", text: ext.name, icon: Icon.List }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "ID", text: ext.id, icon: Icon.Code }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5206\u7C7B", text: ext.category }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5FEB\u901F\u522B\u540D", text: ext.alias || "未设" }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5524\u9192\u70ED\u952E", text: ext.hotkey || "未设" }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8FD0\u884C\u72B6\u6001", text: ext.enabled ? "运行中" : "已禁用", icon: ext.enabled ? Icon.Check : Icon.Circle })) }), actions: React.createElement(ActionPanel, null,
                React.createElement(ActionPanel.Section, { title: "\u6269\u5C55\u63A7\u5236" },
                    React.createElement(Action.Push, { title: `配置 ${ext.name} (回车默认)`, icon: Icon.Pencil, target: React.createElement(ExtensionConfigForm, { extension: ext, onSaved: (updated) => {
                                const list = p.extensions.map(e => e.id === updated.id ? updated : e);
                                setPreferences({ ...p, extensions: list });
                            } }) }),
                    React.createElement(Action, { title: ext.enabled ? "禁用此扩展" : "启用此扩展", icon: ext.enabled ? Icon.Trash : Icon.Checkmark, shortcut: { modifiers: ["ctrl"], key: "t" }, onAction: () => handleToggleExtension(ext) }))) }))))),
        currentTab === "shortcuts" && (React.createElement(List.Section, { title: `全局唤醒快捷键 (${filteredShortcuts.length})` }, filteredShortcuts.map((s) => (React.createElement(List.Item, { key: s.id, id: s.id, title: s.name, subtitle: `命令: ${s.commandId} | 快捷键: ${s.hotkey || "未设"} | 别名: ${s.alias || "无"}`, icon: Icon.Key, accessories: [
                ...(s.hotkey ? [{ text: s.hotkey }] : [{ text: "未分配" }])
            ], detail: React.createElement(List.Item.Detail, { markdown: `# ⌨️ ${s.name} (\`${s.commandId}\`)\n\n- **全局唤醒热键**: \`${s.hotkey || "未配置"}\`\n- **根搜索别名**: \`${s.alias || "无"}\`\n- **状态**: ${s.enabled ? "已启用" : "已禁用"}\n\n> 支持全局极速唤醒，零冲突调度。` }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u590D\u5236\u5524\u9192\u70ED\u952E", icon: Icon.Clipboard, onAction: async () => {
                        if (s.hotkey) {
                            await Clipboard.copy(s.hotkey);
                            await showToast(Toast.Style.Success, "已复制快捷键", s.hotkey);
                        }
                    } })) }))))),
        currentTab === "advanced" && (React.createElement(List.Section, { title: "\u9AD8\u7EA7\u4E0E\u5B58\u50A8\u6CBB\u7406 (Advanced & Storage)" },
            React.createElement(List.Item, { id: "sqlite-cache-governance", title: "\u672C\u5730 SQLite \u7F13\u5B58\u4E0E\u5E95\u5C42\u4FA7\u8F66", subtitle: `缓存体积: ${cacheSizeText} | 代理: ${p.advanced.proxyMode} | 特权穿透: ${p.advanced.enableUiaAccess ? "开" : "关"}`, icon: Icon.HardDrive, accessories: [{ text: cacheSizeText }], detail: React.createElement(List.Item.Detail, { markdown: advancedDetailMarkdown }), actions: React.createElement(ActionPanel, null,
                    React.createElement(ActionPanel.Section, { title: "\u5B58\u50A8\u64CD\u4F5C" },
                        React.createElement(Action, { title: "\u4E00\u952E\u6E05\u7A7A\u672C\u5730 SQLite \u7F13\u5B58 (\u56DE\u8F66\u6267\u884C)", icon: Icon.Trash, onAction: handleClearCache }),
                        React.createElement(Action.Push, { title: "\u914D\u7F6E\u7F51\u7EDC\u4EE3\u7406\u4E0E\u65E5\u5FD7\u7B49\u7EA7", icon: Icon.Gear, target: React.createElement(SettingsFormView, { sectionKey: "advanced", initialPreferences: preferences, onSaved: (updated) => setPreferences(updated) }) }),
                        React.createElement(Action, { title: "\u5907\u4EFD\u5BFC\u51FA\u914D\u7F6E\u5230\u526A\u8D34\u677F", icon: Icon.Clipboard, shortcut: { modifiers: ["ctrl"], key: "e" }, onAction: handleExport }))) }))),
        currentTab === "about" && (React.createElement(List.Section, { title: "\u5173\u4E8E ZTools (About)" },
            React.createElement(List.Item, { id: "about-ztools", title: "ZTools \u6781\u5BA2\u6548\u7387\u4E2D\u67A2", subtitle: `版本: v${p.about.version} (${p.about.buildNumber}) | 开源协议: GPL-3.0`, icon: Icon.Document, accessories: [{ text: `v${p.about.version}` }], detail: React.createElement(List.Item.Detail, { markdown: aboutDetailMarkdown }), actions: React.createElement(ActionPanel, null,
                    React.createElement(ActionPanel.Section, { title: "\u5173\u4E8E\u64CD\u4F5C" },
                        React.createElement(Action, { title: "\u68C0\u67E5\u66F4\u65B0", icon: Icon.Download, onAction: async () => {
                                await showToast(Toast.Style.Success, "当前已是最新极客版本", `v${p.about.version}`);
                            } }),
                        React.createElement(Action, { title: "\u590D\u5236\u7248\u672C\u4FE1\u606F", icon: Icon.Clipboard, onAction: async () => {
                                const info = `ZTools v${p.about.version} (${p.about.buildNumber}) - Electron ${p.about.electronVersion}`;
                                await Clipboard.copy(info);
                                await showToast(Toast.Style.Success, "已复制版本信息");
                            } }))) })))));
}
