import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/declarative-ui";
import {
  computeDiff,
  generateUnifiedDiff,
  generateMarkdownReport,
  computeWordDiff,
  splitLines,
  SAMPLE_LEFT,
  SAMPLE_RIGHT,
  DEFAULT_DIFF_OPTIONS
} from "../dist/logic.js";
import FileCompareCommand from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("file-compare 声明式差异对比插件集成测试", () => {
  test("1. plugin.json 结构与规范合规性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "file-compare");
    assert.equal(manifest.name, "文本与代码差异对比");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)));
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)));
  });

  test("2. 文本差异算法核心逻辑 (行级 & 词级)", () => {
    // 空文本边界处理
    const resEmpty = computeDiff("", "");
    assert.equal(resEmpty.hasDifferences, false);
    assert.equal(resEmpty.lines.length, 0);
    assert.equal(resEmpty.stats.similarity, 100);

    // 完全相同文本
    const resIdentical = computeDiff("line 1\nline 2", "line 1\nline 2");
    assert.equal(resIdentical.hasDifferences, false);
    assert.equal(resIdentical.stats.equal, 2);
    assert.equal(resIdentical.stats.added, 0);
    assert.equal(resIdentical.stats.removed, 0);

    // 增删改混合对比
    const left = "apple\nbanana\norange";
    const right = "apple\nblueberry\norange\nwatermelon";
    const res = computeDiff(left, right);

    assert.equal(res.hasDifferences, true);
    assert.equal(res.stats.added, 1); // watermelon
    assert.equal(res.stats.modified, 1); // banana -> blueberry
    assert.equal(res.stats.equal, 2); // apple, orange

    // 词级差异计算验证
    const wordDiff = computeWordDiff("const x = 10;", "const x = 20;", DEFAULT_DIFF_OPTIONS);
    assert.ok(wordDiff.some((w) => w.type === "removed" && w.text === "10"));
    assert.ok(wordDiff.some((w) => w.type === "added" && w.text === "20"));

    // 选项验证：忽略空白与大小写
    const resWs = computeDiff("  const a = 1;  ", "const a=1;", { ignoreWhitespace: true });
    assert.equal(resWs.hasDifferences, false);

    const resCase = computeDiff("HELLO WORLD", "hello world", { ignoreCase: true });
    assert.equal(resCase.hasDifferences, false);
  });

  test("3. Unified Diff 补丁与 Markdown 报告输出", () => {
    const patch = generateUnifiedDiff("hello\nworld", "hello\nearth");
    assert.ok(patch.includes("--- original.txt"));
    assert.ok(patch.includes("+++ modified.txt"));
    assert.ok(patch.includes("-world"));
    assert.ok(patch.includes("+earth"));

    const diffResult = computeDiff(SAMPLE_LEFT, SAMPLE_RIGHT);
    const report = generateMarkdownReport(diffResult);
    assert.ok(report.includes("# 📋 文本与代码差异对比分析报告"));
    assert.ok(report.includes("```diff"));
    assert.ok(report.includes("相似度"));
  });

  test("4. 声明式 UI 挂载与交互树渲染", () => {
    const root = renderDeclarativeRoot(FileCompareCommand);
    const desc = root.getLatest();

    assert.ok(desc);
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "文本与代码差异对比");
    assert.ok(desc.children.length > 0);

    root.unmount();
  });
});
