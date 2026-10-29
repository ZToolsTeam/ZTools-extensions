/**
 * ZTools 文本排版与格式化核心逻辑 (纯函数)
 */
import { ST_CHARACTERS, ST_PHRASES, TS_CHARACTERS, TS_PHRASES } from "./opencc-dict.js";

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  lines: number;
  nonEmptyLines: number;
  hasChinese: boolean;
}

export interface FormatOptions {
  indentSize?: number;
  sentencesPerParagraph?: number;
}

const CJK_RANGE = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";
const CJK_REGEX = new RegExp(`[${CJK_RANGE}]`);

/** 规范化行尾为 LF */
export function normalizeLineEndings(text: string): string {
  if (typeof text !== "string") return "";
  return text.replace(/\r\n?/g, "\n");
}

/**
 * 1. 大小写转换
 */
export function toUpperCase(text: string): string {
  return (text || "").toUpperCase();
}

export function toLowerCase(text: string): string {
  return (text || "").toLowerCase();
}

const LOWER_TITLE_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of", "on", "or", "the", "to", "with", "is"
]);

export function toTitleCase(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[A-Za-z][A-Za-z'’-]*/g, (word, offset: number, all: string) => {
      // 每行第一个单词总是大写（多行标题列表里行首的 the / a 也要大写）
      const lineStart = all.lastIndexOf("\n", offset - 1) + 1;
      if (all.slice(lineStart, offset).trim() && LOWER_TITLE_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
}

export function toSentenceCase(text: string): string {
  const lowered = (text || "").toLowerCase();
  return lowered.replace(/(^\s*[a-z]|[.!?]\s+[a-z])/g, (match) => match.toUpperCase());
}

/**
 * 命名风格转换的分词：按驼峰边界（userName、HTTPServer、v2Beta）与非 ASCII 字母数字字符切分。
 * 命名风格只对 ASCII 标识符有意义，中文、标点、Emoji 作为分隔符丢弃。
 */
function identifierWords(line: string): string[] {
  return line
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** 逐行转换命名风格：每行是一个标识符，空行保留，行数不变；全部行都没有可用单词时返回空串 */
function convertIdentifierLines(text: string, join: (words: string[]) => string): string {
  const lines = normalizeLineEndings(text || "").split("\n").map((line) => {
    const words = identifierWords(line);
    return words.length ? join(words) : "";
  });
  return lines.some(Boolean) ? lines.join("\n") : "";
}

const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export function toCamelCase(text: string): string {
  return convertIdentifierLines(text, (words) => words[0].toLowerCase() + words.slice(1).map(capitalize).join(""));
}

export function toSnakeCase(text: string): string {
  return convertIdentifierLines(text, (words) => words.map((w) => w.toLowerCase()).join("_"));
}

export function toKebabCase(text: string): string {
  return convertIdentifierLines(text, (words) => words.map((w) => w.toLowerCase()).join("-"));
}

/**
 * 2. 全半角互转
 */
export function toHalfWidth(text: string): string {
  if (!text) return "";
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x3000) {
      // 全角空格
      result += " ";
    } else if (code >= 0xff01 && code <= 0xff5e) {
      // 全角ASCII
      result += String.fromCharCode(code - 0xfee0);
    } else {
      result += text[i];
    }
  }
  return result;
}

export function toFullWidth(text: string): string {
  if (!text) return "";
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0020) {
      // 半角空格
      result += "\u3000";
    } else if (code >= 0x0021 && code <= 0x007e) {
      // 半角ASCII
      result += String.fromCharCode(code + 0xfee0);
    } else {
      result += text[i];
    }
  }
  return result;
}

/**
 * 3. 标点中英文切换
 */
const CJK_CHAR_REGEX = new RegExp(`[${CJK_RANGE}]`);
/** 全角标点、CJK 符号与中文引号 */
const FULL_PUNCT_REGEX = /[　-〿＀-￯“”‘’…—]/;

function isCjk(ch: string | undefined): boolean {
  return ch !== undefined && CJK_CHAR_REGEX.test(ch);
}

function isFullPunct(ch: string | undefined): boolean {
  return ch !== undefined && FULL_PUNCT_REGEX.test(ch);
}

