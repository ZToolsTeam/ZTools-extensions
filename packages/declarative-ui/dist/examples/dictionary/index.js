import React from "../../index.js";
import { List, Detail, ActionPanel, Action, Icon, Color, showToast, Toast, Clipboard, open, useNavigation } from "../../index.js";
import { useState, useMemo, useEffect } from "../../runtime/hooks.js";
import { BUILTIN_DICTIONARY, lookupWord, lookupWordFromHost, speakWordOnHost, getOnlineDictionaryUrls } from "./data.js";
import { getBookmarks, toggleBookmark, isBookmarked, getRecentSearches, recordRecentSearch, clearRecentSearches } from "./storage.js";
import { isRealElectronHost } from "../shared/native-ipc.js";
export * from "./types.js";
export * from "./data.js";
export * from "./storage.js";
/**
 * 单词全屏详情视图
 */
export function WordDetailView({ entry }) {
    const [bookmarked, setBookmarked] = useState(false);
    useEffect(() => {
        let mounted = true;
        (async () => {
            const b = await isBookmarked(entry.word);
            if (mounted)
                setBookmarked(b);
        })();
        return () => { mounted = false; };
    }, [entry.word]);
    const handleToggleBookmark = async () => {
        const res = await toggleBookmark(entry.word);
        setBookmarked(res.isBookmarked);
        await showToast(Toast.Style.Success, res.isBookmarked ? "已加入生词本" : "已从生词本移除", entry.word);
    };
    const urls = getOnlineDictionaryUrls(entry.word);
    const markdown = [
        `# ${entry.word}`,
        `**US:** \`${entry.phoneticUs}\` &nbsp;&nbsp;&nbsp;&nbsp; **UK:** \`${entry.phoneticUk}\`\n`,
        `---`,
        `### 📖 中文精准释义`,
        `> **${entry.pos.join(", ")}** ${entry.definitionZh}\n`,
        `### 🌐 英英释义 (English Definition)`,
        `> ${entry.definitionEn}\n`,
        (entry.examples && entry.examples.length > 0) ? `### 💡 权威例句 (Examples)\n` + (entry.examples ?? []).map(ex => `- ${ex.en}\n  *${ex.zh}*`).join("\n\n") : "",
        entry.synonyms.length > 0 ? `\n### 🔗 同义词 (Synonyms)\n` + entry.synonyms.map(s => `\`${s}\``).join(" • ") : "",
        entry.antonyms.length > 0 ? `\n### ⚡ 反义词 (Antonyms)\n` + entry.antonyms.map(a => `\`${a}\``).join(" • ") : ""
    ].filter(Boolean).join("\n\n");
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `${entry.word} - 详细释义`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u67E5\u8BE2\u5355\u8BCD", text: entry.word, icon: Icon.Text }),
            React.createElement(Detail.Metadata.Label, { title: "\u97F3\u6807", text: `${entry.phoneticUs} (US)` }),
            React.createElement(Detail.Metadata.Label, { title: "\u8BCD\u6027", text: entry.pos.join(", ") }),
            React.createElement(Detail.Metadata.Separator, null),
            entry.tags && entry.tags.length > 0 && (React.createElement(Detail.Metadata.TagList, { title: "\u8BCD\u5E93\u6807\u7B7E" }, entry.tags.map(t => (React.createElement(Detail.Metadata.TagList.Item, { key: t, text: t, color: Color.Blue }))))),
            React.createElement(Detail.Metadata.Label, { title: "\u751F\u8BCD\u672C\u72B6\u6001", text: bookmarked ? "已收藏 ⭐" : "未收藏", icon: bookmarked ? Icon.Star : Icon.Circle })), actions: React.createElement(ActionPanel, null,
            React.createElement(ActionPanel.Section, { title: "\u91CA\u4E49\u64CD\u4F5C" },
                React.createElement(Action, { title: "\u590D\u5236\u4E2D\u6587\u91CA\u4E49", icon: Icon.Clipboard, onAction: async () => {
                        await Clipboard.copy(entry.definitionZh);
                        await showToast(Toast.Style.Success, "已复制中文释义");
                    } }),
                React.createElement(Action, { title: "\u590D\u5236\u5355\u8BCD", icon: Icon.Text, shortcut: { modifiers: ["ctrl"], key: "c" }, onAction: async () => {
                        await Clipboard.copy(entry.word);
                        await showToast(Toast.Style.Success, "已复制单词");
                    } }),
                React.createElement(Action, { title: bookmarked ? "移出生词本" : "加入生词本", icon: bookmarked ? Icon.Trash : Icon.Star, shortcut: { modifiers: ["ctrl"], key: "b" }, onAction: handleToggleBookmark })),
            React.createElement(ActionPanel.Section, { title: "\u5916\u90E8\u6743\u5A01\u8BCD\u5178" },
                React.createElement(Action.OpenInBrowser, { title: "\u5728 \u5251\u6865\u8BCD\u5178 (Cambridge) \u4E2D\u6253\u5F00", url: urls.cambridge }),
                React.createElement(Action.OpenInBrowser, { title: "\u5728 \u6709\u9053\u8BCD\u5178 (Youdao) \u4E2D\u6253\u5F00", url: urls.youdao }),
                React.createElement(Action.OpenInBrowser, { title: "\u5728 \u5FC5\u5E94\u8BCD\u5178 (Bing) \u4E2D\u6253\u5F00", url: urls.bing }),
                React.createElement(Action.OpenInBrowser, { title: "\u5728 WordReference \u4E2D\u6253\u5F00", url: urls.wordReference }))) }));
}
/**
 * 格式化 List.Item.Detail 的 Markdown 视图
 */
