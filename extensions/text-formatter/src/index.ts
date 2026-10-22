import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  Clipboard,
  useState,
  useMemo,
  useNavigation
} from "@ztools/declarative-ui";
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

const DEFAULT_SAMPLE_TEXT = `ZTools 文本格式化工具,支持中英文混合排版!
   这里有   多余的空格   和不规范的标点.
例如:fullwidth and halfwidth characters转换,大小写转换,Markdown标题自动空格。
第二段可以自动首行缩进,并按句子重新分段。`;

interface FormatItemDef {
  id: string;
  category: "case" | "punctuation" | "typesetting" | "lines" | "chinese";
  label: string;
  icon: string;
  transform: (text: string) => string;
}

const FORMAT_ITEMS: FormatItemDef[] = [
  // 智能与排版
  {
    id: "zh-smart",
    category: "typesetting",
    label: "中文智能排版 (中英空格+标点规范+缩进分段)",
    icon: Icon.Star,
    transform: (text) => formatChineseSmart(text)
  },
  {
    id: "cjk-spacing",
    category: "typesetting",
    label: "中英文混排加空格 (规范盘古之白)",
    icon: Icon.Text,
    transform: (text) => normalizeCjkSpacing(text)
  },
  {
    id: "markdown-fmt",
    category: "typesetting",
    label: "Markdown 自动排版 (规范标题与列表空格)",
    icon: Icon.Document,
    transform: (text) => formatMarkdown(text)
  },
  // 大小写转换
  {
    id: "upper-case",
    category: "case",
    label: "全部大写 (UPPERCASE)",
    icon: Icon.Text,
    transform: (text) => toUpperCase(text)
  },
  {
    id: "lower-case",
    category: "case",
    label: "全部小写 (lowercase)",
    icon: Icon.Text,
    transform: (text) => toLowerCase(text)
  },
  {
    id: "title-case",
    category: "case",
    label: "标题大小写 (Title Case)",
    icon: Icon.Text,
    transform: (text) => toTitleCase(text)
  },
  {
    id: "sentence-case",
    category: "case",
    label: "句首大写 (Sentence case)",
    icon: Icon.Text,
    transform: (text) => toSentenceCase(text)
  },
  {
    id: "camel-case",
    category: "case",
    label: "驼峰命名 (camelCase)",
    icon: Icon.Code,
    transform: (text) => toCamelCase(text)
  },
  {
    id: "snake-case",
    category: "case",
    label: "下划线命名 (snake_case)",
    icon: Icon.Code,
    transform: (text) => toSnakeCase(text)
  },
  {
    id: "kebab-case",
    category: "case",
    label: "短横线命名 (kebab-case)",
    icon: Icon.Code,
    transform: (text) => toKebabCase(text)
  },
  // 全半角与标点
  {
    id: "to-half-width",
    category: "punctuation",
    label: "全角转半角 (Fullwidth -> Halfwidth)",
    icon: Icon.ArrowRight,
    transform: (text) => toHalfWidth(text)
  },
  {
    id: "to-full-width",
    category: "punctuation",
    label: "半角转全角 (Halfwidth -> Fullwidth)",
    icon: Icon.ArrowLeft,
    transform: (text) => toFullWidth(text)
  },
  {
    id: "to-zh-punct",
    category: "punctuation",
    label: "英文标点转中文标点 (, . ? ! -> ， 。 ？ ！)",
    icon: Icon.Globe,
    transform: (text) => toChinesePunctuation(text)
  },
  {
    id: "to-en-punct",
    category: "punctuation",
    label: "中文标点转英文标点 (， 。 ？ ！ -> , . ? !)",
    icon: Icon.Globe,
    transform: (text) => toEnglishPunctuation(text)
  },
  // 行操作与去重
  {
    id: "trim-lines",
    category: "lines",
    label: "去除每行首尾空白 (Trim Lines)",
    icon: Icon.Terminal,
    transform: (text) => trimLines(text)
  },
  {
    id: "remove-empty-lines",
    category: "lines",
    label: "删除所有空白行 (Remove Empty Lines)",
    icon: Icon.Trash,
    transform: (text) => removeEmptyLines(text)
  },
  {
    id: "collapse-spaces",
    category: "lines",
    label: "合并连续空白为单个空格 (Collapse Spaces)",
    icon: Icon.Text,
    transform: (text) => collapseInlineSpaces(text)
  },
  {
    id: "dedupe-lines",
    category: "lines",
    label: "行去重 (保留首次出现行)",
    icon: Icon.Check,
    transform: (text) => dedupeLines(text)
  },
  {
    id: "sort-lines-asc",
    category: "lines",
    label: "升序排序行 (Sort Lines A-Z)",
    icon: Icon.ArrowUp,
    transform: (text) => sortLines(text, "asc")
  },
  {
    id: "reverse-lines",
    category: "lines",
    label: "反转行顺序 (Reverse Lines)",
    icon: Icon.Repeat,
    transform: (text) => reverseLines(text)
  },
  {
    id: "add-line-numbers",
    category: "lines",
    label: "添加行号 (01. 02. ...)",
    icon: Icon.List,
    transform: (text) => addLineNumbers(text)
  },
  {
    id: "remove-line-numbers",
    category: "lines",
    label: "去除行号",
    icon: Icon.Trash,
    transform: (text) => removeLineNumbers(text)
  },
  // 简繁转换
  {
    id: "to-traditional",
    category: "chinese",
    label: "简体转繁体 (Simplified -> Traditional)",
    icon: Icon.Document,
    transform: (text) => convertToTraditional(text)
  },
  {
    id: "to-simplified",
    category: "chinese",
    label: "繁体转简体 (Traditional -> Simplified)",
    icon: Icon.Document,
    transform: (text) => convertToSimplified(text)
  }
];