/**
 * 不参与标点转换的片段：行内代码、网址、邮箱。
 * 网址到空白、中文或全角标点为止；末尾的半角句读（如句末的 . ,）不算网址的一部分。
 */
const URL_BODY = `[^\\s<>"'\`，。！？；：、（）【】《》「」『』${CJK_RANGE}]`;
const PROTECTED_REGEX = new RegExp(
  [
    "`[^`\\n]+`",
    `(?:https?|ftp)://${URL_BODY}+`,
    `www\\.${URL_BODY}+`,
    "[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+"
  ].join("|"),
  "g"
);
const URL_TRAILING_PUNCT_REGEX = /[.,;:!?)\]]+$/;

/** 对受保护片段以外的文本执行 convert，受保护片段原样保留 */
function mapUnprotected(text: string, convert: (segment: string) => string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(PROTECTED_REGEX)) {
    const index = match.index ?? 0;
    const token = match[0].startsWith("`") ? match[0] : match[0].replace(URL_TRAILING_PUNCT_REGEX, "");
    if (!token || index < last) continue;
    out += convert(text.slice(last, index)) + token;
    last = index + token.length;
  }
  return out + convert(text.slice(last));
}

/** 从 index 出发按 step 方向找最近的非空格字符（只跳过同一行的空格与制表符，最多看 8 个字符） */
function nearestNonSpace(text: string, index: number, step: 1 | -1): string | undefined {
  for (let i = index, n = 0; i >= 0 && i < text.length && n < 8; i += step, n++) {
    const ch = text[i];
    if (ch !== " " && ch !== "\t") return ch;
  }
  return undefined;
}

const ZH_PUNCT: Record<string, string> = { ",": "，", ".": "。", "!": "！", "?": "？", ":": "：", ";": "；" };

