import React from "../../index.js";
import { List, ActionPanel, Action, Icon, Color } from "../../index.js";
import { useState, useMemo } from "../../runtime/hooks.js";
import { filterSystemActions, executeSystemAction } from "./system-actions.js";
export * from "./system-actions.js";
function getCategoryTitle(category) {
    switch (category) {
        case "power": return "电源与会话 (Power & Session)";
        case "apps": return "进程与桌面治理 (Apps & Windows)";
        case "audio": return "音频与硬件控制 (Audio & Hardware)";
        case "maintenance": return "系统维护与通知 (Maintenance)";
        case "desktop": return "桌面环境治理 (Desktop)";
        case "process": return "进程治理急救 (Process)";
        default: return "全部系统指令 (All Actions)";
    }
}
export default function SystemCommand() {
    const [searchText, setSearchText] = useState("");
    const [category, setCategory] = useState("all");
    const [isShowingDetail, setIsShowingDetail] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const filtered = useMemo(() => {
        return filterSystemActions(searchText, category);
    }, [searchText, category]);
    const handleExecute = async (item, options) => {
        await executeSystemAction(item, options);
    };
    const groupedSections = useMemo(() => {
        if (category !== "all") {
            return [{ title: `${getCategoryTitle(category)} (${filtered.length})`, items: filtered }];
        }
        const categories = ["power", "apps", "audio", "maintenance"];
        return categories
            .map(cat => {
            const items = filtered.filter(item => {
                if (item.category === cat)
                    return true;
                if (cat === "apps" && item.category === "desktop")
                    return true;
                return false;
            });
            return {
                title: `${getCategoryTitle(cat)} (${items.length})`,
                items
            };
        })
            .filter(section => section.items.length > 0);
    }, [filtered, category]);
    return (React.createElement(List, { isShowingDetail: isShowingDetail, searchBarPlaceholder: "\u641C\u7D22 macOS / Windows \u7CFB\u7EDF\u63A7\u5236\u6307\u4EE4 (\u5982 \u6DF1\u8272\u6A21\u5F0F, \u9690\u85CF\u6587\u4EF6, \u9632\u4F11\u7720, \u9501\u5C4F, \u6E05\u7A7A\u56DE\u6536\u7AD9)...", onSearchTextChange: setSearchText, onSelectionChange: setSelectedId, filterBar: {
            summaryText: `系统原生控制指令共 ${filtered.length} 项 · 当前视图: ${getCategoryTitle(category)} · 支持回车直接触发`
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6309\u7C7B\u522B\u7B5B\u9009", value: category, onChange: setCategory },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u52A8\u4F5C (All Actions)", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u7535\u6E90\u4E0E\u9632\u4F11\u7720 (Power & Session)", value: "power", icon: Icon.Power }),
            React.createElement(List.Dropdown.Item, { title: "\u684C\u9762\u4E0E\u5916\u89C2\u6CBB\u7406 (Apps & Desktop)", value: "apps", icon: Icon.AppWindow }),
            React.createElement(List.Dropdown.Item, { title: "\u97F3\u9891\u4E0E\u84DD\u7259\u63A7\u5236 (Audio & Hardware)", value: "audio", icon: Icon.Play }),
            React.createElement(List.Dropdown.Item, { title: "\u7CFB\u7EDF\u7EF4\u62A4\u4E0E\u5E9F\u7EB8\u7BD3 (Maintenance)", value: "maintenance", icon: Icon.Gear })) }, groupedSections.map((section, idx) => (React.createElement(List.Section, { key: `section-${idx}`, title: section.title }, section.items.map(item => (React.createElement(List.Item, { key: item.id, id: item.id, title: item.title, subtitle: `${item.description} · ${item.subtitle}`, icon: item.icon, accessories: [
            ...(item.destructive ? [{ tag: { value: "高危操作", color: Color.Red } }] : []),
            { tag: { value: item.category.toUpperCase() } },
            ...(item.shortcut ? [{ text: item.shortcut }] : [])
        ], detail: React.createElement(List.Item.Detail, { markdown: `### ${item.title}\n\n${item.description}\n\n> **底层调用契约**: \`${item.subtitle}\`\n\n${item.technicalDetails ? `**技术实现细节**:\n${item.technicalDetails}\n\n` : ''}${item.destructive ? '**破坏性操作警告**：该操作会重置系统运行状态或导致正在运行的未保存数据丢失，执行前请务必确认关键工作已妥善存储。' : '**安全运维指令**：该操作执行平稳无损，可在任意工作阶段直接调度。'}` }), actions: React.createElement(ActionPanel, { title: `系统动作: ${item.title}` },
            React.createElement(Action, { title: `立即执行: ${item.title}`, icon: item.destructive ? Icon.ExclamationMark : Icon.Checkmark, onAction: () => handleExecute(item) }),
            item.destructive && (React.createElement(Action, { title: "\u5F3A\u5236\u76F4\u63A5\u6267\u884C (\u8DF3\u8FC7\u4E8C\u6B21\u786E\u8BA4)", icon: Icon.ExclamationMark, shortcut: { modifiers: ["ctrl"], key: "return" }, onAction: () => handleExecute(item, { force: true, confirmBypass: true }) })),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5E95\u5C42\u8C03\u7528\u5951\u7EA6", content: item.actionKey, shortcut: { modifiers: ["ctrl"], key: "c" } }),
            item.technicalDetails && (React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6280\u672F\u5B9E\u73B0\u7EC6\u8282", content: item.technicalDetails, shortcut: { modifiers: ["ctrl", "shift"], key: "c" } })),
            React.createElement(Action, { title: isShowingDetail ? "关闭双栏详情" : "展开双栏详情", icon: Icon.SidebarRight, shortcut: { modifiers: ["ctrl"], key: "b" }, onAction: () => setIsShowingDetail(!isShowingDetail) })) }))))))));
}
