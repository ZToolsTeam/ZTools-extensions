/**
 * 汇率计算插件 - 纯逻辑层（无界面、无宿主依赖，便于单元测试）
 *
 * 数据源沿用旧版：
 * - 法币汇率：open.er-api.com（以 USD 为基准的每日汇率表）
 * - 比特币 / 黄金：api.coingecko.com（bitcoin、tether-gold 的美元价格）
 * 拿不到真实数据时一律抛出 ExchangeRateError，不生成任何估算或演示数据。
 */

export const LATEST_RATES_URL = "https://open.er-api.com/v6/latest/USD";
export const ASSET_QUOTES_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,tether-gold&vs_currencies=usd";

export const NETWORK_POLICY = Object.freeze({
  latestRatesTimeoutMs: 12_000,
  assetQuotesTimeoutMs: 5_000,
  latestRatesMaxBytes: 64 * 1024,
  assetQuotesMaxBytes: 4 * 1024,
  /** 缓存 30 分钟内视为新鲜，直接使用不联网 */
  cacheTtlMs: 30 * 60 * 1000,
  /** 联网失败时最多回退展示 7 天内的缓存（界面会明确标注刷新失败与汇率时间） */
  staleMaxAgeMs: 7 * 24 * 60 * 60 * 1000
});

export const RATE_CACHE_KEY = "rate-cache-v2";
export const SETTINGS_KEY = "settings-v2";

export interface CurrencyInfo {
  readonly code: string;
  readonly name: string;
  readonly symbol: string;
  /** 额外搜索关键字（中英文别名） */
  readonly keywords: readonly string[];
}

/** 支持的货币列表（与旧版一致，顺序即默认展示顺序） */
export const CURRENCIES: readonly CurrencyInfo[] = Object.freeze([
  { code: "CNY", name: "人民币", symbol: "¥", keywords: ["rmb", "yuan", "元", "中国"] },
  { code: "USD", name: "美元", symbol: "$", keywords: ["美金", "dollar", "美国"] },
  { code: "EUR", name: "欧元", symbol: "€", keywords: ["euro", "欧洲"] },
  { code: "JPY", name: "日元", symbol: "¥", keywords: ["yen", "日本", "日币"] },
  { code: "GBP", name: "英镑", symbol: "£", keywords: ["pound", "英国"] },
  { code: "KRW", name: "韩元", symbol: "₩", keywords: ["won", "韩国", "韩币"] },
  { code: "HKD", name: "港币", symbol: "HK$", keywords: ["港元", "香港"] },
  { code: "TWD", name: "新台币", symbol: "NT$", keywords: ["台币", "台湾"] },
  { code: "SGD", name: "新加坡元", symbol: "S$", keywords: ["新币", "新加坡"] },
  { code: "AUD", name: "澳元", symbol: "A$", keywords: ["澳币", "澳大利亚"] },
  { code: "CAD", name: "加元", symbol: "C$", keywords: ["加币", "加拿大"] },
  { code: "CHF", name: "瑞士法郎", symbol: "Fr", keywords: ["franc", "瑞士"] },
  { code: "THB", name: "泰铢", symbol: "฿", keywords: ["baht", "泰国"] },
  { code: "RUB", name: "卢布", symbol: "₽", keywords: ["ruble", "俄罗斯"] },
  { code: "INR", name: "印度卢比", symbol: "₹", keywords: ["rupee", "印度"] },
  { code: "XAU", name: "黄金（盎司）", symbol: "oz", keywords: ["gold", "黄金", "金价"] },
  { code: "BTC", name: "比特币", symbol: "₿", keywords: ["bitcoin", "比特币"] }
]);

