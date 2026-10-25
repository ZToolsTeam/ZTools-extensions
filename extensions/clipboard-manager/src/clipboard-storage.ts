import { LocalStorage } from "@ztools/declarative-ui";
import { getDeclarativeBridge } from "@ztools/declarative-ui";
import { Clipboard } from "@ztools/declarative-ui";
import { hostUpgradeError, isHostMethodMissing, updateStorageItem } from "./host-compat.js";
import {
  callHostTransport,
  isRealElectronHost,
  readRealClipboardText
} from "./native-ipc.js";
import {
  ClipboardItem,
  ClipboardFilterOptions,
  ClipboardContentType,
  ClipboardPreferences,
  PasteSequenceState
} from "./types.js";

const STORAGE_KEY = "ztools:clipboard:history";
const PREFS_STORAGE_KEY = "ztools:clipboard:preferences";
const SAMPLE_IDS = new Set(["clip-1", "clip-2", "clip-3", "clip-4", "clip-5"]);

/**
 * 计算字符串的香农信息熵 (Shannon Entropy)
 * 用于高熵密码、API Key、Token 脱敏识别
 */
export function calculateShannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;
  const frequencies = new Map<string, number>();
  for (const char of str) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }
  let entropy = 0;
  const len = str.length;
  for (const count of frequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const NON_SECRET_TYPES = new Set<ClipboardContentType>(["link", "json", "files", "color", "code", "image"]);

const charClass = (ch: string) => (/[a-z]/.test(ch) ? 0 : /[A-Z]/.test(ch) ? 1 : /\d/.test(ch) ? 2 : 3);

/**
 * 单个无空白词是否可能是随机生成的密钥：
 * 先排除结构化内容（链接、路径、JSON、邮箱、域名、带点的版本号/文件名），
 * 再要求字母与至少 2 个数字混排，且相邻字符的类别（小写/大写/数字/符号）频繁切换——
 * 随机串约一半以上的相邻字符类别不同，FX3-LEGACY-PINNED、report2024-final-v3 这类人写的标识只有约 0.3
 */
function looksLikeSecretToken(token: string): boolean {
  if (NON_SECRET_TYPES.has(detectClipboardContentType(token))) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token) || /^(?:www\.|mailto:)/i.test(token)) return false; // 各类协议链接
  if (/^(?:~|\.{1,2})?\//.test(token) || /^[a-zA-Z]:[\\/]/.test(token)) return false; // 文件路径
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(token)) return false; // 邮箱
  if (/^[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:[/:?#]\S*)?$/i.test(token)) return false; // 域名 / 不带协议的网址
  if (token.includes(".")) return false;
  if (!/[A-Za-z]/.test(token) || (token.match(/\d/g) || []).length < 2) return false;
  let switches = 0;
  for (let i = 1; i < token.length; i++) {
    if (charClass(token[i]) !== charClass(token[i - 1])) switches++;
  }
  return switches / (token.length - 1) >= 0.4;
}

/**
 * 敏感内容安全脱敏识别与遮罩 (OpenAI Key, GitHub Token, AWS, Private Key, JWT, High-Entropy Passwords)
 */
export function maskSensitiveContent(text: string): { isSensitive: boolean; masked: string; reason?: string } {
  if (!text || typeof text !== "string") {
    return { isSensitive: false, masked: text };
  }

  let masked = text;
  let isSensitive = false;
  let reason: string | undefined;

  // 1. OpenAI / Anthropic / AI API Keys (sk-..., sk-ant-...)
  if (/sk-[a-zA-Z0-9_-]{20,}/.test(masked) || /sk-ant-[a-zA-Z0-9_-]{20,}/.test(masked)) {
    isSensitive = true;
    reason = "API Key";
    masked = masked.replace(/(sk-(?:ant-)?[a-zA-Z0-9]{4})[a-zA-Z0-9_-]{12,}([a-zA-Z0-9]{4})/g, "$1••••••••$2");
  }

  // 2. GitHub Personal Access Token (ghp_..., gho_..., github_pat_...)
  if (/gh[pousr]_[a-zA-Z0-9]{20,}/.test(masked) || /github_pat_[a-zA-Z0-9_]{20,}/.test(masked)) {
    isSensitive = true;
    reason = "GitHub Token";
    masked = masked.replace(/(gh[pousr]_[a-zA-Z0-9]{4})[a-zA-Z0-9]{16,}([a-zA-Z0-9]{4})/g, "$1••••••••$2");
  }

  // 3. AWS Access Key (AKIA...)
  if (/AKIA[0-9A-Z]{16}/.test(masked)) {
    isSensitive = true;
    reason = "AWS Access Key";
    masked = masked.replace(/(AKIA[0-9A-Z]{4})[0-9A-Z]{8}([0-9A-Z]{4})/g, "$1••••••••$2");
  }

  // 4. RSA / EC Private Keys
  if (/-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(masked)) {
    isSensitive = true;
    reason = "Private Key";
    masked = masked.replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[^]+?-----END [A-Z ]+PRIVATE KEY-----/g, "[PROTECTED PRIVATE KEY ••••••••]");
  }

  // 5. JWT Tokens
  if (/ey[A-Za-z0-9_-]{12,}\.ey[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{10,}/.test(masked)) {
    isSensitive = true;
    reason = "JWT Token";
    masked = masked.replace(/(ey[A-Za-z0-9_-]{6})[A-Za-z0-9_-]{6,}(\.ey[A-Za-z0-9_-]{6})[A-Za-z0-9_-]{6,}(\.[A-Za-z0-9_-]{6})[A-Za-z0-9_-]{4,}/g, "$1••••$2••••$3••••");
  }

  // 6. High-entropy single-token secrets（只针对纯文本里像密钥的单个词：链接、JSON、路径、颜色、邮箱、域名不按熵判定）
  const trimmed = text.trim();
  if (
    !isSensitive &&
    trimmed.length >= 16 &&
    trimmed.length <= 128 &&
    !/\s/.test(trimmed) &&
    looksLikeSecretToken(trimmed)
  ) {
    const entropy = calculateShannonEntropy(trimmed);
    if (entropy >= 3.6) {
      isSensitive = true;
      reason = "High-Entropy Secret";
      const start = trimmed.slice(0, 4);
      const end = trimmed.slice(-4);
      masked = `${start}••••••••${end}`;
    }
  }

  return { isSensitive, masked, reason };
}

/**
 * 智能识别剪贴板内容类型 (Smart Content Detection)
 */
export function detectClipboardContentType(content: string, rawFormat?: string): ClipboardContentType {
  if (rawFormat === "image" || content.startsWith("data:image/")) return "image";
  if (rawFormat === "files") return "files";

  const trimmed = content.trim();

  // 1. 颜色代码检测
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return "color";
  }
  if (/^(?:rgb|rgba|hsl|hsla)\(\s*[\d.%\s,]+\)$/i.test(trimmed)) {
    return "color";
  }

  // 2. 链接检测
  if (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(trimmed)) {
    return "link";
  }

  // 3. JSON 数据检测
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // not valid JSON
    }
  }

  // 4. 代码结构检测
  const codePatterns = [
    /\b(?:const|let|var|function|class|import|export|interface|type)\s+[a-zA-Z0-9_$]+/,
    /\b(?:def|public|private|protected|void|int|return|async|await)\b/,
    /=>|\{|\};|<!--|<div|<\/|console\.log/,
    /\b(?:fn|pub|impl|struct|enum|match)\b/
  ];
  if (codePatterns.some((p) => p.test(content)) && (content.includes("\n") || content.includes("{"))) {
    return "code";
  }

  // 5. Windows / Unix 文件路径检测
  if (/^[a-zA-Z]:\\[^\0\n]+/.test(trimmed) || (trimmed.startsWith("/") && trimmed.includes("/"))) {
    if (!trimmed.includes(" ") || trimmed.includes("\\")) {
      return "files";
    }
  }

  return "text";
}

