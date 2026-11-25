import React from "../../index.js";
import { List, Detail, Form, ActionPanel, Action, Icon, Color, showToast, Toast, Clipboard, useNavigation } from "../../index.js";
import { useState, useEffect } from "../../runtime/hooks.js";
import { isRealElectronHost, showRealItemInFolder, writeRealClipboardText } from "../shared/native-ipc.js";
import { SAMPLE_CLIPBOARD_ITEMS, getClipboardHistory, saveClipboardHistory, syncCurrentSystemClipboard, detectClipboardContentType, filterClipboardItems, formatCopiedTime, parseColorDetails, maskSensitiveContent, toggleClipboardItemPin, deleteClipboardItem, clearUnpinnedClipboardHistory, pasteSequentialClipboard, resetPasteSequence, getClipboardPreferences } from "./clipboard-storage.js";
export * from "./types.js";
export * from "./clipboard-storage.js";
export function getClipboardMarkdown(item) {
    let markdown = `# 剪贴板内容详情\n\n`;
    const sensitivity = maskSensitiveContent(item.content);
    if (sensitivity.isSensitive || item.isSensitive) {
        markdown += `> **安全防护提示**: 检测到敏感凭据 (${sensitivity.reason || "机密凭据"})，已自动对预览内容执行安全脱敏遮罩。\n\n`;
    }
    if (item.type === "color") {
        const details = parseColorDetails(item.content);
        markdown += `### 调色盘与色彩代码\n\n`;
        if (details) {
            markdown += `\`\`\`css\n/* HEX 格式 */\ncolor: ${details.hex};\n\n/* RGB 格式 */\nbackground-color: ${details.rgb};\n\n/* HSL 格式 */\nborder-color: ${details.hsl};\n\`\`\`\n\n`;
            markdown += `> **HEX**: \`${details.hex}\` | **RGB**: \`${details.rgb}\` | **HSL**: \`${details.hsl}\``;
        }
        else {
            markdown += `> 色彩代码: \`${item.content}\``;
        }
    }
    else if (item.type === "json") {
        try {
            const parsed = JSON.parse(item.content);
            const formatted = JSON.stringify(parsed, null, 2);
            const keysCount = typeof parsed === "object" && parsed !== null ? Object.keys(parsed).length : 0;
            markdown += `### JSON 结构化数据预览 (${keysCount} 个顶层属性)\n\n\`\`\`json\n${formatted}\n\`\`\``;
        }
        catch {
            markdown += `\`\`\`json\n${item.content}\n\`\`\``;
        }
    }
    else if (item.type === "code") {
        markdown += "```typescript\n" + item.content + "\n```";
    }
    else if (item.type === "link") {
        markdown += `### 网络链接\n\n[${item.content}](${item.content})\n\n> 协议: \`${item.content.startsWith("https") ? "HTTPS (安全加密)" : "HTTP"}\``;
    }
    else if (item.type === "image") {
        markdown += `![图片预览](${item.content})\n\n> 分辨率: ${item.imageDimensions?.width ?? 0} x ${item.imageDimensions?.height ?? 0}`;
    }
    else if (item.type === "files") {
        markdown += "### 包含的文件列表\n" + (item.filePaths?.map(f => `- \`${f}\``).join("\n") ?? item.content);
    }
    else {
        if (sensitivity.isSensitive) {
            markdown += `\`\`\`text\n${sensitivity.masked}\n\`\`\``;
        }
        else {
            markdown += item.content;
        }
    }
    return markdown;
}
/**
 * 剪贴板条目详情视图
 */