const SUPPORTED_CODES: ReadonlySet<string> = new Set(CURRENCIES.map((c) => c.code));
/** 由 CoinGecko 提供报价的资产（er-api 不提供或口径不同） */
export const ASSET_CODES: readonly string[] = Object.freeze(["BTC", "XAU"]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isSupportedCurrency(code: unknown): code is string {
  return typeof code === "string" && SUPPORTED_CODES.has(code);
}

export function getCurrency(code: string): CurrencyInfo | undefined {
  return CURRENCIES.find((c) => c.code === code);
}

/* ============================== 换算 ============================== */

/** 根据货币类型决定小数位数：JPY/KRW 0 位，BTC 8 位，XAU 4 位，其余 2 位 */
export function getDecimals(code: string): number {
  if (code === "JPY" || code === "KRW") return 0;
  if (code === "BTC") return 8;
  if (code === "XAU") return 4;
  return 2;
}

/** 格式化单位汇率；无效值返回 "--" */
export function formatRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return "--";
  if (rate >= 1000) return rate.toFixed(0);
  if (rate >= 100) return rate.toFixed(2);
  if (rate >= 1) return rate.toFixed(4);
  return rate.toFixed(6);
}

/** 从 USD 基准汇率表计算 from → to 的汇率；任一侧缺失或无效返回 null */
export function calcRate(rates: Readonly<Record<string, number>>, from: string, to: string): number | null {
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!isPositiveFinite(fromRate) || !isPositiveFinite(toRate)) return null;
  const rate = toRate / fromRate;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** 解析非负十进制金额，允许正确分组的千分位逗号；"0" 是合法金额，返回 0 而不是 null */
export function parseAmount(amount: string): number | null {
  const value = amount.trim();
  if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** 按目标币种小数位换算金额，返回不带千分位的定点字符串；无法计算返回 null */
export function convertAmount(amount: number, rate: number, targetCode: string): string | null {
  if (!Number.isFinite(amount) || amount < 0 || !isPositiveFinite(rate)) return null;
  const converted = amount * rate;
  if (!Number.isFinite(converted) || converted >= 1e21) return null;
  return converted.toFixed(getDecimals(targetCode));
}

/** 给定点数字符串加千分位：1234567.89 → 1,234,567.89 */
export function groupDigits(fixed: string): string {
  const match = fixed.match(/^(\d+)(\.\d+)?$/);
  if (!match) return fixed;
  return match[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (match[2] ?? "");
}

/** 去掉千分位与多余尾随零，用于把换算结果回填为新的输入金额 */
export function toInputAmount(fixed: string): string {
  if (!/^\d+(\.\d+)?$/.test(fixed)) return fixed;
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

/* ============================== 搜索框解析 ============================== */

export type ParsedQuery =
  | { readonly kind: "amount"; readonly amount: number; readonly amountText: string; readonly from?: string; readonly to?: string }
  | { readonly kind: "filter"; readonly amount: number; readonly amountText: string; readonly text: string }
  | { readonly kind: "error"; readonly message: string };

const QUERY_PATTERN = /^([\d.,]+)\s*([a-z]{3})?(?:\s*(?:to|in|到|转|换|=|->)?\s*([a-z]{3}))?$/i;

/**
 * 解析搜索框：
 * - 空 → 金额 1
 * - "100" / "100 usd" / "100 usd to cny" / "100usd=cny" → 金额（可选源/目标币种）
 * - 以数字开头但无法识别 → 错误
 * - 其他文本 → 按币种代码、名称、别名筛选（金额 1）
 */
export function parseQuery(input: string): ParsedQuery {
  const text = input.trim();
  if (text === "") return { kind: "amount", amount: 1, amountText: "1" };
  const match = text.match(QUERY_PATTERN);
  if (match) {
    const amountText = match[1]!;
    const amount = parseAmount(amountText);
    if (amount === null) return { kind: "error", message: `金额格式无效：${amountText}` };
    const from = match[2]?.toUpperCase();
    const to = match[3]?.toUpperCase();
    for (const code of [from, to]) {
      if (code !== undefined && !isSupportedCurrency(code)) return { kind: "error", message: `暂不支持币种 ${code}` };
    }
    return {
      kind: "amount",
      amount,
      amountText: amountText.replace(/,/g, ""),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to })
    };
  }
  if (/^[\d.,+-]/.test(text)) return { kind: "error", message: "无法识别的输入，示例：100、100 USD、100 USD to CNY" };
  return { kind: "filter", amount: 1, amountText: "1", text };
}

/** 币种是否匹配筛选文本（代码、名称、别名，忽略大小写） */
export function matchCurrency(info: CurrencyInfo, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle === "") return true;
  return [info.code, info.name, ...info.keywords].some((v) => v.toLowerCase().includes(needle));
}

