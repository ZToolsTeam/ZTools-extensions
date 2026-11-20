import React, { List, ActionPanel, Action, Icon, showToast, Toast, useState, useEffect, useLocale } from "@ztools/declarative-ui";
import { WindowActionDefinition, WindowActionCategory } from "./types.js";
import { filterWindowActions, executeWindowAction, loadSupportedWindowActions } from "./window-actions.js";
import { t } from "./i18n.js";

export * from "./types.js";
export * from "./window-actions.js";

const CATEGORIES: Array<{ id: WindowActionCategory; titleKey: "catHalves" | "catThirds" | "catQuarters" | "catCenterMax" | "catDisplays" | "catResize" }> = [
  { id: "halves", titleKey: "catHalves" },
  { id: "thirds", titleKey: "catThirds" },
  { id: "quarters", titleKey: "catQuarters" },
  { id: "center-max", titleKey: "catCenterMax" },
  { id: "displays", titleKey: "catDisplays" },
  { id: "resize", titleKey: "catResize" }
];

const ACTION_TEXT_KEYS: Record<string, { name: Parameters<typeof t>[0]; desc: Parameters<typeof t>[0] }> = {
  "left-half": { name: "actionNameLeftHalf", desc: "actionDescLeftHalf" },
  "right-half": { name: "actionNameRightHalf", desc: "actionDescRightHalf" },
  "top-half": { name: "actionNameTopHalf", desc: "actionDescTopHalf" },
  "bottom-half": { name: "actionNameBottomHalf", desc: "actionDescBottomHalf" },
  "first-third": { name: "actionNameFirstThird", desc: "actionDescFirstThird" },
  "center-third": { name: "actionNameCenterThird", desc: "actionDescCenterThird" },
  "last-third": { name: "actionNameLastThird", desc: "actionDescLastThird" },
  "first-two-thirds": { name: "actionNameFirstTwoThirds", desc: "actionDescFirstTwoThirds" },
  "last-two-thirds": { name: "actionNameLastTwoThirds", desc: "actionDescLastTwoThirds" },
  "top-left": { name: "actionNameTopLeft", desc: "actionDescTopLeft" },
  "top-right": { name: "actionNameTopRight", desc: "actionDescTopRight" },
  "bottom-left": { name: "actionNameBottomLeft", desc: "actionDescBottomLeft" },
  "bottom-right": { name: "actionNameBottomRight", desc: "actionDescBottomRight" },
  maximize: { name: "actionNameMaximize", desc: "actionDescMaximize" },
  restore: { name: "actionNameRestore", desc: "actionDescRestore" },
  "reasonable-size": { name: "actionNameReasonableSize", desc: "actionDescReasonableSize" },
  center: { name: "actionNameCenter", desc: "actionDescCenter" },
  "next-display": { name: "actionNameNextDisplay", desc: "actionDescNextDisplay" },
  "previous-display": { name: "actionNamePreviousDisplay", desc: "actionDescPreviousDisplay" },
  "make-larger": { name: "actionNameMakeLarger", desc: "actionDescMakeLarger" },
  "make-smaller": { name: "actionNameMakeSmaller", desc: "actionDescMakeSmaller" }
};

/** 布局一：找到宿主支持的动作后直接执行。 */
export default function WindowManagementCommand() {
  useLocale();
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
    if (!result.success) await showToast({ style: Toast.Style.Failure, title: t("actionFailedTitle"), message: result.error });
  };

  const getName = (item: WindowActionDefinition) => ACTION_TEXT_KEYS[item.id] ? t(ACTION_TEXT_KEYS[item.id].name) : item.name;
  const getDesc = (item: WindowActionDefinition) => ACTION_TEXT_KEYS[item.id] ? t(ACTION_TEXT_KEYS[item.id].desc) : item.description;

  return (
    <List isLoading={loading} searchBarPlaceholder={t("searchPlaceholder")}
      onSearchTextChange={setSearchText}
      filterBar={{ summaryText: error || (loading ? t("loadingSummary") : t("availableSummary", { count: actions.length })),
        actions: [{ id: "refresh", title: t("refreshTitle"), onAction: reload }] }}
      searchBarAccessory={
        <List.Dropdown tooltip={t("filterTooltip")} value={category} onChange={value => setCategory(value as WindowActionCategory | "all")}>
          <List.Dropdown.Item title={t("allActions")} value="all" />
          {CATEGORIES.filter(group => actions.some(item => item.category === group.id)).map(group =>
            <List.Dropdown.Item key={group.id} title={t(group.titleKey)} value={group.id} />)}
        </List.Dropdown>
      }>
      {CATEGORIES.map(group => {
        const items = filtered.filter(item => item.category === group.id);
        return items.length ? <List.Section key={group.id} title={t(group.titleKey)}>
          {items.map(item => {
            const name = getName(item);
            return <List.Item key={item.id} id={item.id} title={name} subtitle={getDesc(item)}
              icon={item.category === "displays" ? Icon.Monitor : Icon.AppWindow}
              actions={<ActionPanel><Action title={t("executeAction", { name })} icon={Icon.Checkmark} onAction={() => execute(item)} /></ActionPanel>} />;
          })}
        </List.Section> : null;
      })}
      {!loading && filtered.length === 0 && <List.Item id="no-actions" title={error ? t("loadFailedTitle") : t("noMatchTitle")}
        subtitle={error || t("noMatchSubtitle")} />}
    </List>
  );
}
