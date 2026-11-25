import React, { Action, ActionPanel, Color, Icon, List, Toast, confirmAlert, showToast, useEffect, useMemo, useRef, useState } from '../../index.js';
import { createExampleImportProps } from '../shared/file-import.js';
import { copyProcessInfoToClipboard, detectClipboardCandidatePath, filterLockingProcesses, inspectTargetLocks, listRemovableDrives, looksLikeFilePath, openUnlockedTarget, pickUnlockTargetPath, revealLockedTargetInFolder, revealProcessExecutableInFolder, sanitizeInputPath, unlockAllProcesses, unlockAndTrashTarget, unlockSingleProcess } from './unlock-service.js';
function extractBaseName(targetPath) {
    const cleaned = sanitizeInputPath(targetPath).replace(/[\\/]+$/, '');
    if (!cleaned)
        return '未指定路径';
    if (/^[a-zA-Z]:$/.test(cleaned))
        return `${cleaned}\\`;
    const parts = cleaned.split(/[\\/]/);
    return parts[parts.length - 1] || cleaned;
}
export default function FileUnlockCommand(props) {
    const [targetPath, setTargetPath] = useState(sanitizeInputPath(props?.initialPath ?? ''));
    const [searchQuery, setSearchQuery] = useState('');
    const [processFilter, setProcessFilter] = useState('all');
    const [processes, setProcesses] = useState([]);
    const [removableDrives, setRemovableDrives] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [lastError, setLastError] = useState('');
    const inspectSeqRef = useRef(0);
    const targetEpochRef = useRef(0);
    const aliveRef = useRef(true);
    const runInspection = async (rawPath) => {
        const cleaned = sanitizeInputPath(rawPath);
        const seq = ++inspectSeqRef.current;
        if (!cleaned) {
            setProcesses([]);
            setLastError('');
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setLastError('');
        try {
            const res = await inspectTargetLocks(cleaned, props?.hostOverride);
            if (!aliveRef.current || seq !== inspectSeqRef.current)
                return;
            if (!res.ok) {
                setProcesses([]);
                setLastError(res.error || '目标路径检测失败');
                await showToast({
                    style: Toast.Style.Failure,
                    title: '无法扫描目标路径',
                    message: res.error || '请检查路径是否存在或是否有访问权限'
                });
                return;
            }
            setTargetPath(res.targetPath);
            setProcesses(res.processes);
            setLastError('');
        }
        finally {
            if (aliveRef.current && seq === inspectSeqRef.current) {
                setIsLoading(false);
            }
        }
    };
    useEffect(() => {
        aliveRef.current = true;
        const init = async () => {
            // 启动时不自动读取剪贴板、不自动扫描磁盘：仅在显式传入 initialPath 时检测目标，或 u 盘入口列出设备供手动选择
            const explicitTarget = sanitizeInputPath(props?.initialPath ?? '');
            if (explicitTarget) {
                await runInspection(explicitTarget);
                return;
            }
            if (props?.featureCode === 'usb-unlock') {
                const drives = await listRemovableDrives(props?.hostOverride);
                if (aliveRef.current)
                    setRemovableDrives(drives);
            }
        };
        void init();
        return () => {
            aliveRef.current = false;
            inspectSeqRef.current += 1;
            targetEpochRef.current += 1;
        };
    }, [props?.initialPath, props?.featureCode, props?.hostOverride]);
    const handlePickTarget = async (directory) => {
        const picked = await pickUnlockTargetPath(directory, props?.hostOverride);
        if (picked.canceled)
            return;
        if (picked.error || !picked.path) {
            await showToast({
                style: Toast.Style.Failure,
                title: directory ? '选择文件夹失败' : '选择文件失败',
                message: picked.error || '未获取到有效路径'
            });
            return;
        }
        setTargetPath(picked.path);
        await runInspection(picked.path);
    };
    const handleDetectClipboard = async () => {
        if (isLoading) {
            await showToast({ style: Toast.Style.Failure, title: '正在检测，请稍后再试' });
            return;
        }
        const candidate = await detectClipboardCandidatePath(props?.hostOverride);
        if (!candidate) {
            await showToast({
                style: Toast.Style.Failure,
                title: '剪贴板中没有可检测的路径',
                message: '请先复制文件、文件夹或盘符完整路径'
            });
            return;
        }
        setTargetPath(candidate);
        await runInspection(candidate);
    };
    const handleClearList = async () => {
        if (isLoading) {
            await showToast({ style: Toast.Style.Failure, title: '正在检测，完成后再清空' });
            return;
        }
        inspectSeqRef.current += 1;
        targetEpochRef.current += 1;
        setTargetPath('');
        setProcesses([]);
        setLastError('');
        setSearchQuery('');
        setProcessFilter('all');
    };
    const fileInputProps = createExampleImportProps(input => {
        const firstPath = sanitizeInputPath(input.paths[0] ?? '');
        if (!firstPath)
            return;
        setTargetPath(firstPath);
        void runInspection(firstPath);
    }, { dropTitle: '拖入被占用的文件或文件夹', dropSubtitle: '松开后立即检测句柄占用进程' });
    const killableCount = useMemo(() => processes.filter(p => !p.isProtected).length, [processes]);
    const filteredProcesses = useMemo(() => filterLockingProcesses(processes, processFilter, searchQuery), [processes, processFilter, searchQuery]);
    const handleSearchChange = (text) => {
        setSearchQuery(text);
        if (looksLikeFilePath(text)) {
            const nextTarget = sanitizeInputPath(text);
            setTargetPath(nextTarget);
            void runInspection(nextTarget);
        }
    };
    const handleUnlockSingle = async (proc, trashAfterUnlock = false) => {
        if (proc.isProtected) {
            await showToast({
                style: Toast.Style.Failure,
                title: '安全策略拦截',
                message: `${proc.name} (PID ${proc.pid}) 为系统关键保护进程，严禁强制结束`
            });
            return;
        }
        const confirmed = await confirmAlert({
            title: trashAfterUnlock
                ? `确认结束进程 ${proc.name} (PID ${proc.pid}) 并将目标移入回收站？`
                : `确认结束占用进程 ${proc.name} (PID ${proc.pid})？`,
            message: proc.serviceTypeLabel === '资源管理器'
                ? '检测到资源管理器占用，解锁后将自动平滑重启 explorer.exe，桌面不会黑屏。'
                : `目标路径: ${targetPath}\n进程路径: ${proc.executablePath}`
        });
        if (!confirmed)
            return;
        const epoch = targetEpochRef.current;
        const res = await unlockSingleProcess(proc, targetPath, { trashAfterUnlock }, props?.hostOverride);
        const stale = !aliveRef.current || epoch !== targetEpochRef.current;
        if (!res.ok) {
            await showToast({
                style: Toast.Style.Failure,
                title: res.errorCode === 'PROCESS_IDENTITY_MISMATCH'
                    ? '进程 PID 已变更，已拦截误杀'
                    : res.errorCode === 'PROCESS_PROTECTED'
                        ? '系统关键保护进程禁止终止'
                        : '解除占用失败',
                message: res.error || '请尝试使用管理员权限运行'
            });
            if (!stale && res.errorCode === 'PROCESS_IDENTITY_MISMATCH' && targetPath) {
                await runInspection(targetPath);
            }
            return;
        }
        await showToast({
            style: Toast.Style.Success,
            title: res.trashed ? `已解锁并移入回收站: ${extractBaseName(targetPath)}` : `已解除进程占用: ${proc.name}`,
            message: res.explorerRestarted ? '已平滑重启 Windows 资源管理器' : `PID ${proc.pid} 已释放句柄`
        });
        if (stale)
            return;
        if (res.trashed)
            setProcesses([]);
        else if (targetPath)
            await runInspection(targetPath);
    };
    const handleUnlockAll = async (trashAfterUnlock = false) => {
        if (!targetPath) {
            await showToast({ style: Toast.Style.Animated, title: '请先输入或选择被占用的文件或文件夹路径' });
            return;
        }
        if (processes.length > 0 && killableCount === 0) {
            await showToast({
                style: Toast.Style.Failure,
                title: '无法强制解锁系统核心进程',
                message: '当前所有占用进程均为系统关键保护进程，受安全策略保护'
            });
            return;
        }
        const confirmed = await confirmAlert({
            title: trashAfterUnlock
                ? `确认结束 ${killableCount} 个占用进程并将「${extractBaseName(targetPath)}」移入回收站？`
                : `确认一键结束 ${killableCount} 个可安全终止的占用进程？`,
            message: `目标路径: ${targetPath}`
        });
        if (!confirmed)
            return;
        const epoch = targetEpochRef.current;
        const res = trashAfterUnlock
            ? await unlockAndTrashTarget(processes, targetPath, props?.hostOverride)
            : await unlockAllProcesses(processes, targetPath, {}, props?.hostOverride);
        const stale = !aliveRef.current || epoch !== targetEpochRef.current;
        if (!res.ok) {
            await showToast({
                style: Toast.Style.Failure,
                title: '批量解锁未完全成功',
                message: res.error || '部分进程需要管理员权限或已变更'
            });
            if (!stale)
                await runInspection(targetPath);
            return;
        }
        await showToast({
            style: Toast.Style.Success,
            title: res.trashed ? '已全部解锁并移入回收站' : `已解除 ${res.unlockedCount} 个进程占用`,
            message: res.skippedProtectedCount > 0 ? `已跳过 ${res.skippedProtectedCount} 个系统关键保护进程` : extractBaseName(targetPath)
        });
        if (stale)
            return;
        if (res.trashed)
            setProcesses([]);
        else
            await runInspection(targetPath);
    };
    const summaryText = useMemo(() => {
        if (!targetPath) {
            return '尚未选择目标 · 可选择文件/文件夹、拖入路径，或粘贴完整路径';
        }
        if (lastError) {
            return `目标: ${extractBaseName(targetPath)} | 检测异常: ${lastError} · 清空列表 Ctrl+Shift+Backspace`;
        }
        if (processes.length === 0) {
            return `目标: ${extractBaseName(targetPath)} | 未发现句柄占用 · 清空列表 Ctrl+Shift+Backspace`;
        }
        return `目标: ${extractBaseName(targetPath)} | 发现 ${processes.length} 个占用进程（可结束 ${killableCount} 个） · 清空列表 Ctrl+Shift+Backspace`;
    }, [targetPath, lastError, processes.length, killableCount]);
    const commonTargetActions = (React.createElement(React.Fragment, null,
        React.createElement(Action, { title: "\u9009\u62E9\u6587\u4EF6\u68C0\u6D4B\u2026", icon: Icon.Document, shortcut: { modifiers: ['ctrl'], key: 'o' }, onAction: () => { void handlePickTarget(false); } }),
        React.createElement(Action, { title: "\u9009\u62E9\u6587\u4EF6\u5939\u68C0\u6D4B\u2026", icon: Icon.Folder, shortcut: { modifiers: ['ctrl', 'shift'], key: 'o' }, onAction: () => { void handlePickTarget(true); } }),
        React.createElement(Action, { title: "\u68C0\u6D4B\u526A\u8D34\u677F\u4E2D\u7684\u8DEF\u5F84", icon: Icon.Clipboard, onAction: () => { void handleDetectClipboard(); } }),
        React.createElement(Action, { title: "\u6E05\u7A7A\u5217\u8868", icon: Icon.Trash, style: Action.Style.Destructive, shortcut: { modifiers: ['ctrl', 'shift'], key: 'backspace' }, onAction: () => { void handleClearList(); } })));
    return (React.createElement(List, { ...fileInputProps, navigationTitle: "\u6587\u4EF6\u89E3\u9501", isLoading: isLoading, isShowingDetail: false, searchBarPlaceholder: "\u7C98\u8D34\u6216\u62D6\u5165\u88AB\u5360\u7528\u7684\u6587\u4EF6/\u6587\u4EF6\u5939/\u76D8\u7B26\u8DEF\u5F84\uFF0C\u6216\u641C\u7D22\u8FDB\u7A0B\u540D...", onSearchTextChange: handleSearchChange, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6309\u8FDB\u7A0B\u7C7B\u578B\u7B5B\u9009", value: processFilter, onChange: (val) => setProcessFilter(val) },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u5360\u7528\u8FDB\u7A0B", value: "all" }),
            React.createElement(List.Dropdown.Item, { title: "\u53EF\u5B89\u5168\u7ED3\u675F", value: "killable" }),
            React.createElement(List.Dropdown.Item, { title: "\u7CFB\u7EDF\u4FDD\u62A4\u8FDB\u7A0B", value: "protected" })), filterBar: {
            summaryText,
            actions: [
                {
                    id: 'unlock-all',
                    title: '一键全部解锁',
                    style: 'primary',
                    onAction: () => { void handleUnlockAll(false); }
                },
                {
                    id: 'unlock-and-trash',
                    title: '解锁并移入回收站',
                    style: 'destructive',
                    onAction: () => { void handleUnlockAll(true); }
                }
            ]
        }, actions: React.createElement(ActionPanel, null, commonTargetActions) },
        removableDrives.length > 0 && (React.createElement(List.Section, { title: "\u5916\u63A5\u79FB\u52A8\u78C1\u76D8\u5FEB\u6377\u68C0\u6D4B", subtitle: `${removableDrives.length} 个设备` }, removableDrives.map(drive => (React.createElement(List.Item, { key: `drive-${drive.mount}`, id: `drive-${drive.mount}`, icon: Icon.HardDrive, title: `${drive.label} (${drive.mount})`, subtitle: `可用 ${drive.freeText} / 总计 ${drive.totalText}`, accessories: [{ text: targetPath === drive.mount ? '当前检测目标' : '检测谁占用了此磁盘' }], actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u68C0\u6D4B\u6B64\u79FB\u52A8\u78C1\u76D8\u7684\u5360\u7528\u8FDB\u7A0B", icon: Icon.MagnifyingGlass, onAction: () => {
                        setTargetPath(drive.mount);
                        void runInspection(drive.mount);
                    } }),
                React.createElement(Action, { title: "\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u6253\u5F00\u6B64\u78C1\u76D8", icon: Icon.Folder, onAction: () => { void openUnlockedTarget(drive.mount, props?.hostOverride); } }),
                commonTargetActions) }))))),
        filteredProcesses.length === 0 ? (React.createElement(List.Section, { title: "\u68C0\u6D4B\u7ED3\u679C" },
            React.createElement(List.Item, { id: "empty-status", icon: lastError ? Icon.ExclamationMark : Icon.CheckCircle, title: !targetPath ? '请选择或粘贴被锁定的文件、文件夹或盘符路径' : lastError ? '目标路径无法完成占用检测' : '当前路径未被任何进程占用', subtitle: !targetPath
                    ? '按 Ctrl+O 选择文件、Ctrl+Shift+O 选择文件夹，或在顶部搜索框粘贴完整路径'
                    : lastError || '您可以直接删除、重命名该文件，或安全弹出外接移动磁盘', actions: React.createElement(ActionPanel, null,
                    targetPath && (React.createElement(Action, { title: "\u91CD\u65B0\u626B\u63CF\u5360\u7528\u72B6\u6001", icon: Icon.ArrowClockwise, shortcut: { modifiers: ['ctrl'], key: 'r' }, onAction: () => { void runInspection(targetPath); } })),
                    targetPath && (React.createElement(Action, { title: "\u5B9A\u4F4D\u88AB\u68C0\u6D4B\u6587\u4EF6\u6240\u5728\u76EE\u5F55", icon: Icon.Folder, onAction: () => { void revealLockedTargetInFolder(targetPath, props?.hostOverride); } })),
                    commonTargetActions) }))) : (React.createElement(List.Section, { title: "\u5360\u7528\u8FDB\u7A0B\u5217\u8868", subtitle: `${filteredProcesses.length} 个进程` }, filteredProcesses.map(proc => (React.createElement(List.Item, { key: proc.id, id: proc.id, icon: proc.isProtected ? Icon.Shield : Icon.Terminal, title: proc.name, subtitle: `PID ${proc.pid} · ${proc.executablePath}`, accessories: proc.isProtected
                ? [{ tag: { value: '系统保护', color: Color.Red } }]
                : [{ text: proc.serviceTypeLabel }], actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u7ED3\u675F\u5360\u7528\u8FDB\u7A0B\uFF08\u89E3\u9501\uFF09", icon: Icon.LockUnlocked, onAction: () => { void handleUnlockSingle(proc, false); } }),
                React.createElement(Action, { title: "\u7ED3\u675F\u8FDB\u7A0B\u5E76\u5220\u9664\u76EE\u6807\u6587\u4EF6", icon: Icon.Trash, style: Action.Style.Destructive, onAction: () => { void handleUnlockSingle(proc, true); } }),
                React.createElement(Action, { title: "\u5B9A\u4F4D\u8FDB\u7A0B\u7A0B\u5E8F\u6240\u5728\u76EE\u5F55", icon: Icon.Folder, onAction: () => { void revealProcessExecutableInFolder(proc.executablePath, props?.hostOverride); } }),
                React.createElement(Action, { title: "\u5B9A\u4F4D\u88AB\u9501\u6587\u4EF6\u6240\u5728\u76EE\u5F55", icon: Icon.Folder, onAction: () => { void revealLockedTargetInFolder(targetPath || proc.lockedPath, props?.hostOverride); } }),
                React.createElement(Action, { title: "\u590D\u5236\u5360\u7528\u8FDB\u7A0B\u4FE1\u606F", icon: Icon.Clipboard, shortcut: { modifiers: ['ctrl'], key: 'c' }, onAction: async () => {
                        const text = `${proc.name} (PID ${proc.pid}) - ${proc.executablePath} -> ${proc.lockedPath}`;
                        await copyProcessInfoToClipboard(text, props?.hostOverride);
                        await showToast({ style: Toast.Style.Success, title: '已复制占用进程信息' });
                    } }),
                React.createElement(Action, { title: "\u91CD\u65B0\u626B\u63CF\u5360\u7528\u72B6\u6001", icon: Icon.ArrowClockwise, shortcut: { modifiers: ['ctrl'], key: 'r' }, onAction: () => { void runInspection(targetPath); } }),
                React.createElement(ActionPanel.Section, { title: "\u76EE\u6807" }, commonTargetActions)) })))))));
}