const clampNumber = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const toHex2 = (n: number) => Math.round(clampNumber(n, 0, 255)).toString(16).padStart(2, "0").toUpperCase();
const formatAlpha = (a: number) => String(Math.round(a * 100) / 100);

/**
 * 标准 RGB → HSL 换算（h 0-360，s/l 0-100，均取整）
 */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = clampNumber(r, 0, 255) / 255;
  const gn = clampNumber(g, 0, 255) / 255;
  const bn = clampNumber(b, 0, 255) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sn = clampNumber(s, 0, 100) / 100;
  const ln = clampNumber(l, 0, 100) / 100;
  const hn = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  const [r1, g1, b1] =
    hn < 60 ? [c, x, 0] : hn < 120 ? [x, c, 0] : hn < 180 ? [0, c, x] : hn < 240 ? [0, x, c] : hn < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

function parseColorChannels(input: string): { r: number; g: number; b: number; a: number } | null {
  const t = input.trim();
  const hex = t.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    };
  }
  const fn = t.match(/^(rgba?|hsla?)\(\s*([^)]*)\)$/i);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const num = (v: string) => (/^-?\d*\.?\d+%?$/.test(v) ? parseFloat(v) : NaN);
  const alphaOf = (v?: string) => {
    if (v === undefined) return 1;
    const n = num(v);
    return v.endsWith("%") ? n / 100 : n;
  };
  const a = alphaOf(parts[3]);
  if (!Number.isFinite(a)) return null;
  if (fn[1].toLowerCase().startsWith("rgb")) {
    const ch = parts.slice(0, 3).map((v) => (v.endsWith("%") ? (num(v) / 100) * 255 : num(v)));
    if (ch.some((n) => !Number.isFinite(n))) return null;
    return { r: clampNumber(Math.round(ch[0]), 0, 255), g: clampNumber(Math.round(ch[1]), 0, 255), b: clampNumber(Math.round(ch[2]), 0, 255), a: clampNumber(a, 0, 1) };
  }
  const [h, sat, light] = parts.slice(0, 3).map(num);
  if (![h, sat, light].every(Number.isFinite)) return null;
  return { ...hslToRgb(h, sat, light), a: clampNumber(a, 0, 1) };
}

/**
 * 解析颜色详情并计算换算值（支持 #RGB / #RGBA / #RRGGBB / #RRGGBBAA、rgb()/rgba()、hsl()/hsla()）
 */
export function parseColorDetails(colorStr: string): { hex: string; rgb: string; hsl: string } | null {
  if (typeof colorStr !== "string") return null;
  const c = parseColorChannels(colorStr);
  if (!c) return null;
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  const hasAlpha = c.a < 1;
  return {
    hex: `#${toHex2(c.r)}${toHex2(c.g)}${toHex2(c.b)}${hasAlpha ? toHex2(c.a * 255) : ""}`,
    rgb: hasAlpha ? `rgba(${c.r}, ${c.g}, ${c.b}, ${formatAlpha(c.a)})` : `rgb(${c.r}, ${c.g}, ${c.b})`,
    hsl: hasAlpha ? `hsla(${h}, ${s}%, ${l}%, ${formatAlpha(c.a)})` : `hsl(${h}, ${s}%, ${l}%)`
  };
}

