import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/declarative-ui";
import {
  validateJson,
  formatJson,
  minifyJson,
  jsonToTsInterface
} from "../dist/logic.js";
import JsonFormatCommand, { JsonDetailView } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("json-format 官方标杆插件集成测试与异常用例套件", () => {
  test("1. plugin.json 清单结构合规性与必要资源文件完整性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "json-format");
    assert.equal(manifest.name, "JSON 格式化与类型推导");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)));
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)));
  });

  test("2. validateJson: 正常结构、深层嵌套、键计数与字节统计", () => {
    const validJson = JSON.stringify({
      id: 101,
      name: "ZTools",
      meta: {
        tags: ["tool", "desktop"],
        author: { name: "Team", active: true }
      }
    });

    const res = validateJson(validJson);
    assert.equal(res.valid, true);
    assert.ok(res.parsed);
    assert.equal(res.parsed.id, 101);
    assert.ok(res.stats);
    assert.ok(res.stats.keys >= 4);
    assert.ok(res.stats.depth >= 3);
    assert.ok(res.stats.byteSize > 0);
  });

  test("3. validateJson: 异常防御 (空值、畸形格式、截断 JSON、非对象类型)", () => {
    // 空字符串与纯空白
    const empty1 = validateJson("");
    assert.equal(empty1.valid, false);
    assert.match(empty1.error, /Empty JSON content/i);

    const empty2 = validateJson("   \n\t  ");
    assert.equal(empty2.valid, false);
    assert.match(empty2.error, /Empty JSON content/i);

    // 截断语法错误
    const malformed1 = validateJson("{ id: 1, name: 'single quote' }");
    assert.equal(malformed1.valid, false);
    assert.ok(malformed1.error);

    const malformed2 = validateJson('{"name": "ZTools", "unclosed": [1, 2,');
    assert.equal(malformed2.valid, false);
    assert.ok(malformed2.error);

    // 尾部逗号语法错误 (标准 JSON 不允许末尾逗号)
    const trailingComma = validateJson('{"key": "value",}');
    assert.equal(trailingComma.valid, false);
    assert.ok(trailingComma.error);
  });

  test("4. formatJson & minifyJson: 格式化、缩进定制与容错回退", () => {
    const raw = '{"a":1,"b":[2,3]}';
    const fmt2 = formatJson(raw, 2);
    assert.equal(fmt2, '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');

    const fmt4 = formatJson(raw, 4);
    assert.equal(fmt4, '{\n    "a": 1,\n    "b": [\n        2,\n        3\n    ]\n}');

    const minified = minifyJson(fmt4);
    assert.equal(minified, '{"a":1,"b":[2,3]}');

    // 容错: 非法 JSON 字符串直接安全返回原文
    const broken = "{broken";
    assert.equal(formatJson(broken), broken);
    assert.equal(minifyJson(broken), broken);
  });

  test("5. jsonToTsInterface: 自动推导结构体、数组与特殊标识符", () => {
    const sample = JSON.stringify({
      id: 1,
      title: "Task",
      done: false,
      "special-key": "dash",
      items: [{ sku: "A1", price: 9.9 }],
      user: { uid: 123, role: "admin" }
    });

    const ts = jsonToTsInterface(sample, "TaskModel");
    assert.ok(ts.includes("export interface TaskModel"));
    assert.ok(ts.includes("id: number;"));
    assert.ok(ts.includes("title: string;"));
    assert.ok(ts.includes("done: boolean;"));
    assert.ok(ts.includes('"special-key": string;')); // 特殊字符需引号包裹
    assert.ok(ts.includes("items: ItemsItem[];"));
    assert.ok(ts.includes("export interface ItemsItem"));
    assert.ok(ts.includes("sku: string;"));
    assert.ok(ts.includes("user: User;"));
    assert.ok(ts.includes("export interface User"));

    // 顶级数组推导
    const arraySample = JSON.stringify([{ id: "item1" }, { id: "item2" }]);
    const arrayTs = jsonToTsInterface(arraySample, "RecordItem");
    assert.ok(arrayTs.includes("export type RecordItemList = RecordItem[];"));

    // 空数组与空内容
    assert.equal(jsonToTsInterface("[]", "EmptyList"), "export type EmptyList = any[];");

    // 异常输入容错
    const errTs = jsonToTsInterface("invalid");
    assert.ok(errTs.includes("// Failed to generate TypeScript interface"));
  });

  test("6. 声明式 UI 挂载与全组件生命周期 (JsonFormatCommand & JsonDetailView)", () => {
    // 主表单命令
    const formRoot = renderDeclarativeRoot(JsonFormatCommand);
    const formDesc = formRoot.getLatest();
    assert.ok(formDesc);
    assert.equal(formDesc.type, "Form");
    assert.equal(formDesc.props.navigationTitle, "JSON 格式化与类型转换");
    assert.equal(formDesc.props.actions.type, "ActionPanel");
    assert.ok(formDesc.children.length >= 2);
    formRoot.unmount();

    // 二级详情视图
    const detailView = JsonDetailView({
      formatted: '{\n  "status": "ok"\n}',
      tsInterface: "export interface Status {\n  status: string;\n}",
      stats: { keys: 1, depth: 1, byteSize: 20 }
    });
    assert.equal(detailView.type, "Detail");
    assert.equal(detailView.props.navigationTitle, "JSON 格式化详情");
    assert.ok(detailView.props.markdown.includes("export interface Status"));
    assert.equal(detailView.props.metadata.type, "Detail.Metadata");
    assert.equal(detailView.props.actions.type, "ActionPanel");
  });
});
