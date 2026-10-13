import {
  List,
  Detail,
  Form,
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
  computeDiff,
  generateUnifiedDiff,
  generateMarkdownReport,
  SAMPLE_LEFT,
  SAMPLE_RIGHT,
  type TextDiffOptions,
  type DiffType
} from "./logic.js";

export default function FileCompareCommand() {
  const [leftText, setLeftText] = useState<string>(SAMPLE_LEFT);
  const [rightText, setRightText] = useState<string>(SAMPLE_RIGHT);
  const [filterChangedOnly, setFilterChangedOnly] = useState<boolean>(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState<boolean>(false);
  const [ignoreCase, setIgnoreCase] = useState<boolean>(false);
  const [mode, setMode] = useState<"line" | "word">("line");
  const [view, setView] = useState<"list" | "form" | "report">("list");

  // 表单临时编辑状态
  const [editLeft, setEditLeft] = useState<string>(SAMPLE_LEFT);
  const [editRight, setEditRight] = useState<string>(SAMPLE_RIGHT);

  const diffOptions: TextDiffOptions = {
    mode,
    ignoreWhitespace,
    ignoreCase
  };

  const result = computeDiff(leftText, rightText, diffOptions);

  const handleCopyUnifiedDiff = async () => {
    const diff = generateUnifiedDiff(leftText, rightText, "original.txt", "modified.txt", diffOptions);
    await Clipboard.copy(diff);
    await showToast(Toast.Style.Success, "已复制 Unified Diff 补丁到剪贴板");
  };

  const handleCopyReport = async () => {
    const report = generateMarkdownReport(result);
    await Clipboard.copy(report);
    await showToast(Toast.Style.Success, "已复制 Markdown 差异报告");
  };

  const handleSwapText = async () => {
    const tmp = leftText;
    setLeftText(rightText);
    setRightText(tmp);
    setEditLeft(rightText);
    setEditRight(tmp);
    await showToast(Toast.Style.Success, "已互换左右文本内容");
  };

  const handleLoadSample = async () => {
    setLeftText(SAMPLE_LEFT);
    setRightText(SAMPLE_RIGHT);
    setEditLeft(SAMPLE_LEFT);
    setEditRight(SAMPLE_RIGHT);
    await showToast(Toast.Style.Success, "已载入预设代码对比示例");
  };

  const handleClear = async () => {
    setLeftText("");
    setRightText("");
    setEditLeft("");
    setEditRight("");
    await showToast(Toast.Style.Success, "已清空两段文本");
  };

  // 1. Markdown 报告视图
  if (view === "report") {
    const reportMarkdown = generateMarkdownReport(result);
    return Detail({
      navigationTitle: "差异对比完整报告",
      markdown: reportMarkdown,
      actions: ActionPanel({ title: "报告操作" }, [
        Action({
          title: "复制 Markdown 报告",
          icon: Icon.CopyClipboard,
          onAction: handleCopyReport
        }),
        Action({
          title: "复制 Unified Diff",
          icon: Icon.Document,
          onAction: handleCopyUnifiedDiff
        }),
        Action({
          title: "返回差异列表",
          icon: Icon.ArrowLeft,
          onAction: () => setView("list")
        })
      ]),
      metadata: Detail.Metadata({}, [
        Detail.Metadata.Label({ title: "文本相似度", text: `${result.stats.similarity}%` }),
        Detail.Metadata.Label({ title: "新增行数", text: `+${result.stats.added}` }),
        Detail.Metadata.Label({ title: "删除行数", text: `-${result.stats.removed}` }),
        Detail.Metadata.Label({ title: "修改行数", text: `~${result.stats.modified}` }),
        Detail.Metadata.Label({ title: "相同行数", text: `=${result.stats.equal}` }),
        Detail.Metadata.Separator(),
        Detail.Metadata.Label({ title: "左侧总行数", text: String(result.stats.totalLeft) }),
        Detail.Metadata.Label({ title: "右侧总行数", text: String(result.stats.totalRight) })
      ])
    });
  }

  // 2. 文本输入/编辑表单视图
  if (view === "form") {
    return Form(
      {
        navigationTitle: "输入对比文本",
        actions: ActionPanel({ title: "表单操作" }, [
          Action.SubmitForm({
            title: "开始对比计算",
            icon: Icon.Check,
            onSubmit: (values) => {
              const newLeft = values.left !== undefined ? values.left : editLeft;
              const newRight = values.right !== undefined ? values.right : editRight;
              setLeftText(newLeft);
              setRightText(newRight);
              setView("list");
              showToast(Toast.Style.Success, "差异对比计算已更新");
            }
          }),
          Action({
            title: "互换左右文本",
            icon: Icon.Repeat,
            onAction: () => {
              const tmp = editLeft;
              setEditLeft(editRight);
              setEditRight(tmp);
            }
          }),
          Action({
            title: "载入代码示例",
            icon: Icon.Document,
            onAction: () => {
              setEditLeft(SAMPLE_LEFT);
              setEditRight(SAMPLE_RIGHT);
            }
          }),
          Action({
            title: "取消并返回",
            icon: Icon.ArrowLeft,
            onAction: () => setView("list")
          })
        ])
      },
      [
        Form.TextArea({
          id: "left",
          title: "原始文本 (左侧/原版)",
          placeholder: "粘贴或输入左侧原版文本...",
          value: editLeft,
          onChange: (val) => setEditLeft(val)
        }),
        Form.TextArea({
          id: "right",
          title: "修改文本 (右侧/新版)",
          placeholder: "粘贴或输入右侧新版文本...",
          value: editRight,
          onChange: (val) => setEditRight(val)
        }),
        Form.Checkbox({
          id: "ignoreWhitespace",
          title: "忽略空白字符差异",
          label: "去除多余空格与缩进后对比",
          value: ignoreWhitespace,
          onChange: (v) => setIgnoreWhitespace(Boolean(v))
        }),
        Form.Checkbox({
          id: "ignoreCase",
          title: "忽略大小写",
          label: "统一转换为小写进行比对",
          value: ignoreCase,
          onChange: (v) => setIgnoreCase(Boolean(v))
        })
      ]
    );
  }

  // 3. 主列表差异视图
  const displayedLines = filterChangedOnly
    ? result.lines.filter((l) => l.type !== "equal")
    : result.lines;

  const getDiffIcon = (type: DiffType) => {
    switch (type) {
      case "added":
        return Icon.Plus;
      case "removed":
        return Icon.Minus;
      case "modified":
        return Icon.Pencil;
      case "equal":
      default:
        return Icon.Dot;
    }
  };

  const getDiffColor = (type: DiffType) => {
    switch (type) {
      case "added":
        return Color.Green;
      case "removed":
        return Color.Red;
      case "modified":
        return Color.Yellow;
      case "equal":
      default:
        return Color.SecondaryText;
    }
  };

  const getDiffTypeLabel = (type: DiffType) => {
    switch (type) {
      case "added":
        return "新增";
      case "removed":
        return "删除";
      case "modified":
        return "修改";
      case "equal":
      default:
        return "相同";
    }
  };

  return List(
    {
      navigationTitle: "文本与代码差异对比",
      searchBarPlaceholder: "输入关键词过滤对比结果..."
    },
    [
      List.Section({ title: "对比统计概览" }, [
        List.Item({
          id: "diff-summary-card",
          title: `相似度: ${result.stats.similarity}% · ${result.hasDifferences ? "检测到文本差异" : "两段文本完全一致"}`,
          subtitle: `+${result.stats.added} 新增 · -${result.stats.removed} 删除 · ~${result.stats.modified} 修改 · =${result.stats.equal} 相同`,
          icon: result.hasDifferences ? Icon.ExclamationMark : Icon.Check,
          accessories: [
            { text: filterChangedOnly ? "仅看变更行" : "显示全部行" }
          ],
          actions: ActionPanel({ title: "操作" }, [
            Action({
              title: "输入与编辑文本",
              icon: Icon.Pencil,
              onAction: () => {
                setEditLeft(leftText);
                setEditRight(rightText);
                setView("form");
              }
            }),
            Action({
              title: "查看完整差异报告 (Markdown)",
              icon: Icon.Eye,
              onAction: () => setView("report")
            }),
            Action({
              title: "复制 Unified Diff 补丁",
              icon: Icon.CopyClipboard,
              onAction: handleCopyUnifiedDiff
            }),
            Action({
              title: "复制 Markdown 报告",
              icon: Icon.Document,
              onAction: handleCopyReport
            }),
            Action({
              title: filterChangedOnly ? "切换为显示全部行" : "切换为仅看变更行",
              icon: Icon.List,
              onAction: () => setFilterChangedOnly(!filterChangedOnly)
            }),
            Action({
              title: "互换左右文本",
              icon: Icon.Repeat,
              onAction: handleSwapText
            }),
            Action({
              title: "载入默认示例",
              icon: Icon.Download,
              onAction: handleLoadSample
            }),
            Action({
              title: "清空对比文本",
              icon: Icon.Trash,
              onAction: handleClear
            })
          ])
        })
      ]),
      List.Section(
        {
          title: `行级对照明细 (${displayedLines.length} 行${filterChangedOnly ? " · 仅变更" : ""})`
        },
        displayedLines.map((line) => {
          let lineTitle = "";
          let lineSubtitle = "";

          if (line.type === "equal") {
            lineTitle = line.leftText || "(空行)";
            lineSubtitle = `L${line.leftLineNo} = R${line.rightLineNo}`;
          } else if (line.type === "added") {
            lineTitle = `+ ${line.rightText || "(空行)"}`;
            lineSubtitle = `R${line.rightLineNo} (新增)`;
          } else if (line.type === "removed") {
            lineTitle = `- ${line.leftText || "(空行)"}`;
            lineSubtitle = `L${line.leftLineNo} (删除)`;
          } else {
            lineTitle = `~ L: ${line.leftText} → R: ${line.rightText}`;
            lineSubtitle = `L${line.leftLineNo} ~ R${line.rightLineNo} (修改)`;
          }

          return List.Item({
            id: line.id,
            title: lineTitle,
            subtitle: lineSubtitle,
            icon: {
              source: getDiffIcon(line.type),
              tintColor: getDiffColor(line.type)
            },
            accessories: [
              {
                text: getDiffTypeLabel(line.type)
              }
            ],
            actions: ActionPanel({ title: "行操作" }, [
              Action({
                title: "复制此行右侧/最新内容",
                icon: Icon.CopyClipboard,
                onAction: async () => {
                  const val = line.rightText || line.leftText;
                  await Clipboard.copy(val);
                  await showToast(Toast.Style.Success, `已复制内容: ${val}`);
                }
              }),
              Action({
                title: "复制此行左侧/原版内容",
                icon: Icon.CopyClipboard,
                onAction: async () => {
                  const val = line.leftText || line.rightText;
                  await Clipboard.copy(val);
                  await showToast(Toast.Style.Success, `已复制原版内容: ${val}`);
                }
              }),
              Action({
                title: "查看完整报告",
                icon: Icon.Eye,
                onAction: () => setView("report")
              }),
              Action({
                title: "编辑两段文本",
                icon: Icon.Pencil,
                onAction: () => {
                  setEditLeft(leftText);
                  setEditRight(rightText);
                  setView("form");
                }
              })
            ])
          });
        })
      )
    ]
  );
}