export const SAMPLE_CLIPBOARD_ITEMS: ClipboardItem[] = [
  {
    id: "clip-1",
    type: "code",
    content: "function calculateFrecency(views: number, lastViewed: number): number {\n  const decay = Math.exp(-(Date.now() - lastViewed) / (86400000 * 7));\n  return views * decay;\n}",
    preview: "function calculateFrecency(views: number, lastViewed: number)...",
    copiedAt: Date.now() - 1000 * 10, // 10s ago, most recent pinned item
    pinned: true,
    charCount: 168,
    wordCount: 18,
    lineCount: 4,
    sourceAppName: "VSCode"
  },
  {
    id: "clip-color-1",
    type: "color",
    content: "#3B82F6",
    preview: "颜色代码 #3B82F6 (Tailwind Blue 500)",
    colorHex: "#3B82F6",
    copiedAt: Date.now() - 1000 * 60 * 2, // 2 mins ago
    pinned: true,
    charCount: 7,
    wordCount: 1,
    lineCount: 1,
    sourceAppName: "Figma"
  },
  {
    id: "clip-json-1",
    type: "json",
    content: JSON.stringify({ name: "ZTools", version: "1.1.7", architecture: "Electron 43 + Rust Sidecar", features: ["MFT-Search", "UIAccess", "Declarative-UI"] }, null, 2),
    preview: "JSON 配置: { name: 'ZTools', version: '1.1.7'... }",
    copiedAt: Date.now() - 1000 * 60 * 5, // 5 mins ago
    pinned: false,
    charCount: 152,
    wordCount: 12,
    lineCount: 7,
    sourceAppName: "Terminal"
  },
  {
    id: "clip-2",
    type: "link",
    content: "https://github.com/microsoft/terminal",
    preview: "https://github.com/microsoft/terminal",
    copiedAt: Date.now() - 1000 * 60 * 15, // 15 mins ago
    pinned: false,
    charCount: 38,
    wordCount: 1,
    lineCount: 1,
    sourceAppName: "Edge"
  },
  {
    id: "clip-3",
    type: "text",
    content: "ZTools Windows 剪贴板历史与现代化架构解构：轻量 TypeScript 宿主通过命名管道调度 Rust UIAccess 特权进程与 NTFS MFT 极速索引引擎。",
    preview: "ZTools Windows 剪贴板历史与现代化架构解构：轻量 TypeScript 宿主通过命名管道调度...",
    copiedAt: Date.now() - 1000 * 60 * 45, // 45 mins ago
    pinned: false,
    charCount: 84,
    wordCount: 22,
    lineCount: 1,
    sourceAppName: "Notion"
  },
  {
    id: "clip-4",
    type: "files",
    content: "C:\\Windows\\System32\\drivers\\etc\\hosts\nC:\\Windows\\System32\\cmd.exe",
    preview: "2 个系统文件 (hosts, cmd.exe)",
    copiedAt: Date.now() - 1000 * 60 * 120, // 2 hours ago
    pinned: false,
    filePaths: [
      "C:\\Windows\\System32\\drivers\\etc\\hosts",
      "C:\\Windows\\System32\\cmd.exe"
    ],
    charCount: 65,
    wordCount: 2,
    lineCount: 2,
    sourceAppName: "Explorer"
  },
  {
    id: "clip-5",
    type: "image",
    content: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    preview: "屏幕截图 [1920x1080 PNG]",
    copiedAt: Date.now() - 1000 * 60 * 360, // 6 hours ago
    pinned: false,
    imageDimensions: { width: 1920, height: 1080 },
    sourceAppName: "Snipaste"
  }
];

// 简单轻量拼音首字母映射辅助 (用于支持剪贴板常用中文首字母拼音快速检索)
const PINYIN_INITIALS_MAP: Record<string, string> = {
  剪: "j", 贴: "t", 板: "b", 历: "l", 史: "s",
  快: "k", 捷: "j", 短: "d", 语: "y", 设: "s", 置: "z",
  颜: "y", 色: "s", 代: "d", 码: "m", 文: "w", 件: "j",
  链: "l", 接: "j", 图: "t", 片: "p", 纯: "c", 本: "b",
  深: "s", 度: "d", 逆: "n", 向: "x", 解: "j", 构: "g"
};

function getPinyinInitials(str: string): string {
  let initials = "";
  for (const ch of str) {
    if (PINYIN_INITIALS_MAP[ch]) {
      initials += PINYIN_INITIALS_MAP[ch];
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      initials += ch.toLowerCase();
    }
  }
  return initials;
}

/**
 * 流水粘贴状态机 (Raycast 对齐实现)
 */
export class PasteSequenceManager {
  private offset = 0;
  private lastInvocation: number | null = null;
  private topItemId: string | null = null;
  private lastPastedId: string | null = null;
  private timeoutSeconds = 60;

  constructor(timeoutSeconds = 60) {
    this.timeoutSeconds = timeoutSeconds;
  }

  public setTimeoutSeconds(timeout: number): void {
    this.timeoutSeconds = timeout;
  }

  public pasteNext(
    items: ClipboardItem[],
    options: { addNewLine?: boolean } = {}
  ): {
    item: ClipboardItem | null;
    remaining: number;
    offset: number;
  } {
    const now = Date.now();
    if (this.lastInvocation && now - this.lastInvocation > this.timeoutSeconds * 1000) {
      this.offset = 0;
      this.lastPastedId = null;
    }

    const topItem = items[0] ?? null;
    this.topItemId = topItem?.id ?? null;
    this.lastInvocation = now;

    // 按上一次粘贴的条目定位下一条，防止新条目插入顶部或粘贴恢复重排后重复粘贴同一条
    const lastIndex = this.lastPastedId ? items.findIndex((i) => i.id === this.lastPastedId) : -1;
    const currentIndex = lastIndex >= 0 ? lastIndex + 1 : this.offset;

    if (currentIndex >= items.length) {
      this.offset = 0;
      this.lastPastedId = null;
      return { item: null, remaining: 0, offset: 0 };
    }

    const item = items[currentIndex];
    this.lastPastedId = item.id;
    this.offset = currentIndex + 1;
    const remaining = items.length - this.offset;
    return { item, remaining, offset: this.offset };
  }

