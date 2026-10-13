import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  useState
} from "@ztools/raycast-compat";
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

export default function TextFormatterCommand() {
  const [inputText, setInputText] = useState<string>("");
  const [category, setCategory] = useState<string>("all");

  const effectiveText = inputText || DEFAULT_SAMPLE_TEXT;
  const stats = getTextStats(effectiveText);

  const handleCopy = async (result: string, label: string) => {
    await Clipboard.copy(result);
    await showToast(Toast.Style.Success, `已复制: ${label}`);
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

  const filteredItems = FORMAT_ITEMS.filter(
    (item) => category === "all" || item.category === category
  );

  return List(
    {
      navigationTitle: "文本排版与格式化助手",
      searchBarPlaceholder: "输入或粘贴待排版文本 (留空使用默认示例)...",
      searchText: inputText,
      onSearchTextChange: (text: string) => setInputText(text),
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
        Action({
          title: "从剪贴板粘贴文本",
          icon: Icon.CopyClipboard,
          onAction: handlePaste
        }),
        Action({
          title: "重置为默认示例文本",
          icon: Icon.Repeat,
          onAction: () => setInputText(DEFAULT_SAMPLE_TEXT)
        }),
        Action({
          title: "清空当前输入文本",
          icon: Icon.Trash,
          onAction: () => setInputText("")
        })
      ])
    },
    [
      // 文本统计信息栏
      List.Section(
        { title: "文本实时统计" },
        [
          List.Item({
            id: "text-stats",
            title: `字符数: ${stats.characters} | 不含空格: ${stats.charactersNoSpaces} | 词数: ${stats.words} | 行数: ${stats.lines}`,
            subtitle: inputText ? "当前输入文本统计" : "示例文本统计",
            icon: Icon.Document,
            accessories: [
              { text: stats.hasChinese ? "包含中文" : "纯英/数字" }
            ],
            actions: ActionPanel({ title: "统计操作" }, [
              Action.CopyToClipboard({
                title: "复制原文本",
                content: effectiveText,
                icon: Icon.CopyClipboard
              }),
              Action({
                title: "从剪贴板粘贴",
                icon: Icon.CopyClipboard,
                onAction: handlePaste
              })
            ])
          })
        ]
      ),
      // 各项格式化结果与一键复制
      List.Section(
        { title: `格式化结果预览 (${filteredItems.length} 项可用)` },
        filteredItems.map((item) => {
          const result = item.transform(effectiveText);
          const singleLinePreview = result.replace(/\n+/g, "  ").slice(0, 100);
          return List.Item({
            id: item.id,
            title: singleLinePreview || "(无输出内容)",
            subtitle: item.label,
            icon: item.icon,
            accessories: [
              { text: `${result.length} 字符` }
            ],
            actions: ActionPanel({ title: item.label }, [
              Action({
                title: `复制: ${item.label}`,
                icon: Icon.CopyClipboard,
                onAction: () => handleCopy(result, item.label)
              }),
              Action({
                title: "将此结果设为当前输入文本",
                icon: Icon.Repeat,
                onAction: () => {
                  setInputText(result);
                  showToast(Toast.Style.Success, "已应用为当前输入");
                }
              }),
              Action.CopyToClipboard({
                title: "直接复制结果到剪贴板",
                content: result,
                icon: Icon.CopyClipboard
              }),
              Action({
                title: "从剪贴板粘贴",
                icon: Icon.CopyClipboard,
                onAction: handlePaste
              }),
              Action({
                title: "清空输入",
                icon: Icon.Trash,
                onAction: () => setInputText("")
              })
            ])
          });
        })
      )
    ]
  );
}
