import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  useState,
  useNavigation
} from "@ztools/raycast-compat";
import {
  extractOutline,
  calculateMarkdownStats,
  cleanMarkdown,
  filterNotes,
  DEFAULT_NOTES,
  type MarkdownNote,
  type MarkdownStats,
  type OutlineItem
} from "./logic.js";

function NoteDetailView({ note }: { note: MarkdownNote }) {
  const stats: MarkdownStats = calculateMarkdownStats(note.content);
  const outline: OutlineItem[] = extractOutline(note.content);

  const markdownContent = `
# ${note.title}

${note.content}

---

### 文档大纲 (${outline.length} 节)
${
  outline.length > 0
    ? outline.map((o) => `${"  ".repeat(o.level - 1)}- ${o.text}`).join("\n")
    : "- 暂无大纲标题"
}
`;

  return Detail({
    markdown: markdownContent,
    navigationTitle: note.title,
    metadata: Detail.Metadata({}, [
      Detail.Metadata.Label({ title: "总字符数", text: `${stats.chars}` }),
      Detail.Metadata.Label({ title: "中文字数", text: `${stats.chineseChars}` }),
      Detail.Metadata.Label({ title: "词数", text: `${stats.words}` }),
      Detail.Metadata.Label({ title: "预计阅读", text: stats.readingTimeText }),
      Detail.Metadata.TagList({ title: "标签" }, [
        ...note.tags.map((t) => Detail.Metadata.TagList.Item({ text: t, color: Color.Blue }))
      ])
    ]),
    actions: ActionPanel({ title: "操作" }, [
      Action.CopyToClipboard({
        title: "复制 Markdown 原文",
        content: note.content,
        icon: Icon.CopyClipboard
      }),
      Action.CopyToClipboard({
        title: "复制纯文本 (无格式)",
        content: cleanMarkdown(note.content),
        icon: Icon.Document
      })
    ])
  });
}

export default function SuperMarkdownCommand() {
  const [searchText, setSearchText] = useState<string>("");
  const [notes, setNotes] = useState<MarkdownNote[]>(DEFAULT_NOTES);
  const { push } = useNavigation();

  const filtered = filterNotes(notes, searchText);

  const handleCopy = async (n: MarkdownNote) => {
    await Clipboard.copy(n.content);
    await showToast(Toast.Style.Success, `已复制《${n.title}》`);
  };

  return List(
    {
      navigationTitle: "Markdown 笔记与大纲",
      searchBarPlaceholder: "搜索笔记标题、内容或标签...",
      searchText,
      onSearchTextChange: (txt: string) => setSearchText(txt)
    },
    [
      List.Section(
        { title: `笔记列表 (${filtered.length})` },
        filtered.map((note) => {
          const stats = calculateMarkdownStats(note.content);
          return List.Item({
            id: note.id,
            title: note.title,
            subtitle: `${stats.chineseChars} 字 • ${stats.readingTimeText}`,
            icon: note.isPinned ? Icon.Pin : Icon.Document,
            accessories: [
              ...note.tags.map((t) => ({ text: `#${t}` }))
            ],
            actions: ActionPanel({ title: note.title }, [
              Action.Push({
                title: "查看详情与大纲",
                icon: Icon.Eye,
                target: () => NoteDetailView({ note })
              }),
              Action.CopyToClipboard({
                title: "复制 Markdown 原文",
                content: note.content,
                icon: Icon.CopyClipboard
              }),
              Action({
                title: "快速复制并提示",
                icon: Icon.Clipboard,
                onAction: () => handleCopy(note)
              })
            ])
          });
        })
      )
    ]
  );
}
