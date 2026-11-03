import React, { List, ActionPanel, Action, Icon, showToast, Toast, useState, useEffect } from "@ztools/declarative-ui";
import { WindowActionDefinition, WindowActionCategory } from "./types.js";
import { filterWindowActions, executeWindowAction, loadSupportedWindowActions } from "./window-actions.js";

export * from "./types.js";
export * from "./window-actions.js";

const CATEGORIES: Array<{ id: WindowActionCategory; title: string }> = [
  { id: "halves", title: "半屏对齐" },
  { id: "thirds", title: "三分屏" },
  { id: "quarters", title: "四角分屏" },
  { id: "center-max", title: "居中与尺寸" },
  { id: "displays", title: "显示器切换" },
  { id: "resize", title: "尺寸微调" }
];

/** 布局一：找到宿主支持的动作后直接执行。 */
export default function WindowManagementCommand() {
  const [searchText, setSearchText] = useState("");
  const [category, setCategory] = useState<WindowActionCategory | "all">("all");
  const [actions, setActions] = useState<WindowActionDefinition[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      setActions(await loadSupportedWindowActions());
      setError("");
    } catch (cause) {
      setActions([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, []);

  const filtered = filterWindowActions(actions, { category, query: searchText });
  const execute = async (item: WindowActionDefinition) => {
    const result = await executeWindowAction(item.id);
    if (!result.success) await showToast({ style: Toast.Style.Failure, title: "窗口操作失败", message: result.error });
  };

  return (
    <List isLoading={loading} searchBarPlaceholder="搜索窗口动作：左半屏、四角、居中、显示器…"
      onSearchTextChange={setSearchText}
      filterBar={{ summaryText: error || (loading ? "正在读取可用动作…" : `可用动作 ${actions.length} 项`),
        actions: [{ id: "refresh", title: "重新读取", onAction: reload }] }}
      searchBarAccessory={
        <List.Dropdown tooltip="按分类筛选" value={category} onChange={value => setCategory(value as WindowActionCategory | "all")}>
          <List.Dropdown.Item title="全部动作" value="all" />
          {CATEGORIES.filter(group => actions.some(item => item.category === group.id)).map(group =>
            <List.Dropdown.Item key={group.id} title={group.title} value={group.id} />)}
        </List.Dropdown>
      }>
      {CATEGORIES.map(group => {
        const items = filtered.filter(item => item.category === group.id);
        return items.length ? <List.Section key={group.id} title={group.title}>
          {items.map(item => <List.Item key={item.id} id={item.id} title={item.name} subtitle={item.description}
            icon={item.category === "displays" ? Icon.Monitor : Icon.AppWindow}
            actions={<ActionPanel><Action title={`执行 ${item.name}`} icon={Icon.Checkmark} onAction={() => execute(item)} /></ActionPanel>} />)}
        </List.Section> : null;
      })}
      {!loading && filtered.length === 0 && <List.Item id="no-actions" title={error ? "无法读取窗口动作" : "没有匹配动作"}
        subtitle={error || "尝试其他关键词，或更新客户端以获取更多动作"} />}
    </List>
  );
}
