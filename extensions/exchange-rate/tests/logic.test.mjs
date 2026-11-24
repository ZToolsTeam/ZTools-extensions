import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENCIES,
  NETWORK_POLICY,
  LATEST_RATES_URL,
  ASSET_QUOTES_URL,
  ExchangeRateError,
  applyAssetQuotes,
  buildRows,
  calcRate,
  convertAmount,
  fetchRateSnapshot,
  formatRate,
  getDecimals,
  groupDigits,
  matchCurrency,
  normalizeRates,
  parseAmount,
  parseCachedSnapshot,
  parseHostResponse,
  parseQuery,
  parseSettings,
  requestJson,
  toInputAmount,
  toggleFavorite,
  validateLatestRates
} from "../dist/logic.js";

const LATEST = {
  result: "success",
  base_code: "USD",
  time_last_update_unix: 1_700_000_000,
  rates: { USD: 1, CNY: 7.1, EUR: 0.9, JPY: 150, XAU: 0.0005, AAA: 3 }
};
const ASSETS = { bitcoin: { usd: 50_000 }, "tether-gold": { usd: 2_000 } };
const ok = (payload) => ({ success: true, data: { statusCode: 200, statusText: "OK", body: JSON.stringify(payload) } });

function requester(map) {
  const calls = [];
  const fn = async (url, timeoutMs) => {
    calls.push({ url, timeoutMs });
    const handler = map[url];
    if (!handler) throw new Error(`未模拟 ${url}`);
    return handler();
  };
  fn.calls = calls;
  return fn;
}

describe("金额解析与换算", () => {
  test("parseAmount：0 是合法金额，不被当成空", () => {
    assert.equal(parseAmount("0"), 0);
    assert.equal(parseAmount("0.00"), 0);
    assert.equal(parseAmount(" 1,234.5 "), 1234.5);
    assert.equal(parseAmount(".5"), 0.5);
    assert.equal(parseAmount("1."), 1);
  });

  test("parseAmount：非法输入返回 null", () => {
    for (const bad of ["", "  ", "-1", "1,23", "1e3", "abc", "1.2.3", "+5", "12,34,567"]) {
      assert.equal(parseAmount(bad), null, bad);
    }
  });

  test("calcRate：交叉汇率与缺失/非法值", () => {
    const rates = { USD: 1, CNY: 7, JPY: 140 };
    assert.equal(calcRate(rates, "CNY", "JPY"), 20);
    assert.equal(calcRate(rates, "USD", "USD"), 1);
    assert.equal(calcRate(rates, "CNY", "BTC"), null);
    assert.equal(calcRate({ USD: 1, CNY: 0 }, "USD", "CNY"), null);
    assert.equal(calcRate({ USD: 1, CNY: Number.NaN }, "USD", "CNY"), null);
  });

  test("convertAmount：按币种小数位，0 金额得到 0 而不是空", () => {
    assert.equal(convertAmount(0, 0.14, "USD"), "0.00");
    assert.equal(convertAmount(100, 21.1267, "JPY"), "2113");
    assert.equal(convertAmount(1, 0.000002, "BTC"), "0.00000200");
    assert.equal(convertAmount(1, 0.00048, "XAU"), "0.0005");
    assert.equal(convertAmount(1, 0, "USD"), null);
    assert.equal(convertAmount(-1, 1, "USD"), null);
    assert.equal(convertAmount(1e300, 1e300, "USD"), null);
  });

  test("getDecimals / formatRate / groupDigits / toInputAmount", () => {
    assert.deepEqual(["JPY", "KRW", "BTC", "XAU", "USD"].map(getDecimals), [0, 0, 8, 4, 2]);
    assert.equal(formatRate(null), "--");
    assert.equal(formatRate(0), "--");
    assert.equal(formatRate(7.1), "7.1000");
    assert.equal(formatRate(150.123), "150.12");
    assert.equal(formatRate(50000), "50000");
    assert.equal(formatRate(0.14), "0.140000");
    assert.equal(groupDigits("1234567.89"), "1,234,567.89");
    assert.equal(groupDigits("999"), "999");
    assert.equal(groupDigits("0.00028169"), "0.00028169");
    assert.equal(toInputAmount("14.10"), "14.1");
    assert.equal(toInputAmount("2113"), "2113");
    assert.equal(toInputAmount("0.00"), "0");
  });
});

