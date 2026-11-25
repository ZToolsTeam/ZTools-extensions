import React, {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  useNavigation,
  useLocale,
  useState,
  useEffect
} from "@ztools/declarative-ui";
import { t } from "./i18n.js";
import {
  parseColor,
  convertColor,
  rgbToOklch,
  generateColorSwatchSvg,
  pickScreenColor,
  isScreenRecordingPermissionError,
  getSavedPalette,
  saveColorToPalette,
  clearPalette,
  removeFromPalette,
  getColorHistory,
  saveColorHistory,
  clearColorHistory,
  ColorConversionResult,
  SavedColorItem,
  PickedColorResult
} from "./converter.js";

import { isRealElectronHost } from "./native-ipc.js";

export * from "./converter.js";
export { convertColor };

function getDefaultPaletteItems(): SavedColorItem[] {
  return [
    { id: "col_1", name: "ZTools Accent Blue", hex: "#0A84FF", savedAt: t("tagBrand"), tag: "brand" },
    { id: "col_2", name: "Emerald Success", hex: "#30D158", savedAt: t("tagSemantic"), tag: "semantic" },
    { id: "col_3", name: "Amber Warning", hex: "#FF9F0A", savedAt: t("tagSemantic"), tag: "semantic" },
    { id: "col_4", name: "Crimson Alert", hex: "#FF453A", savedAt: t("tagSemantic"), tag: "semantic" },
    { id: "col_5", name: "Mica Surface Dark", hex: "#1E1E24", savedAt: t("tagNeutral"), tag: "neutral" },
    { id: "col_6", name: "Slate Muted Text", hex: "#94A3B8", savedAt: t("tagNeutral"), tag: "neutral" },
    { id: "col_7", name: "Pure Graphite Border", hex: "#334155", savedAt: t("tagNeutral"), tag: "neutral" },
    { id: "col_8", name: "Indigo Primary", hex: "#5E5CE6", savedAt: t("tagBrand"), tag: "brand" }
  ];
}

