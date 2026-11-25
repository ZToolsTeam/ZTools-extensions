import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  Clipboard,
  useLocale,
  useState,
  useMemo,
  useNavigation
} from "@ztools/declarative-ui";
import { t } from "./i18n.js";
import {
  toUpperCase,
  toLowerCase,
  toTitleCase,
  toSentenceCase,
  toCamelCase,
  toSnakeCase,
  toKebabCase,
  toHalfWidth,
  toFullWidth,
  toChinesePunctuation,
  toEnglishPunctuation,
  normalizeCjkSpacing,
  formatChineseSmart,
  formatMarkdown,
  trimLines,
  removeEmptyLines,
  collapseInlineSpaces,
  dedupeLines,
  sortLines,
  reverseLines,
  addLineNumbers,
  removeLineNumbers,
  convertToSimplified,
  convertToTraditional,
  getTextStats
} from "./logic.js";

/** 快捷键文案按平台区分：macOS 只写 ⌘，Windows 写 Ctrl */
export function modEnterLabel(): string {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return /Mac/i.test(nav?.platform || nav?.userAgent || "") ? "⌘Enter" : "Ctrl+Enter";
}

interface FormatItemDef {
  id: string;
  category: "case" | "punctuation" | "typesetting" | "lines" | "chinese";
  label: string;
  /** 英文名等额外搜索词，不显示在标题里 */
  keywords?: string;
  icon: string;
  transform: (text: string) => string;
}