describe("搜索框解析", () => {
  test("空输入默认金额 1", () => {
    assert.deepEqual(parseQuery(""), { kind: "amount", amount: 1, amountText: "1" });
  });

  test("金额 / 源币种 / 目标币种多种写法", () => {
    assert.deepEqual(parseQuery("100"), { kind: "amount", amount: 100, amountText: "100" });
    assert.deepEqual(parseQuery("0"), { kind: "amount", amount: 0, amountText: "0" });
    assert.deepEqual(parseQuery("1,000 usd"), { kind: "amount", amount: 1000, amountText: "1000", from: "USD" });
    assert.deepEqual(parseQuery("100 usd to cny"), { kind: "amount", amount: 100, amountText: "100", from: "USD", to: "CNY" });
    assert.deepEqual(parseQuery("100usd=jpy"), { kind: "amount", amount: 100, amountText: "100", from: "USD", to: "JPY" });
    assert.deepEqual(parseQuery("5 btc 转 cny"), { kind: "amount", amount: 5, amountText: "5", from: "BTC", to: "CNY" });
  });

  test("非法金额与不支持的币种报错", () => {
    assert.equal(parseQuery("-5").kind, "error");
    assert.equal(parseQuery("1,23").kind, "error");
    const unsupported = parseQuery("100 xyz");
    assert.equal(unsupported.kind, "error");
    assert.match(unsupported.message, /XYZ/);
  });

  test("非数字文本按币种筛选", () => {
    const q = parseQuery("日元");
    assert.equal(q.kind, "filter");
    const matched = CURRENCIES.filter((c) => matchCurrency(c, q.text)).map((c) => c.code);
    assert.deepEqual(matched, ["JPY"]);
    assert.deepEqual(CURRENCIES.filter((c) => matchCurrency(c, "gold")).map((c) => c.code), ["XAU"]);
    assert.deepEqual(CURRENCIES.filter((c) => matchCurrency(c, "bitcoin")).map((c) => c.code), ["BTC"]);
  });
});

