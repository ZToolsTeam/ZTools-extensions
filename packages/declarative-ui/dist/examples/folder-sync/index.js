import React, { Action, ActionPanel, Color, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { callHostTransport } from '../shared/native-ipc.js';
import { compareFolderTrees, executeFolderSync, filterSyncDiffItems, formatSyncBytes, shortenFolderPath } from './sync-service.js';
export * from './types.js';
export * from './sync-service.js';
export function FolderSyncCommand(props = {}) {
    const [sourceDir, setSourceDir] = useState(props.initialSourceDir ?? '');
    const [targetDir, setTargetDir] = useState(props.initialTargetDir ?? '');
    const [syncMode, setSyncMode] = useState(props.initialSyncMode ?? 'incremental');
    const [ignoreDevJunk, setIgnoreDevJunk] = useState(true);
    const [diffFilter, setDiffFilter] = useState('all');
    const [searchText, setSearchText] = useState('');
    const [diffItems, setDiffItems] = useState([]);
    const [checkedSet, setCheckedSet] = useState(new Set());
    const [isBusy, setIsBusy] = useState(false);
    const handleCompareDirectories = async (customSource = sourceDir, customTarget = targetDir, customMode = syncMode, customIgnore = ignoreDevJunk) => {
        if (!customSource || !customTarget) {
            setDiffItems([]);
            setCheckedSet(new Set());
            return;
        }
        setIsBusy(true);
        try {
            const res = await compareFolderTrees({
                sourceDir: customSource,
                targetDir: customTarget,
                syncMode: customMode,
                ignoreDevJunk: customIgnore,
                hostOverride: props.hostOverride
            });
            if (!res.ok) {
                await showToast({
                    style: Toast.Style.Failure,
                    title: res.error || '目录差异比对失败'
                });
                setDiffItems([]);
                setCheckedSet(new Set());
                return;
            }
            setDiffItems(res.diffs);
            setCheckedSet(new Set(res.diffs.map((d) => d.relPath)));
        }
        finally {
            setIsBusy(false);
        }
    };
    useEffect(() => {
        if (sourceDir && targetDir) {
            void handleCompareDirectories(sourceDir, targetDir, syncMode, ignoreDevJunk);
        }
    }, [sourceDir, targetDir, syncMode, ignoreDevJunk]);
    const filteredDiffs = useMemo(() => filterSyncDiffItems(diffItems, diffFilter, searchText), [diffItems, diffFilter, searchText]);
    const checkedItems = useMemo(() => diffItems.filter((d) => checkedSet.has(d.relPath)), [diffItems, checkedSet]);
    const transferBytes = useMemo(() => checkedItems
        .filter((d) => d.direction !== 'delete-dst')
        .reduce((acc, d) => acc + d.sizeBytes, 0), [checkedItems]);
    const allChecked = filteredDiffs.length > 0 && filteredDiffs.every((d) => checkedSet.has(d.relPath));
    const someChecked = !allChecked && filteredDiffs.some((d) => checkedSet.has(d.relPath));
    const toggleCheck = (relPath) => {
        setCheckedSet((prev) => {
            const next = new Set(prev);
            if (next.has(relPath))
                next.delete(relPath);
            else
                next.add(relPath);
            return next;
        });
    };
    const toggleAllVisible = () => {
        setCheckedSet((prev) => {
            const next = new Set(prev);
            if (allChecked) {
                for (const d of filteredDiffs)
                    next.delete(d.relPath);
            }
            else {
                for (const d of filteredDiffs)
                    next.add(d.relPath);
            }
            return next;
        });
    };
    const handleSelectDirectories = async () => {
        const srcRes = await callHostTransport('dialog_show_open', { properties: ['openDirectory'], title: '选择源文件夹 (Source Folder)' }, props.hostOverride);
        const pickedSrc = srcRes.data?.filePaths?.[0] ?? srcRes.data?.paths?.[0];
        if (!pickedSrc)
            return;
        const dstRes = await callHostTransport('dialog_show_open', { properties: ['openDirectory'], title: '选择目标备份文件夹 (Target Folder)' }, props.hostOverride);
        const pickedDst = dstRes.data?.filePaths?.[0] ?? dstRes.data?.paths?.[0];
        if (!pickedDst)
            return;
        setSourceDir(pickedSrc);
        setTargetDir(pickedDst);
    };
    const handleExecuteSync = async () => {
        if (checkedItems.length === 0) {
            await showToast({
                style: Toast.Style.Failure,
                title: '请先勾选至少一项待同步差异文件'
            });
            return;
        }
        setIsBusy(true);
        try {
            const res = await executeFolderSync({
                sourceDir,
                targetDir,
                syncMode,
                ignoreDevJunk,
                selectedRelPaths: checkedItems.map((d) => d.relPath),
                hostOverride: props.hostOverride
            });
            if (!res.ok && res.failures.length === 0) {
                await showToast({
                    style: Toast.Style.Failure,
                    title: res.error || '目录增量同步失败'
                });
                return;
            }
            if (res.failures.length > 0) {
                await showToast({
                    style: Toast.Style.Failure,
                    title: `同步完成 ${res.syncedCount} 项，但有 ${res.failures.length} 个文件被占用跳过 (${res.failures[0].relPath})`
                });
            }
            else {
                await showToast({
                    style: Toast.Style.Success,
                    title: `增量同步完成：已写入 ${res.syncedCount} 个文件 (${formatSyncBytes(res.transferredBytes)})`
                });
            }
            await handleCompareDirectories(sourceDir, targetDir, syncMode, ignoreDevJunk);
        }
        finally {
            setIsBusy(false);
        }
    };
    return (React.createElement(List, { navigationTitle: "\u76EE\u5F55\u589E\u91CF\u540C\u6B65", isLoading: isBusy, isShowingDetail: false, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u5728\u5DEE\u5F02\u6587\u4EF6\u961F\u5217\u4E2D\u641C\u7D22\u6587\u4EF6\u540D\u6216\u76F8\u5BF9\u8DEF\u5F84...", searchBarAccessory: React.createElement(List.Dropdown, { value: diffFilter, onChange: (val) => setDiffFilter(val), tooltip: "\u6309\u5DEE\u5F02\u7C7B\u578B\u7B5B\u9009" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u5DEE\u5F02\u6587\u4EF6", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u770B\u65B0\u589E\u6587\u4EF6 (+)", value: "added", icon: Icon.Plus }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u770B\u5DF2\u4FEE\u6539\u6587\u4EF6 (\u2191)", value: "modified", icon: Icon.Pencil }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u770B\u76EE\u6807\u7AEF\u591A\u4F59\u6587\u4EF6 (-)", value: "orphan", icon: Icon.Trash })), filterBar: {
            summaryText: `比对完成：共发现 ${diffItems.length} 处差异 · 已勾选 ${checkedItems.length} 项（待传输 ${formatSyncBytes(transferBytes)}）`,
            actions: [
                {
                    id: 'pick-dirs',
                    title: '选择源/目标目录',
                    onAction: () => {
                        void handleSelectDirectories();
                    }
                },
                {
                    id: 'rescan',
                    title: '重新比对',
                    onAction: () => {
                        void handleCompareDirectories();
                    }
                }
            ]
        }, workbenchPanel: {
            title: '同步策略与目录配置',
            subtitle: `${shortenFolderPath(sourceDir)} → ${shortenFolderPath(targetDir)}`,
            fields: [
                {
                    id: 'syncMode',
                    label: '同步模式',
                    type: 'select',
                    value: syncMode,
                    options: [
                        { label: '单向增量备份 (仅新增/更新，最安全)', value: 'incremental' },
                        { label: '双向最新合并 (两边互相同步)', value: 'two-way' },
                        { label: '单向镜像克隆 (清理目标端多余项)', value: 'mirror' }
                    ],
                    onChange: (val) => setSyncMode(val)
                },
                {
                    id: 'ignoreDevJunk',
                    label: '忽略缓存目录 (node_modules/.git)',
                    type: 'toggle',
                    value: ignoreDevJunk,
                    onChange: (val) => setIgnoreDevJunk(Boolean(val))
                },
                {
                    id: 'sourceInfo',
                    label: '源文件夹',
                    type: 'info',
                    value: sourceDir || '未选择'
                },
                {
                    id: 'targetInfo',
                    label: '目标文件夹',
                    type: 'info',
                    value: targetDir || '未选择'
                }
            ],
            previewCard: {
                title: '本次同步传输预估',
                subtitle: `预计写入 ${checkedItems.length} 个文件 · 共 ${formatSyncBytes(transferBytes)}`
            }
        }, subList: {
            title: `待同步差异文件明细 (${filteredDiffs.length} 项)`,
            subtitle: '按空格勾选或取消，按 Enter 开始执行增量同步',
            emptyText: '源目录与目标目录内容完全一致，无需同步',
            checkable: filteredDiffs.length > 0,
            checked: allChecked ? true : someChecked ? 'indeterminate' : false,
            onCheckChange: toggleAllVisible,
            items: filteredDiffs.map((item) => (React.createElement(List.Item, { key: item.relPath, id: item.relPath, title: item.relPath, subtitle: item.reasonText, icon: item.diffType === 'added' || item.diffType === 'reverse-add'
                    ? Icon.Plus
                    : item.diffType === 'modified'
                        ? Icon.ArrowUp
                        : Icon.Trash, checkable: true, checked: checkedSet.has(item.relPath), onCheckChange: () => toggleCheck(item.relPath), accessories: [
                    item.diffType === 'orphan'
                        ? { tag: { value: '目标多余(移入回收站)', color: Color.Red } }
                        : { tag: item.actionBadge },
                    { text: formatSyncBytes(item.sizeBytes) }
                ], actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: `开始执行增量同步 (${checkedItems.length} 个文件)`, icon: Icon.Play, onAction: handleExecuteSync }),
                    React.createElement(Action.ShowInFinder, { title: "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u67E5\u770B\u6E90\u6587\u4EF6", path: item.sourceFullPath || item.targetFullPath }),
                    React.createElement(Action, { title: "\u66F4\u6362\u6E90\u76EE\u5F55\u4E0E\u76EE\u6807\u76EE\u5F55", icon: Icon.Folder, onAction: handleSelectDirectories })) })))
        } }));
}
export default FolderSyncCommand;
