/**
 * Windows Screenshots (截图捕获参数与截图历史回贴工作台 - 布局三)
 *
 * 严格遵循 ZTools 效率工具箱【布局三：左 34% 参数配置工作台 + 右 66% 任务队列/结果工作台】规范：
 * - 左栏 34% workbenchPanel：配置捕获区域模式、输出图像格式、截图后自动动作、窗口阴影边框、自动哈希去重 + previewCard
 * - 右栏 66% subList：本机扫描到的截图文件可勾选队列（支持一键回贴到活动窗口 Enter、复制图片到剪贴板 Ctrl+Enter、定位、批量清理）
 * - 100% 保留 ScreenshotsCommand, ScreenshotDetailView, ScreenshotsManager, defaultScreenshotsManager 导出
 */
import React from "../../index.js";
import { List, Detail, ActionPanel, Action, Icon, Color, showToast, Toast, Clipboard } from "../../index.js";
import { useState, useMemo, useEffect } from "../../runtime/hooks.js";
import { defaultScreenshotsManager, ScreenshotsManager, generateScreenshotThumbnailSvg, INITIAL_SCREENSHOTS } from "./screenshots-service.js";
import { isRealElectronHost } from "../shared/native-ipc.js";
export * from "./types.js";
export * from "./screenshots-service.js";
export { ScreenshotsManager, defaultScreenshotsManager, generateScreenshotThumbnailSvg, INITIAL_SCREENSHOTS };
function formatTotalBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0)
        return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const idx = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))));
    const val = bytes / Math.pow(1024, idx);
    return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(2)} ${units[idx]}`;
}
/**
 * 独立单项详情查看页 (供导航栈或独立路由调用)
 */
export function ScreenshotDetailView({ item }) {
    const markdown = `![${item.filename}](${item.thumbnailSvg})

---

### 识别提取文字 (OCR Result)

