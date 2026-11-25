import React from "../../index.js";
import { List, ActionPanel, Action, Icon, showToast, Toast, Clipboard } from "../../index.js";
import { useState, useMemo, useEffect } from "../../runtime/hooks.js";
import { SUPPORTED_LANGUAGES, getLanguageByCode } from "./languages.js";
import { translateText, swapLanguages, getRecentTranslations, saveRecentTranslation, clearRecentTranslations, getWebTranslatorUrls } from "./engine.js";
export * from "./languages.js";
export * from "./engine.js";
/**
 * 多语言即时翻译主入口
 * 输入即译，支持自动识别源语言、语言对调与反向对照
 */
export default function TranslatorCommand() {
    const [inputText, setInputText] = useState("");
    const [sourceLang, setSourceLang] = useState("auto");
    const [targetLang, setTargetLang] = useState("zh-Hans");
    const [translation, setTranslation] = useState(null);
    const [recents, setRecents] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    // 初始化加载历史记录与选中文本
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const history = await getRecentTranslations();
                if (mounted)
                    setRecents(history);
            }
            catch (e) {
                console.warn("[translator] load recent translations failed:", e);
            }
        })();
        return () => { mounted = false; };
    }, []);
    // 响应输入变化执行翻译
    useEffect(() => {
        let mounted = true;
        const clean = inputText.trim();
        if (!clean) {
            setTranslation(null);
            return;
        }
        setIsLoading(true);
        const timer = setTimeout(async () => {
            try {
                const res = await translateText(clean, sourceLang, targetLang);
                if (mounted) {
                    setTranslation(res);
                    setIsLoading(false);
                    // 异步计入历史
                    const updated = await saveRecentTranslation(clean, res.translatedText, res.sourceLanguage, res.targetLanguage);
                    if (mounted)
                        setRecents(updated);
                }
            }
            catch (err) {
                if (mounted)
                    setIsLoading(false);
            }
        }, 200);
        return () => {
            mounted = false;
            clearTimeout(timer);
        };
    }, [inputText, sourceLang, targetLang]);
    // 语言对调 (Swap Languages)
    const handleSwap = () => {
        const detectedCode = translation?.detectedLanguage.code || "zh-Hans";
        const swapped = swapLanguages(sourceLang, targetLang, detectedCode);
        setSourceLang(swapped.newSource);
        setTargetLang(swapped.newTarget);
        showToast(Toast.Style.Success, "已对调语言", `${swapped.newSource} ⇄ ${swapped.newTarget}`);
    };
    const handleCopyTranslated = async (text) => {
        if (!text)
            return;
        await Clipboard.copy(text);
        await showToast(Toast.Style.Success, "已复制译文", text);
    };
    const handlePasteTranslated = async (text) => {
        if (!text)
            return;
        await Clipboard.paste(text);
        await showToast(Toast.Style.Success, "已粘贴译文到活动窗口", text);
    };
    const handleCopySource = async (text) => {
        if (!text)
            return;
        await Clipboard.copy(text);
        await showToast(Toast.Style.Success, "已复制原文", text);
    };
    const handleSpeak = async (text, langCode) => {
        if (!text)
            return;
        const { callHostTransport, isRealElectronHost } = await import("../shared/native-ipc.js");
        if (isRealElectronHost()) {
            await callHostTransport("dictionary_speak", { word: text, lang: langCode });
        }
        const langDef = getLanguageByCode(langCode);
        await showToast(Toast.Style.Success, `朗读 (${langDef.nativeName})`, text);
    };
    const handleClearHistory = async () => {
        await clearRecentTranslations();
        setRecents([]);
        await showToast(Toast.Style.Success, "翻译历史已清空");
    };
    const sourceLangDef = getLanguageByCode(sourceLang);
    const targetLangDef = getLanguageByCode(targetLang);
    const webUrls = inputText ? getWebTranslatorUrls(inputText, sourceLang, targetLang) : null;
    // 构建翻译结果卡片的 Markdown
    const detailMarkdown = useMemo(() => {
        if (!translation || !inputText) {
            return `### 极速多语言翻译中枢\n\n` +
                `- **支持语言**: 中、英、日、韩、法、德、西、俄 等 30+ 常用语言\n` +
                `- **极客特性**: 语言自动探测、双向热键对调 (\`Ctrl+S\`)、拼音/音标高保真注音、反向词条对照\n` +
                `- **快速操作**: 回车粘贴到当前焦点窗口，或按 \`Ctrl+C\` 复制译文\n\n` +
                `> 请在上方搜索框输入待翻译的内容开始体验。`;
        }
        const lines = [
            `# ${translation.translatedText}`,
            translation.phonetic ? `*注音 / 音标:* \`${translation.phonetic}\`\n` : ``,
            `---`,
            `### 原文对照`,
            `> ${translation.sourceText}`,
            `**源语种**: \`${translation.detectedLanguage.label}\` (置信度: ${Math.round(translation.detectedLanguage.confidence * 100)}%) &nbsp;&nbsp;|&nbsp;&nbsp; **目标语种**: \`${targetLangDef.nativeName}\`\n`
        ];
        if (translation.reverseTranslations && translation.reverseTranslations.length > 0) {
            lines.push(`### 反向词条对照 (Reverse Translations)`);
            translation.reverseTranslations.forEach(r => {
                lines.push(`- **${r.term}** ${r.pos ? `\`${r.pos}\`` : ""} : ${r.meaning}`);
                if (r.alternates && r.alternates.length > 0) {
                    lines.push(`  *近义对照:* ` + r.alternates.map(a => `\`${a}\``).join(" • "));
                }
            });
        }
        return lines.filter(Boolean).join("\n\n");
    }, [translation, inputText, targetLangDef]);
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchBarPlaceholder: `输入待翻译内容... (当前目标: ${targetLangDef.flag} ${targetLangDef.nativeName})`, onSearchTextChange: setInputText, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u9009\u62E9\u76EE\u6807\u8BED\u8A00", value: targetLang, onChange: (val) => setTargetLang(val) }, SUPPORTED_LANGUAGES.filter(l => l.code !== "auto").map(lang => (React.createElement(List.Dropdown.Item, { key: lang.code, value: lang.code, title: `${lang.flag} ${lang.nativeName} (${lang.label})` })))) },
        translation && inputText ? (React.createElement(List.Section, { title: "\u5B9E\u65F6\u7FFB\u8BD1\u7ED3\u679C (Live Translation)" },
            React.createElement(List.Item, { key: "current-translation", id: "current-translation", title: translation.translatedText, subtitle: `原文: ${translation.sourceText}`, icon: Icon.Globe, accessories: [
                    { text: `${translation.detectedLanguage.code} → ${translation.targetLanguage}` },
                    { icon: Icon.Checkmark }
                ], detail: React.createElement(List.Item.Detail, { markdown: detailMarkdown, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6E90\u8BED\u79CD", text: translation.detectedLanguage.label, icon: Icon.Globe }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u76EE\u6807\u8BED\u79CD", text: targetLangDef.nativeName, icon: Icon.Text }),
                        translation.phonetic && (React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6CE8\u97F3/\u97F3\u6807", text: translation.phonetic })),
                        React.createElement(List.Item.Detail.Metadata.Separator, null),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u63A2\u6D4B\u72B6\u6001", text: "\u5DF2\u81EA\u52A8\u8BC6\u522B", icon: Icon.Check })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(ActionPanel.Section, { title: "\u9996\u8981\u64CD\u4F5C" },
                        React.createElement(Action, { title: "\u7C98\u8D34\u8BD1\u6587\u5230\u6D3B\u52A8\u7A97\u53E3 (\u56DE\u8F66\u9ED8\u8BA4)", icon: Icon.Clipboard, onAction: () => handlePasteTranslated(translation.translatedText) }),
                        React.createElement(Action, { title: "\u590D\u5236\u8BD1\u6587", icon: Icon.CopyClipboard, shortcut: { modifiers: ["ctrl"], key: "c" }, onAction: () => handleCopyTranslated(translation.translatedText) }),
                        React.createElement(Action, { title: "\u590D\u5236\u539F\u6587", icon: Icon.Text, shortcut: { modifiers: ["ctrl", "shift"], key: "c" }, onAction: () => handleCopySource(translation.sourceText) })),
                    React.createElement(ActionPanel.Section, { title: "\u7FFB\u8BD1\u63A7\u5236" },
                        React.createElement(Action, { title: "\u5BF9\u8C03\u6E90\u4E0E\u76EE\u6807\u8BED\u8A00 (Swap)", icon: Icon.Repeat, shortcut: { modifiers: ["ctrl"], key: "s" }, onAction: handleSwap }),
                        React.createElement(Action, { title: "\u6717\u8BFB\u8BD1\u6587", icon: Icon.Play, shortcut: { modifiers: ["ctrl"], key: "p" }, onAction: () => handleSpeak(translation.translatedText, translation.targetLanguage) }),
                        React.createElement(Action, { title: "\u6717\u8BFB\u539F\u6587", icon: Icon.Play, onAction: () => handleSpeak(translation.sourceText, translation.sourceLanguage) })),
                    webUrls && (React.createElement(ActionPanel.Section, { title: "\u5916\u90E8\u7FFB\u8BD1\u5E73\u53F0" },
                        React.createElement(Action.OpenInBrowser, { title: "\u5728 DeepL \u4E2D\u6253\u5F00", url: webUrls.deepL }),
                        React.createElement(Action.OpenInBrowser, { title: "\u5728 Google Translate \u4E2D\u6253\u5F00", url: webUrls.googleTranslate }),
                        React.createElement(Action.OpenInBrowser, { title: "\u5728 \u767E\u5EA6\u7FFB\u8BD1 \u4E2D\u6253\u5F00", url: webUrls.baidu })))) }))) : (React.createElement(List.Section, { title: "\u7B49\u5F85\u8F93\u5165\u5F85\u7FFB\u8BD1\u6587\u672C" },
            React.createElement(List.Item, { title: "\u7B49\u5F85\u8F93\u5165...", subtitle: "\u8F93\u5165\u82F1\u6587\u3001\u4E2D\u6587\u3001\u65E5\u6587\u3001\u97E9\u6587\u6216\u6B27\u6D32\u8BED\u8A00\u5373\u65F6\u5448\u73B0\u8BD1\u6587", icon: Icon.Text, detail: React.createElement(List.Item.Detail, { markdown: detailMarkdown }) }))),
        recents.length > 0 && (React.createElement(List.Section, { title: `近期翻译历史 (${recents.length})` }, recents.map(r => (React.createElement(List.Item, { key: r.id, id: r.id, title: r.translatedText, subtitle: `原文: ${r.sourceText} (${r.sourceLang} → ${r.targetLang})`, icon: Icon.Clock, actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u590D\u5236\u8BD1\u6587", icon: Icon.Clipboard, onAction: () => handleCopyTranslated(r.translatedText) }),
                React.createElement(Action, { title: "\u91CD\u65B0\u8F7D\u5165\u67E5\u8BE2", icon: Icon.MagnifyingGlass, onAction: () => {
                        setInputText(r.sourceText);
                        setTargetLang(r.targetLang);
                    } }),
                React.createElement(Action, { title: "\u6E05\u7A7A\u7FFB\u8BD1\u5386\u53F2", icon: Icon.Trash, shortcut: { modifiers: ["ctrl", "shift"], key: "delete" }, onAction: handleClearHistory })) })))))));
}
