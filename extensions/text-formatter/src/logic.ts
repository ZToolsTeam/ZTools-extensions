/**
 * ZTools 文本排版与格式化核心逻辑 (纯函数)
 */

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
const SENTENCE_END_REGEX = /[^。！？!?；;]+[。！？!?；;]?/g;

/** 常用简体繁体字符对照映射表 (自包含，无需引入庞大第三方依赖) */
const SIMP_TO_TRAD_MAP: Record<string, string> = {
  "万": "萬", "与": "與", "丑": "醜", "专": "專", "业": "業", "丛": "叢", "东": "東", "丝": "絲",
  "丢": "丟", "两": "兩", "严": "嚴", "丧": "喪", "个": "個", "丰": "豐", "临": "臨", "为": "為",
  "丽": "麗", "举": "舉", "么": "麼", "乐": "樂", "乔": "喬", "习": "習", "乡": "鄉", "书": "書",
  "买": "買", "乱": "亂", "争": "爭", "于": "於", "亏": "虧", "云": "雲", "亚": "亞", "产": "產",
  "亩": "畝", "亲": "親", "亵": "褻", "亸": "嚲", "亿": "億", "仅": "僅", "从": "從", "仑": "侖",
  "仓": "倉", "仪": "儀", "们": "們", "价": "價", "众": "眾", "优": "優", "伙": "夥", "会": "會",
  "伛": "傴", "伞": "傘", "伟": "偉", "传": "傳", "伤": "傷", "伥": "倀", "伦": "倫", "伧": "傖",
  "伪": "偽", "伫": "佇", "体": "體", "余": "餘", "佣": "傭", "佥": "僉", "侠": "俠", "侣": "侶",
  "侥": "僥", "侦": "偵", "侧": "側", "侨": "僑", "侩": "儈", "侪": "儕", "侬": "儂", "俣": "俁",
  "俦": "儔", "俨": "儼", "俩": "倆", "俪": "儷", "俭": "儉", "债": "債", "倾": "傾", "偬": "傯",
  "偻": "僂", "偿": "償", "傥": "儻", "傧": "儐", "储": "儲", "傩": "儺", "儿": "兒", "兑": "兌",
  "兖": "兗", "党": "黨", "兰": "蘭", "关": "關", "兴": "興", "兹": "茲", "养": "養", "兽": "獸",
  "冁": "囅", "内": "內", "冈": "岡", "册": "冊", "写": "寫", "军": "軍", "农": "農", "冯": "馮",
  "冰": "氷", "冲": "衝", "决": "決", "况": "況", "冻": "凍", "净": "淨", "凄": "淒", "凉": "涼",
  "凌": "淩", "减": "減", "凑": "湊", "凛": "凜", "几": "幾", "凤": "鳳", "凫": "鳧", "凭": "憑",
  "凯": "凱", "出": "齣", "击": "擊", "凿": "鑿", "划": "劃", "刘": "劉", "则": "則", "刚": "剛",
  "创": "創", "初": "齣", "删": "刪", "判": "彆", "刨": "鉋", "利": "悧", "别": "別", "刬": "剗",
  "刭": "剄", "刮": "颳", "制": "製", "刹": "剎", "刺": "剌", "刻": "剋", "刽": "劊", "刿": "劌",
  "剀": "剴", "剂": "劑", "剐": "剮", "剑": "劍", "剥": "剝", "剧": "劇", "劝": "勸", "办": "辦",
  "务": "務", "劢": "劻", "动": "動", "励": "勵", "劲": "勁", "劳": "勞", "势": "勢", "勋": "勳",
  "匀": "勻", "匦": "匭", "匮": "匱", "区": "區", "医": "醫", "华": "華", "协": "協", "单": "單",
  "卖": "賣", "卜": "蔔", "卢": "盧", "卫": "衛", "卷": "捲", "厂": "廠", "厅": "廳", "历": "歷",
  "厉": "厲", "压": "壓", "厌": "厭", "厍": "厙", "厕": "廁", "厢": "廂", "厦": "廈", "厨": "廚",
  "厩": "廄", "厮": "廝", "县": "縣", "参": "參", "双": "雙", "发": "發", "变": "變", "叙": "敘",
  "叠": "疊", "台": "臺", "叶": "葉", "号": "號", "叹": "嘆", "叽": "嘰", "吁": "籲", "后": "後",
  "向": "嚮", "吓": "嚇", "吕": "呂", "吗": "嗎", "吨": "噸", "听": "聽", "启": "啓", "吴": "吳",
  "呐": "吶", "呒": "撫", "呓": "囈", "呕": "嘔", "呖": "唳", "呗": "唄", "员": "員", "呙": "喎",
  "呛": "嗆", "呜": "嗚", "咏": "詠", "咙": "嚨", "咛": "嚀", "响": "響", "哑": "啞", "哒": "噠",
  "哓": "嘵", "哔": "嗶", "哕": "噦", "哗": "嘩", "哝": "儂", "啸": "嘯", "哟": "喲", "唛": "嘜",
  "唝": "嗊", "唠": "嘮", "唏": "欷", "唤": "喚", "唧": "唧", "啧": "嘖", "啬": "嗇",
  "啭": "囀", "啮": "齧", "啰": "囉", "喷": "噴", "噜": "嚕", "团": "團", "园": "園",
  "困": "睏", "囱": "囪", "围": "圍", "囵": "圇", "国": "國", "图": "圖", "圆": "圓", "圣": "聖",
  "场": "場", "坏": "壞", "块": "塊", "坚": "堅", "坛": "壇", "坜": "壢", "坝": "壩", "坞": "塢",
  "坟": "墳", "坠": "墜", "垄": "壟", "垆": "壚", "垒": "壘", "垦": "墾", "垩": "堊", "垫": "墊",
  "垭": "埡", "垲": "塏", "垴": "堖", "壮": "壯", "声": "聲", "壳": "殼", "壶": "壺", "壹": "壹",
  "处": "處", "备": "備", "复": "復", "够": "夠", "头": "頭", "夸": "誇", "夹": "夾", "夺": "奪",
  "妆": "妝", "妇": "婦", "妈": "媽", "戏": "戲", "软": "軟", "件": "件", "设": "設", "置": "置",
  "档": "檔", "案": "案", "管": "管", "理": "理"
};

