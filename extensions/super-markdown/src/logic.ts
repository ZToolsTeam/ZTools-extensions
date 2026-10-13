export interface MarkdownNote {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
  anchor: string;
}

export interface MarkdownStats {
  chars: number;
  charsNoSpaces: number;
  chineseChars: number;
  words: number;
  lines: number;
  paragraphs: number;
  headingsCount: number;
  codeBlocksCount: number;
  readingTimeMinutes: number;
  readingTimeText: string;
}

/**
 * 提取 Markdown 文档大纲 (忽略代码块内部的 # 注释)
 */
export function extractOutline(content: string): OutlineItem[] {
  if (!content || !content.trim()) return [];

  const lines = content.split(/\r?\n/);
  const outline: OutlineItem[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 检查代码块开闭
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    // 匹配标题行: 1 到 6 个 #
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const hashes = headingMatch[1];
      const rawText = headingMatch[2].trim().replace(/\s+#+$/, ""); // 移除行尾闭合 #
      const cleanText = rawText.replace(/[*_~`]/g, ""); // 清理行内强调语法
      const anchor = cleanText
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
        .replace(/^-+|-+$/g, "");

      outline.push({
        level: hashes.length,
        text: cleanText,
        line: i + 1,
        anchor: anchor || `heading-${i + 1}`
      });
    }
  }

  return outline;
}

/**
 * 生成大纲 Markdown 目录 (TOC)
 */
export function generateTocMarkdown(outline: OutlineItem[]): string {
  if (outline.length === 0) return "暂无标题大纲";

  return outline
    .map((item) => {
      const indent = "  ".repeat(Math.max(0, item.level - 1));
      return `${indent}- [${item.text}](#${item.anchor})`;
    })
    .join("\n");
}

/**
 * 计算 Markdown 文本字数、字符数与统计信息
 */
export function calculateMarkdownStats(content: string): MarkdownStats {
  const text = content || "";
  const chars = text.length;
  const charsNoSpaces = text.replace(/\s/g, "").length;

  // 中文字符数 (汉字区间 \u4e00-\u9fa5)
  const chineseMatches = text.match(/[\u4e00-\u9fa5]/g);
  const chineseChars = chineseMatches ? chineseMatches.length : 0;

  // 英文/拉丁单词数
  const wordMatches = text.match(/\b[a-zA-Z0-9]+(?:'[a-zA-Z0-9]+)?\b/g);
  const words = wordMatches ? wordMatches.length : 0;

  // 行数与非空段落数
  const lineArray = text.split(/\r?\n/);
  const lines = text ? lineArray.length : 0;
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;

  // 标题数量
  const outline = extractOutline(text);
  const headingsCount = outline.length;

  // 代码块数量
  const codeBlockMatches = text.match(/```/g);
  const codeBlocksCount = codeBlockMatches ? Math.floor(codeBlockMatches.length / 2) : 0;

  // 预估阅读时间 (中文按 300 字/分钟，英文按 200 词/分钟)
  const totalReadItems = chineseChars + words * 1.5;
  const rawMinutes = totalReadItems / 300;
  const readingTimeMinutes = Math.max(1, Math.round(rawMinutes * 10) / 10);
  const readingTimeText =
    totalReadItems < 100
      ? "少于 1 分钟"
      : readingTimeMinutes < 1
      ? "约 1 分钟"
      : `约 ${Math.ceil(readingTimeMinutes)} 分钟`;

  return {
    chars,
    charsNoSpaces,
    chineseChars,
    words,
    lines,
    paragraphs,
    headingsCount,
    codeBlocksCount,
    readingTimeMinutes,
    readingTimeText
  };
}

/**
 * Markdown 格式清洗优化
 */
export function cleanMarkdown(content: string): string {
  if (!content) return "";

  // 1. 统一换行符
  let cleaned = content.replace(/\r\n/g, "\n");

  // 2. 去除每行行尾多余的空格与制表符
  cleaned = cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  // 3. 规范标题语法：确保 # 与标题内容间保留标准空格 (#标题 -> # 标题)
  cleaned = cleaned.replace(/^(#{1,6})([^\s#])/gm, "$1 $2");

  // 4. 收敛连续 3 行及以上的空行为单行空行
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  // 5. 首尾空白字符整理
  return cleaned.trim() + "\n";
}

/**
 * 将 Markdown 清理去除标签，转换为纯文本 (Plain Text)
 */
export function stripMarkdownToPlainText(content: string): string {
  if (!content) return "";

  let text = content.replace(/\r\n/g, "\n");

  // 移除代码块开闭围栏
  text = text.replace(/```[a-zA-Z0-9_-]*\n/g, "").replace(/```/g, "");

  // 移除 HTML 标签
  text = text.replace(/<[^>]+>/g, "");

  // 转换图片与链接: ![alt](url) -> alt, [text](url) -> text
  text = text.replace(/!\[(.*?)\]\(.*?\)/g, "$1");
  text = text.replace(/\[(.*?)\]\(.*?\)/g, "$1");

  // 移除标题井号
  text = text.replace(/^#{1,6}\s+/gm, "");

  // 移除行内加粗、斜体与删除线
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");

  // 移除引用符号 >
  text = text.replace(/^>\s+/gm, "");

  // 移除无序列表符号与水平分割线
  text = text.replace(/^[\*\-+]\s+/gm, "");
  text = text.replace(/^\d+\.\s+/gm, "");
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // 收敛多余连续空行
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

/**
 * 笔记管理核心操作
 */
export function createNote(
  title: string,
  content: string,
  isPinned = false,
  tags: string[] = []
): MarkdownNote {
  const trimmedTitle = (title || "").trim();
  if (!trimmedTitle) {
    throw new Error("笔记标题不能为空");
  }

  const now = Date.now();
  return {
    id: "note_" + Math.random().toString(36).slice(2, 10),
    title: trimmedTitle,
    content: content || "",
    isPinned,
    tags,
    createdAt: now,
    updatedAt: now
  };
}

export function updateNote(
  notes: MarkdownNote[],
  id: string,
  updates: Partial<Omit<MarkdownNote, "id" | "createdAt">>
): MarkdownNote[] {
  return notes.map((note) => {
    if (note.id === id) {
      return {
        ...note,
        ...updates,
        updatedAt: Date.now()
      };
    }
    return note;
  });
}

export function deleteNote(notes: MarkdownNote[], id: string): MarkdownNote[] {
  return notes.filter((n) => n.id !== id);
}

export function togglePinNote(notes: MarkdownNote[], id: string): MarkdownNote[] {
  return notes.map((note) => {
    if (note.id === id) {
      return {
        ...note,
        isPinned: !note.isPinned,
        updatedAt: Date.now()
      };
    }
    return note;
  });
}

export function filterNotes(
  notes: MarkdownNote[],
  query = "",
  onlyPinned = false
): MarkdownNote[] {
  let list = notes;

  if (onlyPinned) {
    list = list.filter((n) => n.isPinned);
  }

  const q = (query || "").trim().toLowerCase();
  if (q) {
    list = list.filter((n) => {
      return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
    });
  }

  // 排序：置顶在前，更新时间倒序
  return [...list].sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    return b.updatedAt - a.updatedAt;
  });
}

/**
 * 默认预设笔记
 */
export const DEFAULT_NOTES: MarkdownNote[] = [
  {
    id: "note-guide-1",
    title: "ZTools 纯声明式架构设计指南",
    content: `# ZTools 纯声明式架构设计指南

## 1. 核心战略定调
ZTools 彻底卸下历史兼容包袱，不再投入精力维护同步转异步 Shim、黑盒环境模拟与非标兼容层。全面转向**“纯粹开源、免费极客、轻量宿主、极致性能”**的现代化架构体系。

### 1.1 严格声明式 UI 体系
- 彻底封杀原生 DOM/CSS 自由发挥；
- 扩展只能使用语义化组件（<List>, <Detail>, <Form>, <ActionPanel>, <Action>）；
- 由宿主统一呈现沉浸式 Fluent / Mica 毛玻璃与主题。

### 1.2 纯粹键盘优先交互流
全键盘极客闭环：一切高频操作无需离开键盘。
- 方向键聚焦上下项
- Enter 激活首要动作
- Ctrl+K 唤起 ActionPanel 动作面板
- Esc 返回上级导航栈

## 2. 性能与安全性要求
唤醒延迟严格控制在 100ms 以内（SLA < 100ms）。通过 GitOps 与 AST 静态安全门禁，严防 eval 与动态混淆。
`,
    isPinned: true,
    tags: ["架构", "规范"],
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  },
  {
    id: "note-quick-2",
    title: "极客日常快捷备忘",
    content: `# 极客日常快捷备忘

## 常用指令速查
- **tsc**: \`npx tsc -p plugins/xxx/tsconfig.json\`
- **安全门禁扫描**: \`node scripts/scan-plugin-security.mjs plugins/xxx\`
- **单元与集成测试**: \`node --test plugins/xxx/tests/index.test.mjs\`

> 坚持 KISS 原则，拒绝过度设计与重复造轮子。
`,
    isPinned: false,
    tags: ["备忘"],
    createdAt: 1700000010000,
    updatedAt: 1700000010000
  }
];