describe("数据源解析", () => {
  test("parseHostResponse：兼容单/双层包装与裸响应", () => {
    assert.deepEqual(parseHostResponse({ statusCode: 200, body: "{}" }, 100), { statusCode: 200, body: "{}" });
    assert.deepEqual(parseHostResponse(ok({}), 100).statusCode, 200);
    assert.deepEqual(parseHostResponse({ success: true, data: ok({ a: 1 }) }, 100).body, '{"a":1}');
  });

  test("parseHostResponse：缺字段、类型错误与超限都判为无效", () => {
    for (const bad of [null, "x", {}, { statusCode: "200", body: "" }, { statusCode: 200 }, { success: false, data: { statusCode: 200, body: "" } }]) {
      assert.throws(() => parseHostResponse(bad, 100), (e) => e instanceof ExchangeRateError && e.code === "INVALID_RESPONSE");
    }
    assert.throws(() => parseHostResponse({ statusCode: 200, body: "x".repeat(101) }, 100), /响应体过大/);
    // 多字节字符按 UTF-8 字节数计
    assert.throws(() => parseHostResponse({ statusCode: 200, body: "汇".repeat(40) }, 100), /响应体过大/);
  });

  test("requestJson：HTTP 错误、非法 JSON、非对象、传输失败与超时", async () => {
    const cases = [
      [async () => ({ statusCode: 500, body: "{}" }), "HTTP_ERROR", /HTTP 500/],
      [async () => ({ statusCode: 200, body: "<html>" }), "INVALID_RESPONSE", /JSON/],
      [async () => ({ statusCode: 200, body: "[1,2]" }), "INVALID_RESPONSE", /无效/],
      [async () => { throw Object.assign(new Error("boom"), { code: "NETWORK_ERROR" }); }, "TRANSPORT_ERROR", /NETWORK_ERROR/],
      [async () => { throw Object.assign(new Error("slow"), { code: "REQUEST_TIMEOUT" }); }, "TIMEOUT", /超时/],
      [async () => { throw new Error("no code"); }, "TRANSPORT_ERROR", /网络请求失败/]
    ];
    for (const [fn, code, pattern] of cases) {
      await assert.rejects(requestJson(fn, "https://x.test", 1000, 1024), (e) => e instanceof ExchangeRateError && e.code === code && pattern.test(e.message));
    }
  });

  test("错误信息不泄露原始响应体", async () => {
    const secret = "SECRET-BODY-CONTENT";
    await assert.rejects(requestJson(async () => ({ statusCode: 200, body: secret }), "https://x.test", 1000, 1024), (e) => !e.message.includes(secret));
  });

  test("normalizeRates：只保留支持币种，USD 必须为 1 且含 CNY", () => {
    assert.deepEqual(normalizeRates({ USD: 1, CNY: 7, AAA: 2 }), { USD: 1, CNY: 7 });
    assert.equal(normalizeRates({ USD: 1 }), undefined);
    assert.equal(normalizeRates({ USD: 2, CNY: 7 }), undefined);
    assert.equal(normalizeRates({ USD: 1, CNY: 7, EUR: -1 }), undefined);
    assert.equal(normalizeRates({ USD: 1, CNY: 7, EUR: "0.9" }), undefined);
    assert.equal(normalizeRates([1]), undefined);
  });

  test("validateLatestRates：剔除 XAU/BTC，解析数据源更新时间", () => {
    const parsed = validateLatestRates(LATEST);
    assert.deepEqual(parsed.rates, { USD: 1, CNY: 7.1, EUR: 0.9, JPY: 150 });
    assert.equal(parsed.sourceUpdatedAt, 1_700_000_000_000);
    assert.throws(() => validateLatestRates({ ...LATEST, result: "error" }), ExchangeRateError);
    assert.throws(() => validateLatestRates({ ...LATEST, base_code: "EUR" }), ExchangeRateError);
    assert.throws(() => validateLatestRates({ ...LATEST, rates: { USD: 1 } }), /缺少 USD\/CNY/);
    const noTime = validateLatestRates({ ...LATEST, time_last_update_unix: "x" });
    assert.equal("sourceUpdatedAt" in noTime, false);
  });

  test("applyAssetQuotes：价格取倒数，缺失/0/负数/非数字跳过", () => {
    const rates = { USD: 1, CNY: 7 };
    applyAssetQuotes(rates, ASSETS);
    assert.equal(rates.BTC, 1 / 50_000);
    assert.equal(rates.XAU, 1 / 2_000);
    const partial = { USD: 1, CNY: 7 };
    applyAssetQuotes(partial, { bitcoin: { usd: 0 }, "tether-gold": { usd: -3 } });
    assert.deepEqual(partial, { USD: 1, CNY: 7 });
    applyAssetQuotes(partial, { bitcoin: { usd: "100" } });
    applyAssetQuotes(partial, null);
    assert.deepEqual(partial, { USD: 1, CNY: 7 });
  });
});

describe("fetchRateSnapshot", () => {
  test("成功：合并法币与资产报价，使用固定地址与超时", async () => {
    const req = requester({ [LATEST_RATES_URL]: async () => ok(LATEST), [ASSET_QUOTES_URL]: async () => ok(ASSETS) });
    const snap = await fetchRateSnapshot(req, () => 1234);
    assert.equal(snap.timestamp, 1234);
    assert.equal(snap.assetsStatus, "complete");
    assert.equal(snap.rates.BTC, 1 / 50_000);
    assert.equal(snap.rates.XAU, 1 / 2_000);
    assert.equal(snap.sourceUpdatedAt, 1_700_000_000_000);
    const timeouts = Object.fromEntries(req.calls.map((c) => [c.url, c.timeoutMs]));
    assert.deepEqual(timeouts, { [LATEST_RATES_URL]: NETWORK_POLICY.latestRatesTimeoutMs, [ASSET_QUOTES_URL]: NETWORK_POLICY.assetQuotesTimeoutMs });
  });

  test("资产报价失败只标记 partial，不伪造报价", async () => {
    const req = requester({ [LATEST_RATES_URL]: async () => ok(LATEST), [ASSET_QUOTES_URL]: async () => { throw new Error("down"); } });
    const snap = await fetchRateSnapshot(req);
    assert.equal(snap.assetsStatus, "partial");
    assert.equal(snap.rates.BTC, undefined);
    assert.equal(snap.rates.XAU, undefined);
    assert.equal(snap.rates.CNY, 7.1);
  });

  test("只拿到一个资产报价也是 partial", async () => {
    const req = requester({ [LATEST_RATES_URL]: async () => ok(LATEST), [ASSET_QUOTES_URL]: async () => ok({ bitcoin: { usd: 1 } }) });
    const snap = await fetchRateSnapshot(req);
    assert.equal(snap.assetsStatus, "partial");
    assert.equal(snap.rates.BTC, 1);
  });

  test("法币汇率失败整体抛错，不返回任何数据", async () => {
    const req = requester({ [LATEST_RATES_URL]: async () => ({ statusCode: 503, body: "" }), [ASSET_QUOTES_URL]: async () => ok(ASSETS) });
    await assert.rejects(fetchRateSnapshot(req), (e) => e instanceof ExchangeRateError && e.code === "HTTP_ERROR" && e.statusCode === 503);
    const bad = requester({ [LATEST_RATES_URL]: async () => ok({ result: "success", base_code: "USD", rates: { USD: 1, CNY: 0 } }), [ASSET_QUOTES_URL]: async () => ok(ASSETS) });
    await assert.rejects(fetchRateSnapshot(bad), (e) => e.code === "INVALID_RESPONSE");
  });
});

