import React from "../../index.js";
import { confirmAlert } from "../../api/alert.js";
import { List, Detail, ActionPanel, Action, Icon, Color, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useEffect } from "../../runtime/hooks.js";
import { SUPPORTED_LANGUAGES, getLanguageName } from "./languages.js";
import { translateText, fetchLiveTranslation, getTranslateHistory, saveTranslateHistory, clearTranslateHistory, removeTranslateHistoryItem } from "./translate.js";
export * from "./languages.js";
export * from "./translate.js";
/**
 * 翻译详情视图 (现代纯正 TSX 模式)
 */
export function TranslateDetailView({ item }) {
    const googleTranslateUrl = `https://translate.google.com/?sl=${item.sourceLang}&tl=${item.targetLang}&text=${encodeURIComponent(item.sourceText)}`;
    const markdown = `
# ${item.translatedText}

> 原文: **${item.sourceText}**  
> 发音/音标: \`${item.phonetic || "无"}\`

---

### 同义词 / 近义表达
${item.synonyms && item.synonyms.length > 0
        ? item.synonyms.map((s) => `- ${s}`).join("\n")
        : "- 暂无更多同义词推荐"}

### 权威双语例句
${item.examples && item.examples.length > 0
        ? item.examples
            .map((ex, idx) => `**${idx + 1}.** ${ex.source}  
*➔ ${ex.target}*`)
            .join("\n\n")
        : "- 暂无权威例句"}
  `;
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `翻译: ${item.sourceText.slice(0, 12)}...`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u6E90\u8BED\u8A00", text: getLanguageName(item.sourceLang), icon: Icon.Globe }),
            React.createElement(Detail.Metadata.Label, { title: "\u76EE\u6807\u8BED\u8A00", text: getLanguageName(item.targetLang), icon: Icon.ArrowRight }),
            React.createElement(Detail.Metadata.Label, { title: "\u97F3\u6807/\u62FC\u97F3", text: item.phonetic || "-", icon: Icon.Text }),
            React.createElement(Detail.Metadata.Label, { title: "\u7FFB\u8BD1\u65F6\u95F4", text: item.timestamp, icon: Icon.Clock }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.TagList, { title: "\u5F15\u64CE" },
                React.createElement(Detail.Metadata.TagList.Item, { text: "Google Neural MT", color: Color.Blue, icon: Icon.Check }))), actions: React.createElement(ActionPanel, { title: "\u7FFB\u8BD1\u64CD\u4F5C" },
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8BD1\u6587", content: item.translatedText, icon: Icon.CopyClipboard }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u539F\u6587", content: item.sourceText, icon: Icon.Document }),
            React.createElement(Action.OpenInBrowser, { title: "\u5728 Google \u7FFB\u8BD1\u4E2D\u6253\u5F00", url: googleTranslateUrl, icon: Icon.Globe }),
            React.createElement(Action, { title: "\u6717\u8BFB\u53D1\u97F3", icon: Icon.Play, onAction: async () => {
                    await showToast(Toast.Style.Success, "朗读发音", `${item.translatedText} (${item.targetLang})`);
                } })) }));
}
/**
 * Google 翻译主命令 (现代纯正 TSX 模式)
 */