/* ============================== 数据源解析 ============================== */

export type ExchangeRateErrorCode = "HOST_UNSUPPORTED" | "TIMEOUT" | "TRANSPORT_ERROR" | "HTTP_ERROR" | "INVALID_RESPONSE";

/** 稳定、可展示的错误：不包含原始响应体或请求头 */
export class ExchangeRateError extends Error {
  readonly code: ExchangeRateErrorCode;
  readonly statusCode?: number;

  constructor(code: ExchangeRateErrorCode, statusCode?: number, detail?: string) {
    const messages: Record<ExchangeRateErrorCode, string> = {
      HOST_UNSUPPORTED: "当前客户端不支持插件网络请求，请升级 ZTools",
      TIMEOUT: "请求汇率超时",
      TRANSPORT_ERROR: "网络请求失败",
      HTTP_ERROR: `汇率服务返回 HTTP ${statusCode ?? "错误"}`,
      INVALID_RESPONSE: "汇率服务返回的数据无效"
    };
    super(detail ? `${messages[code]}（${detail}）` : messages[code]);
    this.name = "ExchangeRateError";
    this.code = code;
    if (statusCode !== undefined) this.statusCode = statusCode;
  }
}

/** 发起 GET 请求的宿主函数：返回宿主原始响应（{ statusCode, body } 或其 success/data 包装） */
export type HttpRequester = (url: string, timeoutMs: number) => Promise<unknown>;

export interface HttpResponse {
  readonly statusCode: number;
  readonly body: string;
}

/** 解析宿主响应：兼容最多两层 { success: true, data } 包装；超出字节上限视为无效 */
export function parseHostResponse(raw: unknown, maxBytes: number): HttpResponse {
  let value = raw;
  for (let depth = 0; depth < 2 && isRecord(value) && value.success === true && isRecord(value.data); depth++) {
    value = value.data;
  }
  if (!isRecord(value) || !Number.isInteger(value.statusCode) || typeof value.body !== "string") {
    throw new ExchangeRateError("INVALID_RESPONSE");
  }
  if (value.body.length > maxBytes || new TextEncoder().encode(value.body).byteLength > maxBytes) {
    throw new ExchangeRateError("INVALID_RESPONSE", undefined, "响应体过大");
  }
  return { statusCode: value.statusCode as number, body: value.body };
}

function hostErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string") return error.code;
  return "";
}

/** 调用宿主并把结果解析成 JSON 对象；所有失败统一映射为 ExchangeRateError */
export async function requestJson(request: HttpRequester, url: string, timeoutMs: number, maxBytes: number): Promise<UnknownRecord> {
  let raw: unknown;
  try {
    raw = await request(url, timeoutMs);
  } catch (error: unknown) {
    if (error instanceof ExchangeRateError) throw error;
    const code = hostErrorCode(error);
    if (/TIMEOUT/i.test(code)) throw new ExchangeRateError("TIMEOUT");
    throw new ExchangeRateError("TRANSPORT_ERROR", undefined, code || undefined);
  }
  const response = parseHostResponse(raw, maxBytes);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new ExchangeRateError("HTTP_ERROR", response.statusCode);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch (error: unknown) {
    throw new ExchangeRateError("INVALID_RESPONSE", undefined, error instanceof SyntaxError ? "不是有效的 JSON" : undefined);
  }
  if (!isRecord(payload)) throw new ExchangeRateError("INVALID_RESPONSE");
  return payload;
}

