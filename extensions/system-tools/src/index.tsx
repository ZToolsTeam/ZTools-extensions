import React from "@ztools/declarative-ui";
import { List, ActionPanel, Action, Icon, showToast, Toast, useLocale } from "@ztools/declarative-ui";
import { useState, useMemo } from "@ztools/declarative-ui";
import {
  SystemActionItem,
  SystemCategory,
  filterSystemActions,
  executeSystemAction
} from "./system-actions.js";
import { t } from "./i18n.js";

export * from "./system-actions.js";

const CATEGORY_ORDER: SystemCategory[] = ["power", "audio", "maintenance"];

const CATEGORY_KEYS: Record<SystemCategory, "catPower" | "catAudio" | "catMaintenance"> = {
  power: "catPower",
  audio: "catAudio",
  maintenance: "catMaintenance"
};

const ITEM_TEXT_KEYS: Record<string, { title: Parameters<typeof t>[0]; desc: Parameters<typeof t>[0] }> = {
  "lock-screen": { title: "itemTitleLockScreen", desc: "itemDescLockScreen" },
  sleep: { title: "itemTitleSleep", desc: "itemDescSleep" },
  hibernate: { title: "itemTitleHibernate", desc: "itemDescHibernate" },
  restart: { title: "itemTitleRestart", desc: "itemDescRestart" },
  "shut-down": { title: "itemTitleShutDown", desc: "itemDescShutDown" },
  "log-out": { title: "itemTitleLogOut", desc: "itemDescLogOut" },
  "toggle-mute": { title: "itemTitleToggleMute", desc: "itemDescToggleMute" },
  "volume-up": { title: "itemTitleVolumeUp", desc: "itemDescVolumeUp" },
  "volume-down": { title: "itemTitleVolumeDown", desc: "itemDescVolumeDown" },
  "toggle-hidden-files": { title: "itemTitleToggleHiddenFiles", desc: "itemDescToggleHiddenFiles" },
  "empty-trash": { title: "itemTitleEmptyTrash", desc: "itemDescEmptyTrash" },
  "toggle-caffeinate": { title: "itemTitleToggleCaffeinate", desc: "itemDescToggleCaffeinate" }
};

function getItemTitle(item: SystemActionItem): string {
  return ITEM_TEXT_KEYS[item.id] ? t(ITEM_TEXT_KEYS[item.id].title) : item.title;
}

function getItemDesc(item: SystemActionItem): string {
  return ITEM_TEXT_KEYS[item.id] ? t(ITEM_TEXT_KEYS[item.id].desc) : item.description;
}

/** 执行并提示结果：成功、失败、取消分别提示，失败带上客户端返回的原因 */
async function runAction(item: SystemActionItem): Promise<void> {
  const title = getItemTitle(item);
  const res = await executeSystemAction(item);
  if (res.canceled) {
    await showToast({ style: Toast.Style.Animated, title: t("canceledTitle"), message: t("canceledMessage", { title }) });
    return;
  }
  await showToast(
    res.success
      ? { style: Toast.Style.Success, title: res.message }
      : { style: Toast.Style.Failure, title: t("failedTitle", { title }), message: res.message }
  );
}

export default function SystemCommand() {
  const locale = useLocale();
  const [searchText, setSearchText] = useState("");
  const [category, setCategory] = useState("all");

  const filtered = useMemo(() => filterSystemActions(searchText, category), [searchText, category]);

  const sections = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => ({
        title: t(CATEGORY_KEYS[cat]),
        items: filtered.filter((item) => item.category === cat)
      })).filter((section) => section.items.length > 0),
    [filtered, locale]
  );

  return (
    <List
      isShowingDetail={false}
      searchBarPlaceholder={t("searchPlaceholder")}
      onSearchTextChange={setSearchText}
      searchBarAccessory={
        <List.Dropdown tooltip={t("filterTooltip")} value={category} onChange={setCategory}>
          <List.Dropdown.Item title={t("allCategories")} value="all" />
          {CATEGORY_ORDER.map((cat) => (
            <List.Dropdown.Item key={cat} title={t(CATEGORY_KEYS[cat])} value={cat} />
          ))}
        </List.Dropdown>
      }
    >
      {sections.map((section) => (
        <List.Section key={section.title} title={t("sectionTitle", { title: section.title, count: section.items.length })}>
          {section.items.map((item) => {
            const title = getItemTitle(item);
            return (
              <List.Item
                key={item.id}
                id={item.id}
                title={title}
                subtitle={getItemDesc(item)}
                icon={item.icon}
                accessories={item.destructive ? [{ tag: { value: t("confirmTag") } }] : []}
                actions={
                  <ActionPanel title={title}>
                    <Action
                      title={item.destructive ? t("actionConfirm", { title }) : title}
                      icon={item.destructive ? Icon.ExclamationMark : Icon.Checkmark}
                      onAction={() => runAction(item)}
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ))}
    </List>
  );
}