export default function GoogleTranslateCommand() {
    const [inputText, setInputText] = useState("");
    const [targetLang, setTargetLang] = useState("zh-CN");
    const [history, setHistory] = useState([]);
    const [currentResult, setCurrentResult] = useState(null);
    const [errorText, setErrorText] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const { push } = useNavigation();
    // 从 LocalStorage 加载历史记录
    useEffect(() => {
        getTranslateHistory().then((stored) => {
            // 没有历史就是空的，不预置示例记录
            setHistory(Array.isArray(stored) ? stored : []);
        });
    }, []);
    // 监听输入与语种变化，触发真实在线翻译
    useEffect(() => {
        const trimmed = inputText.trim();
        setErrorText("");
        if (!trimmed) {
            setCurrentResult(null);
            setIsLoading(false);
            return;
        }
        // 1. 同步初始结果（如果命中了离线词典，立即响应）
        const initialSync = translateText(trimmed, "auto", targetLang);
        setCurrentResult(initialSync);
        setIsLoading(true);
        // 2. 联网防抖异步获取真实翻译
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const live = await fetchLiveTranslation(trimmed, "auto", targetLang, controller.signal);
                if (live) {
                    setCurrentResult(live);
                }
            }
            catch (err) {
                if (err?.name !== "AbortError" && !controller.signal.aborted) {
                    setErrorText(err?.message || "翻译失败");
                }
            }
            finally {
                setIsLoading(false);
            }
        }, 200);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [inputText, targetLang]);
    // 用系统语音合成朗读；不支持时如实提示
    const handlePronounce = async (text, lang) => {
        const synth = globalThis.speechSynthesis;
        const Utterance = globalThis.SpeechSynthesisUtterance;
        if (!synth || typeof Utterance !== "function") {
            await showToast(Toast.Style.Failure, "当前环境不支持朗读");
            return;
        }
        const utterance = new Utterance(text);
        utterance.lang = lang;
        synth.cancel();
        synth.speak(utterance);
    };
    const handleSaveToHistory = async () => {
        if (!currentResult)
            return;
        const updated = await saveTranslateHistory(currentResult);
        setHistory(updated);
        await showToast(Toast.Style.Success, "已持久化至翻译历史");
    };
    const handleClearHistory = async () => {
        const confirmed = await confirmAlert({
            title: "清空翻译历史？",
            message: `将删除全部 ${history.length} 条记录，且无法恢复。`,
            primaryAction: { title: "清空", style: "destructive" },
            dismissAction: { title: "取消" }
        });
        if (!confirmed)
            return;
        await clearTranslateHistory();
        setHistory([]);
        await showToast(Toast.Style.Success, "已清空翻译历史");
    };
    const handleRemoveHistory = async (id) => {
        const updated = await removeTranslateHistoryItem(id);
        setHistory(updated);
        await showToast(Toast.Style.Success, "已删除该条历史记录");
    };
    const googleUrl = currentResult
        ? `https://translate.google.com/?sl=auto&tl=${targetLang}&text=${encodeURIComponent(currentResult.sourceText)}`
        : "https://translate.google.com";
    return (React.createElement(List, { isLoading: isLoading, navigationTitle: "Google \u5373\u65F6\u7FFB\u8BD1", searchBarPlaceholder: "\u8F93\u5165\u6B32\u7FFB\u8BD1\u7684\u5355\u8BCD\u3001\u53E5\u5B50\u6216\u6BB5\u843D...", searchText: inputText, onSearchTextChange: (txt) => setInputText(txt), searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u9009\u62E9\u76EE\u6807\u8BED\u8A00", value: targetLang, onChange: (newLang) => setTargetLang(newLang) }, SUPPORTED_LANGUAGES.map((lang) => (React.createElement(List.Dropdown.Item, { key: lang.code, title: `${lang.flag} ${lang.name}`, value: lang.code })))), actions: React.createElement(ActionPanel, { title: "\u5168\u5C40\u64CD\u4F5C" },
            React.createElement(Action, { title: "\u4FDD\u5B58\u5F53\u524D\u7FFB\u8BD1\u81F3\u5386\u53F2", icon: Icon.Star, onAction: handleSaveToHistory }),
            React.createElement(Action.OpenInBrowser, { title: "\u5728 Google \u7FFB\u8BD1\u4E2D\u6253\u5F00", url: googleUrl, icon: Icon.Globe }),
            React.createElement(Action, { title: "\u6E05\u7A7A\u6240\u6709\u5386\u53F2\u8BB0\u5F55", icon: Icon.Trash, onAction: handleClearHistory })) },
        !currentResult && errorText && (React.createElement(List.Section, { title: "\u5373\u65F6\u7FFB\u8BD1\u7ED3\u679C" },
            React.createElement(List.Item, { id: "translate-error", title: errorText, icon: Icon.ExclamationMark }))),
        currentResult && (React.createElement(List.Section, { title: "\u5373\u65F6\u7FFB\u8BD1\u7ED3\u679C" },
            React.createElement(List.Item, { id: "live_result", title: currentResult.translatedText, subtitle: currentResult.phonetic
                    ? `${currentResult.phonetic} • ${currentResult.sourceText}`
                    : currentResult.sourceText, icon: Icon.Checkmark, accessories: [{ text: getLanguageName(currentResult.targetLang) }], actions: React.createElement(ActionPanel, { title: currentResult.translatedText },
                    React.createElement(Action.Push, { title: "\u67E5\u770B\u8BE6\u7EC6\u91CA\u4E49\u4E0E\u4F8B\u53E5", icon: Icon.Eye, target: () => React.createElement(TranslateDetailView, { item: currentResult }) }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8BD1\u6587", content: currentResult.translatedText, icon: Icon.CopyClipboard }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u539F\u6587", content: currentResult.sourceText, icon: Icon.Document }),
                    React.createElement(Action, { title: "\u6717\u8BFB\u8BD1\u6587\u53D1\u97F3", icon: Icon.Play, onAction: () => handlePronounce(currentResult.translatedText, currentResult.targetLang) }),
                    React.createElement(Action, { title: "\u4FDD\u5B58\u5230\u672C\u5730\u5386\u53F2", icon: Icon.Star, onAction: handleSaveToHistory }),
                    React.createElement(Action.OpenInBrowser, { title: "\u5728 Google \u7FFB\u8BD1\u4E2D\u6253\u5F00", url: googleUrl, icon: Icon.Globe })) }))),
        React.createElement(List.Section, { title: `翻译历史 (${history.length})` }, history.map((hist) => (React.createElement(List.Item, { key: hist.id, id: hist.id, title: hist.translatedText, subtitle: `${hist.sourceText} (${hist.sourceLang} ➔ ${hist.targetLang})`, icon: Icon.Clock, accessories: [{ text: hist.timestamp }], actions: React.createElement(ActionPanel, { title: hist.translatedText },
                React.createElement(Action.Push, { title: "\u67E5\u770B\u5386\u53F2\u8BE6\u60C5", icon: Icon.Eye, target: () => React.createElement(TranslateDetailView, { item: hist }) }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8BD1\u6587", content: hist.translatedText, icon: Icon.CopyClipboard }),
                React.createElement(Action, { title: "\u91CD\u65B0\u586B\u5165\u8F93\u5165\u6846", icon: Icon.Pencil, onAction: () => {
                        setInputText(hist.sourceText);
                        setTargetLang(hist.targetLang);
                    } }),
                React.createElement(Action, { title: "\u6717\u8BFB\u8BD1\u6587\u53D1\u97F3", icon: Icon.Play, onAction: () => handlePronounce(hist.translatedText, hist.targetLang) }),
                React.createElement(Action, { title: "\u4ECE\u5386\u53F2\u4E2D\u5220\u9664", icon: Icon.Trash, onAction: () => handleRemoveHistory(hist.id) })) }))))));
}
