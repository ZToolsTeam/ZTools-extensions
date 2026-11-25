import React from "../../index.js";
import { List, ActionPanel, Action, Icon, Color, showToast, Toast, Clipboard } from "../../index.js";
import { useState, useMemo, useEffect } from "../../runtime/hooks.js";
import { CATEGORIES, getUnicodeHex, getHtmlEntity, getCategoryLabel } from "./data.js";
import { searchEmojis } from "./search.js";
import { getPinnedEmojis, togglePinnedEmoji } from "./storage.js";
export * from "./types.js";
export * from "./data.js";
export * from "./search.js";
export * from "./storage.js";
/**
 * Emoji 详情卡片组件 (双栏详情模式)
 */
export function EmojiDetailView({ item, isPinned }) {
    const codePoint = item.codePoint || getUnicodeHex(item.char);
    const htmlHex = item.htmlEntity || getHtmlEntity(item.char, true);
    const htmlDec = getHtmlEntity(item.char, false);
    const categoryName = getCategoryLabel(item.category);
    const markdown = `
# ${item.char}

### ${item.nameZh}
*${item.name}*

---

### 字符规范与编码
- **Unicode 码点**: \`${codePoint}\`
- **HTML 16进制实体**: \`${htmlHex}\`
- **HTML 10进制实体**: \`${htmlDec}\`
- **所属分类**: ${categoryName}
- **收藏状态**: ${isPinned ? "⭐ 已收藏" : "未收藏"}

---

> **搜索关键词**: \`${item.keywords.join(", ")}\`
`;
    return (React.createElement(List.Item.Detail, { markdown: markdown, metadata: React.createElement(List.Item.Detail.Metadata, null,
            React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8868\u60C5\u5B57\u5F62", text: item.char, icon: Icon.Text }),
            React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5B98\u65B9\u82F1\u6587\u540D", text: item.name, icon: Icon.Document }),
            React.createElement(List.Item.Detail.Metadata.Label, { title: "\u4E2D\u6587\u6807\u51C6\u540D", text: item.nameZh, icon: Icon.Pencil }),
            React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6240\u5C5E\u5206\u7C7B", text: categoryName, icon: Icon.List }),
            React.createElement(List.Item.Detail.Metadata.Separator, null),
            React.createElement(List.Item.Detail.Metadata.Label, { title: "Unicode \u7801\u70B9", text: codePoint, icon: Icon.Key }),
            React.createElement(List.Item.Detail.Metadata.Label, { title: "HTML \u5B9E\u4F53", text: htmlHex, icon: Icon.Code }),
            React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u68C0\u7D22\u6807\u7B7E" }, item.keywords.slice(0, 5).map(k => (React.createElement(List.Item.Detail.Metadata.TagList.Item, { key: k, text: k, color: Color.Blue }))))) }));
}
/**
 * 全键盘极客 Emoji & 符号选择器主命令
 */
export default function EmojiPickerCommand() {
    const [searchText, setSearchText] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [pinnedList, setPinnedList] = useState([]);
    const [isShowingDetail, setIsShowingDetail] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    // 初始化加载置顶表情
    useEffect(() => {
        getPinnedEmojis().then(pins => {
            setPinnedList(pins);
            setIsLoading(false);
        });
    }, []);
    const pinnedSet = useMemo(() => new Set(pinnedList), [pinnedList]);
    // 执行拼音、中文、英文与十六进制全能搜索
    const { allFiltered, pinnedItems, categoryGroups } = useMemo(() => {
        return searchEmojis(searchText, selectedCategory, pinnedSet);
    }, [searchText, selectedCategory, pinnedSet]);
    // 1. 粘贴到前台应用 (Paste to Active App - Enter 默认主动作)
    const handlePaste = async (item) => {
        await Clipboard.paste(item.char);
        await showToast(Toast.Style.Success, `已插入表情 ${item.char}`, item.nameZh);
    };
    // 2. 复制到剪贴板 (Copy Character)
    const handleCopyChar = async (item) => {
        await Clipboard.copy(item.char);
        await showToast(Toast.Style.Success, `已复制表情 ${item.char}`, item.nameZh);
    };
    // 3. 复制 Unicode 码点 (Copy Unicode Hex)
    const handleCopyUnicode = async (item) => {
        const hex = getUnicodeHex(item.char);
        await Clipboard.copy(hex);
        await showToast(Toast.Style.Success, `已复制 Unicode 码点: ${hex}`, item.nameZh);
    };
    // 4. 复制 HTML 实体 (Copy HTML Entity)
    const handleCopyHtml = async (item) => {
        const entity = getHtmlEntity(item.char, true);
        await Clipboard.copy(entity);
        await showToast(Toast.Style.Success, `已复制 HTML 实体: ${entity}`, item.nameZh);
    };
    // 5. 切换常用收藏 (Toggle Pin / Favorite)
    const handleTogglePin = async (item) => {
        const isNowPinned = await togglePinnedEmoji(item.char);
        const updated = await getPinnedEmojis();
        setPinnedList(updated);
        await showToast(Toast.Style.Success, isNowPinned ? `已添加收藏 ${item.char}` : `已移出收藏 ${item.char}`, item.nameZh);
    };
    const renderEmojiItem = (item) => {
        const isPinned = pinnedSet.has(item.char);
        const codePoint = getUnicodeHex(item.char);
        return (React.createElement(List.Item, { key: `${item.category}-${item.char}`, id: `${item.category}-${item.char}`, title: `${item.char}  ${item.nameZh}`, subtitle: item.name, accessories: [
                ...(isPinned ? [{ icon: Icon.Star, tooltip: "已收藏" }] : []),
                { text: codePoint }
            ], detail: React.createElement(EmojiDetailView, { item: item, isPinned: isPinned }), actions: React.createElement(ActionPanel, { title: `${item.char} ${item.nameZh}` },
                React.createElement(Action, { title: "\u63D2\u5165\u524D\u53F0\u6D3B\u52A8\u5E94\u7528 (Paste)", icon: Icon.Terminal, onAction: () => handlePaste(item) }),
                React.createElement(Action, { title: "\u590D\u5236\u8868\u60C5\u7B26\u53F7 (Copy Char)", icon: Icon.CopyClipboard, shortcut: { modifiers: ["ctrl"], key: "c" }, onAction: () => handleCopyChar(item) }),
                React.createElement(Action, { title: "\u590D\u5236 Unicode \u7801\u70B9 (Hex)", icon: Icon.Key, shortcut: { modifiers: ["ctrl", "shift"], key: "u" }, onAction: () => handleCopyUnicode(item) }),
                React.createElement(Action, { title: "\u590D\u5236 HTML \u5B9E\u4F53\u7F16\u7801", icon: Icon.Code, shortcut: { modifiers: ["ctrl", "shift"], key: "h" }, onAction: () => handleCopyHtml(item) }),
                React.createElement(Action, { title: isPinned ? "取消常用收藏" : "加入常用收藏", icon: Icon.Star, shortcut: { modifiers: ["ctrl"], key: "f" }, onAction: () => handleTogglePin(item) }),
                React.createElement(Action, { title: isShowingDetail ? "关闭详情侧栏" : "展开详情侧栏", icon: Icon.SidebarRight, shortcut: { modifiers: ["ctrl"], key: "b" }, onAction: () => setIsShowingDetail(!isShowingDetail) })) }));
    };
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: isShowingDetail, searchBarPlaceholder: "\u641C\u7D22\u8868\u60C5\u4E0E\u7B26\u53F7 (\u652F\u6301\u4E2D\u6587\u3001\u62FC\u97F3\u5982 xiao / diannao\u3001\u82F1\u6587\u6216 U+\u7801\u70B9)...", searchText: searchText, onSearchTextChange: setSearchText, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u9009\u62E9\u8868\u60C5\u7C7B\u522B", value: selectedCategory, onChange: setSelectedCategory },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u7C7B\u522B (All Categories)", value: "all" }),
            React.createElement(List.Dropdown.Item, { title: "\u2B50 \u5E38\u7528\u6536\u85CF (Pinned)", value: "pinned" }),
            CATEGORIES.map(cat => (React.createElement(List.Dropdown.Item, { key: cat.id, title: `${cat.labelZh} (${cat.labelEn})`, value: cat.id })))) },
        selectedCategory === "all" && !searchText && pinnedItems.length > 0 && (React.createElement(List.Section, { title: `⭐ 常用收藏 (${pinnedItems.length})` }, pinnedItems.map(renderEmojiItem))),
        selectedCategory === "pinned" ? (React.createElement(List.Section, { title: `⭐ 常用收藏 (${pinnedItems.length})` }, pinnedItems.map(renderEmojiItem))) : searchText.trim() ? (React.createElement(List.Section, { title: `搜索结果 (${allFiltered.length})` }, allFiltered.map(renderEmojiItem))) : (categoryGroups.map(group => (React.createElement(List.Section, { key: group.category, title: `${getCategoryLabel(group.category)} (${group.items.length})` }, group.items.map(renderEmojiItem)))))));
}
