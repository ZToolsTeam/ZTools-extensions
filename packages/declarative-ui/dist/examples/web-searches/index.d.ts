/**
 * Web Searches, Browser Tab & Contacts (全网多引擎搜索、活动浏览器标签页嗅探与本地通讯录中枢)
 *
 * 深度对齐 Raycast 官方 `web-searches` + `browser` + `contacts` 套件：
 * - 多源搜索引擎秒级直达：Google, GitHub, 知乎, 哔哩哔哩, StackOverflow, MDN, 百度, DuckDuckGo, npm, PyPI
 * - 浏览器活动标签页感知：读取当前 Safari / Chrome / Arc / Edge 前台活动 Tab URL 与标题，一键复制或转为 Markdown 链接
 * - 本地联系人速查与管理：支持姓名/邮箱/电话检索、一键复制与新建/删除联系人
 * - 对接主进程 `web_search`, `url_quick_open`, `browser_get_active_tab`, `contacts_list`, `contacts_create`, `contacts_delete` IPC
 */
export type WebHubViewMode = "all" | "engines" | "browser" | "contacts";
export interface WebSearchEngine {
    readonly id: string;
    readonly name: string;
    readonly keyword: string;
    readonly category: "General" | "Developer" | "Community";
    readonly urlTemplate: string;
    readonly homepage: string;
    readonly description: string;
    readonly isCustom?: boolean;
}
export interface ActiveBrowserTabInfo {
    readonly browserName: string;
    readonly title: string;
    readonly url: string;
    readonly capturedAt: number;
}
export interface ContactEntry {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly phone: string;
    readonly company: string;
    readonly role: string;
}
export declare const CUSTOM_ENGINES_STORAGE_KEY = "ztools.web-searches.custom-engines.v1";
export declare const WEB_SEARCH_ENGINES: readonly WebSearchEngine[];
export declare const DEFAULT_CONTACTS: readonly ContactEntry[];
export declare function loadCustomSearchEngines(): Promise<WebSearchEngine[]>;
export declare function saveCustomSearchEngine(input: {
    name: string;
    keyword: string;
    urlTemplate: string;
    category?: "General" | "Developer" | "Community";
    description?: string;
}): Promise<WebSearchEngine>;
export declare function buildSearchTargetUrl(engine: WebSearchEngine, query: string): string;
export declare const buildSearchUrl: typeof buildSearchTargetUrl;
export declare function performWebSearch(engineOrId: string | WebSearchEngine, query?: string, hostOverride?: any): Promise<{
    ok: boolean;
    url: string;
    engineName: string;
    error?: string;
}>;
export declare const triggerWebSearch: typeof performWebSearch;
export declare function quickOpenUrl(url: string, hostOverride?: any): Promise<{
    ok: boolean;
    url: string;
    error?: string;
}>;
export declare function fetchActiveBrowserTab(hostOverride?: any): Promise<ActiveBrowserTabInfo | null>;
export declare const fetchActiveBrowserTabs: typeof fetchActiveBrowserTab;
export declare function fetchContactsList(query?: string, hostOverride?: any): Promise<ContactEntry[]>;
export declare const searchSystemContacts: typeof fetchContactsList;
export declare function createContactEntry(input: {
    name: string;
    email: string;
    phone?: string;
    company?: string;
    role?: string;
}, hostOverride?: any): Promise<ContactEntry>;
export declare function deleteContactEntry(id: string, hostOverride?: any): Promise<boolean>;
export declare const performContactAction: typeof deleteContactEntry;
/**
 * 自定义添加搜索引擎表单 (<Form>)
 */
export declare function CreateWebSearchForm({ onCreated }: {
    onCreated?: (engine: WebSearchEngine) => void;
}): JSX.Element;
/**
 * 新建联系人表单 (<Form>)
 */
export declare function CreateContactForm({ onCreated }: {
    onCreated?: (contact: ContactEntry) => void;
}): JSX.Element;
export declare function WebSearchesCommand(): JSX.Element;
export default WebSearchesCommand;
