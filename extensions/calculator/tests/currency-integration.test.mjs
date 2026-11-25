import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getDeclarativeBridge, setDeclarativeBridge } from "@ztools/declarative-ui";
import { createHost, mount, mountPushed, tick } from "../../shared/test-harness.mjs";
import CalculatorCommand, { calcCurrency } from "../dist/index.js";
import {
  CURRENCIES,
  NETWORK_POLICY,
  LATEST_RATES_URL,
  ASSET_QUOTES_URL,
  RATE_CACHE_KEY,
  SETTINGS_KEY,
  ExchangeRateError,
  applyAssetQuotes,
  buildRows,
  calcRate,
  convertAmount,
  evaluateInlineCurrency,
  fetchRateSnapshot,
  formatRate,
  getDecimals,
  groupDigits,
  matchCurrency,
  normalizeRates,
  parseAmount,
  parseCachedSnapshot,
  parseHostResponse,
  parseInlineCurrencyQuery,
  parseQuery,
  parseSettings,
  requestJson,
  resolveCurrencyToken,
  toInputAmount,
  toggleFavorite,
  validateLatestRates
} from "../dist/currency-rates.js";

const HISTORY_KEY = "ztools-calculator-history-v1";

const LATEST = {
  result: "success",
  base_code: "USD",
  time_last_update_unix: 1_700_000_000,
  rates: {
    USD: 1,
    CNY: 7.1,
    EUR: 0.9,
    JPY: 150,
    GBP: 0.8,
    KRW: 1400,
    HKD: 7.8,
    TWD: 32,
    SGD: 1.35,
    AUD: 1.5,
    CAD: 1.37,
    CHF: 0.88,
    THB: 36,
    RUB: 90,
    INR: 83,
    XAU: 0.0005,
    AAA: 3
  }
};
const ASSETS = { bitcoin: { usd: 50_000 }, "tether-gold": { usd: 2_000 } };
const ok = (payload) => ({ success: true, data: { statusCode: 200, statusText: "OK", body: JSON.stringify(payload) } });

let host;
let view;
let netCalls;

function installNetwork(routes) {
  netCalls = [];
  setDeclarativeBridge({
    ...getDeclarativeBridge(),
    hostTransport: {
      async call(method, params, options) {
        netCalls.push({ method, params, options });
        if (method !== "network_http_request") {
          throw Object.assign(new Error("unexpected"), { code: "NOT_SUPPORTED" });
        }
        const route = routes[params.url];
        if (!route) throw Object.assign(new Error("offline"), { code: "NETWORK_ERROR" });
        return route();
      }
    }
  });
}

const healthy = () => ({
  [LATEST_RATES_URL]: async () => ok(LATEST),
  [ASSET_QUOTES_URL]: async () => ok(ASSETS)
});

beforeEach(() => {
  host = createHost();
  netCalls = [];
});

afterEach(() => {
  view?.unmount();
  view = undefined;
});