export function ClipboardDetailView({ item = SAMPLE_CLIPBOARD_ITEMS[0], onDeleted, onPinToggled } = {}) {
    const { pop } = useNavigation();
    const markdown = getClipboardMarkdown(item);
    const colorDetails = item.type === "color" ? parseColorDetails(item.content) : null;
    const sensitivity = maskSensitiveContent(item.content);
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `详情: ${item.type.toUpperCase()}`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u5185\u5BB9\u7C7B\u578B", text: item.type.toUpperCase(), icon: Icon.Document }),
            React.createElement(Detail.Metadata.Label, { title: "\u590D\u5236\u65F6\u95F4", text: formatCopiedTime(item.copiedAt), icon: Icon.Clock }),
            React.createElement(Detail.Metadata.Label, { title: "\u7F6E\u9876\u72B6\u6001", text: item.pinned ? "已置顶" : "未置顶", icon: Icon.Pin }),
            item.sourceAppName ? (React.createElement(Detail.Metadata.Label, { title: "\u6765\u6E90\u5E94\u7528", text: item.sourceAppName, icon: Icon.AppWindow })) : null,
            colorDetails ? (React.createElement(React.Fragment, null,
                React.createElement(Detail.Metadata.Label, { title: "HEX", text: colorDetails.hex, icon: Icon.Eye }),
                React.createElement(Detail.Metadata.Label, { title: "RGB", text: colorDetails.rgb, icon: Icon.Eye }),
                React.createElement(Detail.Metadata.Label, { title: "HSL", text: colorDetails.hsl, icon: Icon.Eye }))) : null,
            item.charCount !== undefined && (React.createElement(Detail.Metadata.Label, { title: "\u5B57\u7B26\u603B\u6570", text: `${item.charCount} 字符`, icon: Icon.Pencil })),
            item.lineCount !== undefined && (React.createElement(Detail.Metadata.Label, { title: "\u6587\u672C\u884C\u6570", text: `${item.lineCount} 行`, icon: Icon.List })),
            (sensitivity.isSensitive || item.isSensitive) ? (React.createElement(Detail.Metadata.Label, { title: "\u654F\u611F\u8131\u654F", text: sensitivity.reason || "已脱敏", icon: Icon.Lock })) : null,
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.TagList, { title: "\u5206\u7C7B\u6807\u7B7E" },
                React.createElement(Detail.Metadata.TagList.Item, { text: item.pinned ? "PINNED" : "STANDARD", color: Color.SecondaryText }),
                (sensitivity.isSensitive || item.isSensitive) ? (React.createElement(Detail.Metadata.TagList.Item, { text: "SENSITIVE", color: Color.Red })) : null)), actions: React.createElement(ActionPanel, { title: "\u6761\u76EE\u64CD\u4F5C" },
            React.createElement(Action.Paste, { title: "\u56DE\u8F66\u7C98\u8D34\u5230\u524D\u53F0\u5E94\u7528 (Paste to Active)", content: item.content, icon: Icon.Checkmark }),
            React.createElement(Action.CopyToClipboard, { title: "\u4EC5\u590D\u5236\u5230\u526A\u8D34\u677F", content: item.content, icon: Icon.CopyClipboard, shortcut: { modifiers: ["ctrl"], key: "c" } }),
            item.type === "link" ? (React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00\u94FE\u63A5", url: item.content, icon: Icon.Globe, shortcut: { modifiers: ["ctrl"], key: "o" } })) : null,
            item.type === "files" && item.filePaths && item.filePaths.length > 0 ? (React.createElement(Action, { title: "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u6253\u5F00\u76EE\u6807", icon: Icon.Folder, shortcut: { modifiers: ["ctrl"], key: "o" }, onAction: async () => {
                    await showToast(Toast.Style.Success, "定位文件", item.filePaths[0]);
                } })) : null,
            colorDetails ? (React.createElement(React.Fragment, null,
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 RGB \u989C\u8272\u503C", content: colorDetails.rgb, icon: Icon.Eye, shortcut: { modifiers: ["ctrl", "shift"], key: "r" } }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 HSL \u989C\u8272\u503C", content: colorDetails.hsl, icon: Icon.Eye, shortcut: { modifiers: ["ctrl", "shift"], key: "s" } }))) : null,
            React.createElement(Action, { title: item.pinned ? "取消置顶" : "置顶条目", icon: Icon.Pin, shortcut: { modifiers: ["ctrl"], key: "p" }, onAction: async () => {
                    await toggleClipboardItemPin(item.id);
                    onPinToggled?.(item.id);
                    showToast(Toast.Style.Success, item.pinned ? "已取消置顶" : "已置顶");
                } }),
            React.createElement(Action, { title: "\u5220\u9664\u8BE5\u8BB0\u5F55", icon: Icon.Trash, shortcut: { modifiers: ["ctrl"], key: "x" }, onAction: async () => {
                    await deleteClipboardItem(item.id);
                    onDeleted?.(item.id);
                    showToast(Toast.Style.Success, "条目已删除");
                    pop();
                } })) }));
}
/**
 * 新建或编辑剪贴板条目表单
 */
