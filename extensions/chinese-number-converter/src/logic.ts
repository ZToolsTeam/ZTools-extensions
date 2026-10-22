/**
 * 中文数字与金额大写转换 - 核心算法库
 * 支持：
 * 1. 数字转中文简体 (小写: 一万二千三百四十五点六七)
 * 2. 数字转中文大写 (繁体/正体: 壹万贰仟叁佰肆拾伍点陆柒)
 * 3. 银行发票级人民币大写 (壹万贰仟叁佰肆拾伍元陆角柒分整)
 * 4. 中文数字转阿拉伯数字 (支持金额、大写、小写、负数与小数)
 * 5. 批量处理与高精度千位分隔符识别
 */

export type ChineseDigitStyle = "lower" | "upper";
export type TicketRoundingMode = "half-up" | "truncate";
export type BatchConversionMode = "to-lower" | "to-upper" | "to-ticket" | "to-number";

export interface TicketRules {
  currencyPrefix: "" | "人民币";
  yuanUnit: "元" | "圆";
  wholeSuffix: "整" | "正";
  roundingMode: TicketRoundingMode;
  showZeroYuan: boolean;
  zeroForMissingJiao: boolean;
}

export interface BatchConversionResult {
  line: number;
  input: string;
  output: string;
  error: string;
}

interface ParsedDecimal {
  negative: boolean;
  integer: string;
  fraction: string;
}

export const DEFAULT_TICKET_RULES: TicketRules = {
  currencyPrefix: "",
  yuanUnit: "元",
  wholeSuffix: "整",
  roundingMode: "half-up",
  showZeroYuan: true,
  zeroForMissingJiao: true,
};

const LOWER_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;
const UPPER_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"] as const;
const LOWER_SMALL_UNITS = ["", "十", "百", "千"] as const;
const UPPER_SMALL_UNITS = ["", "拾", "佰", "仟"] as const;
const GROUP_UNITS = ["", "万", "亿", "兆"] as const;
const MAX_INTEGER_DIGITS = 16;
const MAX_FRACTION_DIGITS = 16;
const MAX_BATCH_ITEMS = 1000;
const MAX_ITEM_LENGTH = 256;

const PARSE_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const SMALL_UNIT_VALUES: Record<string, bigint> = {
  十: 10n,
  百: 100n,
  千: 1000n,
};

const LARGE_UNIT_VALUES: Record<string, bigint> = {
  万: 10000n,
  亿: 100000000n,
  兆: 1000000000000n,
};

const NORMALIZE_MAP: Record<string, string> = {
  〇: "零",
  壹: "一",
  贰: "二",
  貳: "二",
  貮: "二",
  两: "二",
  兩: "二",
  叁: "三",
  參: "三",
  肆: "四",
  伍: "五",
  陆: "六",
  陸: "六",
  柒: "七",
  捌: "八",
  玖: "九",
  拾: "十",
  佰: "百",
  仟: "千",
  萬: "万",
  億: "亿",
  點: "点",
  圆: "元",
  圓: "元",
  負: "负",
  正: "整",
};

export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionError";
  }
}

export function normalizeFullWidth(text: string): string {
  return text.replace(/[０-９．，＋－]/g, (char) => {
    if (char >= "０" && char <= "９") {
      return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
    }
    return ({ "．": ".", "，": ",", "＋": "+", "－": "-" } as Record<string, string>)[char] ?? char;
  });
}

export function parseArabicDecimal(input: string): ParsedDecimal {
  const text = normalizeFullWidth(input).trim();
  if (!text) throw new ConversionError("请输入有效数字");
  if (text.length > MAX_ITEM_LENGTH) throw new ConversionError("输入长度不能超过 256 个字符");

  const signless = text.replace(/^[+-]/, "");
  const integerWithSeparators = signless.split(".")[0] ?? "";
  if (integerWithSeparators.includes(",") && !/^\d{1,3}(?:,\d{3})+$/.test(integerWithSeparators)) {
    throw new ConversionError("千位分隔符位置不正确");
  }

  const normalized = text.replace(/,/g, "");
  const match = normalized.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/);
  if (!match) throw new ConversionError("不是有效的十进制数字格式");

  const integer = (match[2] ?? "0").replace(/^0+(?=\d)/, "") || "0";
  const fraction = match[3] ?? match[4] ?? "";
  if (integer.length > MAX_INTEGER_DIGITS) {
    throw new ConversionError("整数部分最多支持 16 位数字");
  }
  if (fraction.length > MAX_FRACTION_DIGITS) {
    throw new ConversionError("小数部分最多支持 16 位数字");
  }

  const isZero = integer === "0" && !/[1-9]/.test(fraction);
  return {
    negative: match[1] === "-" && !isZero,
    integer,
    fraction,
  };
}

