import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/declarative-ui";
import { translateText, detectLanguage } from "../dist/logic.js";
import TranslatorCommand from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("translator 范例插件集成测试", () => {
  test("1. plugin.json 清单结构合规性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "translator");
    assert.equal(manifest.name, "多语言即时翻译");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard", "network"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)));
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)));
  });

  test("2. 语种识别与核心词典翻译", () => {
    // 自动语种识别
    assert.equal(detectLanguage("你好世界"), "zh");
    assert.equal(detectLanguage("Hello world"), "en");

    // 离线词典词条翻译与音标
    const resHello = translateText("hello", "zh");
    assert.match(resHello.translatedText, /你好/);
    assert.ok(resHello.phonetic);
    assert.ok(resHello.definitions.length > 0);

    // 开发者术语离线翻译
    const resDecl = translateText("declarative", "zh");
    assert.match(resDecl.translatedText, /声明式/);

    // 空输入边界处理
    const resEmpty = translateText("");
    assert.equal(resEmpty.sourceText, "");
    assert.equal(resEmpty.translatedText, "");
  });

  test("3. 声明式 UI 挂载与列表渲染", () => {
    const root = renderDeclarativeRoot(TranslatorCommand);
    const desc = root.getLatest();

    assert.ok(desc);
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "多语言即时翻译");
    assert.ok(desc.children.length > 0);

    root.unmount();
  });
});