\`\`\`text
${item.ocrText}
\`\`\`

- **存储路径**: \`${item.path}\`
- **分辨率**: **${item.dimensions}** (${item.width} × ${item.height})
- **文件大小**: ${item.formattedSize} (${item.sizeBytes.toLocaleString()} bytes)
- **拍摄时间**: ${item.formattedDate}`;
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `截图详情: ${item.filename}`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u6587\u4EF6\u540D\u79F0", text: item.filename, icon: Icon.Image }),
            React.createElement(Detail.Metadata.Label, { title: "\u5206\u8FA8\u7387", text: item.dimensions, icon: Icon.Monitor }),
            React.createElement(Detail.Metadata.Label, { title: "\u6587\u4EF6\u5927\u5C0F", text: item.formattedSize, icon: Icon.HardDrive }),
            React.createElement(Detail.Metadata.Label, { title: "\u62CD\u6444\u65F6\u95F4", text: item.formattedDate, icon: Icon.Calendar }),
            React.createElement(Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                React.createElement(Detail.Metadata.TagList.Item, { text: item.pinned ? "PINNED (已置顶)" : "NORMAL", color: Color.SecondaryText })),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.Label, { title: "\u5B58\u50A8\u8DEF\u5F84", text: item.path, icon: Icon.Folder })), actions: React.createElement(ActionPanel, { title: `截图: ${item.filename}` },
            React.createElement(Action, { title: "\u7C98\u8D34\u5230\u6D3B\u52A8\u7A97\u53E3 (Paste to Active Window)", icon: Icon.Window, onAction: async () => {
                    const res = await defaultScreenshotsManager.pasteToActiveWindow(item);
                    await showToast(Toast.Style.Success, res.message);
                } }),
            React.createElement(Action, { title: "\u590D\u5236\u56FE\u7247\u672C\u8EAB (Copy Image to Clipboard)", icon: Icon.Clipboard, onAction: async () => {
                    const res = await defaultScreenshotsManager.copyImageToClipboard(item);
                    await showToast(Toast.Style.Success, res.message);
                } }),
            React.createElement(Action, { title: "\u590D\u5236\u56FE\u7247\u672C\u5730\u8DEF\u5F84 (Copy Image Path)", icon: Icon.Document, onAction: async () => {
                    await Clipboard.copy(item.path);
                    await showToast(Toast.Style.Success, `已复制路径: ${item.path}`);
                } }),
            React.createElement(Action, { title: "\u590D\u5236\u63D0\u53D6\u7684\u6587\u5B57 (Copy OCR Text)", icon: Icon.Text, onAction: async () => {
                    const res = await defaultScreenshotsManager.copyOcrText(item);
                    await Clipboard.copy(res.ocrText || "");
                    await showToast(Toast.Style.Success, res.message);
                } })) }));
}
export function ScreenshotsCommand() {
    const isRealHost = isRealElectronHost();
    const initialList = isRealHost ? [] : [...INITIAL_SCREENSHOTS];
    const [items, setItems] = useState(() => initialList);
    const [checkedIds, setCheckedIds] = useState(() => initialList.map((s) => s.id));
    const [searchText, setSearchText] = useState("");
    const [category, setCategory] = useState("all");
    const [captureRegionMode, setCaptureRegionMode] = useState("region");
    const [imageFormat, setImageFormat] = useState("png");
    const [postCaptureAction, setPostCaptureAction] = useState("paste_clipboard");
    const [includeWindowShadow, setIncludeWindowShadow] = useState(true);
    const [autoHashDedupe, setAutoHashDedupe] = useState(true);
    const [refreshCount] = useState(0);
    const [selectedId, setSelectedId] = useState(null);
    useEffect(() => {
        let active = true;
        defaultScreenshotsManager.loadScreenshots().then((list) => {
            if (active) {
                const nextList = list.length > 0 ? list : isRealElectronHost() ? [] : [...INITIAL_SCREENSHOTS];
                setItems(nextList);
                setCheckedIds(nextList.map((s) => s.id));
            }
        });
        return () => {
            active = false;
        };
    }, [refreshCount]);
    const reloadScreenshots = (force = false) => {
        defaultScreenshotsManager.loadScreenshots(force).then((list) => {
            const nextList = list.length > 0 ? list : isRealElectronHost() ? [] : [...INITIAL_SCREENSHOTS];
            setItems(nextList);
            setCheckedIds(nextList.map((s) => s.id));
        });
    };
    const handleCaptureScreenNow = async () => {
        const res = await defaultScreenshotsManager.captureScreenNow({
            captureRegionMode,
            imageFormat,
            postCaptureAction,
            includeWindowShadow,
            autoHashDedupe
        });
        reloadScreenshots(true);
        await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
    };
    const filtered = useMemo(() => {
        return defaultScreenshotsManager.filterScreenshots(items, searchText, category);
    }, [items, searchText, category]);
    useMemo(() => {
        return filtered.find((s) => s.id === selectedId) || filtered[0];
    }, [filtered, selectedId]);
    const handlePasteToActive = async (item) => {
        try {
            const res = await defaultScreenshotsManager.pasteToActiveWindow(item);
            await showToast(Toast.Style.Success, res.message);
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "粘贴失败", err.message || String(err));
        }
    };
    const handlePasteLatest = async () => {
        try {
            const res = await defaultScreenshotsManager.pasteLatestScreenshot();
            if (res.success) {
                await showToast(Toast.Style.Success, res.message);
            }
            else {
                await showToast(Toast.Style.Failure, "未找到截图", res.message);
            }
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "回贴最新截图失败", err.message || String(err));
        }
    };
    const handleCopyImage = async (item) => {
        try {
            const res = await defaultScreenshotsManager.copyImageToClipboard(item);
            await showToast(Toast.Style.Success, res.message);
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "复制图片失败", err.message || String(err));
        }
    };
    const handleCopyPath = async (item) => {
        await Clipboard.copy(item.path);
        await showToast(Toast.Style.Success, `已复制路径: ${item.path}`);
    };
    const handleCopyOcr = async (item) => {
        try {
            const text = await defaultScreenshotsManager.extractOcr(item);
            await Clipboard.copy(text);
            await showToast(Toast.Style.Success, `已复制 OCR 文字 (${text.length} 字符)`);
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "提取 OCR 文字失败", err.message || String(err));
        }
    };
    const handleShowInExplorer = async (item) => {
        try {
            const res = await defaultScreenshotsManager.showInExplorer(item);
            await showToast(Toast.Style.Success, res.message);
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "定位失败", err.message || String(err));
        }
    };
    const handleOpenWithDefault = async (item) => {
        try {
            const res = await defaultScreenshotsManager.openWithDefaultApp(item);
            await showToast(Toast.Style.Success, res.message);
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "打开失败", err.message || String(err));
        }
    };
    const handleDelete = async (item) => {
        try {
            const res = await defaultScreenshotsManager.deleteScreenshot(item);
            setItems((prev) => prev.filter((s) => s.id !== item.id));
            setCheckedIds((prev) => prev.filter((id) => id !== item.id));
            await showToast(Toast.Style.Success, res.message);
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "删除截图失败", err.message || String(err));
        }
    };
    const handleBatchDeleteChecked = async () => {
        const targets = items.filter((s) => checkedIds.includes(s.id) && !s.pinned);
        if (targets.length === 0) {
            await showToast(Toast.Style.Failure, "没有可清理的非置顶已勾选截图");
            return;
        }
        for (const item of targets) {
            await defaultScreenshotsManager.deleteScreenshot(item);
        }
        const targetIds = new Set(targets.map((t) => t.id));
        setItems((prev) => prev.filter((s) => !targetIds.has(s.id)));
        setCheckedIds((prev) => prev.filter((id) => !targetIds.has(id)));
        await showToast(Toast.Style.Success, `已批量清理 ${targets.length} 张旧截图`);
    };
    const handleTogglePin = async (item) => {
        try {
            const res = await defaultScreenshotsManager.togglePinScreenshot(item);
            reloadScreenshots();
            await showToast(Toast.Style.Success, res.message);
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "置顶操作失败", err.message || String(err));
        }
    };
    const renderActionPanel = (item) => (React.createElement(ActionPanel, { title: `截图: ${item.filename}` },
        React.createElement(Action, { title: "\u7C98\u8D34\u5230\u6D3B\u52A8\u7A97\u53E3 (Paste Image to Active Window)", icon: Icon.Window, shortcut: { modifiers: ["cmd"], key: "enter" }, onAction: () => handlePasteToActive(item) }),
        React.createElement(Action, { title: "\u590D\u5236\u56FE\u7247\u672C\u8EAB (Copy Image to Clipboard)", icon: Icon.Clipboard, shortcut: { modifiers: ["cmd"], key: "c" }, onAction: () => handleCopyImage(item) }),
        React.createElement(Action, { title: "\u590D\u5236\u56FE\u7247\u672C\u5730\u8DEF\u5F84 (Copy Image Path)", icon: Icon.Document, shortcut: { modifiers: ["cmd", "shift"], key: "c" }, onAction: () => handleCopyPath(item) }),
        React.createElement(Action, { title: "\u590D\u5236\u63D0\u53D6\u7684\u6587\u5B57 (Copy Recognized Text)", icon: Icon.Text, shortcut: { modifiers: ["cmd", "alt"], key: "c" }, onAction: () => handleCopyOcr(item) }),
        React.createElement(Action, { title: "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D (Show in Explorer)", icon: Icon.Folder, shortcut: { modifiers: ["cmd"], key: "o" }, onAction: () => handleShowInExplorer(item) }),
        React.createElement(Action, { title: "\u7528\u9ED8\u8BA4\u56FE\u7247\u67E5\u770B\u5668\u6253\u5F00 (Open with Default App)", icon: Icon.ArrowRight, shortcut: { modifiers: ["cmd", "shift"], key: "o" }, onAction: () => handleOpenWithDefault(item) }),
        React.createElement(Action, { title: "\u7ACB\u5373\u622A\u53D6\u5F53\u524D\u5C4F\u5E55 (Capture Screen Now)", icon: Icon.Camera, shortcut: { modifiers: ["ctrl", "shift"], key: "s" }, onAction: handleCaptureScreenNow }),
        React.createElement(Action, { title: item.pinned ? "取消置顶 (Unpin Screenshot)" : "置顶此截图 (Pin Screenshot)", icon: Icon.Pin, shortcut: { modifiers: ["cmd"], key: "p" }, onAction: () => handleTogglePin(item) }),
        React.createElement(Action, { title: "\u56DE\u8D34\u6700\u65B0\u4E00\u5F20\u622A\u56FE (Paste Latest)", icon: Icon.Clock, shortcut: { modifiers: ["cmd", "shift"], key: "v" }, onAction: handlePasteLatest }),
        React.createElement(Action, { title: `批量清理非置顶已勾选截图 (${checkedIds.length}项)`, icon: Icon.Trash, onAction: handleBatchDeleteChecked }),
        React.createElement(Action, { title: "\u5220\u9664\u6B64\u622A\u56FE (Delete Screenshot)", icon: Icon.Trash, shortcut: { modifiers: ["ctrl"], key: "x" }, onAction: () => handleDelete(item) })));
    const pinnedCount = items.filter((s) => s.pinned).length;
    const totalBytes = items.reduce((sum, s) => sum + s.sizeBytes, 0);
    const latestDimensions = items[0]?.dimensions || "2560 x 1440";
    const maxShotBytes = Math.max(1, ...filtered.map((s) => s.sizeBytes));
    const rightQueueItems = filtered.map((item) => {
        const isChecked = checkedIds.includes(item.id);
        const sizeRatio = Math.max(10, Math.min(100, Math.round((item.sizeBytes / maxShotBytes) * 100)));
        return List.Item({
            id: item.id,
            title: item.filename,
            subtitle: `${item.dimensions} · ${item.formattedDate} · ${item.ocrText ? item.ocrText.slice(0, 42).replace(/\s+/g, " ") : item.path}`,
            checkable: true,
            checked: isChecked,
            onCheckChange: (c) => {
                if (c) {
                    setCheckedIds(Array.from(new Set([...checkedIds, item.id])));
                }
                else {
                    setCheckedIds(checkedIds.filter((id) => id !== item.id));
                }
            },
            icon: {
                source: Icon.Image
            },
            accessories: [
                {
                    progress: {
                        value: sizeRatio
                    }
                },
                {
                    tag: {
                        value: item.pinned ? `置顶 · ${item.dimensions}` : item.dimensions
                    }
                },
                { text: item.formattedSize }
            ],
            actions: renderActionPanel(item)
        });
    });
    return (React.createElement(List, { isShowingDetail: false, searchBarPlaceholder: "\u641C\u7D22\u7CFB\u7EDF\u622A\u56FE\u6587\u4EF6\u540D\u3001OCR \u63D0\u53D6\u6587\u5B57\u6216\u5206\u8FA8\u7387 (\u5982 2560x1440, error)...", onSearchTextChange: setSearchText, onSelectionChange: setSelectedId, filterBar: {
            summaryText: `截图队列共 ${filtered.length} 张 (${formatTotalBytes(totalBytes)}) · 已置顶 ${pinnedCount} 张${filtered[0] ? ` · 最新: ${filtered[0].filename}` : ""}`,
            actions: [
                {
                    id: "paste-latest",
                    label: "粘贴最新截图",
                    title: "粘贴最新截图",
                    style: "primary",
                    onAction: () => {
                        void handlePasteLatest();
                    }
                },
                {
                    id: "rescan",
                    label: "重新扫描队列",
                    title: "重新扫描队列",
                    style: "secondary",
                    onAction: () => {
                        reloadScreenshots(true);
                    }
                }
            ]
        }, workbenchPanel: {
            title: "截图捕获与回贴工作台",
            subtitle: postCaptureAction === "paste_clipboard" ? "截屏即回贴活动窗口" : "本地截图与 OCR 管线",
            fields: [
                {
                    id: "wb-capture-region",
                    label: "捕获区域模式",
                    type: "select",
                    value: captureRegionMode,
                    onChange: (val) => setCaptureRegionMode(val),
                    options: [
                        { label: "框选区域截图 (Region)", value: "region" },
                        { label: "当前活动窗口 (Active Window)", value: "window" },
                        { label: "全屏多显示器 (Full Screen)", value: "fullscreen" },
                        { label: "延时 3 秒截屏 (3s Delay)", value: "delay3s" }
                    ]
                },
                {
                    id: "wb-image-format",
                    label: "输出图像格式",
                    type: "select",
                    value: imageFormat,
                    onChange: (val) => setImageFormat(val),
                    options: [
                        { label: "PNG 无损 (透明通道)", value: "png" },
                        { label: "WebP 高压 (体积省 65%)", value: "webp" },
                        { label: "JPEG 标准兼容", value: "jpeg" }
                    ]
                },
                {
                    id: "wb-post-action",
                    label: "截图后自动动作",
                    type: "select",
                    value: postCaptureAction,
                    onChange: (val) => setPostCaptureAction(val),
                    options: [
                        { label: "立即写入剪贴板并回贴", value: "paste_clipboard" },
                        { label: "仅保存至本机截图库", value: "save_only" },
                        { label: "自动提取图中文字 OCR", value: "auto_ocr" }
                    ]
                },
                {
                    id: "wb-window-shadow",
                    label: "携带窗口阴影边框",
                    type: "toggle",
                    value: includeWindowShadow,
                    onChange: (val) => setIncludeWindowShadow(Boolean(val))
                },
                {
                    id: "wb-hash-dedupe",
                    label: "自动哈希去重",
                    type: "toggle",
                    value: autoHashDedupe,
                    onChange: (val) => setAutoHashDedupe(Boolean(val))
                },
                {
                    id: "wb-save-dir",
                    label: "截图保存目录",
                    type: "info",
                    value: `Pictures\\Screenshots (*.${imageFormat})`
                }
            ],
            previewCard: {
                title: "截图库存储与状态总览",
                badge: `${imageFormat.toUpperCase()} 无损`,
                subtitle: `捕获模式: ${captureRegionMode} · 已选 ${checkedIds.length}/${items.length} 张`,
                metrics: [
                    { label: "本机截图总数", value: `${items.length} 张` },
                    { label: "收藏置顶数", value: `${pinnedCount} 张` },
                    { label: "总占用空间", value: formatTotalBytes(totalBytes) },
                    { label: "最新截图尺寸", value: latestDimensions }
                ]
            }
        }, subList: {
            title: "本机截图历史与回贴队列 (按拍摄时间排序，按 ↵ 立即回贴到活动窗口)",
            subtitle: `${filtered.length} 张截图 · 已选 ${checkedIds.length} 项 · 总计 ${formatTotalBytes(totalBytes)}`,
            checkable: filtered.length > 0,
            checked: filtered.length > 0 && filtered.every((s) => checkedIds.includes(s.id))
                ? true
                : filtered.some((s) => checkedIds.includes(s.id))
                    ? "indeterminate"
                    : false,
            onCheckChange: (checked) => {
                setCheckedIds(checked ? filtered.map((s) => s.id) : []);
            },
            emptyText: "当前分类下暂无匹配的截图记录",
            items: rightQueueItems
        }, actions: React.createElement(ActionPanel, { title: "\u5C4F\u5E55\u622A\u56FE\u5168\u5C40\u64CD\u4F5C" },
            React.createElement(Action, { title: "\u7ACB\u5373\u622A\u53D6\u5F53\u524D\u5C4F\u5E55 (Capture Screen Now)", icon: Icon.Camera, onAction: handleCaptureScreenNow }),
            React.createElement(Action, { title: "\u91CD\u65B0\u626B\u63CF\u622A\u56FE\u76EE\u5F55 (Refresh Screenshots)", icon: Icon.Repeat, onAction: () => reloadScreenshots(true) })), searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6309\u5206\u7C7B\u7B5B\u9009\u622A\u56FE", value: category, onChange: (val) => setCategory(val) },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u622A\u56FE (All Screenshots)", value: "all" }),
            React.createElement(List.Dropdown.Item, { title: "\u5DF2\u7F6E\u9876\u622A\u56FE (Pinned)", value: "pinned" }),
            React.createElement(List.Dropdown.Item, { title: "1\u5C0F\u65F6\u5185\u62CD\u6444 (Recent)", value: "recent" }),
            React.createElement(List.Dropdown.Item, { title: "\u5305\u542B\u63D0\u53D6\u6587\u5B57 (With OCR Text)", value: "ocr" })) },
        React.createElement(List.Section, { title: `系统截图库 (${filtered.length})` }, filtered.map((item) => (React.createElement(List.Item, { key: item.id, id: item.id, title: item.filename, subtitle: item.dimensions, accessories: [
                ...(item.pinned ? [{ text: "PINNED" }] : []),
                { text: item.formattedSize },
                { text: item.formattedDate }
            ], detail: isRealHost ? undefined : (React.createElement(List.Item.Detail, { markdown: `![${item.filename}](${item.thumbnailSvg})\n\n---\n\n### OCR 文字提取识别 (Text Recognition)\n\n\`\`\`text\n${item.ocrText}\n\`\`\``, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6587\u4EF6\u540D\u79F0", text: item.filename, icon: Icon.Image }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5206\u8FA8\u7387", text: item.dimensions, icon: Icon.Monitor }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6587\u4EF6\u5927\u5C0F", text: item.formattedSize, icon: Icon.HardDrive }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u62CD\u6444\u65F6\u95F4", text: item.formattedDate, icon: Icon.Calendar }),
                    React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                        React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: item.pinned ? "PINNED (已置顶)" : "NORMAL", color: Color.SecondaryText })),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5B58\u50A8\u8DEF\u5F84", text: item.path, icon: Icon.Folder })) })), actions: renderActionPanel(item) }))))));
}
export default ScreenshotsCommand;