  public reset(): void {
    this.offset = 0;
    this.lastInvocation = null;
    this.topItemId = null;
    this.lastPastedId = null;
  }

  public getState(): PasteSequenceState {
    return {
      offset: this.offset,
      lastInvocation: this.lastInvocation,
      topItemId: this.topItemId
    };
  }
}

export const pasteSequenceManager = new PasteSequenceManager();

const HOST_MASKED_PREVIEW = /^•+ \[高熵敏感机密已脱敏\]$/;

function parseHistoryFilePaths(content: string): string[] {
  const parsed: unknown = JSON.parse(content);
  if (!Array.isArray(parsed) || !parsed.every((file): file is string => typeof file === "string" && file.length > 0)) {
    throw new Error("剪贴板文件历史格式无效");
  }
  return parsed;
}

function mapRawClipboardRecord(r: any, idx = 0): ClipboardItem {
  const content = String(r?.content ?? r?.text ?? "");
  const formatType = String(r?.format_type ?? r?.type ?? "text");
  const detectedType =
    formatType === "image"
      ? "image"
      : formatType === "files"
      ? "files"
      : detectClipboardContentType(content, formatType);
  return {
    id: String(r?.id || `clip-host-${idx}-${Date.now()}`),
    type: detectedType,
    content,
    // 宿主会把它判定为高熵的内容的预览换成占位符，带数字的普通链接、路径、JSON 也会被误判：
    // 这几类结构化内容按原文生成预览（真正的密钥仍由插件的敏感检测遮罩），其余保留宿主的遮罩
    preview: String(
      (HOST_MASKED_PREVIEW.test(String(r?.text_preview || "")) && NON_SECRET_TYPES.has(detectedType)
        ? ""
        : r?.text_preview || r?.preview) || content.replace(/\s+/g, " ").slice(0, 100)
    ),
    // 宿主去重命中时只更新 updated_at 并把条目移到最前，排序以它为准
    copiedAt: Number(r?.updated_at ?? r?.created_at ?? r?.copiedAt) || Date.now(),
    pinned: Boolean(r?.is_pinned ?? r?.pinned),
    charCount: Number(r?.char_count ?? r?.charCount ?? content.length),
    wordCount: Number(r?.word_count ?? r?.wordCount) || undefined,
    lineCount: Number(r?.line_count ?? r?.lineCount ?? content.split(/\r?\n/).length),
    sourceAppName: r?.source_app_name ?? r?.sourceAppName ?? undefined,
    sourceAppPath: r?.source_app_path ?? r?.sourceAppPath ?? undefined,
    filePaths: Array.isArray(r?.filePaths) ? r.filePaths : formatType === "files" ? parseHistoryFilePaths(content) : undefined
  };
}

/**
 * 插件自己存的记录（id 由插件生成：clip-<时间戳> / clip-live-<时间戳>），其余 id 属于宿主历史库
 */
export function isLocalRecordId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith("clip-") && !id.startsWith("clip-host-");
}

function isUserLocalRecord(item: any): item is ClipboardItem {
  if (!item || typeof item !== "object" || typeof item.content !== "string") return false;
  const id = String(item.id);
  return (
    isLocalRecordId(id) &&
    !SAMPLE_IDS.has(id) &&
    !id.startsWith("clip-color-") &&
    !id.startsWith("clip-json-")
  );
}

function decodeStoredRecords(raw: unknown): ClipboardItem[] | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed) || parsed.some((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const row = item as Record<string, unknown>;
    return typeof row.id !== "string" || !row.id || typeof row.content !== "string" ||
      (row.pinned !== undefined && typeof row.pinned !== "boolean");
  })) throw new Error("剪贴板本地历史格式损坏");
  return parsed;
}

async function readStoredRecords(strict = false): Promise<ClipboardItem[] | null> {
  try {
    return decodeStoredRecords(await LocalStorage.getItem(STORAGE_KEY));
  } catch (error) {
    if (strict) throw error;
    return [];
  }
}

/** 变更只作用于 CAS 重读的最新列表；解析或读取失败时禁止覆盖未知数据。 */
async function updateStoredRecords(update: (items: ClipboardItem[]) => ClipboardItem[]): Promise<ClipboardItem[]> {
  const raw = await updateStorageItem(LocalStorage, STORAGE_KEY, (current) =>
    JSON.stringify(update(decodeStoredRecords(current) ?? []))
  );
  return decodeStoredRecords(raw) ?? [];
}

/** 读出插件自己存的记录（不含示例数据、不含旧版本误存进来的宿主记录） */
async function readLocalRecords(): Promise<ClipboardItem[]> {
  return ((await readStoredRecords()) ?? []).filter(isUserLocalRecord);
}

/** 补记文本只新增或更新该内容的时间，不回写调用方的历史快照。 */
async function rememberLocalText(content: string, offline: boolean, idPrefix?: string): Promise<ClipboardItem[]> {
  const candidate = buildLocalRecord(content, { idPrefix });
  return updateStoredRecords((stored) => {
    const local = offline ? stored : stored.filter(isUserLocalRecord);
    const existing = local.find((item) => item.content === content);
    const item = existing ? { ...existing, copiedAt: candidate.copiedAt } : candidate;
    return [item, ...local.filter((entry) => entry.id !== item.id)];
  });
}