function getFormatItems(): FormatItemDef[] {
  return [
    // 智能与排版
    {
      id: "zh-smart",
      category: "typesetting",
      label: t("itemZhSmart"),
      icon: Icon.Star,
      transform: (text) => formatChineseSmart(text)
    },
    {
      id: "cjk-spacing",
      category: "typesetting",
      label: t("itemCjkSpacing"),
      icon: Icon.Text,
      transform: (text) => normalizeCjkSpacing(text)
    },
    {
      id: "markdown-fmt",
      category: "typesetting",
      label: t("itemMarkdownFmt"),
      icon: Icon.Document,
      transform: (text) => formatMarkdown(text)
    },
    // 大小写转换
    {
      id: "upper-case",
      category: "case",
      label: t("itemUpperCase"),
      keywords: "UPPERCASE upper",
      icon: Icon.Text,
      transform: (text) => toUpperCase(text)
    },
    {
      id: "lower-case",
      category: "case",
      label: t("itemLowerCase"),
      keywords: "lowercase lower",
      icon: Icon.Text,
      transform: (text) => toLowerCase(text)
    },
    {
      id: "title-case",
      category: "case",
      label: t("itemTitleCase"),
      keywords: "Title Case",
      icon: Icon.Text,
      transform: (text) => toTitleCase(text)
    },
    {
      id: "sentence-case",
      category: "case",
      label: t("itemSentenceCase"),
      keywords: "Sentence case",
      icon: Icon.Text,
      transform: (text) => toSentenceCase(text)
    },
    {
      id: "camel-case",
      category: "case",
      label: t("itemCamelCase"),
      icon: Icon.Code,
      transform: (text) => toCamelCase(text)
    },
    {
      id: "snake-case",
      category: "case",
      label: t("itemSnakeCase"),
      icon: Icon.Code,
      transform: (text) => toSnakeCase(text)
    },
    {
      id: "kebab-case",
      category: "case",
      label: t("itemKebabCase"),
      icon: Icon.Code,
      transform: (text) => toKebabCase(text)
    },
    // 全半角与标点
    {
      id: "to-half-width",
      category: "punctuation",
      label: t("itemHalfWidth"),
      keywords: "Fullwidth Halfwidth",
      icon: Icon.ArrowRight,
      transform: (text) => toHalfWidth(text)
    },
    {
      id: "to-full-width",
      category: "punctuation",
      label: t("itemFullWidth"),
      keywords: "Halfwidth Fullwidth",
      icon: Icon.ArrowLeft,
      transform: (text) => toFullWidth(text)
    },
    {
      id: "to-zh-punct",
      category: "punctuation",
      label: t("itemZhPunct"),
      icon: Icon.Globe,
      transform: (text) => toChinesePunctuation(text)
    },
    {
      id: "to-en-punct",
      category: "punctuation",
      label: t("itemEnPunct"),
      icon: Icon.Globe,
      transform: (text) => toEnglishPunctuation(text)
    },
    // 行操作与去重
    {
      id: "trim-lines",
      category: "lines",
      label: t("itemTrimLines"),
      keywords: "Trim Lines",
      icon: Icon.Terminal,
      transform: (text) => trimLines(text)
    },
    {
      id: "remove-empty-lines",
      category: "lines",
      label: t("itemRemoveEmptyLines"),
      keywords: "Remove Empty Lines",
      icon: Icon.Trash,
      transform: (text) => removeEmptyLines(text)
    },
    {
      id: "collapse-spaces",
      category: "lines",
      label: t("itemCollapseSpaces"),
      keywords: "Collapse Spaces",
      icon: Icon.Text,
      transform: (text) => collapseInlineSpaces(text)
    },
    {
      id: "dedupe-lines",
      category: "lines",
      label: t("itemDedupeLines"),
      icon: Icon.Check,
      transform: (text) => dedupeLines(text)
    },
    {
      id: "sort-lines-asc",
      category: "lines",
      label: t("itemSortLinesAsc"),
      keywords: "Sort Lines A-Z",
      icon: Icon.ArrowUp,
      transform: (text) => sortLines(text, "asc")
    },
    {
      id: "reverse-lines",
      category: "lines",
      label: t("itemReverseLines"),
      keywords: "Reverse Lines",
      icon: Icon.Repeat,
      transform: (text) => reverseLines(text)
    },
    {
      id: "add-line-numbers",
      category: "lines",
      label: t("itemAddLineNumbers"),
      icon: Icon.List,
      transform: (text) => addLineNumbers(text)
    },
    {
      id: "remove-line-numbers",
      category: "lines",
      label: t("itemRemoveLineNumbers"),
      icon: Icon.Trash,
      transform: (text) => removeLineNumbers(text)
    },
    // 简繁转换
    {
      id: "to-traditional",
      category: "chinese",
      label: t("itemToTraditional"),
      keywords: "Simplified Traditional",
      icon: Icon.Document,
      transform: (text) => convertToTraditional(text)
    },
    {
      id: "to-simplified",
      category: "chinese",
      label: t("itemToSimplified"),
      keywords: "Traditional Simplified",
      icon: Icon.Document,
      transform: (text) => convertToSimplified(text)
    }
  ];
}

function getCategoryLabels(): Record<FormatItemDef["category"], string> {
  return {
    typesetting: t("catTypesetting"),
    case: t("catCase"),
    punctuation: t("catPunctuation"),
    lines: t("catLines"),
    chinese: t("catChinese")
  };
}

/** 右侧预览最多展示的字符数：超长文本只预览开头，复制得到的仍是完整结果 */
export const PREVIEW_CHAR_LIMIT = 10000;