/** 只保留支持的币种；任一支持币种的值无效、USD 不为 1 或缺少 CNY 时整体判为无效 */
export function normalizeRates(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const rates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(value)) {
    if (!SUPPORTED_CODES.has(code)) continue;
    if (!isPositiveFinite(rate)) return undefined;
    rates[code] = rate;
  }
  if (rates.USD !== 1 || !rates.CNY) return undefined;
  return rates;
}

export interface LatestRates {
  readonly rates: Record<string, number>;
  /** 数据源给出的汇率更新时间（毫秒），缺失或无效时省略 */
  readonly sourceUpdatedAt?: number;
}

/** 校验 er-api 响应；BTC / XAU 一律以 CoinGecko 报价为准，这里剔除 */
export function validateLatestRates(payload: unknown): LatestRates {
  if (!isRecord(payload) || payload.result !== "success" || payload.base_code !== "USD") {
    throw new ExchangeRateError("INVALID_RESPONSE");
  }
  const rates = normalizeRates(payload.rates);
  if (!rates) throw new ExchangeRateError("INVALID_RESPONSE", undefined, "缺少 USD/CNY 或包含无效汇率");
  for (const code of ASSET_CODES) delete rates[code];
  const unix = payload.time_last_update_unix;
  const sourceUpdatedAt = isPositiveFinite(unix) ? unix * 1000 : undefined;
  return sourceUpdatedAt === undefined ? { rates } : { rates, sourceUpdatedAt };
}

/** 把 CoinGecko 美元价格换算成「每 1 USD 可换多少单位」；缺失或无效的报价跳过，不估算 */
export function applyAssetQuotes(rates: Record<string, number>, payload: unknown): void {
  if (!isRecord(payload)) return;
  const candidates: readonly (readonly [string, string])[] = [
    ["BTC", "bitcoin"],
    ["XAU", "tether-gold"]
  ];
  for (const [code, key] of candidates) {
    const item = payload[key];
    const price = isRecord(item) ? item.usd : undefined;
    if (!isPositiveFinite(price)) continue;
    const rate = 1 / price;
    if (Number.isFinite(rate) && rate > 0) rates[code] = rate;
  }
}

export type AssetsStatus = "complete" | "partial";

export interface RateSnapshot {
  readonly base: "USD";
  readonly rates: Readonly<Record<string, number>>;
  /** 本机获取时间（毫秒） */
  readonly timestamp: number;
  readonly sourceUpdatedAt?: number;
  /** partial：黄金或比特币报价缺失 */
  readonly assetsStatus: AssetsStatus;
}

/**
 * 并发请求法币汇率与资产报价并合成快照。
 * 法币汇率失败 → 抛错（不返回任何数据）；资产报价失败 → 快照标记 partial，对应币种显示「暂无报价」。
 */
export async function fetchRateSnapshot(request: HttpRequester, now: () => number = Date.now): Promise<RateSnapshot> {
  const [latest, assets] = await Promise.allSettled([
    requestJson(request, LATEST_RATES_URL, NETWORK_POLICY.latestRatesTimeoutMs, NETWORK_POLICY.latestRatesMaxBytes),
    requestJson(request, ASSET_QUOTES_URL, NETWORK_POLICY.assetQuotesTimeoutMs, NETWORK_POLICY.assetQuotesMaxBytes)
  ]);
  if (latest.status === "rejected") {
    throw latest.reason instanceof ExchangeRateError ? latest.reason : new ExchangeRateError("TRANSPORT_ERROR");
  }
  const { rates, sourceUpdatedAt } = validateLatestRates(latest.value);
  if (assets.status === "fulfilled") applyAssetQuotes(rates, assets.value);
  const assetsStatus: AssetsStatus = ASSET_CODES.every((code) => isPositiveFinite(rates[code])) ? "complete" : "partial";
  return {
    base: "USD",
    rates: Object.freeze({ ...rates }),
    timestamp: now(),
    ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
    assetsStatus
  };
}