function convertGroup(groupText: string, style: ChineseDigitStyle): string {
  const digits = style === "upper" ? UPPER_DIGITS : LOWER_DIGITS;
  const units = style === "upper" ? UPPER_SMALL_UNITS : LOWER_SMALL_UNITS;
  const padded = groupText.padStart(4, "0");
  let output = "";
  let zeroPending = false;

  for (let index = 0; index < padded.length; index += 1) {
    const digit = Number(padded[index]);
    const unit = units[padded.length - 1 - index] ?? "";
    if (digit === 0) {
      if (output) zeroPending = true;
      continue;
    }
    if (zeroPending) {
      output += digits[0];
      zeroPending = false;
    }
    output += `${digits[digit]}${unit}`;
  }

  return output;
}

function integerToChinese(integer: string, style: ChineseDigitStyle): string {
  const digits = style === "upper" ? UPPER_DIGITS : LOWER_DIGITS;
  if (integer === "0") return digits[0];

  const groups: string[] = [];
  for (let end = integer.length; end > 0; end -= 4) {
    groups.unshift(integer.slice(Math.max(0, end - 4), end));
  }
  if (groups.length > GROUP_UNITS.length) throw new ConversionError("整数部分最多支持到兆级");

  let output = "";
  let zeroBetweenGroups = false;
  groups.forEach((group, index) => {
    const value = Number(group);
    if (value === 0) {
      if (output) zeroBetweenGroups = true;
      return;
    }
    if (output && (zeroBetweenGroups || value < 1000) && !output.endsWith(digits[0])) {
      output += digits[0];
    }
    output += `${convertGroup(group, style)}${GROUP_UNITS[groups.length - 1 - index] ?? ""}`;
    zeroBetweenGroups = false;
  });

  if (style === "lower" && output.startsWith("一十")) return output.slice(1);
  return output;
}

/** 数字转中文读法 (lower: 小写, upper: 大写) */
export function numberToChinese(input: string, style: ChineseDigitStyle = "lower"): string {
  const parsed = parseArabicDecimal(input);
  const digits = style === "upper" ? UPPER_DIGITS : LOWER_DIGITS;
  const integerText = integerToChinese(parsed.integer, style);
  const fractionText = parsed.fraction
    ? `点${[...parsed.fraction].map((digit) => digits[Number(digit)]).join("")}`
    : "";
  return `${parsed.negative ? "负" : ""}${integerText}${fractionText}`;
}

function normalizeChineseInput(input: string): string {
  const compact = normalizeFullWidth(input).trim().replace(/[\s,，]/g, "");
  if (!compact) throw new ConversionError("请输入中文数字");
  if (compact.length > MAX_ITEM_LENGTH) throw new ConversionError("输入长度不能超过 256 个字符");
  return [...compact].map((char) => NORMALIZE_MAP[char] ?? char).join("");
}

interface ParsedChineseInteger {
  value: bigint;
  /** 是否按口语省略写法（如“三百五”“一万五”）解析了末位数字 */
  colloquial: boolean;
}

