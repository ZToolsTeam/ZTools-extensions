import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDeclarativeBridge, setDeclarativeBridge } from "@ztools/declarative-ui";
import { createHost, mount, tick } from "../../shared/test-harness.mjs";
import Command from "../dist/index.js";
import { LATEST_RATES_URL, ASSET_QUOTES_URL, RATE_CACHE_KEY, SETTINGS_KEY } from "../dist/logic.js";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LATEST = {
  result: "success",
  base_code: "USD",
  time_last_update_unix: 1_700_000_000,
  rates: { USD: 1, CNY: 7.1, EUR: 0.9, JPY: 150, GBP: 0.8, KRW: 1400, HKD: 7.8, TWD: 32, SGD: 1.35, AUD: 1.5, CAD: 1.37, CHF: 0.88, THB: 36, RUB: 90, INR: 83 }
};
const ASSETS = { bitcoin: { usd: 50_000 }, "tether-gold": { usd: 2_000 } };
const ok = (payload) => ({ success: true, data: { statusCode: 200, statusText: "OK", body: JSON.stringify(payload) } });

let host;
let view;
let netCalls;

/** 给测试宿主装上插件身份通道 hostTransport，按 URL 返回模拟响应 */
function installNetwork(routes) {
  netCalls = [];
  setDeclarativeBridge({
    ...getDeclarativeBridge(),
    hostTransport: {
      async call(method, params, options) {
        netCalls.push({ method, params, options });
        if (method !== "network_http_request") throw Object.assign(new Error("unexpected"), { code: "NOT_SUPPORTED" });
        const route = routes[params.url];
        if (!route) throw Object.assign(new Error("offline"), { code: "NETWORK_ERROR" });
        return route();
      }
    }
  });
}

const healthy = () => ({ [LATEST_RATES_URL]: async () => ok(LATEST), [ASSET_QUOTES_URL]: async () => ok(ASSETS) });
const summary = () => view.tree().props.filterBar.summaryText;
const ids = () => view.items().map((i) => i.props.id);

beforeEach(() => {
  host = createHost();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
});

describe("清单", () => {
  test("plugin.json 字段与权限", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf8"));
    assert.equal(manifest.id, "exchange-rate");
    assert.equal(manifest.version, "2.0.0");
    assert.equal(manifest.entry, "dist/index.js");
    assert.deepEqual(manifest.category, ["办公效率"]);
    assert.deepEqual([...manifest.permissions].sort(), ["clipboard", "network"]);
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)));
  });
});

describe("联网获取与换算", () => {
  test("默认以人民币为源币种列出其他币种，金额 1", async () => {
    installNetwork(healthy());
    view = await mount(Command);
    assert.equal(ids().includes("rate-CNY"), false);
    assert.equal(view.item("rate-USD").props.title, "0.14 USD");
    assert.deepEqual(view.item("rate-USD").props.accessories, [{ text: "1 USD = 7.1000 CNY" }]);
    assert.equal(view.item("rate-BTC").props.title, "0.00000282 BTC");
    assert.match(summary(), /1 CNY 人民币/);
    assert.match(summary(), /汇率时间/);
    // 两个固定地址的只读 GET 请求
    assert.deepEqual(netCalls.map((c) => c.params.method), ["GET", "GET"]);
    assert.deepEqual(netCalls.map((c) => c.params.url).sort(), [ASSET_QUOTES_URL, LATEST_RATES_URL].sort());
    // 成功后写入缓存
    assert.ok(host.storage.has(RATE_CACHE_KEY));
  });

  test("输入金额 100：按币种小数位与千分位显示", async () => {
    installNetwork(healthy());
    view = await mount(Command);
    await view.search("100");
    assert.equal(view.item("rate-USD").props.title, "14.08 USD");
    assert.equal(view.item("rate-JPY").props.title, "2,113 JPY");
    assert.equal(view.item("rate-XAU").props.title, "0.0070 XAU");
  });

  test("输入 0：结果为 0，不被当成空或报错", async () => {
    installNetwork(healthy());
    view = await mount(Command);
    await view.search("0");
    assert.equal(view.item("rate-USD").props.title, "0.00 USD");
    assert.equal(ids().includes("query-error"), false);
  });

  test("100 USD to CNY：临时源币种 + 只显示目标币种", async () => {
    installNetwork(healthy());
    view = await mount(Command);
    await view.search("100 usd to cny");
    assert.deepEqual(ids(), ["rate-CNY"]);
    assert.equal(view.item("rate-CNY").props.title, "710.00 CNY");
  });

  test("输入币种名筛选", async () => {
    installNetwork(healthy());
    view = await mount(Command);
    await view.search("日元");
    assert.deepEqual(ids(), ["rate-JPY"]);
  });

  test("非法金额与不支持的币种显示错误行", async () => {
    installNetwork(healthy());
    view = await mount(Command);
    await view.search("-5");
    assert.deepEqual(ids(), ["query-error"]);
    await view.search("100 xyz");
    assert.match(view.item("query-error").props.title, /XYZ/);
  });

  test("复制换算结果与等式", async () => {
    installNetwork(healthy());
    view = await mount(Command);
    await view.search("100");
    await view.run(view.item("rate-USD"), "复制换算结果");
    assert.equal(host.clipboard.text, "14.08");
    await view.run(view.item("rate-USD"), "复制换算等式");
    assert.equal(host.clipboard.text, "100 CNY = 14.08 USD");
  });

  test("以目标币种为源币种：金额回填为换算结果并保存", async () => {
    installNetwork(healthy());
    view = await mount(Command);
    await view.search("100");
    await view.run(view.item("rate-USD"), "以 USD 为源币种");
    assert.equal(view.tree().props.searchText, "14.08");
    assert.equal(ids().includes("rate-USD"), false);
    assert.equal(view.item("rate-CNY").props.title, "99.97 CNY");
    assert.equal(JSON.parse(host.storage.get(SETTINGS_KEY)).base, "USD");
  });

  test("下拉切换源币种并持久化", async () => {
    installNetwork(healthy());
    view = await mount(Command);
    await view.dropdown("USD");
    assert.equal(view.tree().props.searchBarAccessory.props.value, "USD");
    assert.equal(view.item("rate-CNY").props.title, "7.10 CNY");
    assert.equal(JSON.parse(host.storage.get(SETTINGS_KEY)).base, "USD");
  });
});

