import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/raycast-compat";
import { parseTimeInput, formatDateTime, getRelativeTime } from "../dist/logic.js";
import TimestampCommand from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("timestamp 范例插件集成测试", () => {
  test("1. plugin.json 清单结构合规性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "timestamp");
    assert.equal(manifest.name, "时间戳转换助手");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)));
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)));
  });

  test("2. 时间戳与日期解析核心逻辑", () => {
    // 10 位时间戳解析
    const res10 = parseTimeInput("1609459200"); // 2021-01-01 00:00:00 UTC
    assert.equal(res10.valid, true);
    assert.equal(res10.unixSeconds, 1609459200);
    assert.equal(res10.unixMilliseconds, 1609459200000);

    // 13 位毫秒时间戳解析
    const res13 = parseTimeInput("1609459200000");
    assert.equal(res13.valid, true);
    assert.equal(res13.unixSeconds, 1609459200);

    // 日期字符串解析
    const resDate = parseTimeInput("2024-01-01 12:00:00");
    assert.equal(resDate.valid, true);

    // 相对时间计算
    const now = new Date("2024-01-01 12:00:00");
    const past = new Date("2024-01-01 11:59:58");
    assert.equal(getRelativeTime(past, now), "刚刚");

    // 异常输入优雅降级
    const resInvalid = parseTimeInput("not-a-date-string-xyz");
    assert.equal(resInvalid.valid, false);
    assert.ok(resInvalid.error);
  });

  test("3. 声明式 UI 挂载与列表渲染", () => {
    const root = renderDeclarativeRoot(TimestampCommand);
    const desc = root.getLatest();

    assert.ok(desc);
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "时间戳转换助手");
    assert.ok(desc.children.length > 0);

    root.unmount();
  });
});