/** 校验本地缓存；超过 maxAgeMs、时间戳在未来或数据损坏都返回 undefined */
export function parseCachedSnapshot(value: unknown, now: number, maxAgeMs: number): RateSnapshot | undefined {
  if (!isRecord(value) || value.base !== "USD" || !isPositiveFinite(value.timestamp)) return undefined;
  const timestamp = value.timestamp;
  if (timestamp > now || now - timestamp >= maxAgeMs) return undefined;
  if (!isRecord(value.rates)) return undefined;
  const rates = normalizeRates(value.rates);
  if (!rates) return undefined;
  const sourceUpdatedAt = isPositiveFinite(value.sourceUpdatedAt) ? value.sourceUpdatedAt : undefined;
  const assetsStatus: AssetsStatus = ASSET_CODES.every((code) => isPositiveFinite(rates[code])) ? "complete" : "partial";
  return {
    base: "USD",
    rates: Object.freeze(rates),
    timestamp,
    ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
    assetsStatus
  };
}

/* ============================== 设置 ============================== */

export interface Settings {
  /** 源币种 */
  readonly base: string;
  /** 收藏的目标币种（置顶显示） */
  readonly favorites: readonly string[];
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({ base: "CNY", favorites: Object.freeze([]) as readonly string[] });

/**
 * 解析已保存的设置：不存在返回默认值；格式损坏抛错（调用方据此禁止写回，避免覆盖用户数据）。
 * 未知币种会被过滤，收藏去重。
 */
export function parseSettings(raw: unknown): Settings {
  if (raw === undefined || raw === null) return DEFAULT_SETTINGS;
  if (!isRecord(raw)) throw new Error("已保存的设置格式无效");
  const base = isSupportedCurrency(raw.base) ? raw.base : DEFAULT_SETTINGS.base;
  const favorites = Array.isArray(raw.favorites)
    ? [...new Set(raw.favorites.filter((code): code is string => isSupportedCurrency(code)))]
    : [];
  return { base, favorites };
}

export function toggleFavorite(favorites: readonly string[], code: string): string[] {
  return favorites.includes(code) ? favorites.filter((c) => c !== code) : [...favorites, code];
}

/* ============================== 展示 ============================== */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 本地时间 YYYY-MM-DD HH:mm */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "--";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export interface ConversionRow {
  readonly code: string;
  readonly info: CurrencyInfo;
  readonly favorite: boolean;
  /** 不带千分位的换算结果；无报价时为 null */
  readonly value: string | null;
  /** 1 目标币种 = ? 源币种 */
  readonly reverseRate: number | null;
}

/**
 * 生成换算结果行：排除源币种，收藏优先，其余按币种表顺序；
 * 可选只保留指定目标币种或按文本筛选。
 */
export function buildRows(
  snapshot: RateSnapshot,
  base: string,
  amount: number,
  favorites: readonly string[],
  options: { readonly to?: string; readonly filter?: string } = {}
): ConversionRow[] {
  const rows: ConversionRow[] = [];
  for (const info of CURRENCIES) {
    if (info.code === base) continue;
    if (options.to !== undefined && info.code !== options.to) continue;
    if (options.filter !== undefined && !matchCurrency(info, options.filter)) continue;
    const rate = calcRate(snapshot.rates, base, info.code);
    const reverse = calcRate(snapshot.rates, info.code, base);
    rows.push({
      code: info.code,
      info,
      favorite: favorites.includes(info.code),
      value: rate === null ? null : convertAmount(amount, rate, info.code),
      reverseRate: reverse
    });
  }
  const favoriteRank = (code: string) => {
    const i = favorites.indexOf(code);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return rows.sort((a, b) => favoriteRank(a.code) - favoriteRank(b.code));
}
