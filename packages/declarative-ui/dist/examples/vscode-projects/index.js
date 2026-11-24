import React, { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { filterProjectEntries, launchProjectInEditor, scanAllRecentProjects } from './project-service.js';
export * from './types.js';
export * from './project-service.js';
function getEditorIcon(editorType) {
    switch (editorType) {
        case 'vscode':
        case 'cursor':
        case 'trae':
        case 'windsurf':
            return Icon.Code;
        default:
            return Icon.Terminal;
    }
}
export function VscodeProjectsCommand(props = {}) {
    const defaultEditorFilter = props.featureCode === 'projects-vscode-cursor'
        ? 'vsc-family'
        : props.featureCode === 'projects-jetbrains'
            ? 'jetbrains'
            : 'all';
    const [projects, setProjects] = useState(props.initialProjects ?? []);
    const [selectedEditor, setSelectedEditor] = useState(defaultEditorFilter);
    const [searchText, setSearchText] = useState('');
    const [isLoading, setIsLoading] = useState(!props.initialProjects);
    const handleRescan = async () => {
        setIsLoading(true);
        try {
            const scanned = await scanAllRecentProjects(undefined, props.hostOverride);
            if (scanned.length > 0 || !props.initialProjects) {
                setProjects(scanned);
            }
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        if (!props.initialProjects) {
            void handleRescan();
        }
    }, []);
    const filteredProjects = useMemo(() => filterProjectEntries(projects, searchText, selectedEditor), [projects, searchText, selectedEditor]);
    const handleOpenInEditor = async (item) => {
        const res = await launchProjectInEditor(item, props.hostOverride);
        if (!res.ok) {
            await showToast({
                style: Toast.Style.Failure,
                title: '无法打开该项目',
                message: res.error
            });
            return;
        }
        await showToast({
            style: Toast.Style.Success,
            title: `正在使用 ${item.editorName} 打开 ${item.name}`
        });
    };
    const handleCleanGhostProjects = async () => {
        const missingCount = projects.filter((p) => p.isMissing).length;
        setProjects((prev) => prev.filter((p) => !p.isMissing));
        await showToast({
            style: Toast.Style.Success,
            title: `已清理 ${missingCount} 条失效项目记录`
        });
    };
    return (React.createElement(List, { isLoading: isLoading, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u9879\u76EE\u540D\u3001\u8DEF\u5F84\u3001Git \u5206\u652F\u6216\u7F16\u8F91\u5668 (\u5982: ztools\u3001main\u3001cursor) ...", searchBarAccessory: React.createElement(List.Dropdown, { value: selectedEditor, onChange: (v) => setSelectedEditor(v), tooltip: "\u6309\u7F16\u8F91\u5668\u7B5B\u9009" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u7F16\u8F91\u5668\u9879\u76EE", value: "all", icon: Icon.Folder }),
            React.createElement(List.Dropdown.Item, { title: "VS Code \u5BB6\u65CF (Code / Cursor / Trae)", value: "vsc-family", icon: Icon.Code }),
            React.createElement(List.Dropdown.Item, { title: "JetBrains \u5BB6\u65CF (IDEA / WebStorm \u7B49)", value: "jetbrains", icon: Icon.Terminal })), filterBar: {
            summaryText: `共发现 ${filteredProjects.length} 个本地项目 · 支持回车秒开 IDE、Ctrl+Enter 唤起终端`,
            actions: [
                { id: 'refresh', title: '重新扫描', onAction: handleRescan },
                { id: 'clean-ghost', title: '清理失效记录', onAction: handleCleanGhostProjects }
            ]
        } }, filteredProjects.map((item) => (React.createElement(List.Item, { key: `${item.editorType}:${item.path}`, id: `${item.editorType}:${item.path}`, title: item.name, subtitle: item.displayPath, icon: getEditorIcon(item.editorType), accessories: [
            ...(item.gitBranch ? [{ tag: `git:${item.gitBranch}` }] : []),
            item.isMissing ? { tag: '路径已失效' } : { tag: item.editorName },
            { text: item.lastOpenedRelative }
        ], actions: React.createElement(ActionPanel, null,
            React.createElement(Action, { title: `用 ${item.editorName} 打开项目`, icon: Icon.Desktop, onAction: () => handleOpenInEditor(item) }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u9879\u76EE\u7EDD\u5BF9\u8DEF\u5F84", content: item.path, shortcut: { modifiers: ['cmd'], key: 'c' } }),
            item.gitBranch ? (React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Git \u5206\u652F\u540D", content: item.gitBranch, shortcut: { modifiers: ['cmd', 'shift'], key: 'c' } })) : null,
            React.createElement(Action, { title: "\u6E05\u7406\u5931\u6548\u9879\u76EE\u8BB0\u5F55", icon: Icon.Trash, onAction: handleCleanGhostProjects })) })))));
}
export default VscodeProjectsCommand;