function buildItemDetailMarkdown(entry, isBookmarkedWord) {
    const parts = [
        `# ${entry.word}  \`${entry.phoneticUs}\``,
        `**词性**: ${entry.pos.map(p => `\`${p}\``).join(" ")} &nbsp;&nbsp;|&nbsp;&nbsp; **英式**: \`${entry.phoneticUk}\`\n`,
        `### 📖 中文精准释义`,
        `> ${entry.definitionZh}\n`,
        `### 🌐 英英释义`,
        `> ${entry.definitionEn}\n`
    ];
    const exList = entry.examples;
    if (exList && exList.length > 0) {
        parts.push(`### 💡 权威例句`);
        exList.slice(0, 2).forEach(ex => {
            parts.push(`- **${ex.en}**\n  *${ex.zh}*`);
        });
    }
    if (entry.synonyms.length > 0) {
        parts.push(`\n**同义词**: ` + entry.synonyms.slice(0, 5).map(s => `\`${s}\``).join(" • "));
    }
    if (entry.antonyms.length > 0) {
        parts.push(`\n**反义词**: ` + entry.antonyms.slice(0, 4).map(a => `\`${a}\``).join(" • "));
    }
    return parts.join("\n\n");
}
/**
 * 词典释义主入口
 * 输入单词即查，展示音标、释义、例句与同义词
 */
