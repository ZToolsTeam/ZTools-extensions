import React from "../../index.js";
import { List, Detail, ActionPanel, Action, Icon, Color, showToast, Toast, Clipboard, useNavigation } from "../../index.js";
import { useState, useEffect } from "../../runtime/hooks.js";
import { parseColor, convertColor, generateColorSwatchSvg, pickScreenColor, getSavedPalette, saveColorToPalette, clearPalette, removeFromPalette, getColorHistory, saveColorHistory, clearColorHistory } from "./converter.js";
export * from "./converter.js";
export { convertColor };
const DEFAULT_PALETTE_ITEMS = [
    { id: "col_1", name: "ZTools Accent Blue", hex: "#0A84FF", savedAt: "品牌色" },
    { id: "col_2", name: "Emerald Success", hex: "#30D158", savedAt: "语义色" },
    { id: "col_3", name: "Amber Warning", hex: "#FF9F0A", savedAt: "语义色" },
    { id: "col_4", name: "Crimson Alert", hex: "#FF453A", savedAt: "语义色" },
    { id: "col_5", name: "Mica Surface Dark", hex: "#1E1E24", savedAt: "中性灰阶" },
    { id: "col_6", name: "Slate Muted Text", hex: "#94A3B8", savedAt: "中性灰阶" },
    { id: "col_7", name: "Pure Graphite Border", hex: "#334155", savedAt: "中性灰阶" },
    { id: "col_8", name: "Indigo Primary", hex: "#5E5CE6", savedAt: "品牌色" }
];
function formatColorByMode(parsed, format, includeHash) {
    if (format === "rgb")
        return parsed.cssRgb;
    if (format === "hsl")
        return parsed.cssHsl;
    if (format === "oklch") {
        const l = (parsed.hsl.l / 100).toFixed(2);
        const c = ((parsed.hsl.s / 100) * 0.24).toFixed(3);
        return `oklch(${l} ${c} ${parsed.hsl.h})`;
    }
    if (format === "tailwind") {
        const rawHex = includeHash ? parsed.hex : parsed.hex.replace(/^#/, "");
        return `bg-[${rawHex}]`;
    }
    return includeHash ? parsed.hex : parsed.hex.replace(/^#/, "");
}
/**
 * 颜色可视化与全能合规详情视图
 */
export function ColorDetailView({ color }) {
    const swatchUrl = generateColorSwatchSvg(color.hex);
    const comp = color.harmonies.complementary;
    const markdown = `
# 色彩全景与合规检查

![Color Swatch](${swatchUrl})

---

### 色彩格式换算
| 格式 | 值 | 说明 |
| :--- | :--- | :--- |
| **HEX** | \`${color.hex}\` | 6 位十六进制色值 |
| **HEX8** | \`${color.hex8}\` | 带 Alpha 通道的 8 位色值 |
| **RGB** | \`${color.cssRgb}\` | 红绿蓝标准色彩 |
| **RGBA** | \`${color.cssRgba}\` | 带透明度色彩 |
| **HSL** | \`${color.cssHsl}\` | 色相/饱和度/明度 |
| **HSV** | \`${color.cssHsv}\` | 色相/饱和度/明度 (色度学) |
| **CMYK** | \`${color.cssCmyk}\` | 四色印刷色彩 |
| **CSS 变量** | \`${color.cssVar}\` | Web 变量定义 |

---

### WCAG 2.1 无障碍对比度测试
- **与白色文字对比度**: \`${color.wcag.contrastOnWhite}:1\` (评级: **${color.wcag.whiteRating}**)
- **与黑色文字对比度**: \`${color.wcag.contrastOnBlack}:1\` (评级: **${color.wcag.blackRating}**)
- **推荐前景色**: 使用 **${color.wcag.recommendedText.toUpperCase()}** 字体可获得最高可读性

---

### 衍生专业配色方案
- **互补色**: \`${comp}\`
- **类似色**: \`${color.harmonies.analogous[0]}\`, \`${color.harmonies.analogous[1]}\`
- **三色平衡**: \`${color.harmonies.triadic[0]}\`, \`${color.harmonies.triadic[1]}\`
- **分裂互补**: \`${color.harmonies.splitComplementary[0]}\`, \`${color.harmonies.splitComplementary[1]}\`
- **四色矩阵**: \`${color.harmonies.tetradic.join(", ")}\`
- **单色渐变**: \`${color.harmonies.monochromatic.join(" -> ")}\`
  `;
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `颜色详情: ${color.hex}`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "HEX", text: color.hex, icon: Icon.Eye }),
            React.createElement(Detail.Metadata.Label, { title: "RGB", text: color.cssRgb, icon: Icon.Brush }),
            React.createElement(Detail.Metadata.Label, { title: "HSL", text: color.cssHsl, icon: Icon.Circle }),
            React.createElement(Detail.Metadata.Label, { title: "HSV", text: color.cssHsv, icon: Icon.Dot }),
            React.createElement(Detail.Metadata.Label, { title: "CMYK", text: color.cssCmyk, icon: Icon.Document }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.TagList, { title: "WCAG \u5BF9\u6BD4\u5EA6\u8BC4\u7EA7" },
                React.createElement(Detail.Metadata.TagList.Item, { text: `White: ${color.wcag.whiteRating}`, color: Color.SecondaryText }),
                React.createElement(Detail.Metadata.TagList.Item, { text: `Black: ${color.wcag.blackRating}`, color: Color.SecondaryText }))), actions: React.createElement(ActionPanel, { title: "\u8272\u5F69\u64CD\u4F5C" },
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 HEX \u8272\u503C", content: color.hex, icon: Icon.CopyClipboard }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 RGB \u4EE3\u7801", content: color.cssRgb, icon: Icon.Code }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 HSL \u4EE3\u7801", content: color.cssHsl, icon: Icon.Code }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 HSV \u4EE3\u7801", content: color.cssHsv, icon: Icon.Code }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 CMYK \u4EE3\u7801", content: color.cssCmyk, icon: Icon.Code }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 CSS \u53D8\u91CF", content: color.cssVar, icon: Icon.Terminal }),
            React.createElement(Action, { title: "\u76F4\u63A5\u7C98\u8D34 HEX \u5230\u524D\u53F0\u5E94\u7528", icon: Icon.Pencil, onAction: async () => {
                    await Clipboard.paste(color.hex);
                    await showToast(Toast.Style.Success, `已将 ${color.hex} 粘贴到活动应用`);
                } }),
            React.createElement(Action, { title: "\u6536\u85CF\u5230\u672C\u5730\u8C03\u8272\u677F", icon: Icon.Star, onAction: async () => {
                    await saveColorToPalette(`颜色 ${color.hex}`, color.hex);
                    await showToast(Toast.Style.Success, "已保存到调色板");
                } })) }));
}
/**
 * 调色板与屏幕取色主命令 (布局三：左 34% 参数工作台 + 右 66% 调色板与拾色队列)
 */