const TRAD_TO_SIMP_MAP: Record<string, string> = {};
for (const [simp, trad] of Object.entries(SIMP_TO_TRAD_MAP)) {
  TRAD_TO_SIMP_MAP[trad] = simp;
}

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
    .replace(/[A-Za-z][A-Za-z'’-]*/g, (word, offset) => {
      if (offset > 0 && LOWER_TITLE_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
}

export function toSentenceCase(text: string): string {
  const lowered = (text || "").toLowerCase();
  return lowered.replace(/(^\s*[a-z]|[.!?]\s+[a-z])/g, (match) => match.toUpperCase());
}

export function toCamelCase(text: string): string {
  const words = (text || "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  return words[0].toLowerCase() + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
}

export function toSnakeCase(text: string): string {
  return (text || "")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export function toKebabCase(text: string): string {
  return (text || "")
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
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
export function toChinesePunctuation(text: string): string {
  if (!text) return "";
  return text
    .replace(new RegExp(`([${CJK_RANGE}]),`, "g"), "$1，")
    .replace(new RegExp(`,([${CJK_RANGE}])`, "g"), "，$1")
    .replace(new RegExp(`([${CJK_RANGE}])\\.`, "g"), "$1。")
    .replace(new RegExp(`\\.([${CJK_RANGE}])`, "g"), "。$1")
    .replace(new RegExp(`([${CJK_RANGE}])!`, "g"), "$1！")
    .replace(new RegExp(`!([${CJK_RANGE}])`, "g"), "！$1")
    .replace(new RegExp(`([${CJK_RANGE}])\\?`, "g"), "$1？")
    .replace(new RegExp(`\\?([${CJK_RANGE}])`, "g"), "？$1")
    .replace(new RegExp(`([${CJK_RANGE}]):`, "g"), "$1：")
    .replace(new RegExp(`:([${CJK_RANGE}])`, "g"), "：$1")
    .replace(new RegExp(`([${CJK_RANGE}]);`, "g"), "$1；")
    .replace(new RegExp(`;([${CJK_RANGE}])`, "g"), "；$1")
    .replace(/,/g, "，")
    .replace(/\?/g, "？")
    .replace(/!/g, "！")
    .replace(/:/g, "：")
    .replace(/;/g, "；")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/\[/g, "【")
    .replace(/\]/g, "】")
    .replace(/，{2,}/g, "，")
    .replace(/。{2,}/g, "。")
    .replace(/！{2,}/g, "！")
    .replace(/？{2,}/g, "？");
}

export function toEnglishPunctuation(text: string): string {
  if (!text) return "";
  return text
    .replace(/，/g, ", ")
    .replace(/。/g, ". ")
    .replace(/！/g, "! ")
    .replace(/？/g, "? ")
    .replace(/：/g, ": ")
    .replace(/；/g, "; ")
    .replace(/（/g, " (")
    .replace(/）/g, ") ")
    .replace(/【/g, " [")
    .replace(/】/g, "] ")
    .replace(/《/g, " <")
    .replace(/》/g, "> ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])([^\s,.;:!?])/g, "$1 $2")
    .trim();
}

/**
 * 4. Markdown 自动排版与中文智能排版
 */
export function collapseInlineSpaces(text: string): string {
  return (text || "").replace(/[\t\u00a0\u3000 ]+/g, " ");
}

export function removeSpacesAroundCjk(text: string): string {
  return (text || "")
    .replace(new RegExp(`([${CJK_RANGE}])\\s+([${CJK_RANGE}])`, "g"), "$1$2")
    .replace(new RegExp(`([${CJK_RANGE}])\\s+([，。！？；：、）】》」』])`, "g"), "$1$2")
    .replace(new RegExp(`([（【《「『])\\s+([${CJK_RANGE}])`, "g"), "$1$2");
}

export function normalizeCjkSpacing(text: string): string {
  return removeSpacesAroundCjk(collapseInlineSpaces(text || ""))
    .replace(new RegExp(`([${CJK_RANGE}])([A-Za-z0-9])`, "g"), "$1 $2")
    .replace(new RegExp(`([A-Za-z0-9])([${CJK_RANGE}])`, "g"), "$1 $2");
}

export function splitChineseParagraphs(text: string, sentencesPerParagraph = 3): string {
  const normalized = trimLines(text || "")
    .split("\n")
    .filter((line) => line.length > 0)
    .join("");

  if (!normalized) return "";

  const sentences =
    normalized.match(SENTENCE_END_REGEX)?.map((item) => item.trim()).filter(Boolean) ||
    [normalized];
  const size = Math.max(1, Math.floor(sentencesPerParagraph));
  const paragraphs: string[] = [];

  for (let index = 0; index < sentences.length; index += size) {
    paragraphs.push(sentences.slice(index, index + size).join(""));
  }

  return paragraphs.join("\n\n");
}

export function indentParagraphFirstLine(text: string, indentSize = 2): string {
  const indent = "\u3000".repeat(Math.max(0, Math.floor(indentSize)));
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
  const normalized = normalizeCjkSpacing(toChinesePunctuation(text || ""));
  return indentParagraphFirstLine(
    splitChineseParagraphs(normalized, sentencesPerParagraph),
    indentSize
  );
}

export function formatMarkdown(text: string): string {
  if (!text) return "";
  return normalizeLineEndings(text)
    .split("\n")
    .map((line) => {
      // 保证 # 标题后有空格
      const headerMatch = line.match(/^(#{1,6})([^#\s].*)$/);
      if (headerMatch) {
        return `${headerMatch[1]} ${headerMatch[2]}`;
      }
      // 保证列表项 - or * 后有空格
      const listMatch = line.match(/^(\s*[-*+])([^\s].*)$/);
      if (listMatch) {
        return `${listMatch[1]} ${listMatch[2]}`;
      }
      return line.trimEnd();
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
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
  return normalizeLineEndings(text || "")
    .split("\n")
    .map((line) => line.replace(/^\s*\d+[.)、\s]\s*/, ""))
    .join("\n");
}

/**
 * 6. 繁简转换
 */
export function convertToTraditional(text: string): string {
  if (!text) return "";
  return text.split("").map((ch) => SIMP_TO_TRAD_MAP[ch] || ch).join("");
}

export function convertToSimplified(text: string): string {
  if (!text) return "";
  return text.split("").map((ch) => TRAD_TO_SIMP_MAP[ch] || ch).join("");
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
