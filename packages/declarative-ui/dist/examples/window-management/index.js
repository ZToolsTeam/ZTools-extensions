import React from "../../index.js";
import { List, Detail, Form, ActionPanel, Action, Icon, Color, showHUD, useNavigation } from "../../index.js";
import { useState, useEffect } from "../../runtime/hooks.js";
import { WINDOW_ACTIONS, DEFAULT_WINDOW_PREFERENCES, filterWindowActions, getWindowPreferences, saveWindowPreferences, executeWindowAction } from "./window-actions.js";
export * from "./types.js";
export * from "./window-actions.js";
function getActionIcon(item) {
    switch (item.id) {
        case "left-half": return Icon.SidebarLeft;
        case "right-half": return Icon.SidebarRight;
        case "top-half": return Icon.ArrowUp;
        case "bottom-half": return Icon.ArrowDown;
        case "center-half": return Icon.Columns;
        case "first-third": return Icon.SidebarLeft;
        case "center-third": return Icon.Columns;
        case "last-third": return Icon.SidebarRight;
        case "first-two-thirds":
        case "center-two-thirds":
        case "last-two-thirds": return Icon.Layout;
        case "top-third": return Icon.ArrowUp;
        case "middle-third": return Icon.ArrowsExpand;
        case "bottom-third": return Icon.ArrowDown;
        case "top-left-quarter": return Icon.ArrowUp;
        case "top-right-quarter": return Icon.ArrowUp;
        case "bottom-left-quarter": return Icon.ArrowDown;
        case "bottom-right-quarter": return Icon.ArrowDown;
        case "top-left-sixth":
        case "top-center-sixth":
        case "top-right-sixth":
        case "bottom-left-sixth":
        case "bottom-center-sixth":
        case "bottom-right-sixth": return Icon.Layout;
        case "maximize": return Icon.Maximize;
        case "restore": return Icon.Window;
        case "almost-maximize":
        case "almost-maximize-80":
        case "almost-maximize-70":
        case "almost-maximize-60": return Icon.ArrowsExpand;
        case "reasonable-size": return Icon.AppWindow;
        case "center": return Icon.AppWindow;
        case "maximize-height": return Icon.ArrowsExpand;
        case "maximize-width": return Icon.ArrowsExpand;
        case "minimize": return Icon.Minus;
        case "next-display":
        case "previous-display": return Icon.Monitor;
        case "minimize-on-display": return Icon.Monitor;
        case "make-larger": return Icon.Plus;
        case "make-smaller": return Icon.Minus;
        default: return Icon.ArrowsExpand;
    }
}
function getActionMarkdown(action, prefs) {
    const innerGap = prefs ? prefs.innerGap : 0;
    const outerGap = prefs ? prefs.outerGap : 0;
    return `
# 窗口管理动作: ${action.name}

> **分类**: \`${action.category.toUpperCase()}\` | **全局快捷键**: \`${action.shortcut ?? "未指定"}\`

---

### 功能说明
${action.description}

### 当前边距偏好配置
- **内边距 (innerGap)**: \`${innerGap} px\`
- **外边距 (outerGap)**: \`${outerGap} px\`
- **吸附模式**: \`macOS Menu Bar / Dock WorkArea 自动避让 & Win32 rcWork 栅格计算\`

---

### 原生下沉执行说明 (macOS AXUIElement & Win32 UIAccess)
该动作直接通过双端原生特权管道执行：
- **macOS 端 (\`Accessibility / AXUIElement\`)**:
  - 基于 \`System Events\` / \`AXUIElement\` 定位当前前台活动应用主窗口并读写 \`position\` 与 \`size\`
  - 基于 \`visibleFrame\` / \`workArea\` 实现 **Menu Bar / Dock WorkArea 自动避让**，确保分屏绝不遮挡顶部菜单栏与底部程序坞
- **Windows 端 (\`Win32 & ztools-uiaccess\`)**:
  - 基于 Win32 \`GetForegroundWindow\` 捕获活动窗口句柄，通过 \`MonitorFromWindow\` 与 \`GetMonitorInfoW\` 读取 \`rcWork\`（主动避让系统任务栏）
  - 自动处理最大化窗口还原（\`ShowWindow(SW_RESTORE)\`）与极速重定位（\`SetWindowPos\`）
  - 携带 \`SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED\` 杜绝窗口闪烁，耗时严格控制在 **< 1ms** 内
  `;
}
/**
 * 窗口偏好配置表单
 */