function hostResultSucceeded(res: { ok: boolean; data?: any }): boolean {
  if (!res.ok) return false;
  const d = res.data;
  if (d === false || d?.ok === false || d?.success === false) return false;
  return true;
}

/**
 * 读取宿主剪贴板历史库。宿主不提供历史库（方法不存在或调用失败）时返回 null，
 * 返回数组（哪怕为空）就表示宿主历史库可用，以宿主为准。
 */
async function queryHostHistory(hostOverride?: any): Promise<ClipboardItem[] | null> {
  if (typeof window !== "undefined" && (window as any).ztools?.clipboard_history_query) {
    try {
      const records = await (window as any).ztools.clipboard_history_query({ limit: 100 });
      if (Array.isArray(records)) return records.map((r: any, i: number) => mapRawClipboardRecord(r, i));
    } catch {
      // 继续尝试下一条通道
    }
  }

  if (hostOverride || isRealElectronHost(hostOverride)) {
    try {
      const ipcRes = await callHostTransport<any>("clipboard_history_query", { limit: 100 }, hostOverride);
      if (ipcRes.ok && ipcRes.data !== undefined && ipcRes.data !== null) {
        const d = ipcRes.data;
        const list = Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : Array.isArray(d?.records) ? d.records : null;
        if (list) return list.map((r: any, i: number) => mapRawClipboardRecord(r, i));
      }
    } catch {
      // 继续尝试下一条通道
    }
    return null;
  }

  // DeclarativeBridge 的 query 在宿主没有该方法时也返回 []，无法区分“空”和“不可用”，只认非空结果
  const bridge = getDeclarativeBridge();
  if (bridge?.clipboardHistory?.query) {
    try {
      const records = await bridge.clipboardHistory.query({ limit: 100 });
      if (Array.isArray(records) && records.length > 0) {
        return records.map((r: any, i: number) => mapRawClipboardRecord(r, i));
      }
    } catch {
      // 优雅降级
    }
  }
  return null;
}

async function callHistoryHost(method: string, params: Record<string, unknown>, hostOverride?: any): Promise<{ ok: boolean; data?: any }> {
  if (typeof window !== "undefined" && typeof (window as any).ztools?.[method] === "function") {
    try {
      const data = await (window as any).ztools[method](params);
      return { ok: data !== false && data?.success !== false, data };
    } catch {
      return { ok: false };
    }
  }
  if (hostOverride || isRealElectronHost(hostOverride)) {
    try {
      const res = await callHostTransport<any>(method, params, hostOverride);
      return { ok: hostResultSucceeded(res), data: res.data };
    } catch {
      return { ok: false };
    }
  }
  const bridge = getDeclarativeBridge();
  const api = bridge?.clipboardHistory;
  try {
    if (method === "clipboard_history_toggle_pin" && api?.togglePin) return { ok: Boolean(await api.togglePin(String(params.id))) };
    if (method === "clipboard_history_delete" && api?.delete) return { ok: Boolean(await api.delete(String(params.id))) };
    if (method === "clipboard_history_clear_unpinned" && api?.clearUnpinned) {
      const count = await api.clearUnpinned();
      return { ok: true, data: { count } };
    }
  } catch {
    return { ok: false };
  }
  return { ok: false };
}

function mergeHostAndLocal(host: ClipboardItem[], local: ClipboardItem[]): ClipboardItem[] {
  const hostContents = new Set(host.map((i) => i.content));
  return [...host, ...local.filter((i) => !hostContents.has(i.content))];
}

export interface HostRecordWaitOptions {
  /** 查询宿主历史库的次数（宿主约每 750ms 采集一次剪贴板） */
  attempts?: number;
  intervalMs?: number;
}

const DEFAULT_HOST_WAIT: Required<HostRecordWaitOptions> = { attempts: 8, intervalMs: 300 };

/**
 * 等宿主把刚写入系统剪贴板的文本记进历史库；宿主不可用或超时未记录返回 null
 */
async function waitForHostRecord(
  content: string,
  hostOverride?: any,
  options: HostRecordWaitOptions = {}
): Promise<{ record: ClipboardItem | null; hostAvailable: boolean }> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_HOST_WAIT.attempts);
  const intervalMs = Math.max(0, options.intervalMs ?? DEFAULT_HOST_WAIT.intervalMs);
  let hostAvailable = false;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, intervalMs));
    const host = await queryHostHistory(hostOverride);
    // 宿主没有历史库就不必再等
    if (!host) return { record: null, hostAvailable };
    hostAvailable = true;
    const found = host.find((item) => item.content === content);
    if (found) return { record: found, hostAvailable };
  }
  return { record: null, hostAvailable };
}

/**
 * 获取剪贴板历史：宿主历史库可用时以宿主为准，并带上插件自己存的、宿主里没有的记录（不隐藏、不覆盖）
 */
export async function getClipboardHistory(hostOverride?: any): Promise<ClipboardItem[]> {
  const realHost = isRealElectronHost(hostOverride);

  const host = await queryHostHistory(hostOverride);
  if (host) {
    return mergeHostAndLocal(host, await readLocalRecords());
  }

  // 真实宿主但没有历史库：只用插件自己存的记录，并补上当前系统剪贴板里的文本，拒绝示例数据
  if (realHost || hostOverride) {
    let realStored = await readLocalRecords();
    try {
      const liveText = await readRealClipboardText(hostOverride);
      const trimmed = (liveText || "").trim();
      if (trimmed && !realStored.some((item) => item.content === liveText)) {
        realStored = await rememberLocalText(liveText, false, "clip-live-");
      }
    } catch {
      // ignore
    }
    return realStored;
  }

  // 离线/单元测试环境兜底 LocalStorage 读取
  try {
    const stored = await readStoredRecords();
    if (stored === null) {
      const raw = await updateStorageItem(LocalStorage, STORAGE_KEY, (current) =>
        decodeStoredRecords(current) === null ? JSON.stringify(SAMPLE_CLIPBOARD_ITEMS) : current
      );
      return decodeStoredRecords(raw) ?? [];
    }
    return stored;
  } catch {
    return SAMPLE_CLIPBOARD_ITEMS;
  }
}