export function ColorPickerCommand() {
    const [inputColor, setInputColor] = useState("#0A84FF");
    const [copyFormat, setCopyFormat] = useState("hex");
    const [wcagStandard, setWcagStandard] = useState("aa");
    const [magnifierZoom, setMagnifierZoom] = useState("8x");
    const [paletteGroup, setPaletteGroup] = useState("all");
    const [includeHashPrefix, setIncludeHashPrefix] = useState(true);
    const [palette, setPalette] = useState(DEFAULT_PALETTE_ITEMS);
    const [checkedIds, setCheckedIds] = useState(DEFAULT_PALETTE_ITEMS.map((i) => i.id));
    const [, setHistory] = useState([]);
    useNavigation();
    useEffect(() => {
        getSavedPalette().then((items) => {
            if (items && items.length > 0) {
                setPalette(items);
                setCheckedIds(items.map((i) => i.id));
            }
            else {
                setPalette(DEFAULT_PALETTE_ITEMS);
                setCheckedIds(DEFAULT_PALETTE_ITEMS.map((i) => i.id));
            }
        });
        getColorHistory().then((hist) => {
            if (hist && hist.length > 0) {
                setHistory(hist);
            }
        });
    }, []);
    const parsed = parseColor(inputColor);
    const formattedTargetValue = formatColorByMode(parsed, copyFormat, includeHashPrefix);
    const handlePickScreenColor = async () => {
        try {
            await showToast(Toast.Style.Animated, "正在启动屏幕拾色器...");
            const picked = await pickScreenColor();
            setInputColor(picked.hex);
            const updatedHist = await saveColorHistory(picked);
            setHistory(updatedHist);
            const outStr = formatColorByMode(parseColor(picked.hex), copyFormat, includeHashPrefix);
            await Clipboard.copy(outStr);
            await showToast(Toast.Style.Success, `取色成功: ${outStr}`, picked.source === "native" ? "已通过原生屏幕拾色器拾取" : "高精度放大镜模拟取色");
        }
        catch (err) {
            const msg = String(err?.message || "未知异常");
            if (msg.includes("SCREEN_RECORDING") || msg.includes("TCC") || msg.includes("屏幕录制")) {
                await showToast(Toast.Style.Failure, "需要 macOS 屏幕录制权限 (TCC)", "请前往「系统设置 -> 隐私与安全性 -> 录屏与系统录音」授予 ZTools 权限");
            }
            else {
                await showToast(Toast.Style.Failure, "屏幕拾色失败", msg);
            }
        }
    };
    const handlePasteToActive = async () => {
        await Clipboard.paste(formattedTargetValue);
        await showToast(Toast.Style.Success, `已将 ${formattedTargetValue} 回贴到当前前台应用`);
    };
    const handleSaveToPalette = async () => {
        const updated = await saveColorToPalette(`Color ${parsed.hex}`, parsed.hex);
        setPalette(updated);
        setCheckedIds(updated.map((i) => i.id));
        await showToast(Toast.Style.Success, "已持久化收藏到调色板");
    };
    const handleClearPalette = async () => {
        await clearPalette();
        setPalette([]);
        setCheckedIds([]);
        await showToast(Toast.Style.Success, "已清空调色板历史");
    };
    const handleClearHistory = async () => {
        await clearColorHistory();
        setHistory([]);
        await showToast(Toast.Style.Success, "已清空拾色历史");
    };
    const handleRemoveColor = async (id) => {
        const updated = await removeFromPalette(id);
        setPalette(updated);
        setCheckedIds((prev) => prev.filter((cid) => cid !== id));
        await showToast(Toast.Style.Success, "已从调色板移除");
    };
    const filteredPalette = palette.filter((item) => {
        if (paletteGroup === "neutral")
            return item.savedAt.includes("灰") || parseColor(item.hex).hsl.s <= 20;
        if (paletteGroup === "brand")
            return item.savedAt.includes("品牌") || item.savedAt.includes("语义") || parseColor(item.hex).hsl.s > 20;
        if (paletteGroup === "recent")
            return item.savedAt !== "中性灰阶";
        return true;
    });
    const rightQueueItems = filteredPalette.map((item) => {
        const itemParsed = parseColor(item.hex);
        const itemFormatted = formatColorByMode(itemParsed, copyFormat, includeHashPrefix);
        const isChecked = checkedIds.includes(item.id);
        const contrastRatio = Math.max(itemParsed.wcag.contrastOnWhite, itemParsed.wcag.contrastOnBlack);
        const contrastProgress = Math.max(15, Math.min(100, Math.round((contrastRatio / 21) * 100)));
        return List.Item({
            id: item.id,
            title: `${item.name} (${itemFormatted})`,
            subtitle: `${itemParsed.cssRgb} · ${itemParsed.cssHsl} · 对比度 ${contrastRatio}:1`,
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
                source: Icon.Brush
            },
            accessories: [
                {
                    progress: {
                        value: contrastProgress
                    }
                },
                {
                    tag: {
                        value: `WCAG ${itemParsed.wcag.whiteRating}/${itemParsed.wcag.blackRating}`
                    }
                },
                { text: itemFormatted }
            ],
            actions: (React.createElement(ActionPanel, { title: item.name },
                React.createElement(Action, { title: "\u542F\u52A8\u5C4F\u5E55\u5438\u7BA1\u53D6\u8272 / \u590D\u5236\u5F53\u524D\u8272\u503C", icon: Icon.CopyClipboard, onAction: async () => {
                        setInputColor(item.hex);
                        await Clipboard.copy(itemFormatted);
                        await showToast(Toast.Style.Success, `已复制色值: ${itemFormatted}`);
                    } }),
                React.createElement(Action, { title: "\u7C98\u8D34\u8272\u503C\u5230\u5F53\u524D\u6D3B\u52A8\u7A97\u53E3", icon: Icon.Pencil, onAction: async () => {
                        await Clipboard.paste(itemFormatted);
                        await showToast(Toast.Style.Success, `已粘贴色值: ${itemFormatted}`);
                    } }),
                React.createElement(Action, { title: "\u542F\u52A8\u5C4F\u5E55\u5438\u7BA1\u62FE\u8272\u5668 (Screen Eyedropper)", icon: Icon.Brush, onAction: handlePickScreenColor }),
                React.createElement(Action.Push, { title: "\u67E5\u770B\u8272\u5F69\u8BE6\u60C5", icon: Icon.Eye, target: () => React.createElement(ColorDetailView, { color: itemParsed }) }),
                React.createElement(Action, { title: "\u4ECE\u8C03\u8272\u677F\u79FB\u9664", icon: Icon.Trash, onAction: () => handleRemoveColor(item.id) })))
        });
    });
    return (React.createElement(List, { navigationTitle: "\u8C03\u8272\u677F\u4E0E\u8272\u5F69\u8F6C\u6362\u5668", isShowingDetail: false, searchBarPlaceholder: "\u8F93\u5165 Hex (#0A84FF)\u3001RGB (rgb(10, 132, 255))\u3001HSL (hsl(210, 100%, 52%)) \u6216\u62FE\u8272...", searchText: inputColor, onSearchTextChange: (val) => setInputColor(val), searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6309\u8272\u5F69\u5206\u7EC4\u8FC7\u6EE4\u8C03\u8272\u677F", value: paletteGroup, onChange: (val) => setPaletteGroup(val) },
            React.createElement(List.Dropdown.Item, { title: "\u8272\u5F69\u5206\u7EC4: \u5168\u90E8\u8272\u5F69", value: "all" }),
            React.createElement(List.Dropdown.Item, { title: "\u8272\u5F69\u5206\u7EC4: \u8FD1\u671F\u5C4F\u5E55\u62FE\u53D6", value: "recent" }),
            React.createElement(List.Dropdown.Item, { title: "\u8272\u5F69\u5206\u7EC4: \u6781\u5BA2\u4E2D\u6027\u7070\u9636", value: "neutral" }),
            React.createElement(List.Dropdown.Item, { title: "\u8272\u5F69\u5206\u7EC4: \u54C1\u724C\u8BED\u4E49\u8272", value: "brand" })), filterBar: {
            summaryText: `当前色值 ${formattedTargetValue} (${parsed.cssRgb}) · WCAG 对比度: 白字 ${parsed.wcag.contrastOnWhite}:1 (${parsed.wcag.whiteRating}) / 黑字 ${parsed.wcag.contrastOnBlack}:1 (${parsed.wcag.blackRating})`,
            actions: [
                {
                    id: "eyedropper",
                    label: "屏幕吸色 (Eyedropper)",
                    title: "屏幕吸色 (Eyedropper)",
                    style: "primary",
                    onAction: () => {
                        void handlePickScreenColor();
                    }
                },
                {
                    id: "save-palette",
                    label: "收藏当前颜色",
                    title: "收藏当前颜色",
                    style: "secondary",
                    onAction: () => {
                        void handleSaveToPalette();
                    }
                }
            ]
        }, workbenchPanel: {
            title: "屏幕拾色与色彩换算工作台",
            subtitle: `放大镜 ${magnifierZoom} · WCAG ${wcagStandard.toUpperCase()} 校验`,
            fields: [
                {
                    id: "wb-copy-format",
                    label: "默认复制色彩格式",
                    type: "select",
                    value: copyFormat,
                    onChange: (val) => setCopyFormat(val),
                    options: [
                        { label: "HEX (#RRGGBB)", value: "hex" },
                        { label: "RGB (rgb())", value: "rgb" },
                        { label: "HSL (hsl())", value: "hsl" },
                        { label: "CSS OKLCH (广色域)", value: "oklch" },
                        { label: "Tailwind 类名 (bg-[#...])", value: "tailwind" }
                    ]
                },
                {
                    id: "wb-wcag-std",
                    label: "WCAG 无障碍对比度基准",
                    type: "select",
                    value: wcagStandard,
                    onChange: (val) => setWcagStandard(val),
                    options: [
                        { label: "AA 标准 (4.5:1 常规正文)", value: "aa" },
                        { label: "AAA 严苛 (7.0:1 增强对比)", value: "aaa" }
                    ]
                },
                {
                    id: "wb-zoom",
                    label: "屏幕取色放大镜倍率",
                    type: "select",
                    value: magnifierZoom,
                    onChange: (val) => setMagnifierZoom(val),
                    options: [
                        { label: "8x 像素级标准网格", value: "8x" },
                        { label: "16x 极限亚像素网格", value: "16x" }
                    ]
                },
                {
                    id: "wb-hash-prefix",
                    label: "复制时附带 # 前缀",
                    type: "toggle",
                    value: includeHashPrefix,
                    onChange: (val) => setIncludeHashPrefix(Boolean(val))
                }
            ],
            previewCard: {
                title: "当前聚焦色值与无障碍评级",
                badge: `WCAG ${parsed.wcag.whiteRating}/${parsed.wcag.blackRating}`,
                subtitle: `${parsed.hex} · ${parsed.cssRgb} · ${parsed.cssHsl}`,
                metrics: [
                    { label: "当前 HEX", value: formattedTargetValue },
                    { label: "RGB / HSL", value: parsed.cssRgb },
                    { label: "白字对比度", value: `${parsed.wcag.contrastOnWhite}:1 (${parsed.wcag.whiteRating})` },
                    { label: "黑字对比度", value: `${parsed.wcag.contrastOnBlack}:1 (${parsed.wcag.blackRating})` }
                ]
            }
        }, subList: {
            title: "调色板与屏幕拾色历史队列 (按 ↵ 复制当前色值或启动屏幕吸管取色)",
            subtitle: `${filteredPalette.length} 项色板记录 · 当前输出格式: ${copyFormat.toUpperCase()} (${formattedTargetValue})`,
            checkable: filteredPalette.length > 0,
            checked: filteredPalette.length > 0 && filteredPalette.every((i) => checkedIds.includes(i.id))
                ? true
                : filteredPalette.some((i) => checkedIds.includes(i.id))
                    ? "indeterminate"
                    : false,
            onCheckChange: (checked) => {
                setCheckedIds(checked ? filteredPalette.map((i) => i.id) : []);
            },
            emptyText: "当前分组下暂无调色板色值",
            items: rightQueueItems
        }, actions: React.createElement(ActionPanel, { title: "\u5168\u5C40\u8272\u5F69\u64CD\u4F5C" },
            React.createElement(Action, { title: "\u6536\u85CF\u5F53\u524D\u8272\u5F69\u5230\u8C03\u8272\u677F", icon: Icon.Star, onAction: handleSaveToPalette }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 HEX \u8272\u503C", content: parsed.hex, icon: Icon.CopyClipboard }),
            React.createElement(Action, { title: "\u5C4F\u5E55\u5438\u8272 (Screen Eyedropper)", icon: Icon.Brush, onAction: handlePickScreenColor }),
            React.createElement(Action, { title: "\u7C98\u8D34\u5F53\u524D\u8272\u5230\u524D\u53F0\u5E94\u7528", icon: Icon.Pencil, onAction: handlePasteToActive }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 RGB \u4EE3\u7801", content: parsed.cssRgb, icon: Icon.Code }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 HSL \u4EE3\u7801", content: parsed.cssHsl, icon: Icon.Code }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 HSV \u4EE3\u7801", content: parsed.cssHsv, icon: Icon.Code }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 CMYK \u4EE3\u7801", content: parsed.cssCmyk, icon: Icon.Code }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 CSS \u53D8\u91CF", content: parsed.cssVar, icon: Icon.Terminal }),
            React.createElement(Action, { title: "\u6E05\u7A7A\u8C03\u8272\u677F\u5386\u53F2", icon: Icon.Trash, onAction: handleClearPalette }),
            React.createElement(Action, { title: "\u6E05\u7A7A\u62FE\u8272\u5386\u53F2", icon: Icon.Trash, onAction: handleClearHistory })) },
        React.createElement(List.Section, { title: `当前颜色换算 [${parsed.hex}]` },
            React.createElement(List.Item, { id: "fmt_hex", title: parsed.hex, subtitle: "\u5341\u516D\u8FDB\u5236 HEX \u683C\u5F0F", icon: Icon.Eye, accessories: [{ text: "HEX" }], actions: React.createElement(ActionPanel, { title: parsed.hex },
                    React.createElement(Action.Push, { title: "\u67E5\u770B\u989C\u8272\u89C6\u89C9\u4E0E\u5BF9\u6BD4\u5EA6\u8BE6\u60C5", icon: Icon.Eye, target: () => React.createElement(ColorDetailView, { color: parsed }) }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 HEX", content: parsed.hex, icon: Icon.CopyClipboard }),
                    React.createElement(Action, { title: "\u7C98\u8D34\u5230\u524D\u53F0\u6D3B\u52A8\u5E94\u7528", icon: Icon.Pencil, onAction: handlePasteToActive }),
                    React.createElement(Action, { title: "\u5C4F\u5E55\u5438\u8272 (Eyedropper)", icon: Icon.Brush, onAction: handlePickScreenColor }),
                    React.createElement(Action, { title: "\u6536\u85CF\u5230\u8C03\u8272\u677F", icon: Icon.Star, onAction: handleSaveToPalette })) }),
            React.createElement(List.Item, { id: "fmt_rgb", title: parsed.cssRgb, subtitle: "\u7EA2\u7EFF\u84DD RGB \u683C\u5F0F", icon: Icon.Brush, accessories: [{ text: "RGB" }], actions: React.createElement(ActionPanel, { title: parsed.cssRgb },
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 RGB \u4EE3\u7801", content: parsed.cssRgb, icon: Icon.CopyClipboard }),
                    React.createElement(Action, { title: "\u7C98\u8D34\u5230\u524D\u53F0\u6D3B\u52A8\u5E94\u7528", icon: Icon.Pencil, onAction: () => Clipboard.paste(parsed.cssRgb) })) }),
            React.createElement(List.Item, { id: "fmt_hsl", title: parsed.cssHsl, subtitle: "\u8272\u76F8/\u9971\u548C\u5EA6/\u660E\u5EA6 HSL \u683C\u5F0F", icon: Icon.Circle, accessories: [{ text: "HSL" }], actions: React.createElement(ActionPanel, { title: parsed.cssHsl },
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 HSL \u4EE3\u7801", content: parsed.cssHsl, icon: Icon.CopyClipboard }),
                    React.createElement(Action, { title: "\u7C98\u8D34\u5230\u524D\u53F0\u6D3B\u52A8\u5E94\u7528", icon: Icon.Pencil, onAction: () => Clipboard.paste(parsed.cssHsl) })) }),
            React.createElement(List.Item, { id: "fmt_hsv", title: parsed.cssHsv, subtitle: "\u8272\u5EA6\u5B66\u660E\u5EA6 HSV \u683C\u5F0F", icon: Icon.Dot, accessories: [{ text: "HSV" }], actions: React.createElement(ActionPanel, { title: parsed.cssHsv },
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 HSV \u4EE3\u7801", content: parsed.cssHsv, icon: Icon.CopyClipboard })) }),
            React.createElement(List.Item, { id: "fmt_cmyk", title: parsed.cssCmyk, subtitle: "\u5370\u5237\u8272\u5F69 CMYK \u683C\u5F0F", icon: Icon.Document, accessories: [{ text: "CMYK" }], actions: React.createElement(ActionPanel, { title: parsed.cssCmyk },
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 CMYK \u4EE3\u7801", content: parsed.cssCmyk, icon: Icon.CopyClipboard })) }),
            React.createElement(List.Item, { id: "fmt_css_var", title: parsed.cssVar, subtitle: "CSS \u53D8\u91CF\u5B9A\u4E49", icon: Icon.Terminal, accessories: [{ text: "CSS Var" }], actions: React.createElement(ActionPanel, { title: parsed.cssVar },
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 CSS \u53D8\u91CF", content: parsed.cssVar, icon: Icon.CopyClipboard })) }),
            React.createElement(List.Item, { id: "fmt_wcag", title: `WCAG: White (${parsed.wcag.whiteRating}) / Black (${parsed.wcag.blackRating})`, subtitle: `推荐前景色: ${parsed.wcag.recommendedText.toUpperCase()}`, icon: Icon.Checkmark, accessories: [{ text: `${parsed.wcag.contrastOnWhite}:1 / ${parsed.wcag.contrastOnBlack}:1` }], actions: React.createElement(ActionPanel, { title: "\u65E0\u969C\u788D\u5BF9\u6BD4\u5EA6" }, React.createElement(Action.Push, { title: "\u67E5\u770B\u8272\u5F69\u5408\u89C4\u8BE6\u60C5", icon: Icon.Eye, target: () => React.createElement(ColorDetailView, { color: parsed }) })) })),
        React.createElement(List.Section, { title: `已收藏调色板 (${filteredPalette.length})` }, filteredPalette.map((item) => (React.createElement(List.Item, { key: item.id, id: item.id, title: item.name, subtitle: item.hex, icon: Icon.Star, accessories: [{ text: item.savedAt }], actions: React.createElement(ActionPanel, { title: item.name },
                React.createElement(Action, { title: "\u586B\u5165\u5F53\u524D\u8F93\u5165", icon: Icon.Pencil, onAction: () => setInputColor(item.hex) }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8272\u503C", content: item.hex, icon: Icon.CopyClipboard }),
                React.createElement(Action.Push, { title: "\u67E5\u770B\u8272\u5F69\u8BE6\u60C5", icon: Icon.Eye, target: () => React.createElement(ColorDetailView, { color: parseColor(item.hex) }) }),
                React.createElement(Action, { title: "\u4ECE\u8C03\u8272\u677F\u79FB\u9664", icon: Icon.Trash, onAction: () => handleRemoveColor(item.id) })) }))))));
}
export default ColorPickerCommand;
