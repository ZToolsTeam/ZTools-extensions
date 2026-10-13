/**
 * ZTools 文件与文本差异对比核心逻辑 (纯函数，零外部依赖)
 */

export interface TextDiffOptions {
  mode?: "line" | "word";
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
}

export type DiffType = "equal" | "added" | "removed" | "modified";

export interface WordToken {
  type: "equal" | "added" | "removed";
  text: string;
}

export interface DiffLine {
  id: string;
  leftLineNo: number | null;
  rightLineNo: number | null;
  leftText: string;
  rightText: string;
  type: DiffType;
  wordTokens?: WordToken[];
}

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
  equal: number;
  totalLeft: number;
  totalRight: number;
  similarity: number;
}

export interface TextDiffResult {
  hasDifferences: boolean;
  lines: DiffLine[];
  stats: DiffStats;
  options: Required<TextDiffOptions>;
}

export const DEFAULT_DIFF_OPTIONS: Required<TextDiffOptions> = {
  mode: "line",
  ignoreWhitespace: false,
  ignoreCase: false
};

/**
 * 分割多行文本（统一 CRLF 与 LF）
 */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  // 若以换行符结尾，保留最后一行为空字符串或修剪
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * 标准化单行文本（用于对比判等）
 */
function normalizeLine(line: string, options: Required<TextDiffOptions>): string {
  let val = line;
  if (options.ignoreWhitespace) {
    val = val.replace(/\s+/g, "");
  }
  if (options.ignoreCase) {
    val = val.toLowerCase();
  }
  return val;
}

/**
 * 通用 LCS 最长公共子序列算法
 */
