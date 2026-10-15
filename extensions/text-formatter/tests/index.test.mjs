import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/declarative-ui";
import {
  toUpperCase,
  toLowerCase,
  toTitleCase,
  toSentenceCase,
  toCamelCase,
  toSnakeCase,
  toKebabCase,
  toHalfWidth,
  toFullWidth,
  toChinesePunctuation,
  toEnglishPunctuation,
  normalizeCjkSpacing,
  formatChineseSmart,
  formatMarkdown,
  trimLines,
  removeEmptyLines,
  collapseInlineSpaces,
  dedupeLines,
  sortLines,
  reverseLines,
  addLineNumbers,
  removeLineNumbers,
  convertToSimplified,
  convertToTraditional,
  getTextStats
} from "../dist/logic.js";
import TextFormatterCommand from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("text-formatter 插件端到端集成测试与健壮性验证", () => {
  test("1. plugin.json 清单结构合规性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "text-formatter");
    assert.equal(manifest.name, "文本排版与格式化助手");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)));
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)));
  });

  test("2. 大小写与命名转换", () => {
    // 全部大写与小写
    assert.equal(toUpperCase("hello World!"), "HELLO WORLD!");
    assert.equal(toLowerCase("Hello WORLD!"), "hello world!");

    // 标题大小写
    assert.equal(
      toTitleCase("the quick brown fox jumps over the dog"),
      "The Quick Brown Fox Jumps Over the Dog"
    );

    // 句首大写
    assert.equal(
      toSentenceCase("hello world. second sentence!"),
      "Hello world. Second sentence!"
    );

    // 编程命名转换
    assert.equal(toCamelCase("hello-world_test case"), "helloWorldTestCase");
    assert.equal(toSnakeCase("helloWorldTestCase"), "hello_world_test_case");
    assert.equal(toKebabCase("helloWorld_TestCase"), "hello-world-test-case");

    // 边界与异常
    assert.equal(toUpperCase(""), "");
    assert.equal(toLowerCase(""), "");
    assert.equal(toTitleCase(""), "");
    assert.equal(toSentenceCase(""), "");
    assert.equal(toCamelCase(""), "");
    assert.equal(toSnakeCase(""), "");
    assert.equal(toKebabCase(""), "");
  });

  test("3. 全角与半角互转", () => {
    const half = "Hello, world! 123 @#%";
    const full = "Ｈｅｌｌｏ，　ｗｏｒｌｄ！　１２３　＠＃％";

    assert.equal(toFullWidth(half), full);
    assert.equal(toHalfWidth(full), half);

    // 空值容错
    assert.equal(toFullWidth(""), "");
    assert.equal(toHalfWidth(""), "");
  });

  test("4. 中英文标点切换", () => {
    const en = "你好, 世界! 可以吗? 这是: 测试; (包含括号)";
    const zh = "你好， 世界！ 可以吗？ 这是： 测试； （包含括号）";

    assert.equal(toChinesePunctuation(en), zh);
    const convertedBack = toEnglishPunctuation(zh);
    assert.ok(convertedBack.includes(","));
    assert.ok(convertedBack.includes("!"));
    assert.ok(convertedBack.includes("?"));

    // 空值容错
    assert.equal(toChinesePunctuation(""), "");
    assert.equal(toEnglishPunctuation(""), "");
  });

  test("5. 中英文混排空格 (盘古之白) 与 Markdown 排版", () => {
    const messy = "ZTools文本  格式化 2次!支持Markdown排版。";
    const spaced = normalizeCjkSpacing(messy);
    assert.equal(spaced, "ZTools 文本格式化 2 次!支持 Markdown 排版。");

    // Markdown 标题与列表格式化
    const mdInput = "#Heading1\n##Heading 2\n-Item 1\n*Item 2\n\n\n\n-Item 3";
    const mdOutput = formatMarkdown(mdInput);
    assert.ok(mdOutput.includes("# Heading1"));
    assert.ok(mdOutput.includes("## Heading 2"));
    assert.ok(mdOutput.includes("- Item 1"));
    assert.ok(mdOutput.includes("* Item 2"));
    assert.ok(!mdOutput.includes("\n\n\n"));

    // 智能排版综合测试
    const smart = formatChineseSmart("这是第一句.这是第二句!这是第三句.", {
      indentSize: 2,
      sentencesPerParagraph: 2
    });
    assert.ok(smart.startsWith("\u3000\u3000"));
    assert.ok(smart.includes("\n\n\u3000\u3000"));
  });

  test("6. 行操作与去重排序", () => {
    const rawLines = "  line 1  \n\n  line 2  \n  line 1  \n\n  line 3  ";

    // Trim lines
    const trimmed = trimLines(rawLines);
    assert.ok(trimmed.includes("line 1\n\nline 2"));

    // Remove empty lines
    const noEmpty = removeEmptyLines(rawLines);
    assert.equal(noEmpty.split("\n").length, 4);

    // Dedupe lines
    const deduped = dedupeLines(noEmpty);
    assert.equal(deduped.split("\n").length, 3);

    // Sort lines
    const sorted = sortLines("banana\napple\ncherry", "asc");
    assert.equal(sorted, "apple\nbanana\ncherry");

    // Reverse lines
    const reversed = reverseLines("first\nsecond\nthird");
    assert.equal(reversed, "third\nsecond\nfirst");

    // Line numbers
    const numbered = addLineNumbers("apple\nbanana");
    assert.equal(numbered, "01. apple\n02. banana");
    assert.equal(removeLineNumbers(numbered), "apple\nbanana");
  });

  test("7. 繁简汉字转换", () => {
    assert.equal(convertToTraditional("软件设置"), "軟件設置");
    assert.equal(convertToSimplified("軟件設置"), "软件设置");
    assert.equal(convertToTraditional("档案管理"), "檔案管理");
    assert.equal(convertToSimplified("檔案管理"), "档案管理");

    // 英文/无对照字符原样保留
    assert.equal(convertToTraditional("Hello 123"), "Hello 123");
    assert.equal(convertToSimplified("Hello 123"), "Hello 123");
  });

  test("8. 文本统计健壮性", () => {
    // 正常混合文本
    const stats = getTextStats("Hello 世界\nZTools 2026");
    assert.equal(stats.lines, 2);
    assert.equal(stats.nonEmptyLines, 2);
    assert.ok(stats.characters > 10);
    assert.equal(stats.hasChinese, true);

    // 空字符串边界
    const emptyStats = getTextStats("");
    assert.equal(emptyStats.characters, 0);
    assert.equal(emptyStats.words, 0);
    assert.equal(emptyStats.lines, 0);
    assert.equal(emptyStats.hasChinese, false);
  });

  test("9. 声明式 UI 挂载与列表渲染", () => {
    const root = renderDeclarativeRoot(TextFormatterCommand);
    const desc = root.getLatest();

    assert.ok(desc, "必须生成根视图描述符");
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "文本排版与格式化助手");
    assert.ok(desc.children.length >= 2, "应包含统计与格式化结果 Sections");

    // 验证根 actions 包含操作
    assert.ok(desc.props.actions);
    assert.equal(desc.props.actions.type, "ActionPanel");

    root.unmount();
  });
});
