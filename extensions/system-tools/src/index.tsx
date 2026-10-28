import React from "@ztools/declarative-ui";
import { List, ActionPanel, Action, Icon, showToast, Toast } from "@ztools/declarative-ui";
import { useState, useMemo } from "@ztools/declarative-ui";
import {
  CATEGORY_TITLES,
  SystemActionItem,
  SystemCategory,
  filterSystemActions,
  executeSystemAction
} from "./system-actions.js";

export * from "./system-actions.js";

const CATEGORY_ORDER: SystemCategory[] = ["power", "audio", "maintenance"];

/** 执行并提示结果：成功、失败、取消分别提示，失败带上客户端返回的原因 */
async function runAction(item: SystemActionItem): Promise<void> {
  const res = await executeSystemAction(item);
  if (res.canceled) {
    await showToast({ style: Toast.Style.Animated, title: "已取消", message: `未执行：${item.title}` });
    return;
  }
  await showToast(
    res.success
      ? { style: Toast.Style.Success, title: res.message }
      : { style: Toast.Style.Failure, title: `${item.title}失败`, message: res.message }
  );
}

export default function SystemCommand() {
  const [searchText, setSearchText] = useState("");
  const [category, setCategory] = useState("all");

  const filtered = useMemo(() => filterSystemActions(searchText, category), [searchText, category]);

  const sections = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => ({
        title: CATEGORY_TITLES[cat],
        items: filtered.filter((item) => item.category === cat)
      })).filter((section) => section.items.length > 0),
    [filtered]
  );

  return (
    <List
      isShowingDetail={false}
      searchBarPlaceholder="搜索系统操作，如 锁屏、关机、静音、隐藏文件、回收站"
      onSearchTextChange={setSearchText}
      searchBarAccessory={
        <List.Dropdown tooltip="按类别筛选" value={category} onChange={setCategory}>
          <List.Dropdown.Item title="全部" value="all" />
          {CATEGORY_ORDER.map((cat) => (
            <List.Dropdown.Item key={cat} title={CATEGORY_TITLES[cat]} value={cat} />
          ))}
        </List.Dropdown>
      }
    >
      {sections.map((section) => (
        <List.Section key={section.title} title={`${section.title} (${section.items.length})`}>
          {section.items.map((item) => (
            <List.Item
              key={item.id}
              id={item.id}
              title={item.title}
              subtitle={item.description}
              icon={item.icon}
              accessories={item.destructive ? [{ tag: { value: "执行前确认" } }] : []}
              actions={
                <ActionPanel title={item.title}>
                  <Action
                    title={item.destructive ? `${item.title}（需确认）` : item.title}
                    icon={item.destructive ? Icon.ExclamationMark : Icon.Checkmark}
                    onAction={() => runAction(item)}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}
