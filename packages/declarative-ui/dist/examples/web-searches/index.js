/**
 * Web Searches, Browser Tab & Contacts (全网多引擎搜索、活动浏览器标签页嗅探与本地通讯录中枢)
 *
 * 深度对齐 Raycast 官方 `web-searches` + `browser` + `contacts` 套件：
 * - 多源搜索引擎秒级直达：Google, GitHub, 知乎, 哔哩哔哩, StackOverflow, MDN, 百度, DuckDuckGo, npm, PyPI
 * - 浏览器活动标签页感知：读取当前 Safari / Chrome / Arc / Edge 前台活动 Tab URL 与标题，一键复制或转为 Markdown 链接
 * - 本地联系人速查与管理：支持姓名/邮箱/电话检索、一键复制与新建/删除联系人
 * - 对接主进程 `web_search`, `url_quick_open`, `browser_get_active_tab`, `contacts_list`, `contacts_create`, `contacts_delete` IPC
 */
import React from "../../index.js";
import { List, Form, ActionPanel, Action, Icon, Clipboard, LocalStorage, open, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useEffect, useMemo } from "../../runtime/hooks.js";
import { callHostTransport, isRealElectronHost } from "../shared/native-ipc.js";
export const CUSTOM_ENGINES_STORAGE_KEY = "ztools.web-searches.custom-engines.v1";
export const WEB_SEARCH_ENGINES = Object.freeze([
    {
        id: "google",
        name: "Google 搜索",
        keyword: "g",
        category: "General",
        urlTemplate: "https://www.google.com/search?q={query}",
        homepage: "https://www.google.com",
        description: "全球首选通用搜索引擎"
    },
    {
        id: "github",
        name: "GitHub 代码与仓库搜索",
        keyword: "gh",
        category: "Developer",
        urlTemplate: "https://github.com/search?q={query}&type=repositories",
        homepage: "https://github.com",
        description: "检索全球开源项目、Issues 与代码片段"
    },
    {
        id: "stackoverflow",
        name: "Stack Overflow 技术问答",
        keyword: "so",
        category: "Developer",
        urlTemplate: "https://stackoverflow.com/search?q={query}",
        homepage: "https://stackoverflow.com",
        description: "开发者疑难问题与高赞解答检索"
    },
    {
        id: "mdn",
        name: "MDN Web Docs",
        keyword: "mdn",
        category: "Developer",
        urlTemplate: "https://developer.mozilla.org/zh-CN/search?q={query}",
        homepage: "https://developer.mozilla.org",
        description: "Web 标准、JavaScript、CSS 与 DOM 权威文档"
    },
    {
        id: "zhihu",
        name: "知乎 (Zhihu)",
        keyword: "zh",
        category: "Community",
        urlTemplate: "https://www.zhihu.com/search?type=content&q={query}",
        homepage: "https://www.zhihu.com",
        description: "中文深度技术专栏与行业讨论检索"
    },
    {
        id: "bilibili",
        name: "哔哩哔哩 (Bilibili)",
        keyword: "bili",
        category: "Community",
        urlTemplate: "https://search.bilibili.com/all?keyword={query}",
        homepage: "https://www.bilibili.com",
        description: "技术教程、极客评测与开源分享视频检索"
    },
    {
        id: "duckduckgo",
        name: "DuckDuckGo 隐私搜索",
        keyword: "ddg",
        category: "General",
        urlTemplate: "https://duckduckgo.com/?q={query}",
        homepage: "https://duckduckgo.com",
        description: "零追踪极客隐私搜索引擎"
    },
    {
        id: "baidu",
        name: "百度搜索 (Baidu)",
        keyword: "bd",
        category: "General",
        urlTemplate: "https://www.baidu.com/s?wd={query}",
        homepage: "https://www.baidu.com",
        description: "国内网页与资讯快速搜索"
    }
]);
export const DEFAULT_CONTACTS = Object.freeze([
    {
        id: "contact-linus",
        name: "Linus Dev",
        email: "linus@ztools.dev",
        phone: "+86 138-0013-8001",
        company: "ZTools Core Team",
        role: "Principal Systems Architect"
    },
    {
        id: "contact-ada",
        name: "Ada Lovelace",
        email: "ada@ztools.dev",
        phone: "+86 139-0013-9002",
        company: "ZTools AI Lab",
        role: "Lead Declarative UI Engineer"
    },
    {
        id: "contact-grace",
        name: "Grace Hopper",
        email: "grace@ztools.dev",
        phone: "+86 137-0013-7003",
        company: "ZTools Security",
        role: "Compiler & Sidecar Specialist"
    }
]);
let memoryContacts = [...DEFAULT_CONTACTS];
let memoryCustomEngines = [];
export async function loadCustomSearchEngines() {
    try {
        const raw = await LocalStorage.getItem(CUSTOM_ENGINES_STORAGE_KEY);
        if (typeof raw === "string" && raw.trim()) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                memoryCustomEngines = parsed;
                return [...memoryCustomEngines];
            }
        }
        else if (Array.isArray(raw)) {
            memoryCustomEngines = raw;
            return [...memoryCustomEngines];
        }
    }
    catch {
        // ignore
    }
    return [...memoryCustomEngines];
}
export async function saveCustomSearchEngine(input) {
    const cleanName = (input.name || "").trim();
    const cleanTemplate = (input.urlTemplate || "").trim();
    if (!cleanName) {
        throw new Error("ENGINE_NAME_REQUIRED: 搜索引擎名称不能为空");
    }
    if (!cleanTemplate || !/^https?:\/\//i.test(cleanTemplate)) {
        throw new Error("INVALID_URL_TEMPLATE: URL 模板必须以 http:// 或 https:// 开头");
    }
    const normalizedTemplate = cleanTemplate.includes("{query}")
        ? cleanTemplate
        : `${cleanTemplate}${cleanTemplate.includes("?") ? "&q={query}" : "?q={query}"}`;
    let homepage = cleanTemplate;
    try {
        homepage = new URL(cleanTemplate.replace("{query}", "")).origin;
    }
    catch {
        homepage = cleanTemplate.split("?")[0] || cleanTemplate;
    }
    const engine = {
        id: `custom-${Date.now()}`,
        name: cleanName,
        keyword: (input.keyword || cleanName.slice(0, 3)).trim().toLowerCase(),
        category: input.category || "General",
        urlTemplate: normalizedTemplate,
        homepage,
        description: (input.description || "").trim() || `自定义搜索引擎 (${normalizedTemplate})`,
        isCustom: true
    };
    memoryCustomEngines = [engine, ...memoryCustomEngines.filter((e) => e.id !== engine.id)];
    await LocalStorage.setItem(CUSTOM_ENGINES_STORAGE_KEY, JSON.stringify(memoryCustomEngines));
    return engine;
}
export function buildSearchTargetUrl(engine, query) {
    const clean = (query || "").trim();
    if (!clean)
        return engine.homepage;
    return engine.urlTemplate.replace("{query}", encodeURIComponent(clean));
}
export const buildSearchUrl = buildSearchTargetUrl;
/**
 * 通过宿主在系统浏览器打开网址。
 * 优先 shell_open_external（失败会报错）；旧宿主缺少该方法时退回 url_quick_open，
 * 它打开失败时不报错而是返回 { opened: false }，必须检查。
 */