describe("异常路径（零假数据）", () => {
  test("网络失败：只显示错误，不出现任何汇率行", async () => {
    installNetwork({});
    view = await mount(Command);
    assert.deepEqual(ids(), ["rate-error"]);
    assert.match(view.item("rate-error").props.title, /网络请求失败/);
    assert.equal(summary(), "汇率获取失败");
    assert.equal(host.lastToast().title, "获取汇率失败");
    assert.equal(host.storage.has(RATE_CACHE_KEY), false);
  });

  test("HTTP 错误与非法返回如实报错", async () => {
    installNetwork({ [LATEST_RATES_URL]: async () => ({ success: true, data: { statusCode: 500, body: "" } }), [ASSET_QUOTES_URL]: async () => ok(ASSETS) });
    view = await mount(Command);
    assert.match(view.item("rate-error").props.title, /HTTP 500/);
    view.unmount();

    host = createHost();
    installNetwork({ [LATEST_RATES_URL]: async () => ok({ result: "error" }), [ASSET_QUOTES_URL]: async () => ok(ASSETS) });
    view = await mount(Command);
    assert.match(view.item("rate-error").props.title, /数据无效/);
  });

  test("宿主不支持网络通道时提示升级", async () => {
    view = await mount(Command);
    assert.match(view.item("rate-error").props.title, /不支持插件网络请求/);
  });

  test("资产报价失败：黄金/比特币显示暂无报价，其余正常", async () => {
    installNetwork({ [LATEST_RATES_URL]: async () => ok(LATEST) });
    view = await mount(Command);
    assert.equal(view.item("rate-BTC").props.title, "暂无报价 BTC");
    assert.equal(view.item("rate-XAU").props.title, "暂无报价 XAU");
    assert.equal(view.item("rate-USD").props.title, "0.14 USD");
    assert.match(summary(), /黄金\/比特币报价暂缺/);
  });

  test("源币种无报价时给出明确提示", async () => {
    installNetwork({ [LATEST_RATES_URL]: async () => ok(LATEST) });
    view = await mount(Command);
    await view.dropdown("BTC");
    assert.deepEqual(ids(), ["base-unavailable"]);
  });

  test("刷新失败时保留已显示的真实汇率并标注", async () => {
    let fail = false;
    installNetwork({
      [LATEST_RATES_URL]: async () => {
        if (fail) throw Object.assign(new Error("down"), { code: "NETWORK_ERROR" });
        return ok(LATEST);
      },
      [ASSET_QUOTES_URL]: async () => ok(ASSETS)
    });
    view = await mount(Command);
    fail = true;
    await view.tree().props.filterBar.actions[0].onAction();
    await tick();
    assert.equal(view.item("rate-USD").props.title, "0.14 USD");
    assert.match(summary(), /刷新失败/);
  });
});