describe("缓存与设置", () => {
  const snapshot = { base: "USD", rates: { USD: 1, CNY: 7, BTC: 0.00002, XAU: 0.0005 }, timestamp: 1_000_000, assetsStatus: "complete" };

  test("parseCachedSnapshot：新鲜缓存可用", () => {
    const parsed = parseCachedSnapshot(snapshot, 1_000_000 + 60_000, NETWORK_POLICY.cacheTtlMs);
    assert.equal(parsed.timestamp, 1_000_000);
    assert.equal(parsed.assetsStatus, "complete");
  });

  test("parseCachedSnapshot：过期、未来时间、损坏均不可用", () => {
    const ttl = NETWORK_POLICY.cacheTtlMs;
    assert.equal(parseCachedSnapshot(snapshot, 1_000_000 + ttl, ttl), undefined);
    assert.equal(parseCachedSnapshot(snapshot, 999_999, ttl), undefined);
    for (const bad of [undefined, null, "x", { ...snapshot, base: "EUR" }, { ...snapshot, timestamp: 0 }, { ...snapshot, rates: { USD: 1 } }, { ...snapshot, rates: "x" }]) {
      assert.equal(parseCachedSnapshot(bad, 1_000_001, ttl), undefined);
    }
  });

  test("parseCachedSnapshot：缺资产报价时为 partial", () => {
    const parsed = parseCachedSnapshot({ ...snapshot, rates: { USD: 1, CNY: 7 } }, 1_000_001, NETWORK_POLICY.cacheTtlMs);
    assert.equal(parsed.assetsStatus, "partial");
  });

  test("parseSettings：默认值、过滤未知币种、去重、损坏抛错", () => {
    assert.deepEqual(parseSettings(undefined), { base: "CNY", favorites: [] });
    assert.deepEqual(parseSettings({ base: "USD", favorites: ["JPY", "JPY", "XXX", 3, "BTC"] }), { base: "USD", favorites: ["JPY", "BTC"] });
    assert.deepEqual(parseSettings({ base: "XXX" }), { base: "CNY", favorites: [] });
    assert.throws(() => parseSettings("broken"));
    assert.throws(() => parseSettings([1]));
  });

  test("toggleFavorite", () => {
    assert.deepEqual(toggleFavorite([], "USD"), ["USD"]);
    assert.deepEqual(toggleFavorite(["USD", "EUR"], "USD"), ["EUR"]);
  });

  test("buildRows：排除源币种、收藏置顶、目标筛选、无报价为 null", () => {
    const rows = buildRows({ ...snapshot, rates: { USD: 1, CNY: 7, JPY: 140 } }, "CNY", 0, ["JPY"]);
    assert.equal(rows.some((r) => r.code === "CNY"), false);
    assert.equal(rows[0].code, "JPY");
    assert.equal(rows[0].value, "0");
    const usd = rows.find((r) => r.code === "USD");
    assert.equal(usd.value, "0.00");
    assert.equal(usd.reverseRate, 7);
    assert.equal(rows.find((r) => r.code === "BTC").value, null);
    assert.deepEqual(buildRows(snapshot, "CNY", 1, [], { to: "USD" }).map((r) => r.code), ["USD"]);
    assert.deepEqual(buildRows(snapshot, "CNY", 1, [], { filter: "比特币" }).map((r) => r.code), ["BTC"]);
  });
});