/**
 * 生成一条插件自存记录
 */
export function buildLocalRecord(
  content: string,
  options: { id?: string; pinned?: boolean; sourceAppName?: string; idPrefix?: string } = {}
): ClipboardItem {
  return {
    id: options.id || `${options.idPrefix || "clip-"}${globalThis.crypto.randomUUID()}`,
    type: detectClipboardContentType(content),
    content,
    preview: content.trim().replace(/\s+/g, " ").slice(0, 100),
    copiedAt: Date.now(),
    pinned: Boolean(options.pinned),
    charCount: content.length,
    lineCount: content.split(/\r?\n/).length,
    sourceAppName: options.sourceAppName
  };
}

/**
 * 主动读取当前系统剪贴板并写入历史记录
 * - 宿主历史库可用：宿主会自动采集剪贴板，这里等它记录后重新读取；宿主没有记下时存进插件存储，保证不丢
 * - 没有宿主历史库：存进插件存储
 */
export async function syncCurrentSystemClipboard(
  currentItems: ClipboardItem[] = [],
  hostOverride?: any,
  waitOptions?: HostRecordWaitOptions
): Promise<{ added: boolean; item?: ClipboardItem; items: ClipboardItem[] }> {
  let liveText = "";
  if (hostOverride || isRealElectronHost(hostOverride)) {
    const hasReadMock = Boolean(
      hostOverride &&
        typeof hostOverride === "object" &&
        ("clipboard_read_text" in hostOverride || "transport" in hostOverride)
    );
    const clipRes = await callHostTransport<string | { text?: string }>("clipboard_read_text", {}, hostOverride);
    if (clipRes.ok && clipRes.data !== undefined && clipRes.data !== null) {
      liveText =
        typeof clipRes.data === "string"
          ? clipRes.data
          : typeof clipRes.data?.text === "string"
            ? clipRes.data.text
            : "";
    } else if (!clipRes.ok && (isRealElectronHost(hostOverride) || hasReadMock) && !isHostMethodMissing(clipRes.error)) {
      throw new Error(clipRes.error || "读取系统剪贴板失败");
    } else {
      liveText = await readRealClipboardText(hostOverride);
    }
  } else {
    liveText = await readRealClipboardText(hostOverride);
  }
  if (!liveText || !liveText.trim()) {
    return { added: false, items: currentItems };
  }
  const alreadyListed = currentItems.some((i) => i.content === liveText);

  const { record, hostAvailable } = await waitForHostRecord(liveText, hostOverride, waitOptions);
  if (record) {
    return { added: !alreadyListed, item: record, items: await getClipboardHistory(hostOverride) };
  }

  const offline = !hostAvailable && !hostOverride && !isRealElectronHost(hostOverride);
  const next = await rememberLocalText(liveText, offline);
  const item = next[0];
  return { added: !alreadyListed, item, items: offline ? next : await getClipboardHistory(hostOverride) };
}

/**
 * 保存新建或编辑后的记录（调用前文本已写入系统剪贴板）
 * - 宿主历史库可用：等宿主记下新文本，按需置顶；编辑时删掉被替换的旧记录
 * - 宿主没有记下或不可用：存进插件存储
 * 返回 persisted=false 时表示没有保存成功，界面不能提示“已保存”
 */
export async function saveEditedClipboardItem(
  input: { content: string; pinned: boolean },
  original?: ClipboardItem,
  hostOverride?: any,
  waitOptions?: HostRecordWaitOptions
): Promise<{ persisted: boolean; where?: "host" | "local"; item?: ClipboardItem; items: ClipboardItem[]; message?: string }> {
  const content = String(input?.content ?? "");
  if (!content.trim()) return { persisted: false, items: [], message: "内容不能为空" };
  const pinned = Boolean(input?.pinned);

  const removeOriginal = async (keepId: string) => {
    if (!original || original.id === keepId) return true;
    if (isLocalRecordId(original.id)) {
      return updateLocalRecord(original.id, (latest) => {
        if (latest.content !== original.content || Boolean(latest.pinned) !== Boolean(original.pinned)) {
          throw new Error("旧历史记录已变化");
        }
        return null;
      });
    }
    return deleteClipboardItem(original.id, hostOverride);
  };

  const { record } = await waitForHostRecord(content, hostOverride, waitOptions);
  if (record) {
    let item = record;
    if (record.pinned !== pinned) {
      const toggled = await callHistoryHost("clipboard_history_toggle_pin", { id: record.id }, hostOverride);
      if (!toggled.ok) {
        return { persisted: false, items: await getClipboardHistory(hostOverride), message: "已记录到历史，但置顶状态未能保存" };
      }
      item = { ...record, pinned };
    }
    if (!await removeOriginal(record.id)) {
      return { persisted: false, items: await getClipboardHistory(hostOverride), message: "新内容已保存，但旧记录已变化或无法移除，请刷新后检查" };
    }
    return { persisted: true, where: "host", item, items: await getClipboardHistory(hostOverride) };
  }

  try {
    const keepOriginalId = original && isLocalRecordId(original.id) ? original.id : undefined;
    const candidate = buildLocalRecord(content, {
      id: keepOriginalId,
      pinned,
      sourceAppName: original?.sourceAppName || "ZTools Editor"
    });
    const isOffline = !hostOverride && !isRealElectronHost(hostOverride);
    const next = await updateStoredRecords((stored) => {
      const latest = keepOriginalId ? stored.find((entry) => entry.id === keepOriginalId) : undefined;
      if (keepOriginalId && (!latest || latest.content !== original?.content)) {
        throw new Error("历史记录已被修改或删除，请刷新后重试");
      }
      // 表单没有改置顶时，保留另一窗口刚更新的置顶状态。
      const item = latest && pinned === original?.pinned ? { ...candidate, pinned: latest.pinned } : candidate;
      const rest = stored.filter((entry) => entry && entry.id !== item.id);
      return isOffline ? [item, ...rest] : [item, ...rest.filter(isUserLocalRecord)];
    });
    const item = next[0];
    if (original && !isLocalRecordId(original.id) && !await removeOriginal(item.id)) {
      return { persisted: false, items: await getClipboardHistory(hostOverride), message: "新内容已保存，但旧记录无法移除，请刷新后检查" };
    }
    return { persisted: true, where: "local", item, items: await getClipboardHistory(hostOverride) };
  } catch (err: unknown) {
    return { persisted: false, items: [], message: err instanceof Error ? err.message : "插件存储写入失败" };
  }
}

