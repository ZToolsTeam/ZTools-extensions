import React, { Action, ActionPanel, Color, Form, Icon, List, Toast, showToast, useEffect, useMemo, useRef, useState, useNavigation } from '../../index.js';
import { DEFAULT_COUNTDOWNS, FOCUS_DURATION_MS, PomodoroTimerEngine, enrichAndSortCountdowns, formatRemainingMmSs, validateCountdownInput } from './pomodoro-service.js';
export * from './types.js';
export * from './pomodoro-service.js';
export function CountdownForm({ initialItem, onSave }) {
    const { pop } = useNavigation();
    const [title, setTitle] = useState(initialItem?.title ?? '');
    const [targetDate, setTargetDate] = useState(initialItem?.targetDate ?? '2026-12-31');
    const [category, setCategory] = useState(initialItem?.category ?? 'work');
    const [isRecurring, setIsRecurring] = useState(initialItem?.isRecurring ?? false);
    const handleSubmit = async () => {
        const check = validateCountdownInput({ title, targetDate, category });
        if (!check.valid) {
            await showToast({
                style: Toast.Style.Failure,
                title: check.error || '请填写合法的倒数日信息'
            });
            return;
        }
        onSave({
            id: initialItem?.id || `cd-${Date.now()}`,
            title: title.trim(),
            targetDate: targetDate.trim(),
            category,
            isRecurring,
            createdAt: initialItem?.createdAt || Date.now()
        });
        await showToast({
            style: Toast.Style.Success,
            title: '倒数日已保存'
        });
        pop();
    };
    return (React.createElement(Form, { navigationTitle: initialItem ? '编辑倒数日' : '新建倒数日', actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u5012\u6570\u65E5", onSubmit: handleSubmit })) },
        React.createElement(Form.TextField, { id: "title", title: "\u65E5\u7A0B\u540D\u79F0", placeholder: "\u5982\uFF1A\u7248\u672C\u53D1\u7248\u4E0A\u7EBF / \u6BCF\u6708\u53D1\u85AA\u65E5", value: title, onChange: setTitle }),
        React.createElement(Form.TextField, { id: "targetDate", title: "\u76EE\u6807\u65E5\u671F (YYYY-MM-DD)", placeholder: "2026-10-31", value: targetDate, onChange: setTargetDate }),
        React.createElement(Form.Dropdown, { id: "category", title: "\u65E5\u7A0B\u5206\u7C7B", value: category, onChange: (v) => setCategory(v) },
            React.createElement(Form.Dropdown.Item, { title: "\u5DE5\u4F5C\u4E0E\u9879\u76EE\u53D1\u5E03", value: "work" }),
            React.createElement(Form.Dropdown.Item, { title: "\u53D1\u85AA\u4E0E\u8D22\u52A1\u8FD8\u6B3E", value: "finance" }),
            React.createElement(Form.Dropdown.Item, { title: "\u751F\u6D3B\u4E0E\u7EAA\u5FF5\u65E5", value: "life" })),
        React.createElement(Form.Checkbox, { id: "isRecurring", label: "\u6309\u6708\u56FA\u5B9A\u65E5\u671F\u5FAA\u73AF\u63A8\u7B97\uFF08\u9002\u5408\u6BCF\u6708\u53D1\u85AA\u65E5/\u8D26\u5355\u65E5\uFF09", value: isRecurring, onChange: setIsRecurring })));
}
function getCategoryIcon(category) {
    switch (category) {
        case 'work':
            return Icon.Bolt;
        case 'finance':
            return Icon.Document;
        default:
            return Icon.Pin;
    }
}
const COUNTDOWN_STORAGE_KEY = 'ztools:pomodoro-countdowns-v1';
function loadPersistedCountdowns(fallback) {
    try {
        const g = globalThis;
        const ls = g.localStorage;
        const raw = ls?.getItem?.(COUNTDOWN_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    }
    catch {
        // ignore storage read error
    }
    return fallback;
}
function persistCountdowns(items) {
    try {
        const g = globalThis;
        const ls = g.localStorage;
        ls?.setItem?.(COUNTDOWN_STORAGE_KEY, JSON.stringify(items));
    }
    catch {
        // ignore storage write error
    }
}
async function notifyHostFocus(method, params = {}) {
    try {
        const g = globalThis;
        const win = (typeof window !== 'undefined' ? window : g);
        const electron = win.__ztoolsElectron;
        if (typeof electron?.transport?.methods?.[method] === 'function') {
            await electron.transport.methods[method](params);
        }
        else if (typeof electron?.transport?.invoke === 'function') {
            await electron.transport.invoke(method, params);
        }
    }
    catch {
        // ignore optional host sync error
    }
}
export function PomodoroFocusCommand(props = {}) {
    const { push } = useNavigation();
    const engineRef = useRef(new PomodoroTimerEngine({
        phase: props.featureCode === 'pomodoro-start' ? 'focus' : 'idle',
        startTime: Date.now(),
        durationMs: FOCUS_DURATION_MS,
        completedCycles: 1
    }, (title, body) => {
        void showToast({ style: Toast.Style.Success, title, message: body });
        void notifyHostFocus('system_notify', { title, message: body });
    }));
    const [pomoState, setPomoState] = useState(() => engineRef.current.getState());
    const [remainingMs, setRemainingMs] = useState(() => engineRef.current.getRemainingMs());
    const [countdowns, setCountdowns] = useState(() => props.initialCountdowns ?? loadPersistedCountdowns(DEFAULT_COUNTDOWNS));
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [searchText, setSearchText] = useState('');
    useEffect(() => {
        const timer = setInterval(() => {
            const res = engineRef.current.tick(Date.now());
            setPomoState(res.state);
            setRemainingMs(res.remainingMs);
        }, 1000);
        return () => {
            clearInterval(timer);
        };
    }, []);
    const isRunning = pomoState.phase !== 'idle' && pomoState.pausedRemainingMs === undefined;
    const handleTogglePomodoro = async () => {
        if (pomoState.phase === 'idle') {
            const next = engineRef.current.startFocus(Date.now());
            setPomoState(next);
            setRemainingMs(engineRef.current.getRemainingMs());
            void notifyHostFocus('focus_start', { durationMinutes: 25, title: '25分钟深度专注' });
            await showToast({
                style: Toast.Style.Success,
                title: '已开启 25 分钟极简专注番茄钟'
            });
        }
        else if (pomoState.pausedRemainingMs === undefined) {
            const next = engineRef.current.pause(Date.now());
            setPomoState(next);
            setRemainingMs(engineRef.current.getRemainingMs());
            void notifyHostFocus('focus_pause');
            await showToast({
                style: Toast.Style.Success,
                title: '已暂停当前番茄钟'
            });
        }
        else {
            const next = engineRef.current.resume(Date.now());
            setPomoState(next);
            setRemainingMs(engineRef.current.getRemainingMs());
            void notifyHostFocus('focus_resume');
            await showToast({
                style: Toast.Style.Success,
                title: '已恢复专注计时'
            });
        }
    };
    const handleResetPomodoro = async () => {
        const next = engineRef.current.reset();
        setPomoState(next);
        setRemainingMs(FOCUS_DURATION_MS);
        void notifyHostFocus('focus_cancel');
        await showToast({
            style: Toast.Style.Success,
            title: '番茄钟已重置'
        });
    };
    const enrichedCountdowns = useMemo(() => enrichAndSortCountdowns(countdowns, props.referenceDate ?? new Date()), [countdowns, props.referenceDate]);
    const filteredCountdowns = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        return enrichedCountdowns.filter((item) => {
            if (selectedCategory !== 'all' && item.category !== selectedCategory)
                return false;
            if (!q)
                return true;
            return (item.title.toLowerCase().includes(q) ||
                item.targetDateFormatted.toLowerCase().includes(q));
        });
    }, [enrichedCountdowns, selectedCategory, searchText]);
    const formattedRemaining = formatRemainingMmSs(remainingMs);
    const pomodoroStateText = pomoState.phase === 'focus'
        ? `深度专注中 (${formattedRemaining})`
        : pomoState.phase === 'short_break'
            ? `短休恢复中 (${formattedRemaining})`
            : pomoState.phase === 'long_break'
                ? `长休恢复中 (${formattedRemaining})`
                : `就绪待命 (今日已完成 ${pomoState.completedCycles} 个番茄)`;
    return (React.createElement(List, { navigationTitle: "\u756A\u8304\u5012\u6570", isLoading: false, isShowingDetail: false, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u91CD\u8981\u65E5\u7A0B\u5012\u6570\u65E5\u6216\u542F\u52A8 25 \u5206\u949F\u4E13\u6CE8\u756A\u8304\u949F...", searchBarAccessory: React.createElement(List.Dropdown, { value: selectedCategory, onChange: (val) => setSelectedCategory(val), tooltip: "\u7B5B\u9009\u65E5\u7A0B\u7C7B\u522B" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u65E5\u7A0B\u4E0E\u5012\u6570", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u5DE5\u4F5C\u4E0E\u9879\u76EE\u53D1\u5E03", value: "work", icon: Icon.Bolt }),
            React.createElement(List.Dropdown.Item, { title: "\u53D1\u85AA\u4E0E\u8D22\u52A1\u8FD8\u6B3E", value: "finance", icon: Icon.Document }),
            React.createElement(List.Dropdown.Item, { title: "\u751F\u6D3B\u4E0E\u7EAA\u5FF5\u65E5", value: "life", icon: Icon.Pin })), filterBar: {
            summaryText: `专注状态: ${pomodoroStateText} · 共 ${filteredCountdowns.length} 个倒数日程`,
            actions: [
                {
                    id: 'toggle-pomo',
                    title: isRunning ? '暂停专注' : '开始专注 (25m)',
                    onAction: () => {
                        void handleTogglePomodoro();
                    }
                },
                {
                    id: 'new-countdown',
                    title: '新建倒数日',
                    onAction: () => push(React.createElement(CountdownForm, { onSave: (created) => setCountdowns((prev) => {
                            const next = [created, ...prev];
                            persistCountdowns(next);
                            return next;
                        }) }))
                }
            ]
        } },
        React.createElement(List.Section, { title: "\u5F53\u524D\u756A\u8304\u5DE5\u4F5C\u949F (Micro-Focus)" },
            React.createElement(List.Item, { id: "pomodoro-timer", title: pomoState.phase === 'focus'
                    ? '25 分钟深度专注进行中'
                    : '点击或按回车开启 25 分钟极简番茄专注', subtitle: `基于系统物理时钟防休眠漂移 · 今日已完成 ${pomoState.completedCycles} 轮专注`, icon: isRunning ? Icon.Bolt : Icon.Play, accessories: [
                    { tag: pomoState.phase === 'focus' ? '专注中' : '25:00 标准轮次' },
                    { text: formattedRemaining }
                ], actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: isRunning ? '暂停当前番茄钟' : '立即开始专注 (25分钟)', icon: Icon.Play, onAction: handleTogglePomodoro }),
                    React.createElement(Action, { title: "\u91CD\u7F6E\u756A\u8304\u949F", icon: Icon.ArrowClockwise, shortcut: { modifiers: ['cmd'], key: 'r' }, onAction: handleResetPomodoro })) })),
        React.createElement(List.Section, { title: `重要日程与节点倒数 (${filteredCountdowns.length} 项)` }, filteredCountdowns.map((item) => (React.createElement(List.Item, { key: item.id, id: item.id, title: item.title, subtitle: item.targetDateFormatted, icon: getCategoryIcon(item.category), accessories: [
                item.isRecurring ? { tag: '每月循环' } : {},
                item.daysLeft >= 0 && item.daysLeft <= 3
                    ? { tag: { value: item.daysLeftText, color: Color.Red } }
                    : { text: item.daysLeftText }
            ], actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u7F16\u8F91\u6B64\u5012\u6570\u65E5", icon: Icon.Pencil, onAction: () => push(React.createElement(CountdownForm, { initialItem: item, onSave: (updated) => setCountdowns((prev) => {
                            const next = prev.map((x) => (x.id === updated.id ? updated : x));
                            persistCountdowns(next);
                            return next;
                        }) })) }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5929\u6570\u6458\u8981", content: `${item.title}: ${item.daysLeftText} (${item.targetDateFormatted})` }),
                React.createElement(Action, { title: "\u5220\u9664\u6B64\u5012\u6570\u65E5", icon: Icon.Trash, style: Action.Style.Destructive, onAction: () => setCountdowns((prev) => {
                        const next = prev.filter((x) => x.id !== item.id);
                        persistCountdowns(next);
                        return next;
                    }) })) }))))));
}
export default PomodoroFocusCommand;