export function ClipboardItemForm({ initialItem, onSaved }) {
    const { pop } = useNavigation();
    return (React.createElement(Form, { navigationTitle: initialItem ? "编辑剪贴板内容" : "新建剪贴板内容", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: initialItem ? "保存并写入剪贴板" : "创建并写入剪贴板", icon: Icon.Checkmark, onSubmit: async (values) => {
                    const content = String(values.content || "");
                    if (!content.trim()) {
                        await showToast(Toast.Style.Failure, "内容不能为空");
                        return;
                    }
                    const nextItem = {
                        id: initialItem?.id || `clip-${Date.now()}`,
                        type: detectClipboardContentType(content),
                        content,
                        preview: content.trim().replace(/\s+/g, " ").slice(0, 100),
                        copiedAt: Date.now(),
                        pinned: Boolean(values.pinned ?? initialItem?.pinned),
                        charCount: content.length,
                        lineCount: content.split(/\r?\n/).length,
                        sourceAppName: initialItem?.sourceAppName || "ZTools Editor"
                    };
                    await Clipboard.copy(content);
                    if (isRealElectronHost()) {
                        await writeRealClipboardText(content);
                    }
                    onSaved?.(nextItem);
                    await showToast(Toast.Style.Success, "已保存并同步至系统剪贴板");
                    pop();
                } })) },
        React.createElement(Form.TextArea, { id: "content", title: "\u526A\u8D34\u677F\u6587\u672C\u5185\u5BB9", placeholder: "\u8F93\u5165\u6216\u7F16\u8F91\u8981\u5199\u5165\u526A\u8D34\u677F\u7684\u6587\u672C\u3001\u4EE3\u7801\u3001JSON \u6216\u94FE\u63A5...", defaultValue: initialItem?.content || "" }),
        React.createElement(Form.Checkbox, { id: "pinned", label: "\u7F6E\u9876\u4FDD\u62A4\u8BE5\u6761\u76EE (Pin Item)", defaultValue: Boolean(initialItem?.pinned) })));
}
/**
 * 官方内置核心能力: 剪贴板历史管理器
 * 布局一标杆：左 48% 历史列表 + 右 52% 真实内容本体预览，零彩色 Emoji 污染
 */
