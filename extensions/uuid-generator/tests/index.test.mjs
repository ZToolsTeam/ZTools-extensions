import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/raycast-compat";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("uuid-generator 插件规范与端到端集成测试", () => {
  test("1. plugin.json 清单结构合规性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "uuid-generator");
    assert.equal(manifest.name, "UUID生成器");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)), "icon.svg 文件必须存在");
  });

  test("2. 核心算法集成测试 (v1, v4, v7 与全部格式化标准)", async () => {
    const {
      generateV4,
      generateV1,
      generateV7,
      formatUuid,
      generateUuids
    } = await import("../dist/logic.js");

    // UUID v4 校验: 版本位必须为 4，变体位必须为 8/9/a/b
    const v4 = generateV4();
    assert.match(v4, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // UUID v1 校验: 版本位必须为 1，变体位必须为 8/9/a/b
    const v1 = generateV1();
    assert.match(v1, /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // UUID v7 校验: 版本位必须为 7，变体位必须为 8/9/a/b
    const v7 = generateV7();
    assert.match(v7, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // 格式化功能测试
    const raw = "12345678-1234-4234-8234-123456789abc";
    assert.equal(formatUuid(raw, "standard"), "12345678-1234-4234-8234-123456789abc");
    assert.equal(formatUuid(raw, "uppercase"), "12345678-1234-4234-8234-123456789ABC");
    assert.equal(formatUuid(raw, "no-dash"), "12345678123442348234123456789abc");
    assert.equal(formatUuid(raw, "no-dash-upper"), "12345678123442348234123456789ABC");
    assert.equal(formatUuid(raw, "braces"), "{12345678-1234-4234-8234-123456789abc}");
    assert.equal(formatUuid(raw, "urn"), "urn:uuid:12345678-1234-4234-8234-123456789abc");

    // 批量生成唯一性验证
    const batch50 = generateUuids({ version: "v4", format: "standard", count: 50 });
    assert.equal(batch50.length, 50);
    const set50 = new Set(batch50);
    assert.equal(set50.size, 50, "批量生成的 50 条 UUID 必须互不重复");
  });

  test("3. 异常与边界输入测试 (超出范围、畸形参数防御)", async () => {
    const { generateUuids } = await import("../dist/logic.js");

    // 边界与异常 1: count <= 0 拦截
    assert.throws(() => generateUuids({ count: 0 }), /生成数量必须是 1 到 100/);
    assert.throws(() => generateUuids({ count: -5 }), /生成数量必须是 1 到 100/);

    // 边界与异常 2: count > 100 极值拦截
    assert.throws(() => generateUuids({ count: 101 }), /生成数量必须是 1 到 100/);

    // 边界与异常 3: 非法版本拦截
    assert.throws(() => generateUuids({ version: "v99" }), /不支持的 UUID 版本/);
  });

  test("4. 声明式 UI 挂载与全键盘交互流验证", async () => {
    const { default: UuidGeneratorCommand } = await import("../dist/index.js");

    const root = renderDeclarativeRoot(UuidGeneratorCommand);
    const desc = root.getLatest();

    assert.ok(desc, "渲染视图描述符必须存在");
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "UUID 生成器");
    assert.ok(desc.props.searchBarAccessory, "必须包含顶部版本切换下拉框");
    assert.ok(desc.children.length >= 2, "必须包含生成结果区和设置区");

    root.unmount();
  });
});
