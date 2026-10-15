import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/declarative-ui";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("unit-converter 插件规范与端到端集成测试", () => {
  test("1. plugin.json 清单结构合规性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "unit-converter");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)), "icon.svg 文件必须存在");
  });

  test("2. 度量衡多分类换算引擎精度 (长度、质量、数据、温度等)", async () => {
    const { convertUnit, formatConvertedValue, convertToAllUnits } = await import("../dist/logic.js");

    // 长度: 1 米 = 1000 毫米 = 0.001 千米
    assert.equal(convertUnit(1, "length", "meter", "millimeter"), 1000);
    assert.equal(convertUnit(1, "length", "meter", "kilometer"), 0.001);
    // 1 英寸 = 0.0254 米
    assert.equal(convertUnit(1, "length", "inch", "meter"), 0.0254);

    // 质量: 1 千克 = 1000 克 = 2 斤
    assert.equal(convertUnit(1, "mass", "kilogram", "gram"), 1000);
    assert.equal(convertUnit(1, "mass", "kilogram", "jin"), 2);

    // 数据存储: 1 MiB = 1024 KiB = 1048576 B
    assert.equal(convertUnit(1, "data", "mebibyte", "kibibyte"), 1024);
    assert.equal(convertUnit(1, "data", "megabyte", "kilobyte"), 1000);

    // 速度: 36 km/h = 10 m/s
    const speed = convertUnit(36, "speed", "kilometer-per-hour", "meter-per-second");
    assert.ok(Math.abs((speed || 0) - 10) < 1e-6);

    // 温度非线性转换: -40 °C == -40 °F
    const tMinus40 = convertUnit(-40, "temperature", "celsius", "fahrenheit");
    assert.ok(Math.abs((tMinus40 || 0) - -40) < 1e-6);

    // 0 °C == 32 °F == 273.15 K
    const t0C_F = convertUnit(0, "temperature", "celsius", "fahrenheit");
    const t0C_K = convertUnit(0, "temperature", "celsius", "kelvin");
    assert.equal(t0C_F, 32);
    assert.equal(t0C_K, 273.15);

    // 格式化输出
    assert.equal(formatConvertedValue(3.1415926, 2), "3.14");
    assert.equal(formatConvertedValue(3.1415926, 4), "3.1416");

    // 全量换算列表
    const all = convertToAllUnits(100, "length", "meter", 2);
    assert.ok(all.length >= 8);
    const kmItem = all.find((i) => i.unit.id === "kilometer");
    assert.ok(kmItem);
    assert.equal(kmItem.formatted, "0.1");
  });

  test("3. 异常分支与边界数值防御测试", async () => {
    const { convertUnit, parseUnitInput, formatConvertedValue } = await import("../dist/logic.js");

    // 异常 1: 非法输入解析
    assert.equal(parseUnitInput("abc"), null);
    assert.equal(parseUnitInput(""), null);
    assert.equal(parseUnitInput("0x10"), null); // 不支持非标准16进制作为普通数值

    // 正常科学计数法
    assert.equal(parseUnitInput("1e3"), 1000);

    // 异常 2: 无穷大或 NaN
    assert.equal(convertUnit(NaN, "length", "meter", "kilometer"), null);
    assert.equal(convertUnit(Infinity, "length", "meter", "kilometer"), null);

    // 异常 3: 不存在的单位 ID
    assert.equal(convertUnit(10, "length", "non-existent", "meter"), null);

    // 异常 4: 空值格式化
    assert.equal(formatConvertedValue(null, 4), "");
  });

  test("4. 声明式 UI 挂载与结构渲染", async () => {
    const { default: UnitConverterCommand } = await import("../dist/index.js");

    const root = renderDeclarativeRoot(UnitConverterCommand);
    const desc = root.getLatest();

    assert.ok(desc, "渲染视图描述符必须存在");
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "度量衡与单位换算");
    assert.ok(desc.props.searchBarAccessory, "顶部必须包含分类切换下拉框");
    assert.ok(desc.children.length >= 2, "必须包含换算结果区和分类切换区");

    root.unmount();
  });
});