export default function DictionaryCommand() {
    const [searchText, setSearchText] = useState("");
    const [currentTab, setCurrentTab] = useState("all");
    const [bookmarks, setBookmarks] = useState([]);
    const [recents, setRecents] = useState([]);
    const [selectedWord, setSelectedWord] = useState("");
    const [hostEntry, setHostEntry] = useState(null);
    const { push } = useNavigation();
    // 加载生词本与查词历史
    useEffect(() => {
        let mounted = true;
        (async () => {
            const [bmList, rcList] = await Promise.all([
                getBookmarks(),
                getRecentSearches()
            ]);
            if (mounted) {
                setBookmarks(bmList.map(b => b.word.toLowerCase()));
                setRecents(rcList.map(r => r.word.toLowerCase()));
            }
        })();
        return () => { mounted = false; };
    }, []);
    // 真实宿主下异步调用 dictionary_lookup IPC
    useEffect(() => {
        let mounted = true;
        const q = searchText.trim();
        if (!q || !isRealElectronHost()) {
            setHostEntry(null);
            return;
        }
        (async () => {
            try {
                const entry = await lookupWordFromHost(q);
                if (mounted)
                    setHostEntry(entry);
            }
            catch {
                if (mounted)
                    setHostEntry(null);
            }
        })();
        return () => { mounted = false; };
    }, [searchText]);
    // 记录搜索历史并执行查词
    const { results, guesses, isSearching } = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        if (!q) {
            return { results: BUILTIN_DICTIONARY, guesses: [], isSearching: false };
        }
        const searchRes = lookupWord(q, BUILTIN_DICTIONARY);
        const combined = [...searchRes.exactMatches, ...searchRes.suggestions];
        if (hostEntry && !combined.some(e => e.word.toLowerCase() === hostEntry.word.toLowerCase())) {
            combined.unshift(hostEntry);
        }
        return {
            results: combined,
            guesses: searchRes.guesses,
            isSearching: true
        };
    }, [searchText, hostEntry]);
    // 根据 Tab 进行视图过滤
    const displayedEntries = useMemo(() => {
        if (currentTab === "bookmarks") {
            return BUILTIN_DICTIONARY.filter(e => bookmarks.includes(e.word.toLowerCase()));
        }
        if (currentTab === "history") {
            return recents
                .map(w => BUILTIN_DICTIONARY.find(e => e.word.toLowerCase() === w))
                .filter((e) => Boolean(e));
        }
        return results;
    }, [currentTab, bookmarks, recents, results]);
    const handleToggleBookmark = async (entry) => {
        const res = await toggleBookmark(entry.word);
        setBookmarks(res.list.map(b => b.word.toLowerCase()));
        await showToast(Toast.Style.Success, res.isBookmarked ? "已加入生词本" : "已从生词本移除", entry.word);
    };
    const handleSelectWord = async (entry) => {
        setSelectedWord(entry.word);
        const updated = await recordRecentSearch(entry.word);
        setRecents(updated.map(u => u.word.toLowerCase()));
    };
    const handlePronounce = async (entry, dialect = "US") => {
        const phonetic = dialect === "US" ? entry.phoneticUs : entry.phoneticUk;
        await speakWordOnHost(entry.word, dialect);
        await showToast(Toast.Style.Success, `发音朗读 (${dialect})`, `${entry.word} ${phonetic}`);
    };
    const handleClearHistory = async () => {
        await clearRecentSearches();
        setRecents([]);
        await showToast(Toast.Style.Success, "查词历史已清空");
    };
    const activeEntry = displayedEntries.find((e) => e.word === selectedWord) || displayedEntries[0] || null;
    return (React.createElement(List, { isShowingDetail: true, searchBarPlaceholder: "\u641C\u7D22\u8BCD\u5178 (\u5982 architecture, resilience, sidecar, latency)...", onSearchTextChange: setSearchText, onSelectionChange: (id) => setSelectedWord(id || ""), filterBar: {
            summaryText: `当前词条结果 ${displayedEntries.length} 条 · 生词本已收藏 ${bookmarks.length} 个单词 · 历史查询 ${recents.length} 条`,
            actions: [
                {
                    id: "dict-act-cambridge",
                    label: "剑桥词典打开",
                    title: "剑桥词典打开",
                    style: "secondary",
                    onAction: async () => {
                        const targetWord = activeEntry?.word || searchText.trim() || "architecture";
                        const urls = getOnlineDictionaryUrls(targetWord);
                        await open(urls.cambridge);
                    }
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u5207\u6362\u8BCD\u5178\u89C6\u56FE", value: currentTab, onChange: (val) => setCurrentTab(val) },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u8BCD\u6761 (All Words)", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: `生词本 (${bookmarks.length})`, value: "bookmarks", icon: Icon.Star }),
            React.createElement(List.Dropdown.Item, { title: `查词历史 (${recents.length})`, value: "history", icon: Icon.Clock })) },
        React.createElement(List.Section, { title: currentTab === "bookmarks" ? `生词本收藏 (${displayedEntries.length})` : currentTab === "history" ? `最近查询 (${displayedEntries.length})` : `词条结果 (${displayedEntries.length})` }, displayedEntries.map((entry) => {
            const isFav = bookmarks.includes(entry.word.toLowerCase());
            const urls = getOnlineDictionaryUrls(entry.word);
            return (React.createElement(List.Item, { key: entry.word, id: entry.word, title: entry.word, subtitle: `${entry.phoneticUs} — ${entry.pos.join(", ")}`, icon: isFav ? Icon.Star : Icon.Text, accessories: [
                    { text: entry.pos[0] || "n." },
                    ...(isFav ? [{ icon: Icon.Star, tooltip: "已收藏在生词本" }] : [])
                ], detail: React.createElement(List.Item.Detail, { markdown: buildItemDetailMarkdown(entry, isFav), metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5355\u8BCD", text: entry.word, icon: Icon.Text }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7F8E\u5F0F\u97F3\u6807 (US)", text: entry.phoneticUs }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u82F1\u5F0F\u97F3\u6807 (UK)", text: entry.phoneticUk }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8BCD\u6027", text: entry.pos.join(", ") }),
                        React.createElement(List.Item.Detail.Metadata.Separator, null),
                        entry.tags && entry.tags.length > 0 && (React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u8BCD\u5E93\u5206\u7EA7" }, entry.tags.map(t => (React.createElement(List.Item.Detail.Metadata.TagList.Item, { key: t, text: t, color: Color.Blue }))))),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u751F\u8BCD\u672C", text: isFav ? "已在生词本" : "未收藏", icon: isFav ? Icon.Star : Icon.Circle })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(ActionPanel.Section, { title: "\u67E5\u8BCD\u64CD\u4F5C" },
                        React.createElement(Action, { title: "\u590D\u5236\u4E2D\u6587\u91CA\u4E49 (\u56DE\u8F66\u9ED8\u8BA4)", icon: Icon.Clipboard, onAction: async () => {
                                await handleSelectWord(entry);
                                await Clipboard.copy(entry.definitionZh);
                                await showToast(Toast.Style.Success, "已复制释义", entry.definitionZh);
                            } }),
                        React.createElement(Action, { title: "\u590D\u5236\u82F1\u6587\u5355\u8BCD", icon: Icon.Text, shortcut: { modifiers: ["ctrl"], key: "c" }, onAction: async () => {
                                await handleSelectWord(entry);
                                await Clipboard.copy(entry.word);
                                await showToast(Toast.Style.Success, "已复制单词", entry.word);
                            } }),
                        React.createElement(Action, { title: "\u67E5\u770B\u5168\u5C4F\u8BE6\u60C5", icon: Icon.Document, onAction: async () => {
                                await handleSelectWord(entry);
                                push(React.createElement(WordDetailView, { entry: entry }));
                            } }),
                        React.createElement(Action, { title: isFav ? "移出生词本" : "加入生词本 (Favorites)", icon: isFav ? Icon.Trash : Icon.Star, shortcut: { modifiers: ["ctrl"], key: "b" }, onAction: () => handleToggleBookmark(entry) })),
                    React.createElement(ActionPanel.Section, { title: "\u53D1\u97F3\u4E0E\u5916\u90E8\u68C0\u7D22" },
                        React.createElement(Action, { title: "\u6717\u8BFB\u53D1\u97F3 (\u7F8E\u5F0F US)", icon: Icon.Play, shortcut: { modifiers: ["ctrl"], key: "p" }, onAction: () => handlePronounce(entry, "US") }),
                        React.createElement(Action, { title: "\u6717\u8BFB\u53D1\u97F3 (\u82F1\u5F0F UK)", icon: Icon.Play, onAction: () => handlePronounce(entry, "UK") }),
                        React.createElement(Action.OpenInBrowser, { title: "\u5728 \u5251\u6865\u8BCD\u5178 (Cambridge) \u4E2D\u6253\u5F00", url: urls.cambridge }),
                        React.createElement(Action.OpenInBrowser, { title: "\u5728 \u6709\u9053\u8BCD\u5178 (Youdao) \u4E2D\u6253\u5F00", url: urls.youdao }),
                        React.createElement(Action.OpenInBrowser, { title: "\u5728 \u5FC5\u5E94\u8BCD\u5178 (Bing) \u4E2D\u6253\u5F00", url: urls.bing })),
                    currentTab === "history" && (React.createElement(ActionPanel.Section, { title: "\u5386\u53F2\u7BA1\u7406" },
                        React.createElement(Action, { title: "\u6E05\u7A7A\u67E5\u8BCD\u5386\u53F2", icon: Icon.Trash, shortcut: { modifiers: ["ctrl", "shift"], key: "delete" }, onAction: handleClearHistory })))) }));
        })),
        isSearching && guesses.length > 0 && (React.createElement(List.Section, { title: `您是否要找 (Did you mean? ${guesses.length})` }, guesses.map(guess => (React.createElement(List.Item, { key: `guess-${guess.word}`, id: `guess-${guess.word}`, title: guess.word, subtitle: `智能拼写推荐: ${guess.phoneticUs} — ${guess.definitionZh}`, icon: Icon.MagnifyingGlass, actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: `查询 ${guess.word}`, icon: Icon.MagnifyingGlass, onAction: () => {
                        setSearchText(guess.word);
                    } }),
                React.createElement(Action, { title: "\u590D\u5236\u91CA\u4E49", icon: Icon.Clipboard, onAction: async () => {
                        await Clipboard.copy(guess.definitionZh);
                        await showToast(Toast.Style.Success, "已复制释义", guess.definitionZh);
                    } })) })))))));
}