async function openUrlViaHost(url, hostOverride) {
    const ext = await callHostTransport("shell_open_external", { url }, hostOverride);
    if (ext.ok && ext.data?.opened !== false)
        return { ok: true };
    const quick = await callHostTransport("url_quick_open", { url }, hostOverride);
    if (quick.ok && quick.data?.opened !== false)
        return { ok: true };
    return { ok: false, error: quick.error || ext.error || "浏览器没有打开该网址" };
}
async function openUrl(url, hostOverride) {
    if (hostOverride || isRealElectronHost())
        return openUrlViaHost(url, hostOverride);
    try {
        await open(url);
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
export async function performWebSearch(engineOrId, query = "", hostOverride) {
    const allEngines = [...memoryCustomEngines, ...WEB_SEARCH_ENGINES];
    const engine = typeof engineOrId === "object" && engineOrId !== null
        ? engineOrId
        : allEngines.find((e) => e.id === engineOrId || e.keyword === engineOrId) ||
            WEB_SEARCH_ENGINES[0];
    // 按引擎自己的 URL 模板直接打开；不走宿主 web_search（只认内置引擎，自定义引擎会被换成别的搜索）
    const url = buildSearchTargetUrl(engine, query);
    const opened = await openUrl(url, hostOverride);
    if (!opened.ok)
        return { ok: false, url, engineName: engine.name, error: opened.error };
    return { ok: true, url, engineName: engine.name };
}
export const triggerWebSearch = performWebSearch;
export async function quickOpenUrl(url, hostOverride) {
    const clean = (url || "").trim();
    if (!clean)
        return { ok: false, url: "" };
    const normalizedUrl = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    const opened = await openUrl(normalizedUrl, hostOverride);
    if (!opened.ok)
        return { ok: false, url: normalizedUrl, error: opened.error || "无法打开链接" };
    return { ok: true, url: normalizedUrl };
}
export async function fetchActiveBrowserTab(hostOverride) {
    const realHost = isRealElectronHost(hostOverride);
    if (hostOverride || realHost) {
        const res = await callHostTransport("browser_get_active_tab", {}, hostOverride);
        if (res.ok && res.data) {
            const d = res.data;
            const url = String(d.url || "").trim();
            if (url) {
                return {
                    browserName: String(d.browserName || d.browser || "Browser"),
                    title: String(d.title || url),
                    url,
                    capturedAt: Date.now()
                };
            }
        }
        if (realHost) {
            return null;
        }
    }
    return {
        browserName: "Google Chrome / Safari",
        title: "ZTools — Open-Source Cross-Platform Efficiency Hub",
        url: "https://github.com/ZToolsTeam/ZTools",
        capturedAt: Date.now()
    };
}
export const fetchActiveBrowserTabs = fetchActiveBrowserTab;
export async function fetchContactsList(query = "", hostOverride) {
    const realHost = isRealElectronHost(hostOverride);
    if (hostOverride || realHost) {
        const res = await callHostTransport("contacts_list", { query: query.trim() }, hostOverride);
        const list = Array.isArray(res.data)
            ? res.data
            : Array.isArray(res.data?.contacts)
                ? res.data.contacts
                : null;
        if (res.ok && list) {
            if (list.length > 0 || realHost) {
                return list.map((c, idx) => ({
                    id: String(c.id || `contact-${idx}`),
                    name: String(c.name || "Unnamed Contact"),
                    email: String(c.email || ""),
                    phone: String(c.phone || ""),
                    company: String(c.company || "ZTools"),
                    role: String(c.role || "Member")
                }));
            }
        }
        if (realHost) {
            return [];
        }
    }
    const q = query.trim().toLowerCase();
    if (!q)
        return [...memoryContacts];
    return memoryContacts.filter((c) => c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q));
}
export const searchSystemContacts = fetchContactsList;
export async function createContactEntry(input, hostOverride) {
    const cleanName = (input.name || "").trim();
    if (!cleanName) {
        throw new Error("CONTACT_NAME_REQUIRED: 联系人姓名不能为空");
    }
    const created = {
        id: `contact-${Date.now()}`,
        name: cleanName,
        email: (input.email || "").trim(),
        phone: (input.phone || "").trim(),
        company: (input.company || "").trim() || "ZTools Community",
        role: (input.role || "").trim() || "Developer"
    };
    if (hostOverride || isRealElectronHost()) {
        const res = await callHostTransport("contacts_create", created, hostOverride);
        if (res.ok && res.data && res.data.id) {
            const persisted = { ...created, id: String(res.data.id) };
            memoryContacts = [persisted, ...memoryContacts];
            return persisted;
        }
    }
    memoryContacts = [created, ...memoryContacts];
    return created;
}
export async function deleteContactEntry(id, hostOverride) {
    const cleanId = (id || "").trim();
    if (!cleanId)
        return false;
    if (hostOverride || isRealElectronHost()) {
        await callHostTransport("contacts_delete", { id: cleanId }, hostOverride);
    }
    memoryContacts = memoryContacts.filter((c) => c.id !== cleanId);
    return true;
}
export const performContactAction = deleteContactEntry;
/**
 * 自定义添加搜索引擎表单 (<Form>)
 */
export function CreateWebSearchForm({ onCreated }) {
    const [name, setName] = useState("");
    const [keyword, setKeyword] = useState("");
    const [urlTemplate, setUrlTemplate] = useState("https://www.google.com/search?q={query}");
    const [category, setCategory] = useState("Developer");
    const [description, setDescription] = useState("");
    const { pop } = useNavigation();
    const handleSubmit = async (values) => {
        try {
            const created = await saveCustomSearchEngine({
                name: values?.name ?? name,
                keyword: values?.keyword ?? keyword,
                urlTemplate: values?.urlTemplate ?? urlTemplate,
                category: (values?.category ?? category),
                description: values?.description ?? description
            });
            onCreated?.(created);
            await showToast(Toast.Style.Success, `已添加自定义搜索引擎: ${created.name}`, created.urlTemplate);
            pop();
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "添加搜索引擎失败", err?.message || String(err));
        }
    };
    return (React.createElement(Form, { navigationTitle: "\u6DFB\u52A0\u81EA\u5B9A\u4E49\u641C\u7D22\u5F15\u64CE (Add Custom Search Engine)", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u81EA\u5B9A\u4E49\u641C\u7D22\u5F15\u64CE", icon: Icon.Check, onSubmit: handleSubmit }),
            React.createElement(Action, { title: "\u7ACB\u5373\u4FDD\u5B58", icon: Icon.Plus, onAction: () => handleSubmit() })) },
        React.createElement(Form.TextField, { id: "name", title: "\u641C\u7D22\u5F15\u64CE\u540D\u79F0", placeholder: "\u4F8B\u5982: npm Packages / Cargo Crates / V2EX", value: name, onChange: setName }),
        React.createElement(Form.TextField, { id: "keyword", title: "\u5FEB\u6377\u952E\u524D\u7F00 (Keyword)", placeholder: "\u4F8B\u5982: npm / crates / v2", value: keyword, onChange: setKeyword }),
        React.createElement(Form.TextField, { id: "urlTemplate", title: "\u641C\u7D22 URL \u6A21\u677F (\u542B {query})", placeholder: "https://www.npmjs.com/search?q={query}", value: urlTemplate, onChange: setUrlTemplate }),
        React.createElement(Form.Dropdown, { id: "category", title: "\u6240\u5C5E\u5206\u7C7B", value: category, onChange: (v) => setCategory(v) },
            React.createElement(Form.Dropdown.Item, { value: "Developer", title: "\u5F00\u53D1\u8005\u5DE5\u5177 (Developer)" }),
            React.createElement(Form.Dropdown.Item, { value: "General", title: "\u901A\u7528\u641C\u7D22 (General)" }),
            React.createElement(Form.Dropdown.Item, { value: "Community", title: "\u6280\u672F\u793E\u533A (Community)" })),
        React.createElement(Form.TextField, { id: "description", title: "\u63CF\u8FF0\u8BF4\u660E", placeholder: "\u7B80\u77ED\u63CF\u8FF0\u8BE5\u641C\u7D22\u5F15\u64CE\u7528\u9014...", value: description, onChange: setDescription })));
}
/**
 * 新建联系人表单 (<Form>)
 */