describe("缓存", () => {
  const cached = (ageMs) => ({
    base: "USD",
    rates: { ...LATEST.rates, BTC: 1 / 50_000, XAU: 1 / 2_000 },
    timestamp: Date.now() - ageMs,
    assetsStatus: "complete"
  });

  test("30 分钟内的缓存直接使用，不联网", async () => {
    installNetwork(healthy());
    host.storage.set(RATE_CACHE_KEY, JSON.stringify(cached(60_000)));
    view = await mount(Command);
    assert.equal(netCalls.length, 0);
    assert.equal(view.item("rate-USD").props.title, "0.14 USD");
    assert.match(summary(), /缓存于/);
  });

  test("刷新汇率跳过缓存重新联网", async () => {
    installNetwork(healthy());
    host.storage.set(RATE_CACHE_KEY, JSON.stringify(cached(60_000)));
    view = await mount(Command);
    await view.tree().props.filterBar.actions[0].onAction();
    await tick();
    assert.equal(netCalls.length, 2);
    assert.doesNotMatch(summary(), /缓存于/);
  });

  test("缓存过期且联网失败：回退显示 7 天内的缓存并标注刷新失败", async () => {
    installNetwork({});
    host.storage.set(RATE_CACHE_KEY, JSON.stringify(cached(2 * 3600_000)));
    view = await mount(Command);
    assert.equal(view.item("rate-USD").props.title, "0.14 USD");
    assert.match(summary(), /刷新失败，显示 .* 获取的缓存/);
    assert.equal(host.lastToast().title, "获取汇率失败");
  });

  test("超过 7 天的缓存不再回退使用", async () => {
    installNetwork({});
    host.storage.set(RATE_CACHE_KEY, JSON.stringify(cached(8 * 24 * 3600_000)));
    view = await mount(Command);
    assert.deepEqual(ids(), ["rate-error"]);
  });

  test("损坏的缓存被忽略并联网获取", async () => {
    installNetwork(healthy());
    host.storage.set(RATE_CACHE_KEY, JSON.stringify({ base: "USD", rates: { USD: 1 }, timestamp: Date.now() }));
    view = await mount(Command);
    assert.equal(netCalls.length, 2);
    assert.equal(view.item("rate-USD").props.title, "0.14 USD");
  });

  test("缓存写入失败：汇率照常显示并提示未保存", async () => {
    installNetwork(healthy());
    host.faults.storageWrite = new Error("disk full");
    view = await mount(Command);
    assert.equal(view.item("rate-USD").props.title, "0.14 USD");
    assert.ok(host.toasts.some((t) => t.title === "汇率已更新，但缓存未保存"));
  });
});

describe("收藏与设置", () => {
  test("收藏置顶并持久化，再次执行取消收藏", async () => {
    installNetwork(healthy());
    view = await mount(Command);
    await view.run(view.item("rate-JPY"), "收藏（置顶）");
    assert.deepEqual(JSON.parse(host.storage.get(SETTINGS_KEY)).favorites, ["JPY"]);
    assert.equal(view.items()[0].props.id, "rate-JPY");
    await view.run(view.item("rate-JPY"), "取消收藏");
    assert.deepEqual(JSON.parse(host.storage.get(SETTINGS_KEY)).favorites, []);
  });

  test("读取已保存的源币种与收藏", async () => {
    installNetwork(healthy());
    host.storage.set(SETTINGS_KEY, JSON.stringify({ base: "USD", favorites: ["EUR", "BOGUS"] }));
    view = await mount(Command);
    assert.equal(view.tree().props.searchBarAccessory.props.value, "USD");
    assert.equal(view.items()[0].props.id, "rate-EUR");
  });

  test("收藏写入失败：抛错且界面不变", async () => {
    installNetwork(healthy());
    view = await mount(Command);
    host.faults.storageWrite = new Error("disk full");
    await assert.rejects(view.run(view.item("rate-JPY"), "收藏（置顶）"), /disk full/);
    assert.equal(host.storage.has(SETTINGS_KEY), false);
    assert.equal(view.items()[0].props.id, "rate-USD");
  });

  test("设置损坏：提示读取失败且拒绝写回覆盖", async () => {
    installNetwork(healthy());
    host.storage.set(SETTINGS_KEY, JSON.stringify("corrupted"));
    view = await mount(Command);
    assert.ok(host.toasts.some((t) => t.title === "设置读取失败，本次修改不会保存"));
    await assert.rejects(view.run(view.item("rate-JPY"), "收藏（置顶）"), /设置读取失败/);
    assert.equal(host.storage.get(SETTINGS_KEY), JSON.stringify("corrupted"));
  });

  test("卸载后晚到的网络结果不再更新状态", async () => {
    let release;
    installNetwork({
      [LATEST_RATES_URL]: () => new Promise((resolve) => { release = () => resolve(ok(LATEST)); }),
      [ASSET_QUOTES_URL]: async () => ok(ASSETS)
    });
    view = await mount(Command);
    view.unmount();
    view = undefined;
    const toastsBefore = host.toasts.length;
    release();
    await tick();
    assert.equal(host.storage.has(RATE_CACHE_KEY), false);
    assert.equal(host.toasts.length, toastsBefore);
  });
});
