import React from "@ztools/declarative-ui";
import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  useNavigation
} from "@ztools/declarative-ui";
import { useState, useEffect } from "@ztools/declarative-ui";
import {
  parseColor,
  generateColorSwatchSvg,
  getSavedPalette,
  saveColorToPalette,
  clearPalette,
  removeFromPalette,
  ColorConversionResult,
  SavedColorItem
} from "./converter.js";

export * from "./converter.js";

/**
 * 颜色可视化详情视图 (现代纯正 TSX 模式)
 */
export function ColorDetailView({ color }: { color: ColorConversionResult }) {
  const swatchUrl = generateColorSwatchSvg(color.hex);

  const markdown = `
# 色彩概览与合规检查

![Color Swatch](${swatchUrl})

---

### 色彩格式换算
| 格式 | 值 |
| :--- | :--- |
| **HEX** | \`${color.hex}\` |
| **RGB** | \`${color.cssRgb}\` |
| **HSL** | \`${color.cssHsl}\` |
| **CMYK** | \`${color.cssCmyk}\` |

---

### WCAG 2.1 无障碍对比度测试
- **与白色文字对比度**: \`${color.wcag.contrastOnWhite}:1\` (评级: **${color.wcag.whiteRating}**)
- **与黑色文字对比度**: \`${color.wcag.contrastOnBlack}:1\` (评级: **${color.wcag.blackRating}**)
- **推荐前景色**: 使用 **${color.wcag.recommendedText.toUpperCase()}** 字体可获得最高可读性
  `;

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`颜色详情: ${color.hex}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="HEX" text={color.hex} icon={Icon.Eye} />
          <Detail.Metadata.Label title="RGB" text={color.cssRgb} icon={Icon.Brush} />
          <Detail.Metadata.Label title="HSL" text={color.cssHsl} icon={Icon.Circle} />
          <Detail.Metadata.Label title="CMYK" text={color.cssCmyk} icon={Icon.Document} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title="WCAG 合规性">
            <Detail.Metadata.TagList.Item
              text={`White: ${color.wcag.whiteRating}`}
              color={color.wcag.whiteRating === "AAA" || color.wcag.whiteRating === "AA" ? Color.Green : Color.Red}
            />
            <Detail.Metadata.TagList.Item
              text={`Black: ${color.wcag.blackRating}`}
              color={color.wcag.blackRating === "AAA" || color.wcag.blackRating === "AA" ? Color.Green : Color.Red}
            />
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title="色彩操作">
          <Action.CopyToClipboard title="复制 HEX 色值" content={color.hex} icon={Icon.CopyClipboard} />
          <Action.CopyToClipboard title="复制 RGB 代码" content={color.cssRgb} icon={Icon.Code} />
          <Action.CopyToClipboard title="复制 HSL 代码" content={color.cssHsl} icon={Icon.Code} />
          <Action.CopyToClipboard title="复制 CMYK 代码" content={color.cssCmyk} icon={Icon.Code} />
          <Action
            title="收藏到本地调色板"
            icon={Icon.Star}
            onAction={async () => {
              await saveColorToPalette(`颜色 ${color.hex}`, color.hex);
              await showToast(Toast.Style.Success, "已保存到调色板");
            }}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * 调色板主命令 (现代纯正 TSX 模式)
 */
export default function ColorPickerCommand() {
  const [inputColor, setInputColor] = useState("#0A84FF");
  const [palette, setPalette] = useState<SavedColorItem[]>([]);
  const { push } = useNavigation();

  useEffect(() => {
    getSavedPalette().then((items) => {
      if (items && items.length > 0) {
        setPalette(items);
      } else {
        setPalette([
          { id: "col_1", name: "Apple System Blue", hex: "#0A84FF", savedAt: "预设" },
          { id: "col_2", name: "Emerald Green", hex: "#30D158", savedAt: "预设" },
          { id: "col_3", name: "Sunset Orange", hex: "#FF9F0A", savedAt: "预设" },
          { id: "col_4", name: "Cyber Purple", hex: "#BF5AF2", savedAt: "预设" }
        ]);
      }
    });
  }, []);

  const parsed = parseColor(inputColor);

  const handleSaveToPalette = async () => {
    const updated = await saveColorToPalette(`Color ${parsed.hex}`, parsed.hex);
    setPalette(updated);
    await showToast(Toast.Style.Success, "已持久化收藏到调色板");
  };

  const handleClearPalette = async () => {
    await clearPalette();
    setPalette([]);
    await showToast(Toast.Style.Success, "已清空调色板历史");
  };

  const handleRemoveColor = async (id: string) => {
    const updated = await removeFromPalette(id);
    setPalette(updated);
    await showToast(Toast.Style.Success, "已从调色板移除");
  };

  return (
    <List
      navigationTitle="调色板与色彩转换器"
      searchBarPlaceholder="输入 Hex (#0A84FF)、RGB (rgb(10, 132, 255))、HSL (hsl(210, 100%, 52%))..."
      searchText={inputColor}
      onSearchTextChange={(val) => setInputColor(val)}
      actions={
        <ActionPanel title="全局色彩操作">
          <Action title="收藏当前色彩到调色板" icon={Icon.Star} onAction={handleSaveToPalette} />
          <Action.CopyToClipboard title="复制 HEX 色值" content={parsed.hex} icon={Icon.CopyClipboard} />
          <Action title="清空调色板历史" icon={Icon.Trash} onAction={handleClearPalette} />
        </ActionPanel>
      }
    >
      <List.Section title={`当前颜色换算 [${parsed.hex}]`}>
        <List.Item
          id="fmt_hex"
          title={parsed.hex}
          subtitle="十六进制 HEX 格式"
          icon={Icon.Eye}
          accessories={[{ text: "HEX" }]}
          actions={
            <ActionPanel title={parsed.hex}>
              <Action.Push
                title="查看颜色视觉与对比度详情"
                icon={Icon.Eye}
                target={() => <ColorDetailView color={parsed} />}
              />
              <Action.CopyToClipboard title="复制 HEX" content={parsed.hex} icon={Icon.CopyClipboard} />
              <Action title="收藏到调色板" icon={Icon.Star} onAction={handleSaveToPalette} />
            </ActionPanel>
          }
        />
        <List.Item
          id="fmt_rgb"
          title={parsed.cssRgb}
          subtitle="红绿蓝 RGB 格式"
          icon={Icon.Brush}
          accessories={[{ text: "RGB" }]}
          actions={
            <ActionPanel title={parsed.cssRgb}>
              <Action.CopyToClipboard title="复制 RGB 代码" content={parsed.cssRgb} icon={Icon.CopyClipboard} />
            </ActionPanel>
          }
        />
        <List.Item
          id="fmt_hsl"
          title={parsed.cssHsl}
          subtitle="色相/饱和度/明度 HSL 格式"
          icon={Icon.Circle}
          accessories={[{ text: "HSL" }]}
          actions={
            <ActionPanel title={parsed.cssHsl}>
              <Action.CopyToClipboard title="复制 HSL 代码" content={parsed.cssHsl} icon={Icon.CopyClipboard} />
            </ActionPanel>
          }
        />
        <List.Item
          id="fmt_cmyk"
          title={parsed.cssCmyk}
          subtitle="印刷色彩 CMYK 格式"
          icon={Icon.Document}
          accessories={[{ text: "CMYK" }]}
          actions={
            <ActionPanel title={parsed.cssCmyk}>
              <Action.CopyToClipboard title="复制 CMYK 代码" content={parsed.cssCmyk} icon={Icon.CopyClipboard} />
            </ActionPanel>
          }
        />
        <List.Item
          id="fmt_wcag"
          title={`WCAG: White (${parsed.wcag.whiteRating}) / Black (${parsed.wcag.blackRating})`}
          subtitle={`推荐前景色: ${parsed.wcag.recommendedText.toUpperCase()}`}
          icon={Icon.Checkmark}
          accessories={[{ text: `${parsed.wcag.contrastOnWhite}:1 / ${parsed.wcag.contrastOnBlack}:1` }]}
          actions={
            <ActionPanel title="无障碍对比度">
              <Action.Push
                title="查看色彩合规详情"
                icon={Icon.Eye}
                target={() => <ColorDetailView color={parsed} />}
              />
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title={`已收藏调色板 (${palette.length})`}>
        {palette.map((item) => (
          <List.Item
            key={item.id}
            id={item.id}
            title={item.name}
            subtitle={item.hex}
            icon={Icon.Star}
            accessories={[{ text: item.savedAt }]}
            actions={
              <ActionPanel title={item.name}>
                <Action
                  title="填入当前输入"
                  icon={Icon.Pencil}
                  onAction={() => setInputColor(item.hex)}
                />
                <Action.CopyToClipboard title="复制色值" content={item.hex} icon={Icon.CopyClipboard} />
                <Action.Push
                  title="查看色彩详情"
                  icon={Icon.Eye}
                  target={() => <ColorDetailView color={parseColor(item.hex)} />}
                />
                <Action
                  title="从调色板移除"
                  icon={Icon.Trash}
                  onAction={() => handleRemoveColor(item.id)}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
