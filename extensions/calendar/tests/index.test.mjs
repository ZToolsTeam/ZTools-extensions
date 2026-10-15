import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/declarative-ui";
import {
  getCalendarInfo,
  getLunarDate,
  getSolarTerm,
  getFestivals,
  parseDateInput,
  searchCalendarDates,
  isLunarDateSupported,
  formatDateKey
} from "../dist/logic.js";
import CalendarCommand from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("calendar 声明式万年历与节气插件集成测试", () => {
  test("1. plugin.json 结构与规范合规性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "calendar");
    assert.equal(manifest.name, "万年历与节气助手");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)));
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)));
  });

  test("2. 农历转换与干支生肖计算", () => {
    // 2026年春节: 2026-02-17
    const chunjie2026 = new Date(2026, 1, 17);
    const lunarChunjie = getLunarDate(chunjie2026);
    assert.equal(lunarChunjie.year, 2026);
    assert.equal(lunarChunjie.month, 1);
    assert.equal(lunarChunjie.day, 1);
    assert.equal(lunarChunjie.monthName, "正月");
    assert.equal(lunarChunjie.dayName, "初一");
    assert.equal(lunarChunjie.zodiac, "马");
    assert.equal(lunarChunjie.yearGanZhi, "丙午");

    // 2025年国庆中秋: 2025-10-01
    const national2025 = new Date(2025, 9, 1);
    const info2025 = getCalendarInfo(national2025);
    assert.ok(info2025.festivals.includes("国庆节"));
    assert.equal(info2025.holiday?.status, "holiday");
    assert.equal(info2025.holiday?.name, "国庆中秋");

    // 老黄历建除十二神与宜忌
    assert.ok(info2025.almanac);
    assert.ok(info2025.almanac.officer.endsWith("日"));
    assert.ok(info2025.almanac.yi.length > 0);
    assert.ok(info2025.almanac.clash.includes("冲"));
  });

  test("3. 二十四节气与法定节假日断言", () => {
    // 2026年立春大约在2月4日前后
    const spring2026 = new Date(2026, 1, 4);
    const term = getSolarTerm(spring2026);
    assert.equal(term, "立春");

    // 2026年清明: 2026-04-05
    const qingming2026 = new Date(2026, 3, 5);
    const infoQingming = getCalendarInfo(qingming2026);
    assert.equal(infoQingming.solarTerm, "清明");
    assert.ok(infoQingming.festivals.includes("清明节"));
    assert.equal(infoQingming.holiday?.status, "holiday");
  });

  test("4. 日期解析与关键词检索", () => {
    const d1 = parseDateInput("2026-10-01");
    assert.ok(d1);
    assert.equal(formatDateKey(d1), "2026-10-01");

    const d2 = parseDateInput("20250501");
    assert.ok(d2);
    assert.equal(formatDateKey(d2), "2025-05-01");

    // 非法输入测试
    assert.equal(parseDateInput("invalid-date"), null);
    assert.equal(parseDateInput("2026-13-40"), null);

    // 搜索节日
    const searchChunjie = searchCalendarDates("春节", new Date(2026, 0, 1));
    assert.ok(searchChunjie.length > 0);
    assert.ok(searchChunjie.some((item) => item.festivals.includes("春节")));

    // 超出农历支持范围保护
    const outDate = new Date(1890, 0, 1);
    assert.equal(isLunarDateSupported(outDate), false);
    assert.throws(() => getLunarDate(outDate), /LUNAR_DATE_OUT_OF_RANGE/);
  });

  test("5. 声明式 UI 挂载与列表渲染", () => {
    const root = renderDeclarativeRoot(CalendarCommand);
    const desc = root.getLatest();

    assert.ok(desc);
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "万年历与节气助手");
    assert.ok(desc.children.length > 0);

    root.unmount();
  });
});
