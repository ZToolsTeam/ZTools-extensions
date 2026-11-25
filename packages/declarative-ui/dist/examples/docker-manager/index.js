import React, { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { controlContainer, getContainerTailLogs, listContainers } from './docker-service.js';
export * from './types.js';
export * from './docker-service.js';
export function DockerManagerCommand(props = {}) {
    const defaultFilter = props.featureCode === 'docker-running'
        ? 'running'
        : props.featureCode === 'docker-clean-stopped'
            ? 'exited'
            : 'all';
    const [containers, setContainers] = useState(props.initialContainers ?? []);
    const [statusFilter, setStatusFilter] = useState(defaultFilter);
    const [searchText, setSearchText] = useState('');
    const [daemonOfflineError, setDaemonOfflineError] = useState(null);
    const [isLoading, setIsLoading] = useState(!props.initialContainers);
    const handleRefresh = async () => {
        setIsLoading(true);
        setDaemonOfflineError(null);
        try {
            const list = await listContainers(undefined, props.hostOverride);
            setContainers(list);
        }
        catch (err) {
            setDaemonOfflineError(err instanceof Error ? err.message : '未检测到正在运行的 Docker 引擎');
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        if (!props.initialContainers) {
            void handleRefresh();
        }
    }, []);
    const runningCount = useMemo(() => containers.filter((c) => c.isRunning).length, [containers]);
    const filteredContainers = useMemo(() => {
        const byStatus = containers.filter((c) => {
            if (statusFilter === 'running')
                return c.isRunning;
            if (statusFilter === 'exited')
                return !c.isRunning;
            return true;
        });
        const q = searchText.trim().toLowerCase();
        if (!q)
            return byStatus;
        return byStatus.filter((c) => c.name.toLowerCase().includes(q) ||
            c.image.toLowerCase().includes(q) ||
            c.id.toLowerCase().includes(q) ||
            c.portsDisplay.toLowerCase().includes(q));
    }, [containers, statusFilter, searchText]);
    const handleToggleContainer = async (c) => {
        const nextAction = c.isRunning ? 'stop' : 'start';
        const res = await controlContainer(c.id, nextAction, undefined, props.hostOverride);
        if (!res.ok) {
            await showToast({ style: Toast.Style.Failure, title: res.error || '操作容器失败' });
            return;
        }
        setContainers((prev) => prev.map((item) => item.id === c.id
            ? {
                ...item,
                isRunning: !item.isRunning,
                statusDisplay: !item.isRunning ? 'Up Just Now' : 'Exited (0)'
            }
            : item));
        await showToast({
            style: Toast.Style.Success,
            title: `${c.name} 已${c.isRunning ? '停止' : '启动'}`
        });
    };
    const handlePruneStopped = async () => {
        const stopped = containers.filter((c) => !c.isRunning);
        let removedCount = 0;
        for (const c of stopped) {
            const res = await controlContainer(c.id, 'remove', undefined, props.hostOverride);
            if (res.ok)
                removedCount++;
        }
        setContainers((prev) => prev.filter((c) => c.isRunning));
        await showToast({
            style: Toast.Style.Success,
            title: `已清理 ${removedCount || stopped.length} 个已停止的容器`
        });
    };
    const handleLoadLogs = async (c) => {
        const logs = await getContainerTailLogs(c.id, 100, undefined, props.hostOverride);
        setContainers((prev) => prev.map((item) => (item.id === c.id ? { ...item, tailLogs: logs || '暂无日志输出' } : item)));
        await showToast({
            style: Toast.Style.Success,
            title: `已加载 ${c.name} 最新日志`
        });
    };
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u5BB9\u5668\u540D\u3001\u955C\u50CF\u3001\u7AEF\u53E3\u6216 ID (\u5982: nginx\u3001redis\u30013306) ...", searchBarAccessory: React.createElement(List.Dropdown, { value: statusFilter, onChange: (v) => setStatusFilter(v), tooltip: "\u6309\u72B6\u6001\u7B5B\u9009" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u5BB9\u5668", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u8FD0\u884C\u4E2D (Running)", value: "running", icon: Icon.CheckCircle }),
            React.createElement(List.Dropdown.Item, { title: "\u5DF2\u505C\u6B62 (Exited)", value: "exited", icon: Icon.XMarkCircle })), filterBar: {
            summaryText: daemonOfflineError
                ? `Docker 引擎未就绪: ${daemonOfflineError}`
                : `Docker 状态: 运行中 · 共 ${containers.length} 个容器（${runningCount} 个活跃中）`,
            actions: [
                { id: 'refresh', title: '刷新状态', onAction: handleRefresh },
                { id: 'prune', title: '清理停止容器', onAction: handlePruneStopped }
            ]
        } }, filteredContainers.map((c) => (React.createElement(List.Item, { key: c.id, id: c.id, title: c.name, subtitle: c.image, icon: c.isRunning ? Icon.CheckCircle : Icon.Circle, accessories: [
            ...(c.primaryPort ? [{ tag: c.primaryPort }] : []),
            { text: c.statusDisplay }
        ], detail: React.createElement(List.Item.Detail, { markdown: `### 容器日志 (尾部 100 行)\n\`\`\`bash\n${c.tailLogs || '暂无日志输出'}\n\`\`\``, metadata: React.createElement(List.Item.Detail.Metadata, null,
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5BB9\u5668\u5168\u540D", text: c.name }),
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5BB9\u5668 ID", text: c.id.substring(0, 12) }),
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u57FA\u7840\u955C\u50CF", text: c.image }),
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8FD0\u884C\u72B6\u6001", text: c.statusDisplay }),
                React.createElement(List.Item.Detail.Metadata.Separator, null),
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7AEF\u53E3\u6620\u5C04", text: c.portsDisplay || '无端口映射' }),
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u521B\u5EFA\u65F6\u95F4", text: c.createdFormatted })) }), actions: React.createElement(ActionPanel, null,
            c.webUrl && c.isRunning ? (React.createElement(Action.OpenInBrowser, { title: `在浏览器中打开 ${c.webUrl}`, url: c.webUrl, icon: Icon.Globe })) : null,
            React.createElement(Action, { title: c.isRunning ? '停止容器 (docker stop)' : '启动容器 (docker start)', icon: c.isRunning ? Icon.XMarkCircle : Icon.Play, shortcut: { modifiers: ['cmd'], key: 'enter' }, onAction: () => handleToggleContainer(c) }),
            React.createElement(Action, { title: "\u52A0\u8F7D\u5BB9\u5668\u6700\u65B0\u65E5\u5FD7 (100\u884C)", icon: Icon.Document, onAction: () => handleLoadLogs(c) }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 12 \u4F4D\u77ED\u5BB9\u5668 ID", content: c.id.substring(0, 12), shortcut: { modifiers: ['cmd'], key: 'c' } }),
            React.createElement(Action, { title: "\u6E05\u7406\u505C\u6B62\u5BB9\u5668", icon: Icon.Trash, style: Action.Style.Destructive, onAction: handlePruneStopped })) })))));
}
export default DockerManagerCommand;