function computeLcs<T>(
  seqA: T[],
  seqB: T[],
  equals: (a: T, b: T) => boolean
): { op: number; itemA?: T; itemB?: T }[] {
  const m = seqA.length;
  const n = seqB.length;

  // 边界快速处理
  if (m === 0 && n === 0) return [];
  if (m === 0) return seqB.map((itemB) => ({ op: 1, itemB }));
  if (n === 0) return seqA.map((itemA) => ({ op: -1, itemA }));

  // DP 矩阵
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    const a = seqA[i - 1]!;
    for (let j = 1; j <= n; j++) {
      const b = seqB[j - 1]!;
      if (equals(a, b)) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // 回溯构建差异操作序列
  const result: { op: number; itemA?: T; itemB?: T }[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && equals(seqA[i - 1]!, seqB[j - 1]!)) {
      result.push({ op: 0, itemA: seqA[i - 1], itemB: seqB[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.push({ op: 1, itemB: seqB[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i]![j - 1]! < dp[i - 1]![j]!)) {
      result.push({ op: -1, itemA: seqA[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

/**
 * 单词与标记级切分
 */
function tokenizeWords(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]|\s+/gu);
  return matches || [text];
}

/**
 * 计算行内词级差异
 */
export function computeWordDiff(left: string, right: string, options: Required<TextDiffOptions>): WordToken[] {
  const leftTokens = tokenizeWords(left);
  const rightTokens = tokenizeWords(right);

  const tokenEquals = (a: string, b: string) => {
    let ta = a;
    let tb = b;
    if (options.ignoreWhitespace) {
      ta = ta.trim();
      tb = tb.trim();
    }
    if (options.ignoreCase) {
      ta = ta.toLowerCase();
      tb = tb.toLowerCase();
    }
    return ta === tb;
  };

  const diffs = computeLcs(leftTokens, rightTokens, tokenEquals);
  const words: WordToken[] = [];

  for (const item of diffs) {
    if (item.op === 0) {
      words.push({ type: "equal", text: item.itemB || item.itemA || "" });
    } else if (item.op === -1) {
      words.push({ type: "removed", text: item.itemA || "" });
    } else if (item.op === 1) {
      words.push({ type: "added", text: item.itemB || "" });
    }
  }

  return words;
}

/**
 * 计算两段文本的差异详情
 */
export function computeDiff(
  leftText: string,
  rightText: string,
  opts?: TextDiffOptions
): TextDiffResult {
  const options: Required<TextDiffOptions> = {
    ...DEFAULT_DIFF_OPTIONS,
    ...(opts || {})
  };

  const leftLines = splitLines(leftText);
  const rightLines = splitLines(rightText);

  const lineEquals = (a: string, b: string) => {
    return normalizeLine(a, options) === normalizeLine(b, options);
  };

  const lcsDiffs = computeLcs(leftLines, rightLines, lineEquals);

  const lines: DiffLine[] = [];
  const stats: DiffStats = {
    added: 0,
    removed: 0,
    modified: 0,
    equal: 0,
    totalLeft: leftLines.length,
    totalRight: rightLines.length,
    similarity: 100
  };

  let leftLineNo = 1;
  let rightLineNo = 1;
  let pendingRemoved: string[] = [];
  let pendingAdded: string[] = [];

  const flushPending = () => {
    const count = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let idx = 0; idx < count; idx++) {
      const hasLeft = idx < pendingRemoved.length;
      const hasRight = idx < pendingAdded.length;
      const lText = hasLeft ? pendingRemoved[idx]! : "";
      const rText = hasRight ? pendingAdded[idx]! : "";

      if (hasLeft && hasRight) {
        // 成对删除和新增视作修改行
        const wordTokens = computeWordDiff(lText, rText, options);
        lines.push({
          id: `line-${leftLineNo}-${rightLineNo}`,
          leftLineNo: leftLineNo++,
          rightLineNo: rightLineNo++,
          leftText: lText,
          rightText: rText,
          type: "modified",
          wordTokens
        });
        stats.modified++;
      } else if (hasLeft) {
        lines.push({
          id: `line-${leftLineNo}-del`,
          leftLineNo: leftLineNo++,
          rightLineNo: null,
          leftText: lText,
          rightText: "",
          type: "removed"
        });
        stats.removed++;
      } else if (hasRight) {
        lines.push({
          id: `line-add-${rightLineNo}`,
          leftLineNo: null,
          rightLineNo: rightLineNo++,
          leftText: "",
          rightText: rText,
          type: "added"
        });
        stats.added++;
      }
    }
    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const item of lcsDiffs) {
    if (item.op === 0) {
      flushPending();
      lines.push({
        id: `line-${leftLineNo}-${rightLineNo}`,
        leftLineNo: leftLineNo++,
        rightLineNo: rightLineNo++,
        leftText: item.itemA!,
        rightText: item.itemB!,
        type: "equal"
      });
      stats.equal++;
    } else if (item.op === -1) {
      pendingRemoved.push(item.itemA!);
    } else if (item.op === 1) {
      pendingAdded.push(item.itemB!);
    }
  }

  flushPending();

  const totalLines = stats.totalLeft + stats.totalRight;
  if (totalLines === 0) {
    stats.similarity = 100;
  } else {
    stats.similarity = Math.max(0, Math.min(100, Math.round(((stats.equal * 2) / totalLines) * 100)));
  }

  const hasDifferences = stats.added > 0 || stats.removed > 0 || stats.modified > 0;

  return {
    hasDifferences,
    lines,
    stats,
    options
  };
}

/**
 * 生成标准 Patch / Unified Diff 格式文本
 */
export function generateUnifiedDiff(
  leftText: string,
  rightText: string,
  fileNameA: string = "original.txt",
  fileNameB: string = "modified.txt",
  opts?: TextDiffOptions
): string {
  const result = computeDiff(leftText, rightText, opts);
  if (!result.hasDifferences) {
    return `# 两份文本内容完全一致，未检测到差异\n`;
  }

  const header = `--- ${fileNameA}\n+++ ${fileNameB}\n@@ -1,${result.stats.totalLeft} +1,${result.stats.totalRight} @@\n`;
  const body = result.lines
    .map((l) => {
      if (l.type === "equal") {
        return ` ${l.leftText}`;
      } else if (l.type === "removed") {
        return `-${l.leftText}`;
      } else if (l.type === "added") {
        return `+${l.rightText}`;
      } else {
        return `-${l.leftText}\n+${l.rightText}`;
      }
    })
    .join("\n");

  return header + body;
}

/**
 * 生成详细 Markdown 差异报告
 */
export function generateMarkdownReport(result: TextDiffResult): string {
  const { stats, lines, options } = result;

  const summary = [
    `# 📋 文本与代码差异对比分析报告`,
    ``,
    `> **对比状态**: ${result.hasDifferences ? "⚠️ 存在差异" : "✅ 内容一致"} | **文本相似度**: ${stats.similarity}%`,
    ``,
    `| 指标 | 统计数据 |`,
    `| :--- | :--- |`,
    `| 🟩 新增行数 | **${stats.added}** 行 |`,
    `| 🟥 删除行数 | **${stats.removed}** 行 |`,
    `| 🟨 修改行数 | **${stats.modified}** 行 |`,
    `| ⚪ 相同行数 | **${stats.equal}** 行 |`,
    `| 📄 左侧原行数 | **${stats.totalLeft}** 行 |`,
    `| 📄 右侧新行数 | **${stats.totalRight}** 行 |`,
    `| ⚙️ 选项配置 | 粒度: ${options.mode === "word" ? "词级" : "行级"} · ${options.ignoreWhitespace ? "忽略空白" : "包含空白"} · ${options.ignoreCase ? "忽略大小写" : "大小写敏感"} |`,
    ``,
    `---`,
    ``,
    `### 🔍 差异明细对照`,
    ``
  ];

  if (!result.hasDifferences) {
    summary.push(`*两段文本完全一致，无任何增删改动。*`);
    return summary.join("\n");
  }

  summary.push("```diff");
  for (const line of lines) {
    if (line.type === "equal") {
      summary.push(`  ${line.leftText}`);
    } else if (line.type === "removed") {
      summary.push(`- L${line.leftLineNo}: ${line.leftText}`);
    } else if (line.type === "added") {
      summary.push(`+ R${line.rightLineNo}: ${line.rightText}`);
    } else if (line.type === "modified") {
      summary.push(`- L${line.leftLineNo}: ${line.leftText}`);
      summary.push(`+ R${line.rightLineNo}: ${line.rightText}`);
    }
  }
  summary.push("```");

  return summary.join("\n");
}

/**
 * 预设快速测试示例
 */
export const SAMPLE_LEFT = `function calculateTotal(items) {
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    sum += items[i].price;
  }
  console.log("Total is: " + sum);
  return sum;
}`;

export const SAMPLE_RIGHT = `function calculateTotal(items: CartItem[]): number {
  // 使用 reduce 计算商品总价
  const sum = items.reduce((acc, curr) => acc + curr.price * curr.quantity, 0);
  console.log(\`Total amount: \${sum.toFixed(2)}\`);
  return sum;
}`;