/** 用代码块原样展示文本（保留换行、缩进与空白）；围栏比内容里最长的反引号串更长，内容里的 ``` 不会提前结束代码块 */
export function textPreviewMarkdown(text: string, emptyHint: string): string {
  if (!text) return emptyHint;
  const shown = text.length > PREVIEW_CHAR_LIMIT ? text.slice(0, PREVIEW_CHAR_LIMIT) : text;
  const longestTicks = Math.max(0, ...(shown.match(/`+/g) || []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestTicks + 1));
  const note =
    shown.length < text.length
      ? t("previewTruncatedNote", { limit: PREVIEW_CHAR_LIMIT, total: text.length })
      : "";
  return `${fence}text\n${shown}\n${fence}${note}`;
}

/** 列表行标题用的单行摘要：取第一行非空内容 */
function firstLine(text: string): string {
  const line = text.split("\n").find((item) => item.trim().length > 0) || "";
  return line.trim().slice(0, 60);
}

/**
 * 编辑待排版文本：多行正文用 TextArea 输入，保留换行（搜索框是单行输入，只用来筛选转换方式）
 */
export function EditTextForm({ initialText, onApply }: { initialText: string; onApply: (text: string) => void }) {
  useLocale();
  const { pop } = useNavigation();
  const [text, setText] = useState<string>(initialText);

  return Form(
    {
      navigationTitle: t("editFormNavTitle"),
      actions: ActionPanel({ title: t("editFormPanelTitle") }, [
        Action.SubmitForm({
          title: t("editFormSubmitTitle"),
          icon: Icon.Check,
          onSubmit: () => {
            onApply(text);
            pop();
          }
        })
      ])
    },
    [
      Form.TextArea({
        id: "text",
        title: t("editFormFieldTitle"),
        placeholder: t("editFormPlaceholder", { modEnter: modEnterLabel() }),
        value: text,
        onChange: (value: string) => setText(value)
      })
    ]
  );
}

export default function TextFormatterCommand() {
  const locale = useLocale();
  const [inputText, setInputText] = useState<string>("");
  const [category, setCategory] = useState<string>("all");
  const [searchText, setSearchText] = useState<string>("");
  const { push } = useNavigation();

  const effectiveText = inputText || t("sampleText");
  const stats = useMemo(() => getTextStats(effectiveText), [effectiveText]);
  const formatItems = useMemo(() => getFormatItems(), [locale]);
  const categoryLabels = useMemo(() => getCategoryLabels(), [locale]);
  // 结果只随文本变化重新计算，筛选、切换分类不重复跑 24 种转换
  const results = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of formatItems) map.set(item.id, item.transform(effectiveText));
    return map;
  }, [effectiveText, formatItems]);

  const handleCopy = async (result: string, label: string) => {
    if (!result) {
      await showToast(Toast.Style.Failure, t("toastNothingToCopy"), t("toastNothingToCopyMsg", { label }));
      return;
    }
    try {
      await Clipboard.copy(result);
      await showToast(Toast.Style.Success, t("toastCopied", { label }));
    } catch (error) {
      await showToast(Toast.Style.Failure, t("toastCopyFailed"), error instanceof Error ? error.message : String(error));
    }
  };

  const handlePasteResult = async (result: string, label: string) => {
    if (!result) {
      await showToast(Toast.Style.Failure, t("toastNothingToPaste"), t("toastNothingToPasteMsg", { label }));
      return;
    }
    try {
      await Clipboard.paste(result);
      await showToast(Toast.Style.Success, t("toastPasted", { label }));
    } catch (error) {
      await showToast(Toast.Style.Failure, t("toastPasteFailed"), error instanceof Error ? error.message : String(error));
    }
  };

  const handlePaste = async () => {
    try {
      const clipboardText = await Clipboard.readText();
      if (clipboardText) {
        setInputText(clipboardText);
        await showToast(Toast.Style.Success, t("toastClipboardRead"));
      } else {
        await showToast(Toast.Style.Failure, t("toastClipboardEmpty"));
      }
    } catch {
      await showToast(Toast.Style.Failure, t("toastClipboardReadFailed"));
    }
  };

  const openEditor = () =>
    push(() =>
      EditTextForm({
        initialText: inputText,
        onApply: (text: string) => {
          setInputText(text);
          showToast(Toast.Style.Success, text ? t("toastTextUpdated") : t("toastResetToSample"));
        }
      })
    );

  const keyword = searchText.trim().toLowerCase();
  const filteredItems = formatItems.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!keyword) return true;
    return `${item.label} ${item.keywords ?? ""} ${item.id} ${categoryLabels[item.category]}`.toLowerCase().includes(keyword);
  });

  const editAction = Action({ title: t("actionEditText"), icon: Icon.Pencil, onAction: openEditor });
  const pasteAction = Action({ title: t("actionPasteText"), icon: Icon.CopyClipboard, onAction: handlePaste });

  const sourceItem = List.Item({
    id: "source-text",
    title: inputText ? firstLine(inputText) || t("sourceBlankLabel") : t("sourceEmptyTitle"),
    subtitle: t("sourceStatsSub", {
      tag: inputText ? t("sourceCurrentTag") : t("sourceSampleTag"),
      chars: stats.characters,
      lines: stats.lines
    }),
    icon: Icon.Pencil,
    detail: List.Item.Detail({ markdown: textPreviewMarkdown(effectiveText, "") }),
    actions: ActionPanel({ title: t("editFormPanelTitle") }, [
      editAction,
      pasteAction,
      Action({
        title: t("actionResetSample"),
        icon: Icon.Repeat,
        onAction: () => setInputText("")
      })
    ])
  });

  return List(
    {
      navigationTitle: t("navTitle"),
      searchBarPlaceholder: t("searchPlaceholder"),
      searchText,
      onSearchTextChange: (text: string) => setSearchText(text),
      isShowingDetail: true,
      searchBarAccessory: List.Dropdown(
        {
          tooltip: t("filterTooltip"),
          value: category,
          onChange: (val: string) => setCategory(val)
        },
        [
          List.Dropdown.Item({ title: t("filterAll"), value: "all" }),
          List.Dropdown.Item({ title: t("catTypesetting"), value: "typesetting" }),
          List.Dropdown.Item({ title: t("catCase"), value: "case" }),
          List.Dropdown.Item({ title: t("catPunctuation"), value: "punctuation" }),
          List.Dropdown.Item({ title: t("catLines"), value: "lines" }),
          List.Dropdown.Item({ title: t("catChinese"), value: "chinese" })
        ]
      ),
      actions: ActionPanel({ title: t("globalActionsTitle") }, [
        editAction,
        pasteAction,
        Action({
          title: t("actionResetSample"),
          icon: Icon.Repeat,
          onAction: () => setInputText("")
        })
      ])
    },
    [
      // 待排版文本：筛选时隐藏，避免改了筛选词后回车打开编辑页而不是执行转换
      ...(keyword ? [] : [List.Section({ title: t("editFormPanelTitle") }, [sourceItem])]),
      List.Section(
        { title: t("resultsSectionTitle", { count: filteredItems.length }) },
        filteredItems.map((item) => {
          const result = results.get(item.id) ?? "";
          return List.Item({
            id: item.id,
            title: item.label,
            icon: item.icon,
            accessories: [{ text: result ? t("charsCount", { count: result.length }) : t("noOutputTag") }],
            detail: List.Item.Detail({
              markdown: textPreviewMarkdown(result, t("noOutputDetail"))
            }),
            actions: ActionPanel({ title: item.label }, [
              Action({
                title: t("actionCopyPrefix", { label: item.label }),
                icon: Icon.CopyClipboard,
                onAction: () => handleCopy(result, item.label)
              }),
              Action({
                title: t("actionPasteResultPrefix", { label: item.label }),
                icon: Icon.ArrowRight,
                shortcut: { modifiers: ["ctrl"], key: "return" },
                onAction: () => handlePasteResult(result, item.label)
              }),
              Action({
                title: t("actionUseAsInput"),
                icon: Icon.Repeat,
                onAction: async () => {
                  if (!result) {
                    await showToast(Toast.Style.Failure, t("toastEmptyResult"));
                    return;
                  }
                  setInputText(result);
                  await showToast(Toast.Style.Success, t("toastAppliedAsInput"));
                }
              }),
              editAction,
              pasteAction
            ])
          });
        })
      )
    ]
  );
}