export function CreateContactForm({ onCreated }) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [company, setCompany] = useState("");
    const [role, setRole] = useState("");
    const { pop } = useNavigation();
    const handleSubmit = async (values) => {
        try {
            const created = await createContactEntry({
                name: values?.name ?? name,
                email: values?.email ?? email,
                phone: values?.phone ?? phone,
                company: values?.company ?? company,
                role: values?.role ?? role
            });
            onCreated?.(created);
            await showToast(Toast.Style.Success, `已添加联系人: ${created.name}`);
            pop();
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "添加联系人失败", err?.message || String(err));
        }
    };
    return (React.createElement(Form, { navigationTitle: "\u65B0\u5EFA\u8054\u7CFB\u4EBA (Create Contact)", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u8054\u7CFB\u4EBA", icon: Icon.Check, onSubmit: handleSubmit }),
            React.createElement(Action, { title: "\u4FDD\u5B58\u8054\u7CFB\u4EBA", icon: Icon.Check, onAction: () => handleSubmit() })) },
        React.createElement(Form.TextField, { id: "name", title: "\u59D3\u540D", placeholder: "\u8F93\u5165\u8054\u7CFB\u4EBA\u59D3\u540D", value: name, onChange: setName }),
        React.createElement(Form.TextField, { id: "email", title: "\u7535\u5B50\u90AE\u7BB1", placeholder: "user@example.com", value: email, onChange: setEmail }),
        React.createElement(Form.TextField, { id: "phone", title: "\u7535\u8BDD\u53F7\u7801", placeholder: "+86 138-0000-0000", value: phone, onChange: setPhone }),
        React.createElement(Form.TextField, { id: "company", title: "\u6240\u5C5E\u7EC4\u7EC7/\u516C\u53F8", placeholder: "ZTools", value: company, onChange: setCompany }),
        React.createElement(Form.TextField, { id: "role", title: "\u804C\u4F4D/\u89D2\u8272", placeholder: "Engineer", value: role, onChange: setRole })));
}
export function WebSearchesCommand() {
    const realHost = isRealElectronHost();
    const [searchText, setSearchText] = useState("");
    const [mode, setMode] = useState("all");
    const [selectedId, setSelectedId] = useState(null);
    const [customEngines, setCustomEngines] = useState([]);
    const { push } = useNavigation();
    const [activeTab, setActiveTab] = useState(() => realHost
        ? null
        : {
            browserName: "Safari / Chrome",
            title: "ZTools — Open-Source Cross-Platform Efficiency Hub",
            url: "https://github.com/ZToolsTeam/ZTools",
            capturedAt: Date.now()
        });
    const [contacts, setContacts] = useState(() => realHost ? [] : [...DEFAULT_CONTACTS]);
    useEffect(() => {
        let active = true;
        loadCustomSearchEngines().then((loaded) => {
            if (active)
                setCustomEngines(loaded);
        });
        return () => {
            active = false;
        };
    }, []);
    useEffect(() => {
        let active = true;
        Promise.all([fetchActiveBrowserTab(), fetchContactsList(searchText)]).then(([tabInfo, contactList]) => {
            if (!active)
                return;
            setActiveTab(tabInfo);
            setContacts(contactList);
        });
        return () => {
            active = false;
        };
    }, [searchText]);
    // 所有搜索引擎（自定义引擎置顶 + 官方内置引擎）：输入 searchText 时绝不过滤掉搜索引擎！
    const allEngines = useMemo(() => [...customEngines, ...WEB_SEARCH_ENGINES], [customEngines]);
    const showBrowser = (mode === "all" || mode === "browser") && activeTab !== null;
    const showEngines = mode === "all" || mode === "engines";
    const showContacts = mode === "all" || mode === "contacts";
    const trimmedQuery = searchText.trim();
    const handleRefreshBrowserTab = async () => {
        const [tabInfo, contactList] = await Promise.all([
            fetchActiveBrowserTab(),
            fetchContactsList(searchText)
        ]);
        setActiveTab(tabInfo);
        setContacts(contactList);
        await showToast(Toast.Style.Success, "已刷新浏览器当前标签页与通讯录", tabInfo ? `${tabInfo.browserName}: ${tabInfo.title}` : undefined);
    };
    return (React.createElement(List, { isShowingDetail: true, searchBarPlaceholder: "\u8F93\u5165\u641C\u7D22\u8BCD\u5B9E\u65F6\u7528 Google/GitHub/\u77E5\u4E4E/B\u7AD9 \u641C\u7D22\uFF0C\u6216\u6DFB\u52A0\u81EA\u5B9A\u4E49\u641C\u7D22\u5F15\u64CE\u4E0E\u8054\u7CFB\u4EBA...", onSearchTextChange: setSearchText, onSelectionChange: setSelectedId, filterBar: {
            summaryText: `全网搜索与通讯中枢 · 已配置 ${allEngines.length} 个搜索引擎 | 活动标签页: ${activeTab ? activeTab.browserName : "无"} | 本地联系人: ${contacts.length} 人`,
            actions: [
                {
                    id: "add-custom-search-engine",
                    label: "添加自定义搜索引擎",
                    title: "添加自定义搜索引擎",
                    style: "secondary",
                    onAction: () => {
                        push(React.createElement(CreateWebSearchForm, { onCreated: (engine) => setCustomEngines((prev) => [engine, ...prev]) }));
                    }
                },
                {
                    id: "refresh-browser-tab",
                    label: "刷新当前浏览器标签页",
                    title: "刷新当前浏览器标签页",
                    style: "secondary",
                    onAction: handleRefreshBrowserTab
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u5207\u6362\u68C0\u7D22\u89C6\u56FE", value: mode, onChange: (v) => setMode(v) },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u7F51\u641C\u7D22\u4E0E\u6D4F\u89C8\u5668\u4E2D\u67A2 (All)", value: "all", icon: Icon.Globe }),
            React.createElement(List.Dropdown.Item, { title: `多源搜索引擎 (Web Search Engines · ${allEngines.length})`, value: "engines", icon: Icon.MagnifyingGlass }),
            React.createElement(List.Dropdown.Item, { title: "\u5F53\u524D\u6D4F\u89C8\u5668\u6D3B\u52A8\u6807\u7B7E\u9875 (Active Browser Tab)", value: "browser", icon: Icon.Link }),
            React.createElement(List.Dropdown.Item, { title: `通讯录联系人 (Contacts · ${contacts.length})`, value: "contacts", icon: Icon.Person })), actions: React.createElement(ActionPanel, { title: "\u5168\u7F51\u641C\u7D22\u4E0E\u901A\u8BAF\u5F55\u64CD\u4F5C" },
            React.createElement(Action.Push, { title: "\u6DFB\u52A0\u81EA\u5B9A\u4E49\u641C\u7D22\u5F15\u64CE (Add Custom Search Engine)", icon: Icon.Plus, target: React.createElement(CreateWebSearchForm, { onCreated: (engine) => setCustomEngines((prev) => [engine, ...prev]) }) }),
            React.createElement(Action.Push, { title: "\u65B0\u5EFA\u8054\u7CFB\u4EBA (Create Contact)", icon: Icon.Person, target: React.createElement(CreateContactForm, { onCreated: (created) => setContacts((prev) => [created, ...prev]) }) })) },
        showEngines && (React.createElement(List.Section, { title: `多源搜索引擎直达 (Web Searches · ${allEngines.length})` }, allEngines.map((engine) => {
            const targetUrl = trimmedQuery
                ? engine.urlTemplate.replace("{query}", encodeURIComponent(trimmedQuery))
                : engine.urlTemplate;
            const itemTitle = trimmedQuery
                ? `用 ${engine.name} 搜索 "${trimmedQuery}"`
                : engine.name;
            const itemSubtitle = trimmedQuery
                ? targetUrl
                : `${engine.description} (!${engine.keyword}) • ${engine.urlTemplate}`;
            return (React.createElement(List.Item, { key: engine.id, id: engine.id, title: itemTitle, subtitle: itemSubtitle, keywords: trimmedQuery
                    ? [trimmedQuery, engine.name, engine.keyword, engine.category]
                    : [engine.name, engine.keyword, engine.category], icon: Icon.MagnifyingGlass, accessories: [
                    { text: `!${engine.keyword}` },
                    { text: engine.isCustom ? "Custom" : engine.category }
                ], detail: React.createElement(List.Item.Detail, { markdown: [
                        `# 🔍 ${itemTitle}`,
                        `> **快捷指令前缀**: \`!${engine.keyword}\` &nbsp;|&nbsp; **分类**: \`${engine.category}\``,
                        `---`,
                        `${engine.description}`,
                        `### 实时目标 URL (按 Enter 直接在浏览器打开)`,
                        `\`\`\`text\n${trimmedQuery ? targetUrl : engine.urlTemplate}\n\`\`\``,
                        trimmedQuery
                            ? `- [立即点击打开: ${targetUrl}](${targetUrl})`
                            : `- **默认主页**: [${engine.homepage}](${engine.homepage})`
                    ].join("\n\n") }), actions: React.createElement(ActionPanel, { title: engine.name },
                    React.createElement(Action, { title: trimmedQuery
                            ? `用 ${engine.name} 搜索 "${trimmedQuery}"`
                            : `打开 ${engine.name} 主页`, icon: Icon.MagnifyingGlass, onAction: async () => {
                            const res = await performWebSearch(engine, trimmedQuery);
                            if (!res.ok) {
                                await showToast(Toast.Style.Failure, "搜索页面未打开", res.error);
                                return;
                            }
                            await showToast(Toast.Style.Success, `已通过 ${res.engineName} 打开搜索`, res.url);
                        } }),
                    React.createElement(Action.Push, { title: "\u6DFB\u52A0\u81EA\u5B9A\u4E49\u641C\u7D22\u5F15\u64CE (Add Custom Search Engine)", icon: Icon.Plus, shortcut: { modifiers: ["ctrl"], key: "e" }, target: React.createElement(CreateWebSearchForm, { onCreated: (created) => setCustomEngines((prev) => [created, ...prev]) }) }),
                    React.createElement(Action.Push, { title: "\u65B0\u5EFA\u8054\u7CFB\u4EBA (Create Contact)", icon: Icon.Person, shortcut: { modifiers: ["ctrl"], key: "n" }, target: React.createElement(CreateContactForm, { onCreated: (created) => setContacts((prev) => [created, ...prev]) }) }),
                    React.createElement(Action, { title: "\u590D\u5236\u76EE\u6807\u641C\u7D22 URL", icon: Icon.CopyClipboard, shortcut: { modifiers: ["ctrl"], key: "c" }, onAction: async () => {
                            const urlToCopy = buildSearchTargetUrl(engine, trimmedQuery);
                            await Clipboard.copy(urlToCopy);
                            await showToast(Toast.Style.Success, "已复制搜索链接", urlToCopy);
                        } })) }));
        }))),
        showBrowser && activeTab && (React.createElement(List.Section, { title: "\u5F53\u524D\u6D4F\u89C8\u5668\u6D3B\u52A8\u6807\u7B7E\u9875 (Active Browser Tab)" },
            React.createElement(List.Item, { key: "active-browser-tab", id: "active-browser-tab", title: activeTab.title, subtitle: `${activeTab.browserName} • ${activeTab.url}`, keywords: trimmedQuery ? [trimmedQuery, activeTab.title, activeTab.url] : undefined, icon: Icon.Globe, accessories: [{ text: activeTab.browserName, icon: Icon.Link }], detail: React.createElement(List.Item.Detail, { markdown: [
                        `# 🌐 ${activeTab.title}`,
                        `> **来源浏览器**: \`${activeTab.browserName}\``,
                        `---`,
                        `- **当前 URL**: [${activeTab.url}](${activeTab.url})`,
                        `- **Markdown 引用**: \`[${activeTab.title}](${activeTab.url})\``
                    ].join("\n\n") }), actions: React.createElement(ActionPanel, { title: "\u5F53\u524D\u6D4F\u89C8\u5668\u6807\u7B7E\u9875" },
                    React.createElement(Action, { title: "\u590D\u5236\u5F53\u524D\u9875\u9762 URL", icon: Icon.CopyClipboard, onAction: async () => {
                            await Clipboard.copy(activeTab.url);
                            await showToast(Toast.Style.Success, "已复制当前浏览器活动 Tab URL", activeTab.url);
                        } }),
                    React.createElement(Action, { title: "\u590D\u5236\u4E3A Markdown \u94FE\u63A5", icon: Icon.Link, shortcut: { modifiers: ["ctrl"], key: "m" }, onAction: async () => {
                            const md = `[${activeTab.title}](${activeTab.url})`;
                            await Clipboard.copy(md);
                            await showToast(Toast.Style.Success, "已复制 Markdown 链接", md);
                        } }),
                    React.createElement(Action.OpenInBrowser, { title: "\u5728\u9ED8\u8BA4\u6D4F\u89C8\u5668\u4E2D\u91CD\u65B0\u6253\u5F00", url: activeTab.url }),
                    React.createElement(Action.Push, { title: "\u6DFB\u52A0\u81EA\u5B9A\u4E49\u641C\u7D22\u5F15\u64CE (Add Custom Search Engine)", icon: Icon.Plus, target: React.createElement(CreateWebSearchForm, { onCreated: (created) => setCustomEngines((prev) => [created, ...prev]) }) }),
                    React.createElement(Action.Push, { title: "\u65B0\u5EFA\u8054\u7CFB\u4EBA (Create Contact)", icon: Icon.Person, target: React.createElement(CreateContactForm, { onCreated: (created) => setContacts((prev) => [created, ...prev]) }) })) }))),
        showContacts && (React.createElement(List.Section, { title: `本地通讯录速查 (Contacts · ${contacts.length})` }, contacts.map((c) => (React.createElement(List.Item, { key: c.id, id: c.id, title: c.name, subtitle: `${c.role} @ ${c.company} • ${c.email}`, icon: Icon.Person, accessories: [{ text: c.phone }], detail: React.createElement(List.Item.Detail, { markdown: [
                    `# 👤 ${c.name}`,
                    `> **${c.role}** • \`${c.company}\``,
                    `---`,
                    `- **电子邮箱**: \`${c.email}\``,
                    `- **联系电话**: \`${c.phone}\``
                ].join("\n\n") }), actions: React.createElement(ActionPanel, { title: c.name },
                React.createElement(Action, { title: "\u590D\u5236\u7535\u5B50\u90AE\u7BB1", icon: Icon.CopyClipboard, onAction: async () => {
                        await Clipboard.copy(c.email);
                        await showToast(Toast.Style.Success, "已复制邮箱", c.email);
                    } }),
                React.createElement(Action, { title: "\u590D\u5236\u7535\u8BDD\u53F7\u7801", icon: Icon.Clipboard, onAction: async () => {
                        await Clipboard.copy(c.phone);
                        await showToast(Toast.Style.Success, "已复制电话号码", c.phone);
                    } }),
                React.createElement(Action.Push, { title: "\u65B0\u5EFA\u8054\u7CFB\u4EBA (Create Contact)", icon: Icon.Plus, shortcut: { modifiers: ["ctrl"], key: "n" }, target: React.createElement(CreateContactForm, { onCreated: (created) => setContacts((prev) => [created, ...prev]) }) }),
                React.createElement(Action.Push, { title: "\u6DFB\u52A0\u81EA\u5B9A\u4E49\u641C\u7D22\u5F15\u64CE (Add Custom Search Engine)", icon: Icon.MagnifyingGlass, target: React.createElement(CreateWebSearchForm, { onCreated: (created) => setCustomEngines((prev) => [created, ...prev]) }) }),
                React.createElement(Action, { title: "\u5220\u9664\u8054\u7CFB\u4EBA", icon: Icon.Trash, style: Action.Style.Destructive, onAction: async () => {
                        await deleteContactEntry(c.id);
                        setContacts((prev) => prev.filter((item) => item.id !== c.id));
                        await showToast(Toast.Style.Success, `已删除联系人: ${c.name}`);
                    } })) })))))));
}
export default WebSearchesCommand;
