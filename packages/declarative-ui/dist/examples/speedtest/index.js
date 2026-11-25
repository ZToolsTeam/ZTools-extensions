import React, { Detail, List, ActionPanel, Action, Icon, Color, Clipboard, showToast, Toast, useState, useEffect, useMemo, useCallback, useRef } from '../../index.js';
import { buildSpeedtestDiagnosticSummary, normalizeCustomHostInput, probeSpeedtestNodes, runSpeedtestBandwidth } from './speedtest-service.js';
export * from './types.js';
export * from './speedtest-service.js';
export function Speedtest({ featureCode = 'speedtest-full', initialBandwidth = null, initialProbes } = {}) {
    const [isRunning, setIsRunning] = useState(!initialProbes);
    const [searchText, setSearchText] = useState('');
    const [viewCategory, setViewCategory] = useState('all');
    const [bandwidth, setBandwidth] = useState(initialBandwidth);
    const [probes, setProbes] = useState(initialProbes || []);
    const mountedRef = useRef(true);
    const abortControllerRef = useRef(null);
    const runSeqRef = useRef(0);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
        };
    }, []);
    const executeSpeedtest = useCallback(async (includeBandwidth, customHost) => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const seq = ++runSeqRef.current;
        setIsRunning(true);
        try {
            const customClean = customHost ? normalizeCustomHostInput(customHost) || undefined : undefined;
            const nodesPromise = probeSpeedtestNodes({
                customHost: customClean,
                signal: controller.signal
            });
            const bwPromise = includeBandwidth
                ? runSpeedtestBandwidth({ signal: controller.signal })
                : Promise.resolve(null);
            const [nodesResult, bwResult] = await Promise.all([nodesPromise, bwPromise]);
            if (!mountedRef.current || seq !== runSeqRef.current || controller.signal.aborted) {
                return;
            }
            setProbes(nodesResult);
            if (bwResult) {
                setBandwidth(bwResult);
            }
        }
        catch (err) {
            if (!mountedRef.current || seq !== runSeqRef.current || controller.signal.aborted) {
                return;
            }
            await showToast({
                style: Toast.Style.Failure,
                title: '网络测速异常',
                message: err instanceof Error ? err.message : String(err)
            });
        }
        finally {
            if (mountedRef.current && seq === runSeqRef.current) {
                setIsRunning(false);
            }
        }
    }, []);
    useEffect(() => {
        if (initialProbes) {
            return;
        }
        const includeBw = featureCode !== 'speedtest-ping-check';
        void executeSpeedtest(includeBw);
    }, [initialProbes, featureCode, executeSpeedtest]);
    const handleToggleSpeedtest = useCallback(async () => {
        if (isRunning) {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            setIsRunning(false);
            await showToast({
                style: Toast.Style.Success,
                title: '已停止网络测速'
            });
            return;
        }
        const customHost = normalizeCustomHostInput(searchText) || undefined;
        await executeSpeedtest(featureCode !== 'speedtest-ping-check', customHost);
    }, [isRunning, searchText, featureCode, executeSpeedtest]);
    const handleStartFullTest = useCallback(async () => {
        const customHost = normalizeCustomHostInput(searchText) || undefined;
        await executeSpeedtest(true, customHost);
    }, [searchText, executeSpeedtest]);
    const handleProbeSingle = useCallback(async (node) => {
        setIsRunning(true);
        try {
            const updatedList = await probeSpeedtestNodes({ customHost: node.host });
            if (!mountedRef.current)
                return;
            setProbes(updatedList);
            const target = updatedList.find((n) => n.host === node.host);
            await showToast({
                style: Toast.Style.Success,
                title: `${node.name} 延迟重测完成`,
                message: target?.reachable ? `${target.latencyMs} ms` : '连接超时'
            });
        }
        catch (err) {
            if (!mountedRef.current)
                return;
            await showToast({
                style: Toast.Style.Failure,
                title: '节点探测失败',
                message: err instanceof Error ? err.message : String(err)
            });
        }
        finally {
            if (mountedRef.current) {
                setIsRunning(false);
            }
        }
    }, []);
    const summary = useMemo(() => buildSpeedtestDiagnosticSummary(bandwidth, probes), [bandwidth, probes]);
    const handleCopyFullReport = useCallback(async () => {
        await Clipboard.copy(summary.fullMarkdown);
        await showToast({
            style: Toast.Style.Success,
            title: '已复制完整网络诊断报告'
        });
    }, [summary.fullMarkdown]);
    const filteredProbes = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        return probes.filter((node) => {
            if (viewCategory === 'domestic' && node.region !== 'domestic' && node.region !== 'lan') {
                return false;
            }
            if (viewCategory === 'global' && node.region !== 'global') {
                return false;
            }
            if (!q)
                return true;
            // If user typed a custom domain that matches a custom probe or general filter
            return (node.name.toLowerCase().includes(q) ||
                node.host.toLowerCase().includes(q) ||
                node.regionLabel.toLowerCase().includes(q));
        });
    }, [probes, searchText, viewCategory]);
    return (React.createElement(List, { isLoading: isRunning, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u8BCA\u65AD\u8282\u70B9\u540D\u79F0\uFF0C\u6216\u8F93\u5165\u81EA\u5B9A\u4E49\u57DF\u540D/IP \u56DE\u8F66\u76F4\u63A5\u6D4B\u8BD5\u5EF6\u8FDF...", searchBarAccessory: React.createElement(List.Dropdown, { value: viewCategory, onChange: setViewCategory, tooltip: "\u7B5B\u9009\u6D4B\u901F\u4E0E\u8BCA\u65AD\u7EF4\u5EA6" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u94FE\u8DEF\u8BCA\u65AD + \u5BBD\u5E26\u6D4B\u901F", value: "all", icon: Icon.Bolt }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u770B\u56FD\u5185\u6838\u5FC3\u7F51\u7AD9\u8FDE\u901A\u6027", value: "domestic", icon: Icon.Globe }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u770B\u56FD\u9645\u4E0E\u5F00\u53D1\u8005\u8282\u70B9 (GitHub\u7B49)", value: "global", icon: Icon.Code })), filterBar: {
            summaryText: summary.summaryText,
            actions: [
                {
                    id: 'rerun',
                    title: isRunning ? '停止测速' : '重新测速',
                    onAction: handleToggleSpeedtest
                },
                { id: 'copy-report', title: '复制诊断报告', onAction: handleCopyFullReport }
            ]
        } },
        viewCategory === 'all' && summary.bandwidthItems.length > 0 && (React.createElement(List.Section, { title: "\u5BBD\u5E26\u541E\u5410\u91CF\u4E0E\u7F51\u7EDC\u8D28\u91CF" }, summary.bandwidthItems.map((bw) => (React.createElement(List.Item, { key: bw.id, id: bw.id, title: bw.title, subtitle: bw.subtitle, icon: Icon.Bolt, accessories: [
                { progress: bw.progressRatio },
                { tag: bw.gradeTag },
                { text: bw.valueText }
            ], actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u91CD\u65B0\u6267\u884C\u5B8C\u6574\u7F51\u7EDC\u6D4B\u901F", icon: Icon.ArrowClockwise, onAction: handleStartFullTest }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5B8C\u6574\u7F51\u7EDC\u8BCA\u65AD\u62A5\u544A", content: summary.fullMarkdown })) }))))),
        React.createElement(List.Section, { title: "\u5206\u8282\u70B9\u8FDE\u901A\u6027\u4E0E\u5EF6\u8FDF\u8BCA\u65AD" }, filteredProbes.map((node) => (React.createElement(List.Item, { key: node.id, id: node.id, title: `${node.name} (${node.host})`, subtitle: node.categoryDesc, icon: node.reachable ? Icon.CheckCircle : Icon.ExclamationMark, accessories: [
                !node.reachable
                    ? { tag: { value: '连接超时', color: Color.Red } }
                    : node.latencyMs > 300
                        ? { tag: { value: '高延迟', color: Color.Red } }
                        : { progress: Math.max(0.05, 1 - node.latencyMs / 400) },
                { tag: node.regionLabel },
                { text: node.reachable ? `${node.latencyMs} ms` : '不可达' }
            ], actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: `单独重测 ${node.name} 延迟`, icon: Icon.ArrowClockwise, onAction: () => handleProbeSingle(node) }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8282\u70B9\u6D4B\u901F\u7ED3\u679C", content: `${node.name} (${node.host}): ${node.reachable ? `${node.latencyMs} ms` : '超时'}` }),
                React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00\u9A8C\u8BC1", url: `https://${node.host}` })) }))))));
}
export const SpeedtestCommand = Speedtest;
export default Speedtest;
export function SpeedtestDetailView({ report }) {
    return (React.createElement(Detail, { markdown: "# 全球主流 DNS 解析延时对比\n\n- 8.8.8.8: 15ms\n\n## 网络拓扑路径\n\nLocal -> Gateway -> Edge", metadata: React.createElement(Detail.Metadata, null), actions: React.createElement(ActionPanel, null) }));
}
