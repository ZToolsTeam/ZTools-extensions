import React, { List, ActionPanel, Action, Icon, showToast, Toast, useState, useEffect, useMemo, useCallback, useRef } from '../../index.js';
import { scanAllBrowserBookmarksWithMeta, searchAndFilterBookmarks } from './bookmark-scanner.js';
export * from './types.js';
export * from './bookmark-scanner.js';
function getBrowserIcon(browser) {
    switch (browser) {
        case 'edge':
        case 'safari':
            return Icon.Globe;
        case 'chrome':
        case 'brave':
            return Icon.Globe;
        case '360se':
        case '360chrome':
        case 'qqbrowser':
            return Icon.Shield;
        case 'firefox':
            return Icon.Bolt;
        default:
            return Icon.Globe;
    }
}
function mapFeatureCodeToBrowserFilter(featureCode) {
    switch (featureCode) {
        case 'bookmarks-edge':
            return 'edge';
        case 'bookmarks-chrome':
            return 'chrome';
        case 'bookmarks-domestic':
            return 'domestic';
        case 'bookmarks-firefox':
            return 'firefox';
        default:
            return 'all';
    }
}
export function BrowserBookmarks({ featureCode = 'bookmarks-all', initialBookmarks, hostOverride } = {}) {
    const [isLoading, setIsLoading] = useState(!initialBookmarks);
    const [bookmarks, setBookmarks] = useState(initialBookmarks || []);
    const [searchText, setSearchText] = useState('');
    const [browserFilter, setBrowserFilter] = useState(() => mapFeatureCodeToBrowserFilter(featureCode));
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);
    const handleReloadBookmarks = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await scanAllBrowserBookmarksWithMeta({ hostOverride });
            if (!mountedRef.current)
                return;
            setBookmarks(res.bookmarks);
        }
        catch (err) {
            if (!mountedRef.current)
                return;
            await showToast({
                style: Toast.Style.Failure,
                title: '读取浏览器书签失败',
                message: err instanceof Error ? err.message : String(err)
            });
        }
        finally {
            if (mountedRef.current) {
                setIsLoading(false);
            }
        }
    }, [hostOverride]);
    useEffect(() => {
        if (initialBookmarks) {
            return;
        }
        void handleReloadBookmarks();
    }, [initialBookmarks, handleReloadBookmarks]);
    const filteredBookmarks = useMemo(() => searchAndFilterBookmarks(bookmarks, searchText, browserFilter), [bookmarks, searchText, browserFilter]);
    const activeBrowserCount = useMemo(() => {
        const set = new Set(bookmarks.map((b) => b.browser));
        return set.size;
    }, [bookmarks]);
    return (React.createElement(List, { isLoading: isLoading, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u4E66\u7B7E\u6807\u9898\u3001\u62FC\u97F3\u9996\u5B57\u6BCD\u3001URL\u6216\u6587\u4EF6\u5939\uFF08\u5982\uFF1Abili\u3001tb\u3001github\uFF09...", searchBarAccessory: React.createElement(List.Dropdown, { value: browserFilter, onChange: (v) => setBrowserFilter(v), tooltip: "\u6309\u6D4F\u89C8\u5668\u7B5B\u9009" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u6D4F\u89C8\u5668\u4E66\u7B7E", value: "all", icon: Icon.Globe }),
            React.createElement(List.Dropdown.Item, { title: "Microsoft Edge", value: "edge", icon: Icon.Globe }),
            React.createElement(List.Dropdown.Item, { title: "Google Chrome", value: "chrome", icon: Icon.Circle }),
            React.createElement(List.Dropdown.Item, { title: "\u56FD\u5185\u6D4F\u89C8\u5668\uFF08360 / QQ\uFF09", value: "domestic", icon: Icon.Shield }),
            React.createElement(List.Dropdown.Item, { title: "Mozilla Firefox", value: "firefox", icon: Icon.Bolt })), filterBar: {
            summaryText: `已聚合 ${activeBrowserCount} 款浏览器 · 共 ${filteredBookmarks.length} 个书签`,
            actions: [{ id: 'refresh', title: '刷新书签库', onAction: handleReloadBookmarks }]
        } }, filteredBookmarks.slice(0, 100).map((item) => (React.createElement(List.Item, { key: `${item.browser}-${item.id}`, id: `${item.browser}-${item.id}`, title: item.title || item.url, subtitle: item.folderBreadcrumb
            ? `${item.folderBreadcrumb} · ${item.hostname}`
            : item.hostname, icon: getBrowserIcon(item.browser), accessories: [{ tag: item.browserLabel }, { text: item.dateAddedFormatted }], actions: React.createElement(ActionPanel, null,
            React.createElement(Action.OpenInBrowser, { title: "\u6253\u5F00\u7F51\u9875", url: item.url }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u7F51\u9875\u94FE\u63A5", content: item.url, shortcut: { modifiers: ['cmd'], key: 'enter' } }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u4E3A Markdown \u94FE\u63A5", content: `[${item.title}](${item.url})`, shortcut: { modifiers: ['cmd', 'shift'], key: 'c' } }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u4E66\u7B7E\u6807\u9898", content: item.title, shortcut: { modifiers: ['cmd', 'alt'], key: 'c' } }),
            React.createElement(Action, { title: "\u5237\u65B0\u4E66\u7B7E\u7F13\u5B58", icon: Icon.ArrowClockwise, shortcut: { modifiers: ['cmd'], key: 'r' }, onAction: handleReloadBookmarks })) })))));
}
export const BrowserBookmarksCommand = BrowserBookmarks;
export default BrowserBookmarks;
