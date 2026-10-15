import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/declarative-ui";
import {
  createTodo,
  toggleTodoStatus,
  deleteTodoItem,
  filterAndSearchTodos
} from "../dist/logic.js";
import TodoCommand from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("todo 范例插件集成测试", () => {
  test("1. plugin.json 清单结构合规性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "todo");
    assert.equal(manifest.name, "极简待办清单");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)));
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)));
  });

  test("2. 待办事项状态增删改查业务流", () => {
    // 创建
    const todo = createTodo("完成 ZTools 插件脚手架", "high");
    assert.equal(todo.title, "完成 ZTools 插件脚手架");
    assert.equal(todo.completed, false);
    assert.equal(todo.priority, "high");

    // 空标题异常防御
    assert.throws(() => createTodo(""), /标题不能为空/);

    // 状态切换
    let list = [todo];
    list = toggleTodoStatus(list, todo.id);
    assert.equal(list[0].completed, true);
    assert.ok(list[0].completedAt);

    // 再次切换
    list = toggleTodoStatus(list, todo.id);
    assert.equal(list[0].completed, false);

    // 过滤与检索
    const highTodo = createTodo("高优先级任务", "high");
    const lowTodo = createTodo("低优先级任务", "low");
    list = [lowTodo, highTodo];

    const sorted = filterAndSearchTodos(list, "all", "");
    assert.equal(sorted[0].id, highTodo.id, "高优先级应该排在前面");

    const filtered = filterAndSearchTodos(list, "all", "高优先级");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].title, "高优先级任务");

    // 删除
    const remaining = deleteTodoItem(list, lowTodo.id);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, highTodo.id);
  });

  test("3. 声明式 UI 挂载与列表渲染", () => {
    const root = renderDeclarativeRoot(TodoCommand);
    const desc = root.getLatest();

    assert.ok(desc);
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "极简待办清单");
    assert.ok(desc.children.length > 0);

    root.unmount();
  });
});