describe("汇率纯逻辑与解析", () => {
  test("parseAmount：0 为合法金额，非法格式返回 null", () => {
    assert.equal(parseAmount("0"), 0);
    assert.equal(parseAmount("0.00"), 0);
    assert.equal(parseAmount(" 1,234.5 "), 1234.5);
    assert.equal(parseAmount(".5"), 0.5);
    for (const bad of ["", "  ", "-1", "1,23", "1e3", "abc", "1.2.3", "+5"]) {
      assert.equal(parseAmount(bad), null, bad);
    }
  });

  test("币种代码与中英文别名解析", () => {
    assert.equal(resolveCurrencyToken("USD"), "USD");
    assert.equal(resolveCurrencyToken("美金"), "USD");
    assert.equal(resolveCurrencyToken("rmb"), "CNY");
    assert.equal(resolveCurrencyToken("日元"), "JPY");
    assert.equal(resolveCurrencyToken("gold"), "XAU");
    assert.equal(resolveCurrencyToken("比特币"), "BTC");
    assert.equal(resolveCurrencyToken("xyz"), undefined);
  });

  test("parseQuery 与 parseInlineCurrencyQuery：看板与主计算器语法隔离", () => {
    assert.deepEqual(parseQuery(""), { kind: "amount", amount: 1, amountText: "1" });
    assert.deepEqual(parseQuery("100"), { kind: "amount", amount: 100, amountText: "100" });
    assert.deepEqual(parseQuery("1,000 usd"), { kind: "amount", amount: 1000, amountText: "1000", from: "USD" });
    assert.deepEqual(parseQuery("100 美元 转 人民币"), {
      kind: "amount",
      amount: 100,
      amountText: "100",
      from: "USD",
      to: "CNY"
    });
    assert.equal(parseQuery("日元").kind, "filter");
    assert.equal(parseQuery("100 xyz").kind, "error");

    // 主计算器内联算式：纯数字或非货币不误触发
    assert.equal(parseInlineCurrencyQuery("100"), null);
    assert.equal(parseInlineCurrencyQuery("10 foo to bar"), null);
    assert.deepEqual(parseInlineCurrencyQuery("100 usd to cny"), {
      kind: "convert",
      expression: "100 usd to cny",
      amount: 100,
      amountText: "100",
      from: "USD",
      to: "CNY"
    });
    assert.deepEqual(parseInlineCurrencyQuery("5,000 日元 转 rmb"), {
      kind: "convert",
      expression: "5,000 日元 转 rmb",
      amount: 5000,
      amountText: "5000",
      from: "JPY",
      to: "CNY"
    });
    assert.equal(parseInlineCurrencyQuery("100 USD to XYZ")?.kind, "error");
    assert.equal(parseInlineCurrencyQuery("-10 USD to CNY")?.kind, "error");
    assert.equal(parseInlineCurrencyQuery("1,23 USD to CNY")?.kind, "error");
  });

  test("数据源校验、部分资产降级、缓存与收藏设置", async () => {
    assert.deepEqual(parseHostResponse({ statusCode: 200, body: "{}" }, 100), { statusCode: 200, body: "{}" });
    assert.throws(() => parseHostResponse({ statusCode: 200, body: "汇".repeat(40) }, 100), /响应体过大/);
    await assert.rejects(
      requestJson(async () => ({ statusCode: 200, body: "SECRET-BODY" }), "https://x.test", 1000, 1024),
      (e) => e instanceof ExchangeRateError && !e.message.includes("SECRET-BODY")
    );

    const parsed = validateLatestRates(LATEST);
    assert.equal(parsed.rates.XAU, undefined);
    assert.equal(parsed.rates.AAA, undefined);
    applyAssetQuotes(parsed.rates, ASSETS);
    assert.equal(parsed.rates.BTC, 1 / 50_000);
    assert.equal(parsed.rates.XAU, 1 / 2_000);

    const snap = await fetchRateSnapshot(async (url) => {
      if (url === LATEST_RATES_URL) return ok(LATEST);
      throw new Error("coingecko down");
    });
    assert.equal(snap.assetsStatus, "partial");
    assert.equal(snap.rates.BTC, undefined);
    assert.equal(snap.rates.CNY, 7.1);

    assert.equal(parseCachedSnapshot(snap, snap.timestamp + 1000, NETWORK_POLICY.cacheTtlMs)?.assetsStatus, "partial");
    assert.equal(parseCachedSnapshot(snap, snap.timestamp + NETWORK_POLICY.cacheTtlMs + 1, NETWORK_POLICY.cacheTtlMs), undefined);
    assert.deepEqual(parseSettings({ base: "USD", favorites: ["JPY", "JPY", "BAD"] }), {
      base: "USD",
      favorites: ["JPY"]
    });
    assert.throws(() => parseSettings("corrupted"));
    assert.deepEqual(toggleFavorite(["USD"], "JPY"), ["USD", "JPY"]);
    assert.deepEqual(toggleFavorite(["USD", "JPY"], "USD"), ["JPY"]);
  });
});