/** 合并尚未保存的本地记录；更新与删除走专门动作，旧列表不能覆盖最新记录。 */
export async function saveClipboardHistory(items: ClipboardItem[]): Promise<void> {
  await updateStoredRecords((stored) => {
    const local = stored.filter((item) => isLocalRecordId(item?.id));
    const ids = new Set(local.map((item) => item.id));
    return [...local, ...items.filter((item) => isLocalRecordId(item?.id) && !ids.has(item.id))];
  });
}

async function updateLocalRecord(id: string, fn: (item: ClipboardItem) => ClipboardItem | null): Promise<boolean> {
  try {
    let found = false;
    await updateStoredRecords((stored) => {
      found = stored.some((item) => item?.id === id);
      return stored.flatMap((item) => {
        if (item?.id !== id) return [item];
        const updated = fn(item);
        return updated ? [updated] : [];
      });
    });
    return found;
  } catch {
    return false;
  }
}

/**
 * 切换条目置顶状态，返回是否切换成功（成功后请重新读取历史以获得真实状态）
 */
export async function toggleClipboardItemPin(id: string, hostOverride?: any): Promise<boolean> {
  if (!id || typeof id !== "string" || !id.trim()) return false;
  if (isLocalRecordId(id)) {
    return updateLocalRecord(id, (item) => ({ ...item, pinned: !item.pinned }));
  }
  return (await callHistoryHost("clipboard_history_toggle_pin", { id }, hostOverride)).ok;
}

/**
 * 删除剪贴板单条记录
 */
export async function deleteClipboardItem(id: string, hostOverride?: any): Promise<boolean> {
  if (!id || typeof id !== "string" || !id.trim()) return false;
  if (isLocalRecordId(id)) {
    return updateLocalRecord(id, () => null);
  }
  return (await callHistoryHost("clipboard_history_delete", { id }, hostOverride)).ok;
}

/**
 * 清空所有未置顶历史（宿主历史库与插件存储都清），返回清掉的条数
 */
export async function clearUnpinnedClipboardHistory(hostOverride?: unknown): Promise<number> {
  // 先读本地数据；读取失败不能把未知内容当成空历史覆盖。
  await readStoredRecords(true);
  const hostRes = await callHistoryHost("clipboard_history_clear_unpinned", {}, hostOverride);
  if (!hostRes.ok && (hostOverride || isRealElectronHost())) {
    throw new Error("宿主剪贴板历史清空失败，请重试");
  }
  const data = hostRes.data;
  let removed = hostRes.ok ? Number(typeof data === "number" ? data : data?.count ?? data?.clearedCount ?? 0) || 0 : 0;
  let localRemoved = 0;
  await updateStoredRecords((stored) => {
    const kept = stored.filter((item) => item?.pinned);
    const countable = hostRes.ok ? isUserLocalRecord : () => true;
    localRemoved = stored.filter(countable).length - kept.filter(countable).length;
    return kept;
  });
  removed += localRemoved;
  return removed;
}

/** 宿主记录按 ID 恢复原始类型；手工保存的文本仍通过 SDK 写入。 */
export async function restoreClipboardItem(item: ClipboardItem, paste = false, hostOverride?: unknown): Promise<void> {
  if (!isLocalRecordId(item.id) && (hostOverride || isRealElectronHost())) {
    const res = await callHostTransport("clipboard_history_restore", { id: item.id, paste }, hostOverride);
    if (res.ok && res.data?.success !== false) return;
    // 旧客户端没有按 ID 恢复的接口：文本仍可由 SDK 写入，图片与文件只能提示升级
    if (!res.ok && isHostMethodMissing(res.error)) {
      if (item.type === "image" || item.type === "files") throw hostUpgradeError("恢复图片和文件历史");
      if (paste) await Clipboard.paste(item.content);
      else await Clipboard.copy(item.content);
      return;
    }
    throw new Error(res.error || "恢复剪贴板历史失败");
  }
  if (item.type === "image" || (item.type === "files" && item.filePaths?.length)) {
    throw new Error("图片与文件历史需要由客户端宿主恢复");
  }
  if (paste) await Clipboard.paste(item.content);
  else await Clipboard.copy(item.content);
}

/**
 * 连续流水粘贴 (Paste Sequentially)
 */