export function formatColorByMode(
  parsed: ColorConversionResult,
  format: "hex" | "rgb" | "hsl" | "oklch" | "tailwind",
  includeHash: boolean
): string {
  if (format === "rgb") return parsed.cssRgb;
  if (format === "hsl") return parsed.cssHsl;
  if (format === "oklch") {
    return rgbToOklch(parsed.rgb).css;
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
export function ColorDetailView({ color }: { color: ColorConversionResult }) {
  useLocale();
  const swatchUrl = generateColorSwatchSvg(color.hex);
  const comp = color.harmonies.complementary;

  const markdown = t("detailMarkdown", {
    swatchUrl,
    hex: color.hex,
    hex8: color.hex8,
    rgb: color.cssRgb,
    rgba: color.cssRgba,
    hsl: color.cssHsl,
    hsv: color.cssHsv,
    cmyk: color.cssCmyk,
    cssVar: color.cssVar,
    whiteContrast: color.wcag.contrastOnWhite,
    whiteRating: color.wcag.whiteRating,
    blackContrast: color.wcag.contrastOnBlack,
    blackRating: color.wcag.blackRating,
    recText: color.wcag.recommendedText.toUpperCase(),
    comp,
    ana0: color.harmonies.analogous[0],
    ana1: color.harmonies.analogous[1],
    tri0: color.harmonies.triadic[0],
    tri1: color.harmonies.triadic[1],
    split0: color.harmonies.splitComplementary[0],
    split1: color.harmonies.splitComplementary[1],
    tetradic: color.harmonies.tetradic.join(", "),
    mono: color.harmonies.monochromatic.join(" -> ")
  });

  return (
    <Detail
      markdown={markdown}
      navigationTitle={t("detailNavTitle", { hex: color.hex })}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="HEX" text={color.hex} icon={Icon.Eye} />
          <Detail.Metadata.Label title="RGB" text={color.cssRgb} icon={Icon.Brush} />
          <Detail.Metadata.Label title="HSL" text={color.cssHsl} icon={Icon.Circle} />
          <Detail.Metadata.Label title="HSV" text={color.cssHsv} icon={Icon.Dot} />
          <Detail.Metadata.Label title="CMYK" text={color.cssCmyk} icon={Icon.Document} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title={t("wcagTagListTitle")}>
            <Detail.Metadata.TagList.Item
              text={`White: ${color.wcag.whiteRating}`}
              color={Color.SecondaryText}
            />
            <Detail.Metadata.TagList.Item
              text={`Black: ${color.wcag.blackRating}`}
              color={Color.SecondaryText}
            />
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title={t("colorActionsTitle")}>
          <Action.CopyToClipboard title={t("copyHexValue")} content={color.hex} icon={Icon.CopyClipboard} />
          <Action.CopyToClipboard title={t("copyRgbCode")} content={color.cssRgb} icon={Icon.Code} />
          <Action.CopyToClipboard title={t("copyHslCode")} content={color.cssHsl} icon={Icon.Code} />
          <Action.CopyToClipboard title={t("copyHsvCode")} content={color.cssHsv} icon={Icon.Code} />
          <Action.CopyToClipboard title={t("copyCmykCode")} content={color.cssCmyk} icon={Icon.Code} />
          <Action.CopyToClipboard title={t("copyCssVar")} content={color.cssVar} icon={Icon.Terminal} />
          <Action
            title={t("pasteHexToActive")}
            icon={Icon.Pencil}
            onAction={async () => {
              await Clipboard.paste(color.hex);
              await showToast(Toast.Style.Success, t("pastedHexToast", { hex: color.hex }));
            }}
          />
          <Action
            title={t("saveToLocalPalette")}
            icon={Icon.Star}
            onAction={async () => {
              await saveColorToPalette(t("savedColorName", { hex: color.hex }), color.hex);
              await showToast(Toast.Style.Success, t("savedToPaletteToast"));
            }}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * 调色板与屏幕取色主命令 (布局三：左 34% 参数工作台 + 右 66% 调色板与拾色队列)
 */
export function ColorPickerCommand() {
  useLocale();
  const [inputColor, setInputColor] = useState("#0A84FF");
  const [copyFormat, setCopyFormat] = useState<"hex" | "rgb" | "hsl" | "oklch" | "tailwind">("hex");
  const [wcagStandard, setWcagStandard] = useState<"aa" | "aaa">("aa");
  const [paletteGroup, setPaletteGroup] = useState<"all" | "recent" | "neutral" | "brand">("all");
  const [includeHashPrefix, setIncludeHashPrefix] = useState<boolean>(true);
  const isReal = isRealElectronHost();
  const initialDefaults = isReal ? [] : getDefaultPaletteItems();
  const [palette, setPalette] = useState<SavedColorItem[]>(initialDefaults);
  const [checkedIds, setCheckedIds] = useState<string[]>(initialDefaults.map((i) => i.id));
  const [history, setHistory] = useState<PickedColorResult[]>([]);
  useNavigation();

  useEffect(() => {
    getSavedPalette().then((items) => {
      if (items && items.length > 0) {
        setPalette(items);
        setCheckedIds(items.map((i) => i.id));
      } else {
        const isRealHost = isRealElectronHost();
        const defaults = isRealHost ? [] : getDefaultPaletteItems();
        setPalette(defaults);
        setCheckedIds(defaults.map((i) => i.id));
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
      const picked = await pickScreenColor();
      setInputColor(picked.hex);
      const updatedHist = await saveColorHistory(picked);
      setHistory(updatedHist);
      const outStr = formatColorByMode(parseColor(picked.hex), copyFormat, includeHashPrefix);
      await Clipboard.copy(outStr);
      await showToast(
        Toast.Style.Success,
        t("pickSuccessTitle", { val: outStr }),
        picked.source === "native" ? t("pickNativeDesc") : t("pickSimulatedDesc")
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = String(err instanceof Error ? err.message : err || t("unknownErr"));
      if (isScreenRecordingPermissionError(err)) {
        await showToast(Toast.Style.Failure, t("tccPermTitle"), t("tccPermMsg"));
      } else {
        await showToast(Toast.Style.Failure, t("pickFailedTitle"), msg);
      }
    }
  };

  const handlePasteToActive = async () => {
    await Clipboard.paste(formattedTargetValue);
    await showToast(Toast.Style.Success, t("pastedTargetToast", { val: formattedTargetValue }));
  };

  const handleSaveToPalette = async () => {
    const updated = await saveColorToPalette(`Color ${parsed.hex}`, parsed.hex);
    setPalette(updated);
    setCheckedIds(updated.map((i) => i.id));
    await showToast(Toast.Style.Success, t("savedPersistentToast"));
  };

  const handleClearPalette = async () => {
    await clearPalette();
    setPalette([]);
    setCheckedIds([]);
    await showToast(Toast.Style.Success, t("clearedPaletteToast"));
  };

  const handleClearHistory = async () => {
    await clearColorHistory();
    setHistory([]);
    await showToast(Toast.Style.Success, t("clearedHistoryToast"));
  };

  const handleRemoveColor = async (id: string) => {
    const updated = await removeFromPalette(id);
    setPalette(updated);
    setCheckedIds((prev) => prev.filter((cid) => cid !== id));
    await showToast(Toast.Style.Success, t("removedColorToast"));
  };

  const filteredPalette = palette.filter((item) => {
    const isNeutralTag =
      item.tag === "neutral" || item.savedAt === t("tagNeutral") || item.savedAt === "Neutral";
    const isBrandTag =
      item.tag === "brand" ||
      item.tag === "semantic" ||
      item.savedAt === t("tagBrand") ||
      item.savedAt === t("tagSemantic") ||
      item.savedAt === "Brand" ||
      item.savedAt === "Semantic";
    if (paletteGroup === "neutral") return isNeutralTag || parseColor(item.hex).hsl.s <= 20;
    if (paletteGroup === "brand") return isBrandTag || parseColor(item.hex).hsl.s > 20;
    if (paletteGroup === "recent") return !isNeutralTag;
    return true;
  });

  const historyQueueItems = history.map((item, idx) => {
    const itemParsed = parseColor(item.hex);
    const itemFormatted = formatColorByMode(itemParsed, copyFormat, includeHashPrefix);
    const contrastRatio = Math.max(itemParsed.wcag.contrastOnWhite, itemParsed.wcag.contrastOnBlack);
    const contrastProgress = Math.max(15, Math.min(100, Math.round((contrastRatio / 21) * 100)));
    const histId = `hist_${idx}_${item.hex.replace(/^#/, "")}`;

    return List.Item({
      id: histId,
      title: t("historyItemTitle", { val: itemFormatted }),
      subtitle: t("itemSubtitle", { rgb: itemParsed.cssRgb, hsl: itemParsed.cssHsl, ratio: contrastRatio }),
      icon: {
        source: Icon.Clock
      },
      accessories: [
        {
          progress: {
            value: contrastProgress
          }
        },
        {
          tag: {
            value: t("tagRecentPick")
          }
        },
        { text: itemFormatted }
      ],
      actions: (
        <ActionPanel title={item.hex}>
          <Action
            title={t("actionCopyColorValue")}
            icon={Icon.CopyClipboard}
            onAction={async () => {
              setInputColor(item.hex);
              await Clipboard.copy(itemFormatted);
              await showToast(Toast.Style.Success, t("copiedValueToast", { val: itemFormatted }));
            }}
          />
          <Action
            title={t("actionPasteToActive")}
            icon={Icon.Pencil}
            onAction={async () => {
              await Clipboard.paste(itemFormatted);
              await showToast(Toast.Style.Success, t("pastedValueToast", { val: itemFormatted }));
            }}
          />
          <Action
            title={t("actionBookmarkShort")}
            icon={Icon.Star}
            onAction={async () => {
              const updated = await saveColorToPalette(`Color ${itemParsed.hex}`, itemParsed.hex);
              setPalette(updated);
              setCheckedIds(updated.map((i) => i.id));
              await showToast(Toast.Style.Success, t("savedPersistentToast"));
            }}
          />
          <Action.Push
            title={t("actionViewColorDetail")}
            icon={Icon.Eye}
            target={() => <ColorDetailView color={itemParsed} />}
          />
          <Action
            title={t("actionClearHistory")}
            icon={Icon.Trash}
            onAction={handleClearHistory}
          />
        </ActionPanel>
      )
    });
  });

  const paletteQueueItems = filteredPalette.map((item) => {
    const itemParsed = parseColor(item.hex);
    const itemFormatted = formatColorByMode(itemParsed, copyFormat, includeHashPrefix);
    const isChecked = checkedIds.includes(item.id);
    const contrastRatio = Math.max(itemParsed.wcag.contrastOnWhite, itemParsed.wcag.contrastOnBlack);
    const contrastProgress = Math.max(15, Math.min(100, Math.round((contrastRatio / 21) * 100)));

    return List.Item({
      id: item.id,
      title: `${item.name} (${itemFormatted})`,
      subtitle: t("itemSubtitle", { rgb: itemParsed.cssRgb, hsl: itemParsed.cssHsl, ratio: contrastRatio }),
      checkable: true,
      checked: isChecked,
      onCheckChange: (c) => {
        if (c) {
          setCheckedIds(Array.from(new Set([...checkedIds, item.id])));
        } else {
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
      actions: (
        <ActionPanel title={item.name}>
          <Action
            title={t("actionEyedropOrCopy")}
            icon={Icon.CopyClipboard}
            onAction={async () => {
              setInputColor(item.hex);
              await Clipboard.copy(itemFormatted);
              await showToast(Toast.Style.Success, t("copiedValueToast", { val: itemFormatted }));
            }}
          />
          <Action
            title={t("actionPasteToActive")}
            icon={Icon.Pencil}
            onAction={async () => {
              await Clipboard.paste(itemFormatted);
              await showToast(Toast.Style.Success, t("pastedValueToast", { val: itemFormatted }));
            }}
          />
          <Action
            title={t("actionEyedropperFull")}
            icon={Icon.Brush}
            onAction={handlePickScreenColor}
          />
          <Action.Push
            title={t("actionViewColorDetail")}
            icon={Icon.Eye}
            target={() => <ColorDetailView color={itemParsed} />}
          />
          <Action
            title={t("actionRemovePalette")}
            icon={Icon.Trash}
            onAction={() => handleRemoveColor(item.id)}
          />
        </ActionPanel>
      )
    });
  });

  const rightQueueItems =
    paletteGroup === "recent"
      ? historyQueueItems
      : paletteGroup === "all"
        ? [...historyQueueItems, ...paletteQueueItems]
        : paletteQueueItems;

  return (
    <List
      navigationTitle={t("navTitle")}
      isShowingDetail={false}
      searchBarPlaceholder={t("searchPlaceholder")}
      searchText={inputColor}
      onSearchTextChange={(val) => setInputColor(val)}
      searchBarAccessory={
        <List.Dropdown
          tooltip={t("groupFilterTooltip")}
          value={paletteGroup}
          onChange={(val) => setPaletteGroup(val as "all" | "recent" | "neutral" | "brand")}
        >
          <List.Dropdown.Item title={t("groupAll")} value="all" />
          <List.Dropdown.Item title={t("groupRecent")} value="recent" />
          <List.Dropdown.Item title={t("groupNeutral")} value="neutral" />
          <List.Dropdown.Item title={t("groupBrand")} value="brand" />
        </List.Dropdown>
      }
      filterBar={{
        summaryText: t("summaryText", {
          val: formattedTargetValue,
          rgb: parsed.cssRgb,
          white: parsed.wcag.contrastOnWhite,
          whiteRating: parsed.wcag.whiteRating,
          black: parsed.wcag.contrastOnBlack,
          blackRating: parsed.wcag.blackRating
        }),
        actions: [
          {
            id: "eyedropper",
            label: t("eyedropperBtn"),
            title: t("eyedropperBtn"),
            style: "primary",
            onAction: () => {
              void handlePickScreenColor();
            }
          },
          {
            id: "save-palette",
            label: t("savePaletteBtn"),
            title: t("savePaletteBtn"),
            style: "secondary",
            onAction: () => {
              void handleSaveToPalette();
            }
          }
        ]
      }}
      workbenchPanel={{
        title: t("wbTitle"),
        subtitle: t("wbSubtitle", { std: wcagStandard.toUpperCase() }),
        fields: [
          {
            id: "wb-copy-format",
            label: t("wbCopyFormatLabel"),
            type: "select",
            value: copyFormat,
            onChange: (val) => setCopyFormat(val as "hex" | "rgb" | "hsl" | "oklch" | "tailwind"),
            options: [
              { label: t("optHex"), value: "hex" },
              { label: t("optRgb"), value: "rgb" },
              { label: t("optHsl"), value: "hsl" },
              { label: t("optOklch"), value: "oklch" },
              { label: t("optTailwind"), value: "tailwind" }
            ]
          },
          {
            id: "wb-wcag-std",
            label: t("wbWcagLabel"),
            type: "select",
            value: wcagStandard,
            onChange: (val) => setWcagStandard(val as "aa" | "aaa"),
            options: [
              { label: t("optAa"), value: "aa" },
              { label: t("optAaa"), value: "aaa" }
            ]
          },
          {
            id: "wb-hash-prefix",
            label: t("wbHashLabel"),
            type: "toggle",
            value: includeHashPrefix,
            onChange: (val) => setIncludeHashPrefix(Boolean(val))
          }
        ],
        previewCard: {
          title: t("wbCardTitle"),
          badge: `WCAG ${parsed.wcag.whiteRating}/${parsed.wcag.blackRating}`,
          subtitle: `${parsed.hex} · ${parsed.cssRgb} · ${parsed.cssHsl}`,
          metrics: [
            { label: t("metricHex"), value: formattedTargetValue },
            { label: t("metricRgbHsl"), value: parsed.cssRgb },
            { label: t("metricWhiteContrast"), value: `${parsed.wcag.contrastOnWhite}:1 (${parsed.wcag.whiteRating})` },
            { label: t("metricBlackContrast"), value: `${parsed.wcag.contrastOnBlack}:1 (${parsed.wcag.blackRating})` }
          ]
        }
      }}
      subList={{
        title: t("subListTitle"),
        subtitle: t("subListSubtitle", {
          count: rightQueueItems.length,
          fmt: copyFormat.toUpperCase(),
          val: formattedTargetValue
        }),
        checkable: filteredPalette.length > 0,
        checked:
          filteredPalette.length > 0 && filteredPalette.every((i) => checkedIds.includes(i.id))
            ? true
            : filteredPalette.some((i) => checkedIds.includes(i.id))
            ? "indeterminate"
            : false,
        onCheckChange: (checked) => {
          setCheckedIds(checked ? filteredPalette.map((i) => i.id) : []);
        },
        emptyText: t("subListEmpty"),
        items: rightQueueItems
      }}
      actions={
        <ActionPanel title={t("globalActionsTitle")}>
          <Action title={t("actionBookmarkCurrent")} icon={Icon.Star} onAction={handleSaveToPalette} />
          <Action.CopyToClipboard title={t("copyHexValue")} content={parsed.hex} icon={Icon.CopyClipboard} />
          <Action title={t("actionEyedropper")} icon={Icon.Brush} onAction={handlePickScreenColor} />
          <Action title={t("actionPasteCurrent")} icon={Icon.Pencil} onAction={handlePasteToActive} />
          <Action.CopyToClipboard title={t("copyRgbCode")} content={parsed.cssRgb} icon={Icon.Code} />
          <Action.CopyToClipboard title={t("copyHslCode")} content={parsed.cssHsl} icon={Icon.Code} />
          <Action.CopyToClipboard title={t("copyHsvCode")} content={parsed.cssHsv} icon={Icon.Code} />
          <Action.CopyToClipboard title={t("copyCmykCode")} content={parsed.cssCmyk} icon={Icon.Code} />
          <Action.CopyToClipboard title={t("copyCssVar")} content={parsed.cssVar} icon={Icon.Terminal} />
          <Action title={t("actionClearPalette")} icon={Icon.Trash} onAction={handleClearPalette} />
          <Action title={t("actionClearHistory")} icon={Icon.Trash} onAction={handleClearHistory} />
        </ActionPanel>
      }
    >
      <List.Section title={t("sectionConvertTitle", { hex: parsed.hex })}>
        <List.Item
          id="fmt_hex"
          title={parsed.hex}
          subtitle={t("subHex")}
          icon={Icon.Eye}
          accessories={[{ text: "HEX" }]}
          actions={
            <ActionPanel title={parsed.hex}>
              <Action.Push
                title={t("actionViewVisualDetail")}
                icon={Icon.Eye}
                target={() => <ColorDetailView color={parsed} />}
              />
              <Action.CopyToClipboard title={t("actionCopyHexShort")} content={parsed.hex} icon={Icon.CopyClipboard} />
              <Action title={t("actionPasteActiveShort")} icon={Icon.Pencil} onAction={handlePasteToActive} />
              <Action title={t("eyedropperBtn")} icon={Icon.Brush} onAction={handlePickScreenColor} />
              <Action title={t("actionBookmarkShort")} icon={Icon.Star} onAction={handleSaveToPalette} />
            </ActionPanel>
          }
        />
        <List.Item
          id="fmt_rgb"
          title={parsed.cssRgb}
          subtitle={t("subRgb")}
          icon={Icon.Brush}
          accessories={[{ text: "RGB" }]}
          actions={
            <ActionPanel title={parsed.cssRgb}>
              <Action.CopyToClipboard title={t("copyRgbCode")} content={parsed.cssRgb} icon={Icon.CopyClipboard} />
              <Action title={t("actionPasteActiveShort")} icon={Icon.Pencil} onAction={() => Clipboard.paste(parsed.cssRgb)} />
            </ActionPanel>
          }
        />
        <List.Item
          id="fmt_hsl"
          title={parsed.cssHsl}
          subtitle={t("subHsl")}
          icon={Icon.Circle}
          accessories={[{ text: "HSL" }]}
          actions={
            <ActionPanel title={parsed.cssHsl}>
              <Action.CopyToClipboard title={t("copyHslCode")} content={parsed.cssHsl} icon={Icon.CopyClipboard} />
              <Action title={t("actionPasteActiveShort")} icon={Icon.Pencil} onAction={() => Clipboard.paste(parsed.cssHsl)} />
            </ActionPanel>
          }
        />
        <List.Item
          id="fmt_hsv"
          title={parsed.cssHsv}
          subtitle={t("subHsv")}
          icon={Icon.Dot}
          accessories={[{ text: "HSV" }]}
          actions={
            <ActionPanel title={parsed.cssHsv}>
              <Action.CopyToClipboard title={t("copyHsvCode")} content={parsed.cssHsv} icon={Icon.CopyClipboard} />
            </ActionPanel>
          }
        />
        <List.Item
          id="fmt_cmyk"
          title={parsed.cssCmyk}
          subtitle={t("subCmyk")}
          icon={Icon.Document}
          accessories={[{ text: "CMYK" }]}
          actions={
            <ActionPanel title={parsed.cssCmyk}>
              <Action.CopyToClipboard title={t("copyCmykCode")} content={parsed.cssCmyk} icon={Icon.CopyClipboard} />
            </ActionPanel>
          }
        />
        <List.Item
          id="fmt_css_var"
          title={parsed.cssVar}
          subtitle={t("subCssVar")}
          icon={Icon.Terminal}
          accessories={[{ text: "CSS Var" }]}
          actions={
            <ActionPanel title={parsed.cssVar}>
              <Action.CopyToClipboard title={t("copyCssVar")} content={parsed.cssVar} icon={Icon.CopyClipboard} />
            </ActionPanel>
          }
        />
        <List.Item
          id="fmt_wcag"
          title={`WCAG: White (${parsed.wcag.whiteRating}) / Black (${parsed.wcag.blackRating})`}
          subtitle={t("wcagRecommendedSub", { color: parsed.wcag.recommendedText.toUpperCase() })}
          icon={Icon.Checkmark}
          accessories={[{ text: `${parsed.wcag.contrastOnWhite}:1 / ${parsed.wcag.contrastOnBlack}:1` }]}
          actions={
            <ActionPanel title={t("wcagPanelTitle")}>
              <Action.Push
                title={t("actionViewCompliance")}
                icon={Icon.Eye}
                target={() => <ColorDetailView color={parsed} />}
              />
            </ActionPanel>
          }
        />
      </List.Section>

      {history.length > 0 ? (
        <List.Section title={t("sectionPickHistory", { count: history.length })}>
          {history.map((item, idx) => {
            const itemParsed = parseColor(item.hex);
            const itemFormatted = formatColorByMode(itemParsed, copyFormat, includeHashPrefix);
            return (
              <List.Item
                key={`history_sec_${idx}_${item.hex}`}
                id={`history_sec_${idx}_${item.hex.replace(/^#/, "")}`}
                title={itemFormatted}
                subtitle={`${itemParsed.cssRgb} · ${itemParsed.cssHsl}`}
                icon={Icon.Clock}
                accessories={[{ tag: { value: t("tagRecentPick") } }, { text: item.hex }]}
                actions={
                  <ActionPanel title={item.hex}>
                    <Action.CopyToClipboard
                      title={t("actionCopyColorValue")}
                      content={itemFormatted}
                      icon={Icon.CopyClipboard}
                    />
                    <Action
                      title={t("actionFillInput")}
                      icon={Icon.Pencil}
                      onAction={() => setInputColor(item.hex)}
                    />
                    <Action.Push
                      title={t("actionViewColorDetail")}
                      icon={Icon.Eye}
                      target={() => <ColorDetailView color={itemParsed} />}
                    />
                    <Action
                      title={t("actionClearHistory")}
                      icon={Icon.Trash}
                      onAction={handleClearHistory}
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ) : null}

      <List.Section title={t("sectionSavedPalette", { count: filteredPalette.length })}>
        {filteredPalette.map((item) => (
          <List.Item
            key={item.id}
            id={item.id}
            title={item.name}
            subtitle={item.hex}
            icon={Icon.Star}
            accessories={[
              {
                text:
                  item.tag === "brand"
                    ? t("tagBrand")
                    : item.tag === "semantic"
                      ? t("tagSemantic")
                      : item.tag === "neutral"
                        ? t("tagNeutral")
                        : item.savedAt
              }
            ]}
            actions={
              <ActionPanel title={item.name}>
                <Action
                  title={t("actionFillInput")}
                  icon={Icon.Pencil}
                  onAction={() => setInputColor(item.hex)}
                />
                <Action.CopyToClipboard title={t("actionCopyColorValue")} content={item.hex} icon={Icon.CopyClipboard} />
                <Action.Push
                  title={t("actionViewColorDetail")}
                  icon={Icon.Eye}
                  target={() => <ColorDetailView color={parseColor(item.hex)} />}
                />
                <Action
                  title={t("actionRemovePalette")}
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

export default ColorPickerCommand;