function segmentToChinesePunctuation(segment: string): string {
  return (
    segment
      // 成对括号里有中文才转换，f(x)、(./a.md) 这类保留；方括号后紧跟 ( 是 Markdown 链接，不转换
      .replace(/\(([^()\n]*)\)/g, (match, inner: string) => (CJK_CHAR_REGEX.test(inner) ? `（${inner}）` : match))
      .replace(/\[([^[\]\n]*)\](?!\()/g, (match, inner: string, offset: number, all: string) =>
        CJK_CHAR_REGEX.test(inner) && all[offset - 1] !== "!" ? `【${inner}】` : match
      )
      // 句读：只转换紧挨中文的标点，3.14、example.com、a?b=1,c、12:30 这类不动。
      // 点号只看左右紧邻的字符；其余标点可隔着空格判断（如「你好 , 世界」）
      .replace(/([,.!?:;])\1*/g, (run: string, ch: string, offset: number, all: string) => {
        const prev = ch === "." ? all[offset - 1] : nearestNonSpace(all, offset - 1, -1);
        const next = ch === "." ? all[offset + run.length] : nearestNonSpace(all, offset + run.length, 1);
        if (!isCjk(prev) && !isCjk(next)) return run;
        if (ch === "." && run.length > 1) return "……";
        return ZH_PUNCT[ch].repeat(run.length);
      })
  );
}

export function toChinesePunctuation(text: string): string {
  if (!text) return "";
  return mapUnprotected(text, segmentToChinesePunctuation);
}

const EN_PUNCT: Record<string, string> = {
  "，": ",", "。": ".", "！": "!", "？": "?", "：": ":", "；": ";",
  "（": "(", "）": ")", "【": "[", "】": "]", "《": "<", "》": ">"
};
const EN_OPENERS = new Set(["（", "【", "《"]);
/** 后面是这些字符时，转换出的半角标点后不补空格 */
const NO_SPACE_BEFORE_REGEX = /[\s,.;:!?)\]>，。！？：；）】》（【《"'”’]/;
/** 前面是这些字符时，转换出的左括号前不补空格 */
const NO_SPACE_AFTER_REGEX = /[\s([<（【《"'“‘]/;

/**
 * 中文标点转英文标点：只在原本是全角标点的位置按英文习惯补空格，
 * 行尾、文末与相邻标点处不补；原文里的半角标点（3.14、网址）保持不变
 */
export function toEnglishPunctuation(text: string): string {
  if (!text) return "";
  return text.replace(/[，。！？：；（）【】《》]/g, (ch: string, offset: number, all: string) => {
    const ascii = EN_PUNCT[ch];
    if (EN_OPENERS.has(ch)) {
      const prev = all[offset - 1];
      return prev !== undefined && !NO_SPACE_AFTER_REGEX.test(prev) ? ` ${ascii}` : ascii;
    }
    const next = all[offset + 1];
    return next !== undefined && !NO_SPACE_BEFORE_REGEX.test(next) ? `${ascii} ` : ascii;
  });
}

/**
 * 4. Markdown 自动排版与中文智能排版
 */
export function collapseInlineSpaces(text: string): string {
  return (text || "").replace(/[\t 　 ]+/g, " ");
}

/** 去掉中文之间、中文与全角标点之间的空格（只处理同一行内的空格，不删换行） */
export function removeSpacesAroundCjk(text: string): string {
  return (text || "")
    .replace(new RegExp(`([${CJK_RANGE}])[ \\t]+(?=[${CJK_RANGE}])`, "g"), "$1")
    .replace(new RegExp(`([${CJK_RANGE}])[ \\t]+([，。！？；：、）】》」』])`, "g"), "$1$2")
    .replace(new RegExp(`([（【《「『])[ \\t]+([${CJK_RANGE}])`, "g"), "$1$2");
}

export function normalizeCjkSpacing(text: string): string {
  return removeSpacesAroundCjk(collapseInlineSpaces(text || ""))
    .replace(new RegExp(`([${CJK_RANGE}])([A-Za-z0-9])`, "g"), "$1 $2")
    .replace(new RegExp(`([A-Za-z0-9])([${CJK_RANGE}])`, "g"), "$1 $2");
}

/**
 * 把多段文本接起来：相邻两段两侧都是中文、或任一侧是全角标点时直接相连，
 * 否则补一个空格，避免英文单词、数字粘在一起（一次 join，避免长文本反复拼接）
 */
function joinText(parts: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (out.length) {
      const prev = out[out.length - 1];
      const a = prev[prev.length - 1];
      const b = part[0];
      if (!(isFullPunct(a) || isFullPunct(b) || (isCjk(a) && isCjk(b)))) out.push(" ");
    }
    out.push(part);
  }
  return out.join("");
}

/** 按句末标点切句：全角 。！？； 一律切；半角 !?; 只有后面是空白或文末时才切（网址里的 a?b=1 不切） */
function splitSentences(paragraph: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < paragraph.length; i++) {
    const ch = paragraph[i];
    const isEnd =
      "。！？；".includes(ch) || ("!?;".includes(ch) && (i + 1 === paragraph.length || /\s/.test(paragraph[i + 1])));
    if (!isEnd) continue;
    let end = i + 1;
    while (end < paragraph.length && /[。！？；!?”’」』）]/.test(paragraph[end])) end++;
    sentences.push(paragraph.slice(start, end).trim());
    start = end;
    i = end - 1;
  }
  sentences.push(paragraph.slice(start).trim());
  return sentences.filter(Boolean);
}

/** Markdown 结构行（标题、列表、引用、分隔线、代码围栏、表格）：保持独立成行，不与正文合并、不缩进 */
const MD_STRUCTURE_REGEX = /^(?:#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>|```|~~~|\|)|^([-*_])(?:\s*\1){2,}\s*$/;

interface SmartBlock {
  text: string;
  structural: boolean;
}

/** 空行是段落边界；段内硬换行按语种接起来后，每 N 句分为一段；Markdown 结构行原样保留 */
function buildSmartBlocks(text: string, sentencesPerParagraph: number): SmartBlock[] {
  const size = Math.max(1, Math.floor(sentencesPerParagraph) || 1);
  const blocks: SmartBlock[] = [];
  let prose: string[] = [];
  let structure: string[] = [];
  const flushProse = () => {
    if (!prose.length) return;
    const sentences = splitSentences(joinText(prose));
    for (let index = 0; index < sentences.length; index += size) {
      blocks.push({
        text: joinText(sentences.slice(index, index + size)),
        structural: false
      });
    }
    prose = [];
  };
  const flushStructure = () => {
    if (!structure.length) return;
    blocks.push({ text: structure.join("\n"), structural: true });
    structure = [];
  };
  for (const line of trimLines(text || "").split("\n")) {
    if (!line) {
      flushProse();
      flushStructure();
    } else if (MD_STRUCTURE_REGEX.test(line)) {
      flushProse();
      structure.push(line);
    } else {
      flushStructure();
      prose.push(line);
    }
  }
  flushProse();
  flushStructure();
  return blocks;
}

export function splitChineseParagraphs(text: string, sentencesPerParagraph = 3): string {
  return buildSmartBlocks(text, sentencesPerParagraph)
    .map((block) => block.text)
    .join("\n\n");
}

export function indentParagraphFirstLine(text: string, indentSize = 2): string {
  const indent = "　".repeat(Math.max(0, Math.floor(indentSize)));
  return normalizeLineEndings(text || "")
    .split(/\n{2,}/)
    .map((paragraph) => {
      const lines = paragraph.split("\n");
      const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
      if (firstContentIndex === -1) return paragraph;

      return lines
        .map((line, index) => {
          if (index !== firstContentIndex) return line;
          return `${indent}${line.trimStart()}`;
        })
        .join("\n");
    })
    .join("\n\n");
}

export function formatChineseSmart(text: string, options: FormatOptions = {}): string {
  const indentSize = options.indentSize ?? 2;
  const sentencesPerParagraph = options.sentencesPerParagraph ?? 3;
  const indent = "　".repeat(Math.max(0, Math.floor(indentSize)));
  const normalized = normalizeCjkSpacing(toChinesePunctuation(text || ""));
  return buildSmartBlocks(normalized, sentencesPerParagraph)
    .map((block) => (block.structural ? block.text : `${indent}${block.text}`))
    .join("\n\n");
}

const FENCE_OPEN_REGEX = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_REGEX = /^ {0,3}(`{3,}|~{3,})\s*$/;
const HR_REGEX = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;

/** 「-」「*」「+」后面的内容像列表正文才补空格：排除 **粗体、--选项、-1 负数、+86、*斜体*、-> 箭头 */
function looksLikeListItem(marker: string, rest: string): boolean {
  if (/^[-*+_=<>~\d]/.test(rest)) return false;
  if (marker === "*" && rest.includes("*")) return false;
  return true;
}

/**
 * Markdown 自动排版：# 标题、- * + 列表符号后补空格，去掉行尾空白，连续空行合并为一行。
 * 代码块（``` / ~~~）内的内容原样保留；分隔线、粗体、负数等不当作列表处理
 */
export function formatMarkdown(text: string): string {
  if (!text) return "";
  const out: string[] = [];
  let fence: string | null = null;
  let blankRun = 0;
  for (const line of normalizeLineEndings(text).split("\n")) {
    if (fence) {
      out.push(line);
      const close = line.match(FENCE_CLOSE_REGEX);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const trimmed = line.trimEnd();
    if (!trimmed) {
      blankRun++;
      if (blankRun <= 1) out.push("");
      continue;
    }
    blankRun = 0;
    const open = trimmed.match(FENCE_OPEN_REGEX);
    if (open) {
      fence = open[1];
      out.push(trimmed);
      continue;
    }
    if (HR_REGEX.test(trimmed)) {
      out.push(trimmed);
      continue;
    }
    const header = trimmed.match(/^(#{1,6})([^#\s].*)$/);
    if (header) {
      out.push(`${header[1]} ${header[2]}`);
      continue;
    }
    const list = trimmed.match(/^(\s*)([-*+])(\S.*)$/);
    if (list && looksLikeListItem(list[2], list[3])) {
      out.push(`${list[1]}${list[2]} ${list[3]}`);
      continue;
    }
    out.push(trimmed);
  }
  return out.join("\n");
}

/**
 * 5. 行操作与去重排序
 */
export function trimLines(text: string): string {
  return normalizeLineEndings(text || "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}

export function removeEmptyLines(text: string): string {
  return normalizeLineEndings(text || "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

export function dedupeLines(text: string): string {
  const seen = new Set<string>();
  return normalizeLineEndings(text || "")
    .split("\n")
    .filter((line) => {
      const key = line.trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
}

export function sortLines(text: string, order: "asc" | "desc" = "asc"): string {
  const lines = normalizeLineEndings(text || "").split("\n");
  lines.sort((left, right) => left.localeCompare(right, "zh-CN"));
  if (order === "desc") lines.reverse();
  return lines.join("\n");
}

export function reverseLines(text: string): string {
  return normalizeLineEndings(text || "").split("\n").reverse().join("\n");
}

export function addLineNumbers(text: string): string {
  if (!text) return "";
  return normalizeLineEndings(text)
    .split("\n")
    .map((line, index) => `${String(index + 1).padStart(2, "0")}. ${line}`)
    .join("\n");
}

export function removeLineNumbers(text: string): string {
  // 只认「数字 + . ) 、」形式的行号（如 01. / 1) / 1、），「3 apples」「2024 年」「3.14」开头的正文不动
  return normalizeLineEndings(text || "")
    .split("\n")
    .map((line) => line.replace(/^\s*\d+[.)、．）](?!\d)[ \t　]*/, ""))
    .join("\n");
}

/**
 * 6. 繁简转换（OpenCC 字表 + 词组表，最长词组优先匹配，处理一简对多繁）
 */
interface ChineseConverter {
  chars: Map<string, string>;
  phrases: Map<string, string>;
  /** 以某字开头的词组的最大长度（UTF-16 单位） */
  maxPhraseLength: Map<string, number>;
}

function parseDict(data: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of data.split("|")) {
    const space = entry.indexOf(" ");
    if (space > 0) map.set(entry.slice(0, space), entry.slice(space + 1));
  }
  return map;
}

function buildConverter(chars: string, phrases: string): ChineseConverter {
  const phraseMap = parseDict(phrases);
  const maxPhraseLength = new Map<string, number>();
  for (const key of phraseMap.keys()) {
    const first = String.fromCodePoint(key.codePointAt(0) ?? 0);
    maxPhraseLength.set(first, Math.max(maxPhraseLength.get(first) ?? 0, key.length));
  }
  return { chars: parseDict(chars), phrases: phraseMap, maxPhraseLength };
}

let simpToTrad: ChineseConverter | null = null;
let tradToSimp: ChineseConverter | null = null;

function convertChinese(text: string, converter: ChineseConverter): string {
  const parts: string[] = [];
  let plainStart = 0;
  let i = 0;
  outer: while (i < text.length) {
    const code = text.codePointAt(i) ?? 0;
    const width = code > 0xffff ? 2 : 1;
    // 字典里没有 U+2E80 以下的字符，ASCII 等直接跳过
    if (code < 0x2e80) {
      i += width;
      continue;
    }
    const ch = text.slice(i, i + width);
    const maxLength = converter.maxPhraseLength.get(ch);
    if (maxLength) {
      for (let length = Math.min(maxLength, text.length - i); length > width; length--) {
        const hit = converter.phrases.get(text.slice(i, i + length));
        if (hit !== undefined) {
          parts.push(text.slice(plainStart, i), hit);
          i += length;
          plainStart = i;
          continue outer;
        }
      }
    }
    const mapped = converter.chars.get(ch);
    if (mapped !== undefined) {
      parts.push(text.slice(plainStart, i), mapped);
      plainStart = i + width;
    }
    i += width;
  }
  parts.push(text.slice(plainStart));
  return parts.join("");
}

export function convertToTraditional(text: string): string {
  if (!text) return "";
  simpToTrad ??= buildConverter(ST_CHARACTERS, ST_PHRASES);
  return convertChinese(text, simpToTrad);
}

export function convertToSimplified(text: string): string {
  if (!text) return "";
  tradToSimp ??= buildConverter(TS_CHARACTERS, TS_PHRASES);
  return convertChinese(text, tradToSimp);
}

/**
 * 7. 文本信息统计
 */
export function getTextStats(text: string): TextStats {
  const normalized = normalizeLineEndings(text || "");
  const trimmed = normalized.trim();
  const lines = normalized ? normalized.split("\n").length : 0;
  const nonEmptyLines = normalized
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
  const words = trimmed
    ? trimmed.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)?|[\u3400-\u9fff]/g)?.length || 0
    : 0;

  return {
    characters: normalized.length,
    charactersNoSpaces: normalized.replace(/\s/g, "").length,
    words,
    lines,
    nonEmptyLines,
    hasChinese: CJK_REGEX.test(normalized)
  };
}