export async function pasteSequentialClipboard(
  items: ClipboardItem[],
  options: { addNewLine?: boolean; timeoutSeconds?: number } = {}
): Promise<{ success: boolean; item?: ClipboardItem; remaining: number; offset: number; message?: string; pasteFailed?: boolean }> {
  if (isRealElectronHost()) {
    const res = await callHostTransport("clipboard_history_paste_sequential");
    if (!res.ok) return { success: false, pasteFailed: true, remaining: items.length, offset: 0, message: res.error || "流水粘贴失败" };
    const data = res.data;
    return {
      success: data?.success === true,
      ...(data?.item ? { item: mapRawClipboardRecord(data.item) } : {}),
      remaining: Math.max(0, Number(data?.total ?? 0) - Number(data?.sequenceIndex ?? 0)),
      offset: Number(data?.sequenceIndex ?? 0),
      ...(data?.success === false ? { pasteFailed: Boolean(data.item), message: String(data.message || "流水粘贴失败") } : {})
    };
  }
  // 宿主已取到条目但粘贴失败（如 macOS 未授权辅助功能）：如实返回失败，不能再走本地回退把它报成成功
  const hostPasteFailure = (res: any) =>
    res && res.success === false && res.item && typeof res.message === "string"
      ? {
          success: false,
          pasteFailed: true,
          item: res.item,
          remaining: Math.max(0, (res.total || 0) - (res.sequenceIndex || 0)),
          offset: res.sequenceIndex || 0,
          message: res.message
        }
      : null;

  // 1. window.ztools 原生调度
  if (typeof window !== "undefined" && (window as any).ztools?.clipboard_history_paste_sequential) {
    try {
      const res = await (window as any).ztools.clipboard_history_paste_sequential();
      const failed = hostPasteFailure(res);
      if (failed) return failed;
      if (res && res.success) {
        return {
          success: true,
          item: res.item,
          remaining: Math.max(0, (res.total || 0) - (res.sequenceIndex || 0)),
          offset: res.sequenceIndex || 0
        };
      }
    } catch {}
  }

  // 2. Bridge 调度
  const bridge = getDeclarativeBridge();
  if (bridge?.clipboardHistory?.pasteSequential) {
    try {
      const res = await bridge.clipboardHistory.pasteSequential();
      const failed = hostPasteFailure(res);
      if (failed) return failed;
      if (res && res.success) {
        return {
          success: true,
          item: res.item,
          remaining: Math.max(0, (res.total || 0) - (res.sequenceIndex || 0)),
          offset: res.sequenceIndex || 0
        };
      }
    } catch {}
  }

  // 3. 本地状态机模拟回贴
  if (options.timeoutSeconds) {
    pasteSequenceManager.setTimeoutSeconds(options.timeoutSeconds);
  }
  const result = pasteSequenceManager.pasteNext(items, options);
  if (!result.item) {
    return { success: false, remaining: 0, offset: 0, message: "No clipboard item found to paste." };
  }

  let textToPaste = result.item.content;
  if (options.addNewLine) {
    textToPaste += "\n";
  }

  await restoreClipboardItem({ ...result.item, content: textToPaste }, true);
  return {
    success: true,
    item: result.item,
    remaining: result.remaining,
    offset: result.offset
  };
}

/**
 * 重置流水粘贴指针
 */
export async function resetPasteSequence(): Promise<void> {
  if (typeof window !== "undefined" && (window as any).ztools?.clipboard_history_reset_sequence) {
    try {
      await (window as any).ztools.clipboard_history_reset_sequence();
    } catch {}
  }
  const bridge = getDeclarativeBridge();
  if (bridge?.clipboardHistory?.resetSequence) {
    try {
      await bridge.clipboardHistory.resetSequence();
    } catch {}
  }
  pasteSequenceManager.reset();
}

/**
 * 偏好设置获取与持久化
 */
export async function getClipboardPreferences(): Promise<ClipboardPreferences> {
  try {
    const raw = await LocalStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) {
      return {
        historyDuration: "P1W",
        primaryAction: "paste",
        preferPastingAsPlainText: false,
        updateHistoryAfterAction: true
      };
    }
    return JSON.parse(raw);
  } catch {
    return {
      historyDuration: "P1W",
      primaryAction: "paste",
      preferPastingAsPlainText: false,
      updateHistoryAfterAction: true
    };
  }
}

export async function saveClipboardPreferences(prefs: ClipboardPreferences): Promise<void> {
  await LocalStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
}

/**
 * 过滤与排序剪贴板条目（支持拼音缩写与模糊检索）
 */
export function filterClipboardItems(items: ClipboardItem[], options: ClipboardFilterOptions): ClipboardItem[] {
  let result = [...items];

  // 1. Filter by category
  if (options.type && options.type !== "all") {
    if (options.type === "pinned") {
      result = result.filter(item => item.pinned);
    } else {
      result = result.filter(item => item.type === options.type);
    }
  }

  // 2. Filter by search query
  if (options.query && options.query.trim()) {
    const q = options.query.trim().toLowerCase();
    result = result.filter(item => {
      if (item.content.toLowerCase().includes(q)) return true;
      if (item.preview.toLowerCase().includes(q)) return true;
      if (item.filePaths?.some(fp => fp.toLowerCase().includes(q))) return true;
      if (item.sourceAppName && item.sourceAppName.toLowerCase().includes(q)) return true;
      // 拼音首字母匹配
      const initials = getPinyinInitials(item.content + " " + item.preview);
      if (initials && initials.includes(q)) return true;
      return false;
    });
  }

  // 3. Sort: Pinned first, then newest copiedAt
  result.sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return b.copiedAt - a.copiedAt;
  });

  return result;
}

export function formatCopiedTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}
