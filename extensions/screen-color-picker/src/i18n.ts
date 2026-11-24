import { createTranslator } from "@ztools/declarative-ui";

const MESSAGES = {
  "zh-CN": {
    tagBrand: "品牌色",
    tagSemantic: "语义色",
    tagNeutral: "中性灰阶",
    detailMarkdown: `
# 色彩全景与合规检查

![Color Swatch]({swatchUrl})

---

### 色彩格式换算
| 格式 | 值 | 说明 |
| :--- | :--- | :--- |
| **HEX** | \`{hex}\` | 6 位十六进制色值 |
| **HEX8** | \`{hex8}\` | 带 Alpha 通道的 8 位色值 |
| **RGB** | \`{rgb}\` | 红绿蓝标准色彩 |
| **RGBA** | \`{rgba}\` | 带透明度色彩 |
| **HSL** | \`{hsl}\` | 色相/饱和度/明度 |
| **HSV** | \`{hsv}\` | 色相/饱和度/明度 (色度学) |
| **CMYK** | \`{cmyk}\` | 四色印刷色彩 |
| **CSS 变量** | \`{cssVar}\` | Web 变量定义 |

---

### WCAG 2.1 无障碍对比度测试
- **与白色文字对比度**: \`{whiteContrast}:1\` (评级: **{whiteRating}**)
- **与黑色文字对比度**: \`{blackContrast}:1\` (评级: **{blackRating}**)
- **推荐前景色**: 使用 **{recText}** 字体可获得最高可读性

---

### 衍生专业配色方案
- **互补色**: \`{comp}\`
- **类似色**: \`{ana0}\`, \`{ana1}\`
- **三色平衡**: \`{tri0}\`, \`{tri1}\`
- **分裂互补**: \`{split0}\`, \`{split1}\`
- **四色矩阵**: \`{tetradic}\`
- **单色渐变**: \`{mono}\`
  `,
    detailNavTitle: "颜色详情: {hex}",
    wcagTagListTitle: "WCAG 对比度评级",
    colorActionsTitle: "色彩操作",
    copyHexValue: "复制 HEX 色值",
    copyRgbCode: "复制 RGB 代码",
    copyHslCode: "复制 HSL 代码",
    copyHsvCode: "复制 HSV 代码",
    copyCmykCode: "复制 CMYK 代码",
    copyCssVar: "复制 CSS 变量",
    pasteHexToActive: "直接粘贴 HEX 到前台应用",
    pastedHexToast: "已将 {hex} 粘贴到活动应用",
    saveToLocalPalette: "收藏到本地调色板",
    savedColorName: "颜色 {hex}",
    savedToPaletteToast: "已保存到调色板",
    pickSuccessTitle: "取色成功: {val}",
    pickNativeDesc: "已通过原生屏幕拾色器拾取",
    pickSimulatedDesc: "高精度放大镜模拟取色",
    unknownErr: "未知异常",
    tccPermTitle: "需要 macOS 屏幕录制权限 (TCC)",
    tccPermMsg: "请前往「系统设置 -> 隐私与安全性 -> 录屏与系统录音」授予 ZTools 权限",
    pickFailedTitle: "屏幕拾色失败",
    pastedTargetToast: "已将 {val} 回贴到当前前台应用",
    savedPersistentToast: "已持久化收藏到调色板",
    clearedPaletteToast: "已清空调色板历史",
    clearedHistoryToast: "已清空拾色历史",
    removedColorToast: "已从调色板移除",
    itemSubtitle: "{rgb} · {hsl} · 对比度 {ratio}:1",
    actionEyedropOrCopy: "启动屏幕吸管取色 / 复制当前色值",
    copiedValueToast: "已复制色值: {val}",
    actionPasteToActive: "粘贴色值到当前活动窗口",
    pastedValueToast: "已粘贴色值: {val}",
    actionEyedropperFull: "启动屏幕吸管拾色器 (Screen Eyedropper)",
    actionViewColorDetail: "查看色彩详情",
    actionRemovePalette: "从调色板移除",
    navTitle: "调色板与色彩转换器",
    searchPlaceholder: "输入 Hex (#0A84FF)、RGB (rgb(10, 132, 255))、HSL (hsl(210, 100%, 52%)) 或拾色...",
    groupFilterTooltip: "按色彩分组过滤调色板",
    groupAll: "色彩分组: 全部色彩",
    groupRecent: "色彩分组: 近期屏幕拾取",
    groupNeutral: "色彩分组: 极客中性灰阶",
    groupBrand: "色彩分组: 品牌语义色",
    summaryText: "当前色值 {val} ({rgb}) · WCAG 对比度: 白字 {white}:1 ({whiteRating}) / 黑字 {black}:1 ({blackRating})",
    eyedropperBtn: "屏幕吸色 (Eyedropper)",
    savePaletteBtn: "收藏当前颜色",
    wbTitle: "屏幕拾色与色彩换算工作台",
    wbSubtitle: "点击屏幕选点，Esc 取消 · WCAG {std} 校验",
    wbCopyFormatLabel: "默认复制色彩格式",
    optHex: "HEX (#RRGGBB)",
    optRgb: "RGB (rgb())",
    optHsl: "HSL (hsl())",
    optOklch: "CSS OKLCH (广色域)",
    optTailwind: "Tailwind 类名 (bg-[#...])",
    wbWcagLabel: "WCAG 无障碍对比度基准",
    optAa: "AA 标准 (4.5:1 常规正文)",
    optAaa: "AAA 严苛 (7.0:1 增强对比)",
    wbHashLabel: "复制时附带 # 前缀",
    wbCardTitle: "当前聚焦色值与无障碍评级",
    metricHex: "当前 HEX",
    metricRgbHsl: "RGB / HSL",
    metricWhiteContrast: "白字对比度",
    metricBlackContrast: "黑字对比度",
    subListTitle: "调色板与屏幕拾色历史队列 (按 ↵ 复制当前色值或启动屏幕吸管取色)",
    subListSubtitle: "{count} 项色板记录 · 当前输出格式: {fmt} ({val})",
    subListEmpty: "当前分组下暂无调色板色值",
    globalActionsTitle: "全局色彩操作",
    actionBookmarkCurrent: "收藏当前色彩到调色板",
    actionEyedropper: "屏幕吸色 (Screen Eyedropper)",
    actionPasteCurrent: "粘贴当前色到前台应用",
    actionClearPalette: "清空调色板历史",
    actionClearHistory: "清空拾色历史",
    sectionConvertTitle: "当前颜色换算 [{hex}]",
    subHex: "十六进制 HEX 格式",
    actionViewVisualDetail: "查看颜色视觉与对比度详情",
    actionCopyHexShort: "复制 HEX",
    actionPasteActiveShort: "粘贴到前台活动应用",
    actionBookmarkShort: "收藏到调色板",
    subRgb: "红绿蓝 RGB 格式",
    subHsl: "色相/饱和度/明度 HSL 格式",
    subHsv: "色度学明度 HSV 格式",
    subCmyk: "印刷色彩 CMYK 格式",
    subCssVar: "CSS 变量定义",
    wcagRecommendedSub: "推荐前景色: {color}",
    wcagPanelTitle: "无障碍对比度",
    actionViewCompliance: "查看色彩合规详情",
    sectionSavedPalette: "已收藏调色板 ({count})",
    sectionPickHistory: "最近拾色历史 ({count})",
    tagRecentPick: "近期拾色",
    historyItemTitle: "拾色 {val}",
    actionFillInput: "填入当前输入",
    actionCopyColorValue: "复制色值",
    // converter.ts
    errScreenRecordingPerm: "SCREEN_RECORDING_PERMISSION_DENIED: 缺少 macOS 屏幕录制权限 (TCC Screen Recording)，请前往「系统设置 -> 隐私与安全性 -> 录屏与系统录音」授予 ZTools 权限",
    errColorPickerFailed: "COLOR_PICKER_FAILED: 未能从屏幕获取真实像素颜色"
  },
  "en-US": {
    tagBrand: "Brand",
    tagSemantic: "Semantic",
    tagNeutral: "Neutral",
    detailMarkdown: `
# Color Overview & Compliance

![Color Swatch]({swatchUrl})

---

### Color Format Conversions
| Format | Value | Notes |
| :--- | :--- | :--- |
| **HEX** | \`{hex}\` | 6-digit hex |
| **HEX8** | \`{hex8}\` | 8-digit hex with alpha |
| **RGB** | \`{rgb}\` | Standard RGB |
| **RGBA** | \`{rgba}\` | RGB with alpha |
| **HSL** | \`{hsl}\` | Hue / Saturation / Lightness |
| **HSV** | \`{hsv}\` | Hue / Saturation / Value |
| **CMYK** | \`{cmyk}\` | Print CMYK |
| **CSS Var** | \`{cssVar}\` | CSS custom property |

---

### WCAG 2.1 Contrast Check
- **On White**: \`{whiteContrast}:1\` (Rating: **{whiteRating}**)
- **On Black**: \`{blackContrast}:1\` (Rating: **{blackRating}**)
- **Recommended Text**: Use **{recText}** text for best readability

---

### Color Harmonies
- **Complementary**: \`{comp}\`
- **Analogous**: \`{ana0}\`, \`{ana1}\`
- **Triadic**: \`{tri0}\`, \`{tri1}\`
- **Split Complementary**: \`{split0}\`, \`{split1}\`
- **Tetradic**: \`{tetradic}\`
- **Monochromatic**: \`{mono}\`
  `,
    detailNavTitle: "Color Details: {hex}",
    wcagTagListTitle: "WCAG Contrast Rating",
    colorActionsTitle: "Color Actions",
    copyHexValue: "Copy HEX",
    copyRgbCode: "Copy RGB",
    copyHslCode: "Copy HSL",
    copyHsvCode: "Copy HSV",
    copyCmykCode: "Copy CMYK",
    copyCssVar: "Copy CSS Variable",
    pasteHexToActive: "Paste HEX to Active App",
    pastedHexToast: "Pasted {hex} to active app",
    saveToLocalPalette: "Save to Palette",
    savedColorName: "Color {hex}",
    savedToPaletteToast: "Saved to palette",
    pickSuccessTitle: "Picked: {val}",
    pickNativeDesc: "Picked via native screen eyedropper",
    pickSimulatedDesc: "Simulated high-precision magnifier",
    unknownErr: "Unknown error",
    tccPermTitle: "macOS Screen Recording Permission Required",
    tccPermMsg: "Grant ZTools permission in System Settings -> Privacy & Security -> Screen & System Audio Recording",
    pickFailedTitle: "Screen color pick failed",
    pastedTargetToast: "Pasted {val} to active app",
    savedPersistentToast: "Saved to palette",
    clearedPaletteToast: "Palette cleared",
    clearedHistoryToast: "Pick history cleared",
    removedColorToast: "Removed from palette",
    itemSubtitle: "{rgb} · {hsl} · Contrast {ratio}:1",
    actionEyedropOrCopy: "Pick / Copy Color Value",
    copiedValueToast: "Copied: {val}",
    actionPasteToActive: "Paste to Active Window",
    pastedValueToast: "Pasted: {val}",
    actionEyedropperFull: "Pick Screen Color (Eyedropper)",
    actionViewColorDetail: "View Color Details",
    actionRemovePalette: "Remove from Palette",
    navTitle: "Color Picker & Converter",
    searchPlaceholder: "Enter Hex (#0A84FF), RGB, HSL, or pick from screen...",
    groupFilterTooltip: "Filter Palette",
    groupAll: "Group: All Colors",
    groupRecent: "Group: Recent Picks",
    groupNeutral: "Group: Neutral Grays",
    groupBrand: "Group: Brand & Semantic",
    summaryText: "Current {val} ({rgb}) · WCAG: White {white}:1 ({whiteRating}) / Black {black}:1 ({blackRating})",
    eyedropperBtn: "Eyedropper",
    savePaletteBtn: "Save Color",
    wbTitle: "Color Picker & Converter",
    wbSubtitle: "Click screen to pick, Esc to cancel · WCAG {std}",
    wbCopyFormatLabel: "Default Copy Format",
    optHex: "HEX (#RRGGBB)",
    optRgb: "RGB (rgb())",
    optHsl: "HSL (hsl())",
    optOklch: "CSS OKLCH (Wide Gamut)",
    optTailwind: "Tailwind Class (bg-[#...])",
    wbWcagLabel: "WCAG Contrast Standard",
    optAa: "AA Standard (4.5:1 normal text)",
    optAaa: "AAA Strict (7.0:1 enhanced)",
    wbHashLabel: "Include # Prefix on Copy",
    wbCardTitle: "Focused Color & Accessibility",
    metricHex: "HEX",
    metricRgbHsl: "RGB / HSL",
    metricWhiteContrast: "On White",
    metricBlackContrast: "On Black",
    subListTitle: "Palette & History (↵ to copy or pick)",
    subListSubtitle: "{count} item(s) · Format: {fmt} ({val})",
    subListEmpty: "No colors in this group",
    globalActionsTitle: "Global Color Actions",
    actionBookmarkCurrent: "Save Current Color",
    actionEyedropper: "Screen Eyedropper",
    actionPasteCurrent: "Paste to Active App",
    actionClearPalette: "Clear Palette",
    actionClearHistory: "Clear History",
    sectionConvertTitle: "Color Conversions [{hex}]",
    subHex: "Hexadecimal HEX format",
    actionViewVisualDetail: "View Visual & Contrast Details",
    actionCopyHexShort: "Copy HEX",
    actionPasteActiveShort: "Paste to Active App",
    actionBookmarkShort: "Save to Palette",
    subRgb: "Red Green Blue RGB format",
    subHsl: "Hue / Saturation / Lightness HSL",
    subHsv: "Hue / Saturation / Value HSV",
    subCmyk: "Print CMYK format",
    subCssVar: "CSS custom property",
    wcagRecommendedSub: "Recommended text: {color}",
    wcagPanelTitle: "Accessibility Contrast",
    actionViewCompliance: "View Compliance Details",
    sectionSavedPalette: "Saved Palette ({count})",
    sectionPickHistory: "Recent Pick History ({count})",
    tagRecentPick: "Recent Pick",
    historyItemTitle: "Picked {val}",
    actionFillInput: "Use as Input",
    actionCopyColorValue: "Copy Color",
    // converter.ts
    errScreenRecordingPerm: "SCREEN_RECORDING_PERMISSION_DENIED: macOS Screen Recording permission (TCC) is required. Grant permission in System Settings -> Privacy & Security -> Screen & System Audio Recording.",
    errColorPickerFailed: "COLOR_PICKER_FAILED: Failed to read pixel color from screen"
  }
};

export const t = createTranslator(MESSAGES, { defaultLocale: "en-US" });