function parseChineseInteger(input: string): ParsedChineseInteger {
  if (!input) return { value: 0n, colloquial: false };
  if (!/^[零一二三四五六七八九十百千万亿兆]+$/.test(input)) {
    throw new ConversionError("包含无法识别的中文数字字符");
  }

  const hasUnit = /[十百千万亿兆]/.test(input);
  if (!hasUnit) {
    const digits = [...input].map((char) => PARSE_DIGITS[char]);
    if (digits.some((digit) => digit === undefined)) throw new ConversionError("包含无法识别的数字");
    const normalized = digits.join("").replace(/^0+(?=\d)/, "") || "0";
    if (normalized.length > MAX_INTEGER_DIGITS) throw new ConversionError("整数部分最多支持 16 位");
    return { value: BigInt(normalized), colloquial: false };
  }

  const NO_SMALL_UNIT = 10000n;
  const NO_LARGE_UNIT = 10000000000000n;
  let total = 0n;
  let section = 0n;
  let pendingDigit: number | null = null;
  let pendingAfterZero = false;
  let lastSmallUnit = NO_SMALL_UNIT;
  let lastLargeUnit = NO_LARGE_UNIT;
  let lastWasZero = false;
  let colloquial = false;

  /**
   * 没有单位跟随的数字的位权：前面有“零”时是个位（三百零五 = 305）；
   * 紧跟在百、千后面且中间没有“零”时，按口语省略写法表示下一级单位（三百五 = 350，一千二百三 = 1230）；
   * allowLargeUnit 为真（数字位于末尾）且本节没有十百千时，紧跟在万、亿、兆后面的数字同理（一万五 = 15000）。
   */
  const pendingWeight = (allowLargeUnit: boolean): bigint => {
    if (pendingAfterZero) return 1n;
    if (lastSmallUnit !== NO_SMALL_UNIT) return lastSmallUnit / 10n;
    if (allowLargeUnit && section === 0n && lastLargeUnit !== NO_LARGE_UNIT) return lastLargeUnit / 10n;
    return 1n;
  };
  const flushPending = (allowLargeUnit: boolean) => {
    if (pendingDigit === null) return;
    const weight = pendingWeight(allowLargeUnit);
    if (weight > 1n) colloquial = true;
    section += BigInt(pendingDigit) * weight;
    pendingDigit = null;
  };

  for (const char of input) {
    if (char in PARSE_DIGITS) {
      const digit = PARSE_DIGITS[char] ?? 0;
      if (digit === 0) {
        if (pendingDigit !== null) throw new ConversionError("中文数字位序不正确");
        lastWasZero = true;
        continue;
      }
      if (pendingDigit !== null) throw new ConversionError("带单位写法中不能连续出现多个数字");
      pendingDigit = digit;
      pendingAfterZero = lastWasZero;
      lastWasZero = false;
      continue;
    }

    const smallUnit = SMALL_UNIT_VALUES[char];
    if (smallUnit) {
      if (smallUnit >= lastSmallUnit || lastWasZero) throw new ConversionError("十、百、千的顺序不正确");
      section += BigInt(pendingDigit ?? 1) * smallUnit;
      pendingDigit = null;
      lastSmallUnit = smallUnit;
      lastWasZero = false;
      continue;
    }

    const largeUnit = LARGE_UNIT_VALUES[char];
    if (largeUnit) {
      // 数字紧挨在万、亿、兆前面时是该单位的系数，只按本节的十百千判断是否口语省略（一千二万 = 1200 万）
      flushPending(false);
      if (section === 0n || largeUnit >= lastLargeUnit) throw new ConversionError("万、亿、兆的顺序不正确");
      total += section * largeUnit;
      section = 0n;
      lastSmallUnit = NO_SMALL_UNIT;
      lastLargeUnit = largeUnit;
      lastWasZero = false;
      continue;
    }

    throw new ConversionError(`无法识别字符“${char}”`);
  }

  if (lastWasZero) throw new ConversionError("中文数字不能以无意义的零结尾");
  flushPending(true);
  const result = total + section;
  if (result.toString().length > MAX_INTEGER_DIGITS) throw new ConversionError("整数部分最多支持 16 位");
  return { value: result, colloquial };
}

