/**
 * 文本行级差异对比（Myers O(ND) 算法）
 *
 * 纯函数，无宿主依赖：输入两段文本，输出逐行差异、按上下文合并的差异块与统一格式（unified diff）报告。
 */

export type DiffOp = "equal" | "add" | "remove";

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** 在左侧（原文）中的行号，从 1 开始；新增行为 undefined */
  leftNo?: number;
  /** 在右侧（新文）中的行号，从 1 开始；删除行为 undefined */
  rightNo?: number;
}

export interface DiffHunk {
  leftStart: number;
  leftCount: number;
  rightStart: number;
  rightCount: number;
  lines: DiffLine[];
  added: number;
  removed: number;
}

export interface DiffResult {
  identical: boolean;
  added: number;
  removed: number;
  leftLines: number;
  rightLines: number;
  hunks: DiffHunk[];
  lines: DiffLine[];
}

export interface DiffOptions {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
  context?: number;
}

/** 单侧最多比较的行数；超过后 Myers 的最坏耗时会让界面卡顿 */
export const MAX_DIFF_LINES = 20000;

export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // 末尾换行不算作额外的一行
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function normalize(line: string, options: DiffOptions): string {
  let s = line;
  if (options.ignoreWhitespace) s = s.replace(/\s+/g, " ").trim();
  if (options.ignoreCase) s = s.toLowerCase();
  return s;
}

/**
 * Myers 最短编辑脚本，返回逐行操作序列
 */
function myers(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }
  // 回溯
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push("equal"); x--; y--; }
    if (d > 0) {
      if (x === prevX) { ops.push("add"); y--; }
      else { ops.push("remove"); x--; }
    }
  }
  return ops.reverse();
}

export function diffText(left: string, right: string, options: DiffOptions = {}): DiffResult {
  const a = splitLines(left);
  const b = splitLines(right);
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    throw new Error(`文本超过 ${MAX_DIFF_LINES} 行，暂不支持对比`);
  }
  const na = a.map((l) => normalize(l, options));
  const nb = b.map((l) => normalize(l, options));
  const ops = myers(na, nb);

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op === "equal") { lines.push({ op, text: b[j], leftNo: i + 1, rightNo: j + 1 }); i++; j++; }
    else if (op === "remove") { lines.push({ op, text: a[i], leftNo: i + 1 }); i++; removed++; }
    else { lines.push({ op, text: b[j], rightNo: j + 1 }); j++; added++; }
  }

  const context = options.context ?? 3;
  const hunks: DiffHunk[] = [];
  let idx = 0;
  while (idx < lines.length) {
    if (lines[idx].op === "equal") { idx++; continue; }
    const start = Math.max(0, idx - context);
    let end = idx;
    // 向后扩展：两个改动之间相隔不超过 2*context 行时合并为一个差异块
    while (end < lines.length) {
      if (lines[end].op !== "equal") { end++; continue; }
      let run = 0;
      while (end + run < lines.length && lines[end + run].op === "equal") run++;
      if (end + run >= lines.length || run > context * 2) { end = Math.min(lines.length, end + context); break; }
      end += run;
    }
    const slice = lines.slice(start, end);
    const firstLeft = slice.find((l) => l.leftNo !== undefined)?.leftNo;
    const firstRight = slice.find((l) => l.rightNo !== undefined)?.rightNo;
    const leftCount = slice.filter((l) => l.op !== "add").length;
    const rightCount = slice.filter((l) => l.op !== "remove").length;
    hunks.push({
      leftStart: firstLeft ?? (slice.find((l) => l.rightNo !== undefined)?.rightNo ?? 1) - 1,
      leftCount,
      rightStart: firstRight ?? (firstLeft ?? 1) - 1,
      rightCount,
      lines: slice,
      added: slice.filter((l) => l.op === "add").length,
      removed: slice.filter((l) => l.op === "remove").length
    });
    idx = end;
  }

  return { identical: added === 0 && removed === 0, added, removed, leftLines: a.length, rightLines: b.length, hunks, lines };
}

function hunkHeader(h: DiffHunk): string {
  return `@@ -${h.leftStart},${h.leftCount} +${h.rightStart},${h.rightCount} @@`;
}

export function formatHunk(h: DiffHunk): string {
  const body = h.lines.map((l) => (l.op === "add" ? "+" : l.op === "remove" ? "-" : " ") + l.text).join("\n");
  return `${hunkHeader(h)}\n${body}`;
}

/** 统一格式（unified diff）报告，可直接粘贴到代码评审或 git apply */
export function formatUnifiedDiff(result: DiffResult, leftName = "左侧", rightName = "右侧"): string {
  if (result.identical) return "";
  return [`--- ${leftName}`, `+++ ${rightName}`, ...result.hunks.map(formatHunk)].join("\n");
}

export function describeHunk(h: DiffHunk): string {
  const parts: string[] = [];
  if (h.removed) parts.push(`删除 ${h.removed} 行`);
  if (h.added) parts.push(`新增 ${h.added} 行`);
  return parts.join("，");
}