export function WindowPreferencesForm({ onSaved } = {}) {
    const { pop } = useNavigation();
    const [innerGap, setInnerGap] = useState("0");
    const [outerGap, setOuterGap] = useState("0");
    const [cycleMode, setCycleMode] = useState("sizes");
    const [percentage, setPercentage] = useState("0.9");
    useEffect(() => {
        void getWindowPreferences().then(prefs => {
            setInnerGap(String(prefs.innerGap));
            setOuterGap(String(prefs.outerGap));
            setCycleMode(prefs.cycleMode);
            setPercentage(String(prefs.percentage));
        });
    }, []);
    const handleSave = async () => {
        const updated = await saveWindowPreferences({
            innerGap: parseInt(innerGap, 10) || 0,
            outerGap: parseInt(outerGap, 10) || 0,
            cycleMode: cycleMode === "disabled" ? "disabled" : "sizes",
            percentage: parseFloat(percentage) || 0.9
        });
        if (onSaved)
            onSaved(updated);
        await showHUD("窗口调度偏好设置已更新");
        pop();
    };
    return (React.createElement(Form, { navigationTitle: "\u7A97\u53E3\u7BA1\u7406\u504F\u597D\u8BBE\u7F6E (Window Preferences)", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u504F\u597D\u8BBE\u7F6E", onSubmit: handleSave, icon: Icon.Checkmark }),
            React.createElement(Action, { title: "\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E", icon: Icon.Repeat, onAction: async () => {
                    await saveWindowPreferences(DEFAULT_WINDOW_PREFERENCES);
                    setInnerGap("0");
                    setOuterGap("0");
                    setCycleMode("sizes");
                    setPercentage("0.9");
                    await showHUD("已恢复默认偏好设置");
                } })) },
        React.createElement(Form.Dropdown, { id: "innerGap", title: "\u5206\u5C4F\u5185\u8FB9\u8DDD (Inner Gap)", value: innerGap, onChange: setInnerGap },
            React.createElement(Form.Dropdown.Item, { value: "0", title: "0 \u50CF\u7D20 (\u7D27\u8D34\u65E0\u7F1D)" }),
            React.createElement(Form.Dropdown.Item, { value: "4", title: "4 \u50CF\u7D20 (\u5FAE\u5C0F\u95F4\u9699)" }),
            React.createElement(Form.Dropdown.Item, { value: "8", title: "8 \u50CF\u7D20 (\u6807\u51C6\u95F4\u9699)" }),
            React.createElement(Form.Dropdown.Item, { value: "12", title: "12 \u50CF\u7D20 (\u8212\u9002\u7559\u767D)" }),
            React.createElement(Form.Dropdown.Item, { value: "16", title: "16 \u50CF\u7D20 (\u6781\u5BA2\u5BBD\u677E)" })),
        React.createElement(Form.Dropdown, { id: "outerGap", title: "\u5C4F\u5E55\u5916\u8FB9\u8DDD (Outer Gap)", value: outerGap, onChange: setOuterGap },
            React.createElement(Form.Dropdown.Item, { value: "0", title: "0 \u50CF\u7D20 (\u7D27\u8D34\u5C4F\u5E55\u8FB9\u6846)" }),
            React.createElement(Form.Dropdown.Item, { value: "4", title: "4 \u50CF\u7D20 (\u5FAE\u8FB9\u8DDD)" }),
            React.createElement(Form.Dropdown.Item, { value: "8", title: "8 \u50CF\u7D20 (\u6807\u51C6\u8FB9\u8DDD)" }),
            React.createElement(Form.Dropdown.Item, { value: "16", title: "16 \u50CF\u7D20 (\u4E9A\u514B\u529B\u5927\u7559\u767D)" })),
        React.createElement(Form.Dropdown, { id: "percentage", title: "\u51E0\u4E4E\u6700\u5927\u5316\u5360\u6BD4 (Percentage)", value: percentage, onChange: setPercentage },
            React.createElement(Form.Dropdown.Item, { value: "0.9", title: "90% \u5C4F\u5E55\u9762\u79EF (\u63A8\u8350)" }),
            React.createElement(Form.Dropdown.Item, { value: "0.8", title: "80% \u5C4F\u5E55\u9762\u79EF" }),
            React.createElement(Form.Dropdown.Item, { value: "0.7", title: "70% \u5C4F\u5E55\u9762\u79EF" }),
            React.createElement(Form.Dropdown.Item, { value: "0.6", title: "60% \u5C4F\u5E55\u9762\u79EF" })),
        React.createElement(Form.Dropdown, { id: "cycleMode", title: "\u5FAA\u73AF\u6A21\u5F0F (Cycle Mode)", value: cycleMode, onChange: setCycleMode },
            React.createElement(Form.Dropdown.Item, { value: "sizes", title: "\u5C3A\u5BF8\u5FAA\u73AF (Sizes: 1/2 -> 2/3 -> 1/3)" }),
            React.createElement(Form.Dropdown.Item, { value: "disabled", title: "\u7981\u7528\u5FAA\u73AF (\u5355\u6B21\u5438\u9644)" }))));
}
/**
 * 窗口动作详情视图
 */