function normalizeNumberOutput(integer: bigint, fraction: string, negative: boolean): string {
  const trimmedFraction = fraction.replace(/0+$/, "");
  const zero = integer === 0n && !trimmedFraction;
  return `${negative && !zero ? "-" : ""}${integer.toString()}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}

function parseTicketChinese(input: string, negative: boolean): ChineseNumberParseResult {
  const ticketPattern =
    /^([零一二三四五六七八九十百千万亿兆]+)?(元)?(?:([零一二三四五六七八九])角)?(?:零?([零一二三四五六七八九])分)?(整)?$/;
  const match = input.match(ticketPattern);
  if (!match) throw new ConversionError("票据金额格式或单位顺序不正确");

  const integerText = match[1] ?? "";
  const hasYuan = Boolean(match[2]);
  const jiaoText = match[3];
  const fenText = match[4];
  const hasWhole = Boolean(match[5]);
  if (!hasYuan && integerText) throw new ConversionError("整数金额后缺少元或圆");
  if (!hasYuan && !jiaoText && !fenText) throw new ConversionError("票据金额缺少元、角或分");
  if (hasYuan && !integerText) throw new ConversionError("元或圆前缺少金额");
  if (hasWhole && (!hasYuan || jiaoText || fenText)) throw new ConversionError("整或正只能用于无角分的金额");

  const integer = parseChineseInteger(integerText || "零");
  const jiao = jiaoText ? PARSE_DIGITS[jiaoText] ?? 0 : 0;
  const fen = fenText ? PARSE_DIGITS[fenText] ?? 0 : 0;
  return {
    value: normalizeNumberOutput(integer.value, `${jiao}${fen}`, negative),
    colloquial: integer.colloquial,
  };
}

export interface ChineseNumberParseResult {
  /** 阿拉伯数字结果 */
  value: string;
  /** 是否按口语省略写法解析（三百五 = 350、一万五 = 15000），界面据此提示用户核对 */
  colloquial: boolean;
}

/** 中文数字转阿拉伯数字 (支持小写、大写、票据金额与小数) */
export function chineseToNumber(input: string): string {
  return parseChineseNumber(input).value;
}

/** 中文数字转阿拉伯数字，并返回是否使用了口语省略写法 */
export function parseChineseNumber(input: string): ChineseNumberParseResult {
  let normalized = normalizeChineseInput(input);
  let negative = false;
  if (normalized.startsWith("负")) {
    negative = true;
    normalized = normalized.slice(1);
  }
  if (normalized.startsWith("人民币")) normalized = normalized.slice(3);
  if (!normalized || normalized.includes("负")) throw new ConversionError("负号位置不正确");

  if (/[元角分整]/.test(normalized)) return parseTicketChinese(normalized, negative);

  const parts = normalized.split("点");
  if (parts.length > 2) throw new ConversionError("只能包含一个小数点");
  const integerText = parts[0] || "零";
  const fractionText = parts[1] ?? "";
  if (parts.length === 2 && !fractionText) throw new ConversionError("小数点后缺少数字");
  if (fractionText && !/^[零一二三四五六七八九]+$/.test(fractionText)) {
    throw new ConversionError("小数部分只能逐位书写中文数字");
  }
  if (fractionText.length > MAX_FRACTION_DIGITS) throw new ConversionError("小数部分最多支持 16 位");

  const integer = parseChineseInteger(integerText);
  const fraction = [...fractionText].map((char) => PARSE_DIGITS[char]).join("");
  return { value: normalizeNumberOutput(integer.value, fraction, negative), colloquial: integer.colloquial };
}

function decimalToFen(parsed: ParsedDecimal, roundingMode: TicketRoundingMode): bigint {
  const cents = parsed.fraction.padEnd(2, "0").slice(0, 2);
  const shouldRound = roundingMode === "half-up" && Number(parsed.fraction[2] ?? "0") >= 5;
  let value = BigInt(parsed.integer) * 100n + BigInt(cents || "0") + (shouldRound ? 1n : 0n);
  if ((value / 100n).toString().length > MAX_INTEGER_DIGITS) {
    throw new ConversionError("舍入后的整数金额超过 16 位");
  }
  if (parsed.negative) value = -value;
  return value;
}

/** 数字转银行发票级人民币大写金额 */
export function numberToTicketUppercase(
  input: string,
  rules: TicketRules = DEFAULT_TICKET_RULES
): string {
  const parsed = parseArabicDecimal(input);
  const amountFen = decimalToFen(parsed, rules.roundingMode);
  const negative = amountFen < 0n;
  const absoluteFen = negative ? -amountFen : amountFen;
  const yuan = absoluteFen / 100n;
  const jiao = Number((absoluteFen / 10n) % 10n);
  const fen = Number(absoluteFen % 10n);
  const showYuan = rules.showZeroYuan || yuan > 0n || (jiao === 0 && fen === 0);

  let body = "";
  if (showYuan) body += `${integerToChinese(yuan.toString(), "upper")}${rules.yuanUnit}`;
  if (jiao === 0 && fen === 0) {
    body += rules.wholeSuffix;
  } else {
    if (jiao > 0) body += `${UPPER_DIGITS[jiao]}角`;
    if (fen > 0) {
      if (jiao === 0 && rules.zeroForMissingJiao && showYuan) body += UPPER_DIGITS[0];
      body += `${UPPER_DIGITS[fen]}分`;
    }
  }

  return `${negative ? "负" : ""}${rules.currencyPrefix}${body}`;
}

/** 批量转换多行数据 */
export function convertBatch(
  input: string,
  mode: BatchConversionMode,
  rules: TicketRules = DEFAULT_TICKET_RULES
): BatchConversionResult[] {
  const items = input
    .split(/\r?\n/)
    .map((value, index) => ({ line: index + 1, input: value.trim() }))
    .filter((item) => item.input.length > 0);

  if (items.length === 0) throw new ConversionError("请至少输入一条待转换内容");
  if (items.length > MAX_BATCH_ITEMS) throw new ConversionError("批量转换最多支持 1000 条");

  return items.map((item) => {
    try {
      if (item.input.length > MAX_ITEM_LENGTH) throw new ConversionError("单条内容不能超过 256 个字符");
      let output = "";
      switch (mode) {
        case "to-lower":
          output = numberToChinese(item.input, "lower");
          break;
        case "to-upper":
          output = numberToChinese(item.input, "upper");
          break;
        case "to-ticket":
          output = numberToTicketUppercase(item.input, rules);
          break;
        case "to-number":
          output = chineseToNumber(item.input);
          break;
        default:
          throw new ConversionError("不支持的批量转换类型");
      }
      return { ...item, output, error: "" };
    } catch (error) {
      return {
        ...item,
        output: "",
        error: error instanceof Error ? error.message : "转换失败",
      };
    }
  });
}