export default function ClipboardHistoryCommand() {
    const { push } = useNavigation();
    const [items, setItems] = useState(() => isRealElectronHost() ? [] : SAMPLE_CLIPBOARD_ITEMS);
    const [filterType, setFilterType] = useState("all");
    const [searchText, setSearchText] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [isShowingDetail, setIsShowingDetail] = useState(true);
    const [isLoading, setIsLoading] = useState(() => isRealElectronHost());
    const [preferences, setPreferences] = useState({
        historyDuration: "P1W",
        primaryAction: "paste",
        preferPastingAsPlainText: false,
        updateHistoryAfterAction: true
    });
    useEffect(() => {
        (async () => {
            setIsLoading(true);
            const [data, prefs] = await Promise.all([
                getClipboardHistory(),
                getClipboardPreferences()
            ]);
            setItems(data);
            setPreferences(prefs);
            setIsLoading(false);
        })();
    }, []);
    const filteredItems = filterClipboardItems(items, {
        type: filterType,
        query: searchText
    });
    const pinnedCount = items.filter((item) => item.pinned).length;
    const handleTogglePin = async (id) => {
        await toggleClipboardItemPin(id);
        const updated = items.map(item => item.id === id ? { ...item, pinned: !item.pinned } : item);
        setItems(updated);
        await saveClipboardHistory(updated);
    };
    const handleDelete = async (id) => {
        await deleteClipboardItem(id);
        const updated = items.filter(item => item.id !== id);
        setItems(updated);
        await saveClipboardHistory(updated);
    };
    const handleClearUnpinned = async () => {
        await clearUnpinnedClipboardHistory();
        const updated = items.filter(item => item.pinned);
        setItems(updated);
        await saveClipboardHistory(updated);
        await showToast(Toast.Style.Success, "已清空未置顶历史", `保留了 ${updated.length} 条置顶条目`);
    };
    const handleSyncSystemClipboard = async () => {
        try {
            const res = await syncCurrentSystemClipboard(items);
            setItems(res.items);
            await showToast(Toast.Style.Success, res.added ? "已同步当前系统剪贴板" : "系统剪贴板已是最新记录", res.item?.preview || "当前系统剪贴板为空");
        }
        catch (error) {
            await showToast(Toast.Style.Failure, "同步系统剪贴板失败", error instanceof Error ? error.message : String(error));
        }
    };
    const handleSaveEditedItem = async (saved) => {
        const exists = items.some((i) => i.id === saved.id);
        const next = exists
            ? items.map((i) => (i.id === saved.id ? saved : i))
            : [saved, ...items];
        setItems(next);
        await saveClipboardHistory(next);
    };
    const handlePasteSequential = async () => {
        const res = await pasteSequentialClipboard(filteredItems, {
            addNewLine: true,
            timeoutSeconds: 60
        });
        if (res.success && res.item) {
            await showToast(Toast.Style.Success, `流水粘贴 [第 ${res.offset} 项]`, `剩余 ${res.remaining} 条记录`);
        }
        else {
            await showToast(Toast.Style.Failure, "连续流水粘贴已结束", res.message || "无可用条目");
        }
    };
    const handleResetSequence = async () => {
        await resetPasteSequence();
        await showToast(Toast.Style.Success, "流水粘贴指针已重置", "下一次粘贴将重新从首条开始");
    };
    const getItemIcon = (item) => {
        switch (item.type) {
            case "color": return Icon.Eye;
            case "json": return Icon.Code;
            case "code": return Icon.Terminal;
            case "image": return Icon.Image;
            case "link": return Icon.Globe;
            case "files": return Icon.Folder;
            default: return Icon.Document;
        }
    };
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: isShowingDetail, searchBarPlaceholder: "\u641C\u7D22\u526A\u8D34\u677F\u5386\u53F2 (\u652F\u6301\u62FC\u97F3\u7F29\u5199\u3001\u5185\u5BB9\u3001\u4EE3\u7801\u3001\u8272\u5F69\u3001\u6587\u4EF6\u540D)...", onSearchTextChange: setSearchText, onSelectionChange: (id) => setSelectedId(id || ""), filterBar: {
            summaryText: `本地 SQLite 历史共 ${items.length} 条 · 置顶 ${pinnedCount} 条 · 支持流水粘贴`,
            actions: [
                {
                    id: "clear",
                    label: "清空非置顶",
                    title: "清空非置顶",
                    style: "secondary",
                    onAction: () => {
                        void handleClearUnpinned();
                    }
                },
                {
                    id: "sync",
                    label: "同步剪贴板",
                    title: "同步剪贴板",
                    style: "secondary",
                    onAction: () => {
                        void handleSyncSystemClipboard();
                    }
                }
            ]
        }, actions: React.createElement(ActionPanel, { title: "\u526A\u8D34\u677F\u5168\u5C40\u64CD\u4F5C" },
            React.createElement(Action, { title: "\u8BFB\u53D6\u5E76\u540C\u6B65\u5F53\u524D\u7CFB\u7EDF\u526A\u8D34\u677F", icon: Icon.Repeat, onAction: handleSyncSystemClipboard }),
            React.createElement(Action.Push, { title: "\u65B0\u5EFA\u526A\u8D34\u677F\u8BB0\u5F55...", icon: Icon.Plus, shortcut: { modifiers: ["ctrl"], key: "n" }, target: React.createElement(ClipboardItemForm, { onSaved: handleSaveEditedItem }) })), searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6309\u7C7B\u578B\u7B5B\u9009", value: filterType, onChange: setFilterType },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u683C\u5F0F (All)", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u5DF2\u7F6E\u9876 (Pinned)", value: "pinned", icon: Icon.Pin }),
            React.createElement(List.Dropdown.Item, { title: "\u8272\u5F69\u4EE3\u7801 (Color)", value: "color", icon: Icon.Eye }),
            React.createElement(List.Dropdown.Item, { title: "JSON \u6570\u636E (JSON)", value: "json", icon: Icon.Code }),
            React.createElement(List.Dropdown.Item, { title: "\u4EE3\u7801\u7247\u6BB5 (Code)", value: "code", icon: Icon.Terminal }),
            React.createElement(List.Dropdown.Item, { title: "\u94FE\u63A5\u7F51\u5740 (Links)", value: "link", icon: Icon.Globe }),
            React.createElement(List.Dropdown.Item, { title: "\u6587\u4EF6\u5217\u8868 (Files)", value: "files", icon: Icon.Folder }),
            React.createElement(List.Dropdown.Item, { title: "\u56FE\u7247 (Images)", value: "image", icon: Icon.Image }),
            React.createElement(List.Dropdown.Item, { title: "\u7EAF\u6587\u672C (Text)", value: "text", icon: Icon.Document })) },
        React.createElement(List.Section, { title: `历史记录 (${filteredItems.length} 条)` }, filteredItems.map(item => {
            const colorDetails = item.type === "color" ? parseColorDetails(item.content) : null;
            const sensitivity = maskSensitiveContent(item.content);
            const isItemSensitive = Boolean(item.isSensitive || sensitivity.isSensitive);
            return (React.createElement(List.Item, { key: item.id, id: item.id, title: isItemSensitive ? sensitivity.masked : item.preview, subtitle: formatCopiedTime(item.copiedAt), icon: getItemIcon(item), accessories: [
                    ...(item.pinned ? [{ tag: { value: "置顶" }, tooltip: "已置顶" }] : []),
                    ...(isItemSensitive ? [{ tag: { value: "敏感", color: Color.Red } }] : []),
                    { text: item.type.toUpperCase() }
                ], detail: React.createElement(List.Item.Detail, { markdown: getClipboardMarkdown(item), metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7C7B\u578B", text: item.type.toUpperCase(), icon: Icon.Document }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u590D\u5236\u65F6\u95F4", text: formatCopiedTime(item.copiedAt), icon: Icon.Clock }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7F6E\u9876", text: item.pinned ? "已置顶" : "普通", icon: Icon.Pin }),
                        item.sourceAppName ? (React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6765\u6E90\u5E94\u7528", text: item.sourceAppName, icon: Icon.AppWindow })) : null,
                        colorDetails ? (React.createElement(React.Fragment, null,
                            React.createElement(List.Item.Detail.Metadata.Label, { title: "HEX", text: colorDetails.hex, icon: Icon.Eye }),
                            React.createElement(List.Item.Detail.Metadata.Label, { title: "RGB", text: colorDetails.rgb, icon: Icon.Eye }))) : null,
                        item.charCount !== undefined && (React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5B57\u7B26\u6570", text: `${item.charCount}`, icon: Icon.Pencil })),
                        item.lineCount !== undefined && (React.createElement(List.Item.Detail.Metadata.Label, { title: "\u884C\u6570", text: `${item.lineCount}`, icon: Icon.List })),
                        isItemSensitive ? (React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5B89\u5168\u72B6\u6001", text: "\u5DF2\u8131\u654F\u906E\u7F69", icon: Icon.Lock })) : null,
                        React.createElement(List.Item.Detail.Metadata.Separator, null),
                        React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                            React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: item.pinned ? "PINNED" : "STANDARD", color: Color.SecondaryText }),
                            isItemSensitive ? (React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: "PROTECTED", color: Color.Red })) : null)) }), actions: React.createElement(ActionPanel, { title: "\u526A\u8D34\u677F\u52A8\u4F5C" },
                    React.createElement(Action.Paste, { title: "\u56DE\u8F66\u7C98\u8D34\u5230\u524D\u53F0\u5E94\u7528 (Paste to Active)", content: item.content, icon: Icon.Checkmark }),
                    React.createElement(Action.CopyToClipboard, { title: "\u4EC5\u590D\u5236\u5230\u526A\u8D34\u677F", content: item.content, icon: Icon.CopyClipboard, shortcut: { modifiers: ["ctrl"], key: "c" } }),
                    React.createElement(Action.Push, { title: "\u5168\u5C4F\u67E5\u770B\u8BE6\u60C5", target: React.createElement(ClipboardDetailView, { item: item, onDeleted: handleDelete, onPinToggled: handleTogglePin }), icon: Icon.Eye, shortcut: { modifiers: ["ctrl"], key: "d" } }),
                    React.createElement(Action, { title: "\u8FDE\u7EED\u6D41\u6C34\u7C98\u8D34\u4E0B\u4E00\u4E2A (Paste Sequentially)", icon: Icon.ArrowRight, shortcut: { modifiers: ["ctrl", "shift"], key: "v" }, onAction: handlePasteSequential }),
                    React.createElement(Action, { title: "\u91CD\u7F6E\u6D41\u6C34\u7C98\u8D34\u6307\u9488", icon: Icon.RotateClockwise, shortcut: { modifiers: ["ctrl", "shift"], key: "z" }, onAction: handleResetSequence }),
                    React.createElement(Action, { title: isShowingDetail ? "关闭右侧详情分栏" : "展开右侧详情分栏", icon: Icon.SidebarRight, shortcut: { modifiers: ["ctrl"], key: "b" }, onAction: () => setIsShowingDetail(!isShowingDetail) }),
                    item.type === "files" && item.filePaths && item.filePaths.length > 0 ? (React.createElement(Action, { title: "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D\u6587\u4EF6", icon: Icon.Folder, shortcut: { modifiers: ["ctrl"], key: "o" }, onAction: async () => {
                            if (isRealElectronHost()) {
                                await showRealItemInFolder(item.filePaths[0]);
                            }
                            await showToast(Toast.Style.Success, "定位文件", item.filePaths[0]);
                        } })) : null,
                    item.type === "link" ? (React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00\u7F51\u5740", url: item.content, icon: Icon.Globe, shortcut: { modifiers: ["ctrl"], key: "o" } })) : null,
                    colorDetails ? (React.createElement(React.Fragment, null,
                        React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 RGB \u989C\u8272\u503C", content: colorDetails.rgb, icon: Icon.Eye, shortcut: { modifiers: ["ctrl", "shift"], key: "r" } }),
                        React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 HSL \u989C\u8272\u503C", content: colorDetails.hsl, icon: Icon.Eye, shortcut: { modifiers: ["ctrl", "shift"], key: "s" } }))) : null,
                    React.createElement(Action.Push, { title: "\u7F16\u8F91\u8BE5\u526A\u8D34\u677F\u5185\u5BB9...", icon: Icon.Pencil, shortcut: { modifiers: ["ctrl"], key: "e" }, target: React.createElement(ClipboardItemForm, { initialItem: item, onSaved: handleSaveEditedItem }) }),
                    React.createElement(Action.Push, { title: "\u65B0\u5EFA\u526A\u8D34\u677F\u8BB0\u5F55...", icon: Icon.Plus, shortcut: { modifiers: ["ctrl"], key: "n" }, target: React.createElement(ClipboardItemForm, { onSaved: handleSaveEditedItem }) }),
                    React.createElement(Action, { title: "\u8BFB\u53D6\u5E76\u540C\u6B65\u5F53\u524D\u7CFB\u7EDF\u526A\u8D34\u677F", icon: Icon.Repeat, shortcut: { modifiers: ["ctrl"], key: "r" }, onAction: handleSyncSystemClipboard }),
                    React.createElement(Action, { title: item.pinned ? "取消置顶" : "置顶条目", icon: Icon.Pin, shortcut: { modifiers: ["ctrl"], key: "p" }, onAction: () => handleTogglePin(item.id) }),
                    React.createElement(Action, { title: "\u5220\u9664\u8BE5\u8BB0\u5F55", icon: Icon.Trash, shortcut: { modifiers: ["ctrl"], key: "x" }, onAction: () => handleDelete(item.id) }),
                    React.createElement(Action, { title: "\u6E05\u7A7A\u6240\u6709\u672A\u7F6E\u9876\u8BB0\u5F55", icon: Icon.Trash, shortcut: { modifiers: ["ctrl", "shift"], key: "x" }, onAction: handleClearUnpinned })) }));
        }))));
}