export function WindowActionDetailView({ action = WINDOW_ACTIONS[0], preferences } = {}) {
    const markdown = getActionMarkdown(action, preferences);
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `动作: ${action.name}`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u52A8\u4F5C\u6807\u8BC6", text: action.id, icon: Icon.Key }),
            React.createElement(Detail.Metadata.Label, { title: "\u5206\u7C7B", text: action.category.toUpperCase(), icon: Icon.List }),
            action.shortcut && (React.createElement(Detail.Metadata.Label, { title: "\u63A8\u8350\u70ED\u952E", text: action.shortcut, icon: Icon.Terminal })),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.TagList, { title: "\u5E95\u5C42\u7BA1\u9053" },
                React.createElement(Detail.Metadata.TagList.Item, { text: "Accessibility (AXUIElement)", color: Color.SecondaryText }),
                React.createElement(Detail.Metadata.TagList.Item, { text: "Menu Bar / Dock WorkArea \u81EA\u52A8\u907F\u8BA9", color: Color.SecondaryText }),
                React.createElement(Detail.Metadata.TagList.Item, { text: "UIAccess UIPI Bypass", color: Color.SecondaryText }),
                React.createElement(Detail.Metadata.TagList.Item, { text: "Win32 SetWindowPos", color: Color.SecondaryText }))), actions: React.createElement(ActionPanel, { title: "\u7A97\u53E3\u52A8\u4F5C" },
            React.createElement(Action, { title: `立即执行: ${action.name}`, icon: Icon.Checkmark, onAction: async () => {
                    await executeWindowAction(action.id);
                } }),
            action.shortcut && (React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5FEB\u6377\u952E\u7EC4\u5408", content: action.shortcut, icon: Icon.CopyClipboard }))) }));
}
/**
 * 官方内置核心能力: Window Management (窗口调度器)
 * 布局一：100% 全宽极简列表，一目了然展示分屏比例、描述与全局快捷键
 */
export default function WindowManagementCommand() {
    const [searchText, setSearchText] = useState("");
    const [category, setCategory] = useState("all");
    const [isShowingDetail, setIsShowingDetail] = useState(false);
    const [preferences, setPreferences] = useState(DEFAULT_WINDOW_PREFERENCES);
    const [selectedId, setSelectedId] = useState(null);
    const { push } = useNavigation();
    useEffect(() => {
        void getWindowPreferences().then(setPreferences);
    }, []);
    const filtered = filterWindowActions(WINDOW_ACTIONS, {
        category: category,
        query: searchText
    });
    const halves = filtered.filter(a => a.category === "halves");
    const thirds = filtered.filter(a => a.category === "thirds");
    const quarters = filtered.filter(a => a.category === "quarters");
    const sixths = filtered.filter(a => a.category === "sixths");
    const centerMax = filtered.filter(a => a.category === "center-max");
    const displays = filtered.filter(a => a.category === "displays");
    const resize = filtered.filter(a => a.category === "resize");
    const handleExecute = async (item) => {
        await executeWindowAction(item.id, { preferences });
    };
    const renderActionItem = (item) => (React.createElement(List.Item, { key: item.id, id: item.id, title: item.name, subtitle: item.description, icon: getActionIcon(item), accessories: [
            { tag: { value: item.category.toUpperCase() } },
            ...(item.shortcut ? [{ text: item.shortcut }] : [])
        ], detail: React.createElement(List.Item.Detail, { markdown: getActionMarkdown(item, preferences) }), actions: React.createElement(ActionPanel, { title: "\u7A97\u53E3\u52A8\u4F5C" },
            React.createElement(Action, { title: `执行 ${item.name}`, icon: Icon.Checkmark, onAction: () => handleExecute(item) }),
            React.createElement(Action.Push, { title: "\u504F\u597D\u8BBE\u7F6E\u4E0E\u8FB9\u8DDD\u5FAE\u8C03", target: React.createElement(WindowPreferencesForm, { onSaved: setPreferences }), icon: Icon.Gear, shortcut: { modifiers: ["ctrl"], key: "return" } }),
            React.createElement(Action.Push, { title: "\u5168\u5C4F\u67E5\u770B\u52A8\u4F5C\u8BE6\u60C5\u4E0E\u5E95\u5C42\u8BF4\u660E", target: React.createElement(WindowActionDetailView, { action: item, preferences: preferences }), icon: Icon.Eye, shortcut: { modifiers: ["ctrl"], key: "d" } }),
            React.createElement(Action, { title: isShowingDetail ? "关闭右侧详情分栏" : "展开右侧详情分栏", icon: Icon.SidebarRight, shortcut: { modifiers: ["ctrl"], key: "b" }, onAction: () => setIsShowingDetail(!isShowingDetail) }),
            item.shortcut && (React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u63A8\u8350\u5FEB\u6377\u952E", content: item.shortcut, icon: Icon.CopyClipboard, shortcut: { modifiers: ["ctrl"], key: "c" } }))) }));
    return (React.createElement(List, { isShowingDetail: isShowingDetail, searchBarPlaceholder: "\u641C\u7D22\u7A97\u53E3\u7BA1\u7406\u52A8\u4F5C (\u5982: \u5DE6\u534A\u5C4F, \u6700\u5927\u5316, \u5C45\u4E2D, 60%, \u5FEB\u6377\u952E)...", onSearchTextChange: setSearchText, onSelectionChange: setSelectedId, filterBar: {
            summaryText: `窗口栅格调度动作 ${filtered.length} 项 · 分屏边距 ${preferences.innerGap}px / ${preferences.outerGap}px · Win32 WorkArea 自动避让`,
            actions: [
                {
                    id: "prefs",
                    label: "边距偏好设置",
                    title: "边距偏好设置",
                    style: "secondary",
                    onAction: () => {
                        push(React.createElement(WindowPreferencesForm, { onSaved: setPreferences }));
                    }
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6309\u5206\u7C7B\u7B5B\u9009", value: category, onChange: setCategory },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u52A8\u4F5C (All)", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u534A\u5C4F\u5BF9\u9F50 (Halves)", value: "halves", icon: Icon.SidebarLeft }),
            React.createElement(List.Dropdown.Item, { title: "\u4E09\u5206\u5C4F\u4E0E\u6BD4\u4F8B (Thirds)", value: "thirds", icon: Icon.Columns }),
            React.createElement(List.Dropdown.Item, { title: "\u56DB\u5206\u5C4F\u4E0E\u89D2\u843D (Quarters)", value: "quarters", icon: Icon.ArrowUp }),
            React.createElement(List.Dropdown.Item, { title: "\u516D\u5206\u5C4F\u6805\u683C (Sixths)", value: "sixths", icon: Icon.Layout }),
            React.createElement(List.Dropdown.Item, { title: "\u5C45\u4E2D\u4E0E\u94FA\u6EE1 (Center & Max)", value: "center-max", icon: Icon.Maximize }),
            React.createElement(List.Dropdown.Item, { title: "\u663E\u793A\u5668\u5207\u6362 (Displays)", value: "displays", icon: Icon.Monitor }),
            React.createElement(List.Dropdown.Item, { title: "\u5FAE\u8C03\u7F29\u653E (Resize)", value: "resize", icon: Icon.ArrowsExpand })) },
        halves.length > 0 && (React.createElement(List.Section, { title: "\u534A\u5C4F\u5BF9\u9F50 (Halves)" }, halves.map(renderActionItem))),
        thirds.length > 0 && (React.createElement(List.Section, { title: "\u4E09\u5206\u5C4F\u4E0E\u4E3B\u5DE5\u4F5C\u6D41 (Thirds & Two-Thirds)" }, thirds.map(renderActionItem))),
        quarters.length > 0 && (React.createElement(List.Section, { title: "\u56DB\u5206\u5C4F\u4E0E\u89D2\u843D\u5438\u9644 (Quarters & Corners)" }, quarters.map(renderActionItem))),
        sixths.length > 0 && (React.createElement(List.Section, { title: "\u516D\u5206\u5C4F\u6805\u683C\u6392\u7248 (Sixths Grid)" }, sixths.map(renderActionItem))),
        centerMax.length > 0 && (React.createElement(List.Section, { title: "\u5C45\u4E2D\u4E0E\u94FA\u6EE1 (Center & Maximize)" }, centerMax.map(renderActionItem))),
        displays.length > 0 && (React.createElement(List.Section, { title: "\u8DE8\u663E\u793A\u5668\u8C03\u5EA6 (Multi-Display Scheduling)" }, displays.map(renderActionItem))),
        resize.length > 0 && (React.createElement(List.Section, { title: "\u89C6\u7A97\u5FAE\u8C03\u7F29\u653E (Resize Step by Step)" }, resize.map(renderActionItem)))));
}