describe("多币种汇率看板（calcCurrency）", () => {
  test("默认人民币源币种、金额换算、收藏置顶、源币种切换与反向回填", async () => {
    installNetwork(healthy());
    view = await mount(calcCurrency);
    assert.equal(view.item("rate-USD").props.title, "0.14 USD");
    assert.equal(view.item("rate-BTC").props.title, "0.00000282 BTC");
    assert.deepEqual(netCalls.map((c) => c.params.url).sort(), [ASSET_QUOTES_URL, LATEST_RATES_URL].sort());

    await view.search("100");
    assert.equal(view.item("rate-USD").props.title, "14.08 USD");
    assert.equal(view.item("rate-JPY").props.title, "2,113 JPY");

    // 收藏置顶并持久化
    await view.run(view.item("rate-JPY"), "收藏（置顶）");
    assert.equal(view.items()[0].props.id, "rate-JPY");
    assert.deepEqual(JSON.parse(host.storage.get(SETTINGS_KEY)).favorites, ["JPY"]);

    // 以 USD 为源币种并回填换算金额
    await view.run(view.item("rate-USD"), "以 USD 为源币种");
    assert.equal(view.tree().props.searchText, "14.08");
    assert.equal(JSON.parse(host.storage.get(SETTINGS_KEY)).base, "USD");
  });

  test("部分资产缺失与设置损坏保护（拒绝覆盖已有损坏设置）", async () => {
    host.storage.set(SETTINGS_KEY, JSON.stringify("corrupted-string"));
    installNetwork({ [LATEST_RATES_URL]: async () => ok(LATEST) });
    view = await mount(calcCurrency);
    assert.equal(view.item("rate-BTC").props.title, "暂无报价 BTC");
    assert.match(view.tree().props.filterBar.summaryText, /黄金\/比特币报价暂缺/);
    await assert.rejects(() => view.run(view.item("rate-USD"), "收藏（置顶）"), /设置读取失败/);
    assert.equal(host.storage.get(SETTINGS_KEY), JSON.stringify("corrupted-string"));
  });
});

describe("计算器主视图内联汇率换算联动", () => {
  test("常规算式与单位换算不发起任何汇率网络请求", async () => {
    installNetwork(healthy());
    view = await mount(CalculatorCommand);
    await view.search("1024 * 768");
    await view.search("10km to miles");
    assert.equal(netCalls.length, 0);
  });

  test("输入货币算式按需拉取真实汇率、支持中英文别名、0 金额、写入汇率历史与 Ctrl+E 填回计算", async () => {
    installNetwork(healthy());
    view = await mount(CalculatorCommand);

    await view.search("100 usd to cny");
    await tick(10);
    const item = view.item("calc-success");
    assert.equal(item.props.title, "= 710.00 CNY");
    assert.match(item.props.subtitle, /1 USD = 7\.1000 CNY/);
    assert.equal(netCalls.length, 2);

    // 0 金额合法换算为 0.00，不报错
    await view.search("0 美元 转 人民币");
    assert.equal(view.item("calc-success").props.title, "= 0.00 CNY");

    // 中文别名 + 黄金/比特币换算（复用已加载快照，不再重复请求网络）
    await view.search("1 黄金 to usd");
    assert.equal(view.item("calc-success").props.title, "= 2,000.00 USD");
    assert.equal(netCalls.length, 2);

    // 复制结果自动记入 currency 类型历史
    await view.search("100 usd to cny");
    await view.run(view.item("calc-success"), "复制计算结果");
    assert.equal(host.clipboard.text, "710.00 CNY");
    const history = JSON.parse(host.storage.get(HISTORY_KEY));
    assert.equal(history[0].type, "currency");
    assert.equal(history[0].expression, "100 usd to cny");
    assert.equal(history[0].answer, "710.00 CNY");

    // 将结果填入输入框：去除单位与尾随零变为纯数字 710，可继续四则运算
    await view.run(view.item("calc-success"), "将结果填入输入框");
    assert.equal(view.tree().props.searchText, "710");
    assert.equal(view.item("calc-success").props.title, "= 710");

    // 在汇率看板中查看全部币种（自动携带金额与源币种）
    await view.search("250 eur to cny");
    await view.run(view.item("calc-success"), "在汇率看板中查看全部币种…");
    const board = await mountPushed(host);
    try {
      assert.equal(board.tree().props.navigationTitle, "汇率换算");
      assert.equal(board.tree().props.searchText, "250 EUR");
    } finally {
      board.unmount();
    }
  });

  test("[破坏性] 主视图内联汇率离线无缓存、不支持币种与负数金额均明确报错，绝不造假", async () => {
    installNetwork({});
    view = await mount(CalculatorCommand);

    await view.search("100 usd to cny");
    await tick(10);
    assert.equal(view.items().some((i) => i.props.id === "calc-success"), false);
    const errRow = view.item("calc-error");
    assert.equal(errRow.props.title, "汇率换算无法完成");
    assert.match(errRow.props.subtitle, /不使用估算汇率/);

    await view.search("100 usd to xyz");
    assert.match(view.item("calc-error").props.subtitle, /XYZ/);

    await view.search("-50 usd to cny");
    assert.match(view.item("calc-error").props.subtitle, /负数/);
  });
});