const CATEGORY_LABELS: Record<FormatItemDef["category"], string> = {
  typesetting: "中文智能与排版",
  case: "大小写与命名规范",
  punctuation: "全半角与标点切换",
  lines: "行操作与去重排序",
  chinese: "简繁汉字转换"
};

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
      ? `\n\n仅预览前 ${PREVIEW_CHAR_LIMIT} 个字符（共 ${text.length} 个），复制可得到完整结果`
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
  const { pop } = useNavigation();
  const [text, setText] = useState<string>(initialText);

  return Form(
    {
      navigationTitle: "编辑待排版文本",
      actions: ActionPanel({ title: "待排版文本" }, [
        Action.SubmitForm({
          title: "应用文本",
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
        title: "待排版文本",
        placeholder: "输入或粘贴多行文本，⌘↵ 应用；留空则使用示例文本",
        value: text,
        onChange: (value: string) => setText(value)
      })
    ]
  );
}

export default function TextFormatterCommand() {
  const [inputText, setInputText] = useState<string>("");
  const [category, setCategory] = useState<string>("all");
  const [searchText, setSearchText] = useState<string>("");
  const { push } = useNavigation();

  const effectiveText = inputText || DEFAULT_SAMPLE_TEXT;
  const stats = useMemo(() => getTextStats(effectiveText), [effectiveText]);
  // 结果只随文本变化重新计算，筛选、切换分类不重复跑 24 种转换
  const results = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of FORMAT_ITEMS) map.set(item.id, item.transform(effectiveText));
    return map;
  }, [effectiveText]);

  const handleCopy = async (result: string, label: string) => {
    if (!result) {
      await showToast(Toast.Style.Failure, "没有可复制的内容", `${label} 对当前文本没有输出`);
      return;
    }
    try {
      await Clipboard.copy(result);
      await showToast(Toast.Style.Success, `已复制: ${label}`);
    } catch (error) {
      await showToast(Toast.Style.Failure, "复制失败", error instanceof Error ? error.message : String(error));
    }
  };

  const handlePaste = async () => {
    try {
      const clipboardText = await Clipboard.readText();
      if (clipboardText) {
        setInputText(clipboardText);
        await showToast(Toast.Style.Success, "已从剪贴板读取文本");
      } else {
        await showToast(Toast.Style.Failure, "剪贴板中没有文本内容");
      }
    } catch {
      await showToast(Toast.Style.Failure, "读取剪贴板失败");
    }
  };

  const openEditor = () =>
    push(() =>
      EditTextForm({
        initialText: inputText,
        onApply: (text: string) => {
          setInputText(text);
          showToast(Toast.Style.Success, text ? "已更新待排版文本" : "已清空，使用示例文本");
        }
      })
    );

  const keyword = searchText.trim().toLowerCase();
  const filteredItems = FORMAT_ITEMS.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!keyword) return true;
    return `${item.label} ${item.id} ${CATEGORY_LABELS[item.category]}`.toLowerCase().includes(keyword);
  });

  const editAction = Action({ title: "编辑待排版文本", icon: Icon.Pencil, onAction: openEditor });
  const pasteAction = Action({ title: "从剪贴板粘贴文本", icon: Icon.CopyClipboard, onAction: handlePaste });

  const sourceItem = List.Item({
    id: "source-text",
    title: inputText ? firstLine(inputText) || "(空白文本)" : "输入或粘贴待排版文本",
    subtitle: `${inputText ? "当前文本" : "示例文本"} · ${stats.characters} 字符 · ${stats.lines} 行`,
    icon: Icon.Pencil,
    detail: List.Item.Detail({ markdown: textPreviewMarkdown(effectiveText, "") }),
    actions: ActionPanel({ title: "待排版文本" }, [
      editAction,
      pasteAction,
      Action({
        title: "重置为默认示例文本",
        icon: Icon.Repeat,
        onAction: () => setInputText("")
      })
    ])
  });

  return List(
    {
      navigationTitle: "文本排版与格式化助手",
      searchBarPlaceholder: "筛选转换方式，例如 大写、行号、繁体",
      searchText,
      onSearchTextChange: (text: string) => setSearchText(text),
      isShowingDetail: true,
      searchBarAccessory: List.Dropdown(
        {
          tooltip: "筛选格式化分类",
          value: category,
          onChange: (val: string) => setCategory(val)
        },
        [
          List.Dropdown.Item({ title: "全部格式化能力", value: "all" }),
          List.Dropdown.Item({ title: "中文智能与排版", value: "typesetting" }),
          List.Dropdown.Item({ title: "大小写与命名规范", value: "case" }),
          List.Dropdown.Item({ title: "全半角与标点切换", value: "punctuation" }),
          List.Dropdown.Item({ title: "行操作与去重排序", value: "lines" }),
          List.Dropdown.Item({ title: "简繁汉字转换", value: "chinese" })
        ]
      ),
      actions: ActionPanel({ title: "全局操作" }, [
        editAction,
        pasteAction,
        Action({
          title: "重置为默认示例文本",
          icon: Icon.Repeat,
          onAction: () => setInputText("")
        })
      ])
    },
    [
      // 待排版文本：筛选时隐藏，避免改了筛选词后回车打开编辑页而不是执行转换
      ...(keyword ? [] : [List.Section({ title: "待排版文本" }, [sourceItem])]),
      List.Section(
        { title: `格式化结果 (${filteredItems.length} 项)` },
        filteredItems.map((item) => {
          const result = results.get(item.id) ?? "";
          return List.Item({
            id: item.id,
            title: item.label,
            icon: item.icon,
            accessories: [{ text: result ? `${result.length} 字符` : "无输出" }],
            detail: List.Item.Detail({
              markdown: textPreviewMarkdown(result, "该转换对当前文本没有输出内容")
            }),
            actions: ActionPanel({ title: item.label }, [
              Action({
                title: `复制: ${item.label}`,
                icon: Icon.CopyClipboard,
                onAction: () => handleCopy(result, item.label)
              }),
              Action({
                title: "将此结果设为当前输入文本",
                icon: Icon.Repeat,
                onAction: async () => {
                  if (!result) {
                    await showToast(Toast.Style.Failure, "该结果为空，未替换当前文本");
                    return;
                  }
                  setInputText(result);
                  await showToast(Toast.Style.Success, "已应用为当前输入");
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
