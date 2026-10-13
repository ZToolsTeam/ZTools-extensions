import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/raycast-compat";
import { evaluateExpression, formatResultNumber } from "../dist/engine.js";
import CalculatorCommand from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("calculator 范例插件集成测试", () => {
  test("1. plugin.json 清单结构合规性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "calculator");
    assert.equal(manifest.name, "极简即时计算器");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)));
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)));
  });

  test("2. 算式解析与数学求值引擎 (覆盖正常、边界与异常分支)", () => {
    // 基础四则运算与运算符优先级
    const r1 = evaluateExpression("1 + 2 * 3");
    assert.equal(r1.success, true);
    assert.equal(r1.value, 7);

    // 括号与嵌套
    const r2 = evaluateExpression("(10 + 20) * 2 / 5");
    assert.equal(r2.success, true);
    assert.equal(r2.value, 12);

    // 常用数学函数 (sqrt, sin, cos, abs, log)
    const r3 = evaluateExpression("sqrt(144)");
    assert.equal(r3.success, true);
    assert.equal(r3.value, 12);

    const rPow = evaluateExpression("2 ^ 10");
    assert.equal(rPow.success, true);
    assert.equal(rPow.value, 1024);

    // 浮点数精度与格式化
    assert.equal(formatResultNumber(0.1 + 0.2), "0.3");

    // 异常场景 1: 除以零 (安全处理，拦截除零错误)
    const rDivZero = evaluateExpression("10 / 0");
    assert.equal(rDivZero.success, false);
    assert.match(rDivZero.error, /除数不能为0/);

    // 异常场景 2: 非法语法 (语法错误拦截，不崩溃)
    const rSyntax = evaluateExpression("1 + + * 3");
    assert.equal(rSyntax.success, false);
    assert.ok(rSyntax.error);

    // 异常场景 3: 括号不匹配
    const rParen = evaluateExpression("(10 + 2");
    assert.equal(rParen.success, false);
    assert.ok(rParen.error);
  });

  test("3. 声明式 UI 挂载与列表渲染", () => {
    const root = renderDeclarativeRoot(CalculatorCommand);
    const desc = root.getLatest();

    assert.ok(desc);
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "极简即时计算器");
    assert.ok(desc.children.length > 0);

    root.unmount();
  });
});
