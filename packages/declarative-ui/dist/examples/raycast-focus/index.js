/**
 * Raycast Focus (极客心流专注时钟与分心应用/站点屏蔽工作台)
 *
 * 深度对齐 Raycast 官方 `raycast-focus` 套件：
 * - 支持开启专注会话 (Start Focus Session)、暂停/恢复、完成结算与中途取消
 * - 支持专注分类管理 (Deep Coding / Writing / Design / Reading) 与屏蔽应用/域名规则配置
 * - 对接主进程 `focus_start`, `focus_toggle`, `focus_pause`, `focus_resume`, `focus_complete`,
 *   `focus_cancel`, `focus_get_current`, `focus_list_categories`, `focus_create_category`, `focus_get_stats` IPC
 */
import React from "../../index.js";
import { List, Form, ActionPanel, Action, Icon, LocalStorage, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useEffect, useMemo } from "../../runtime/hooks.js";
import { callHostTransport, isRealElectronHost } from "../shared/native-ipc.js";
export const DEFAULT_FOCUS_CATEGORIES = Object.freeze([
    {
        id: "cat-deep-coding",
        name: "深度编码 (Deep Coding)",
        icon: "💻",
        defaultDurationMinutes: 50,
        blockedApps: ["WeChat", "Telegram", "Discord", "Music"],
        blockedSites: ["weibo.com", "bilibili.com", "twitter.com", "reddit.com"]
    },
    {
        id: "cat-architecture",
        name: "架构设计与文档 (Architecture & RFC)",
        icon: "📐",
        defaultDurationMinutes: 45,
        blockedApps: ["Slack", "WeChat", "Mail"],
        blockedSites: ["youtube.com", "bilibili.com", "news.ycombinator.com"]
    },
    {
        id: "cat-pomodoro",
        name: "标准番茄钟 (25m Pomodoro)",
        icon: "🍅",
        defaultDurationMinutes: 25,
        blockedApps: ["WeChat", "Discord"],
        blockedSites: ["bilibili.com", "zhihu.com", "tiktok.com"]
    },
    {
        id: "cat-bug-hunt",
        name: "极限排障冲刺 (Bug Triage Sprint)",
        icon: "🔥",
        defaultDurationMinutes: 90,
        blockedApps: ["WeChat", "Feishu", "DingTalk", "Steam"],
        blockedSites: ["weibo.com", "bilibili.com", "v2ex.com"]
    }
]);
const DEFAULT_FOCUS_STATS = {
    completedSessions: 0,
    totalFocusedMinutes: 0,
    currentStreakDays: 0,
    blockedDistractionsCount: 0
};
let memoryCurrentSession = null;
let memoryCategories = [...DEFAULT_FOCUS_CATEGORIES];
let memoryStats = { ...DEFAULT_FOCUS_STATS };
function normalizeHostFocusSession(value) {
    if (!value || typeof value !== "object")
        return null;
    const wrapped = value;
    const raw = "session" in wrapped ? wrapped.session : wrapped;
    if (!raw || typeof raw !== "object")
        return null;
    const session = raw;
    // 宿主在完成/取消后仍保留最后一次会话（status 为 completed / cancelled），对插件来说就是当前没有专注
    if (!session.id || session.status !== "running" && session.status !== "paused" && session.status !== "active")
        return null;
    const durationMinutes = Number(session.durationMinutes ?? Number(session.totalDurationMs ?? 0) / 60000);
    const categoryId = String(session.categoryId ?? "");
    // 宿主不保存屏蔽清单，按分类从插件自己的存储补回
    const category = memoryCategories.find((c) => c.id === categoryId);
    return {
        id: String(session.id), goal: String(session.title ?? session.goal ?? "专注"),
        categoryId, categoryName: String(session.categoryName ?? ""),
        durationMinutes, remainingSeconds: Number(session.remainingSeconds ?? Number(session.remainingMs ?? 0) / 1000),
        status: session.status === "paused" ? "paused" : "active",
        startedAt: Number(session.startedAt ?? 0),
        blockedApps: [...(category?.blockedApps ?? [])], blockedSites: [...(category?.blockedSites ?? [])]
    };
}
/** 屏蔽清单按分类单独存一个键：分类 ID 唯一，直接覆盖写，不存在并发读改写 */
const BLOCKLIST_KEY_PREFIX = "ztools.raycast-focus.blocklist.";
async function loadBlocklist(categoryId) {
    const stored = await LocalStorage.getItem(BLOCKLIST_KEY_PREFIX + categoryId);
    if (!stored || typeof stored !== "object")
        return null;
    return {
        blockedApps: Array.isArray(stored.blockedApps) ? stored.blockedApps.map(String) : [],
        blockedSites: Array.isArray(stored.blockedSites) ? stored.blockedSites.map(String) : []
    };
}
export async function getFocusCurrentSession(hostOverride) {
    if (hostOverride || isRealElectronHost()) {
        const res = await callHostTransport("focus_get_current", {}, hostOverride);
        if (!res.ok)
            throw new Error(res.error || "无法获取专注状态");
        let session = normalizeHostFocusSession(res.data);
        if (session && session.categoryId && session.blockedApps.length === 0 && session.blockedSites.length === 0) {
            const stored = await loadBlocklist(session.categoryId).catch(() => null);
            if (stored) {
                session = { ...session, blockedApps: [...stored.blockedApps], blockedSites: [...stored.blockedSites] };
            }
        }
        memoryCurrentSession = session;
    }
    return memoryCurrentSession ? { ...memoryCurrentSession } : null;
}
const FOCUS_ICON_MAP = {
    briefcase: "💼",
    code: "💻",
    book: "📖",
    "academic-cap": "🎓",
    target: "🎯",
    flame: "🔥",
    clock: "⏱️"
};
function normalizeFocusIcon(rawIcon) {
    const str = String(rawIcon || "").trim();
    if (!str)
        return "🎯";
    return FOCUS_ICON_MAP[str.toLowerCase()] || str;
}
export async function listFocusCategories(hostOverride) {
    if (hostOverride || isRealElectronHost()) {
        const res = await callHostTransport("focus_list_categories", {}, hostOverride);
        const list = Array.isArray(res.data)
            ? res.data
            : Array.isArray(res.data?.categories)
                ? res.data.categories
                : null;
        if (res.ok && list && list.length > 0) {
            memoryCategories = await Promise.all(list.map(async (c, idx) => {
                const id = String(c.id || `cat-${idx}`);
                // 屏蔽清单读不出来时不影响分类本身显示
                const stored = await loadBlocklist(id).catch(() => null);
                return {
                    id,
                    name: String(c.name || "Focus Category"),
                    icon: normalizeFocusIcon(c.icon),
                    defaultDurationMinutes: Number(c.defaultDurationMinutes || c.durationMinutes || 25),
                    blockedApps: stored?.blockedApps ?? (Array.isArray(c.blockedApps) ? c.blockedApps.map(String) : []),
                    blockedSites: stored?.blockedSites ?? (Array.isArray(c.blockedSites) ? c.blockedSites.map(String) : [])
                };
            }));
            return [...memoryCategories];
        }
        if (!res.ok)
            throw new Error(res.error || "无法读取专注分类");
        return [];
    }
    return [...memoryCategories];
}
export async function getFocusStats(hostOverride) {
    if (hostOverride || isRealElectronHost()) {
        const res = await callHostTransport("focus_get_stats", {}, hostOverride);
        if (res.ok && res.data) {
            const d = res.data;
            return {
                completedSessions: Number(d.totalCompletedSessions ?? d.completedSessions ?? d.totalSessions ?? 0),
                totalFocusedMinutes: Number(d.totalFocusedMinutes ?? d.totalMinutes ?? 0),
                currentStreakDays: Number(d.currentStreakDays ?? d.streakDays ?? 0),
                blockedDistractionsCount: Number(d.blockedDistractionsCount ?? 0)
            };
        }
        throw new Error(res.error || "无法获取专注统计");
    }
    return { ...memoryStats };
}
export async function startFocusSession(params, hostOverride) {
    const duration = Math.max(1, Math.min(480, Math.floor(Number(params.durationMinutes || 25))));
    const goal = (params.goal || "").trim() || "深度心流专注";
    const cat = memoryCategories.find((c) => c.id === params.categoryId) || memoryCategories[0];
    if (hostOverride || isRealElectronHost()) {
        const res = await callHostTransport("focus_start", {
            title: goal, categoryId: params.categoryId, durationMinutes: duration
        }, hostOverride);
        if (!res.ok)
            throw new Error(res.error || "无法启动专注会话");
        const session = normalizeHostFocusSession(res.data);
        if (!session)
            throw new Error("专注服务未返回有效会话");
        memoryCurrentSession = session;
        return { ...session };
    }
    memoryCurrentSession = {
        id: `focus-${Date.now()}`,
        goal,
        categoryId: cat.id,
        categoryName: cat.name,
        durationMinutes: duration,
        remainingSeconds: duration * 60,
        status: "active",
        startedAt: Date.now(),
        blockedApps: [...cat.blockedApps],
        blockedSites: [...cat.blockedSites]
    };
    return { ...memoryCurrentSession };
}
export async function controlFocusSession(action, hostOverride) {
    const methodMap = {
        toggle: "focus_toggle",
        pause: "focus_pause",
        resume: "focus_resume",
        complete: "focus_complete",
        cancel: "focus_cancel"
    };
    if (hostOverride || isRealElectronHost()) {
        const res = await callHostTransport(methodMap[action], {}, hostOverride);
        if (!res.ok)
            return { ok: false, session: memoryCurrentSession, message: res.error || "专注操作失败" };
        memoryCurrentSession = normalizeHostFocusSession(res.data);
        const message = action === "complete" ? "本次专注已完成" : action === "cancel" ? "已取消本次专注" : "专注状态已更新";
        return { ok: true, session: memoryCurrentSession, message };
    }
    if (action === "pause" && memoryCurrentSession) {
        memoryCurrentSession = { ...memoryCurrentSession, status: "paused" };
        return { ok: true, session: { ...memoryCurrentSession }, message: "专注时钟已暂停" };
    }
    if (action === "resume" && memoryCurrentSession) {
        memoryCurrentSession = { ...memoryCurrentSession, status: "active" };
        return { ok: true, session: { ...memoryCurrentSession }, message: "专注时钟已继续" };
    }
    if (action === "toggle") {
        if (!memoryCurrentSession) {
            const started = await startFocusSession({ goal: "快速番茄钟专注", durationMinutes: 25 });
            return { ok: true, session: started, message: "已开启 25 分钟快速专注" };
        }
        const nextStatus = memoryCurrentSession.status === "paused" ? "active" : "paused";
        memoryCurrentSession = { ...memoryCurrentSession, status: nextStatus };
        return {
            ok: true,
            session: { ...memoryCurrentSession },
            message: nextStatus === "active" ? "专注已恢复" : "专注已暂停"
        };
    }
    if (action === "complete") {
        if (memoryCurrentSession) {
            memoryStats = {
                ...memoryStats,
                completedSessions: memoryStats.completedSessions + 1,
                totalFocusedMinutes: memoryStats.totalFocusedMinutes + memoryCurrentSession.durationMinutes
            };
        }
        memoryCurrentSession = null;
        return { ok: true, session: null, message: "🎉 恭喜完成本次心流专注会话！" };
    }
    memoryCurrentSession = null;
    return { ok: true, session: null, message: "已结束当前专注会话" };
}
export async function createFocusCategory(input, hostOverride) {
    const cleanName = (input.name || "").trim();
    if (!cleanName) {
        throw new Error("CATEGORY_NAME_REQUIRED: 专注分类名称不能为空");
    }
    const duration = Math.max(5, Math.min(240, Number(input.defaultDurationMinutes || 25)));
    const category = {
        id: `cat-${Date.now()}`,
        name: cleanName,
        icon: "🚀",
        defaultDurationMinutes: duration,
        blockedApps: input.blockedApps || ["WeChat"],
        blockedSites: input.blockedSites || ["weibo.com", "bilibili.com"]
    };
    if (hostOverride || isRealElectronHost()) {
        const res = await callHostTransport("focus_create_category", { name: cleanName, defaultDurationMinutes: duration }, hostOverride);
        if (!res.ok || !res.data?.id)
            throw new Error(res.error || "专注分类未能保存");
        const saved = { ...category, id: String(res.data.id) };
        try {
            await LocalStorage.setItem(BLOCKLIST_KEY_PREFIX + saved.id, {
                blockedApps: [...saved.blockedApps],
                blockedSites: [...saved.blockedSites]
            });
        }
        catch (err) {
            throw new Error(`分类已创建，但屏蔽清单未能保存：${err instanceof Error ? err.message : String(err)}`);
        }
        memoryCategories = [saved, ...memoryCategories];
        return saved;
    }
    memoryCategories = [category, ...memoryCategories];
    return category;
}
export function formatRemainingTime(remainingSeconds) {
    const safe = Math.max(0, Math.floor(Number(remainingSeconds || 0)));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
export const getFocusStatus = getFocusCurrentSession;
export const pauseFocusSession = (hostOverride) => controlFocusSession("pause", hostOverride);
export const resumeFocusSession = (hostOverride) => controlFocusSession("resume", hostOverride);
export const completeFocusSession = (hostOverride) => controlFocusSession("complete", hostOverride);
export function CreateFocusCategoryForm({ onCreated }) {
    const [name, setName] = useState("");
    const [durationStr, setDurationStr] = useState("45");
    const [appsStr, setAppsStr] = useState("WeChat, Discord, Music");
    const [sitesStr, setSitesStr] = useState("weibo.com, bilibili.com, twitter.com");
    const { pop } = useNavigation();
    const handleSubmit = async (values) => {
        try {
            const rawName = values?.name ?? name;
            const rawDur = values?.duration ?? durationStr;
            const rawApps = values?.apps ?? appsStr;
            const rawSites = values?.sites ?? sitesStr;
            const created = await createFocusCategory({
                name: rawName,
                defaultDurationMinutes: Number(rawDur) || 45,
                blockedApps: String(rawApps)
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                blockedSites: String(rawSites)
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
            });
            onCreated?.(created);
            await showToast(Toast.Style.Success, `已创建专注分类: ${created.name}`);
            pop();
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "创建失败", err?.message || String(err));
        }
    };
    return (React.createElement(Form, { navigationTitle: "\u65B0\u5EFA\u4E13\u6CE8\u5C4F\u853D\u5206\u7C7B (Create Focus Category)", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u4E13\u6CE8\u5206\u7C7B", icon: Icon.Check, onSubmit: handleSubmit }),
            React.createElement(Action, { title: "\u4FDD\u5B58\u4E13\u6CE8\u5206\u7C7B", icon: Icon.Check, onAction: () => handleSubmit() })) },
        React.createElement(Form.TextField, { id: "name", title: "\u5206\u7C7B\u540D\u79F0", placeholder: "\u4F8B\u5982: \u6DF1\u5EA6\u8BBA\u6587\u9605\u8BFB / \u6838\u5FC3\u4EE3\u7801\u91CD\u6784", value: name, onChange: setName }),
        React.createElement(Form.TextField, { id: "duration", title: "\u9ED8\u8BA4\u65F6\u957F (\u5206\u949F)", placeholder: "45", value: durationStr, onChange: setDurationStr }),
        React.createElement(Form.TextField, { id: "apps", title: "\u5C4F\u853D\u5E72\u6270\u5E94\u7528 (\u9017\u53F7\u5206\u9694)", placeholder: "WeChat, Slack, Discord", value: appsStr, onChange: setAppsStr }),
        React.createElement(Form.TextField, { id: "sites", title: "\u5C4F\u853D\u5E72\u6270\u7F51\u7AD9 (\u9017\u53F7\u5206\u9694)", placeholder: "bilibili.com, weibo.com, youtube.com", value: sitesStr, onChange: setSitesStr })));
}
export function RaycastFocusCommand() {
    const realHost = isRealElectronHost();
    const [session, setSession] = useState(null);
    const [categories, setCategories] = useState(() => realHost ? [] : [...DEFAULT_FOCUS_CATEGORIES]);
    const [stats, setStats] = useState({ ...DEFAULT_FOCUS_STATS });
    const [searchText, setSearchText] = useState("");
    const [durationPreset, setDurationPreset] = useState("all");
    const [selectedId, setSelectedId] = useState(null);
    const { push } = useNavigation();
    useEffect(() => {
        let active = true;
        // 先读分类：会话的屏蔽清单按分类补全
        listFocusCategories().then((cats) => Promise.all([getFocusCurrentSession(), getFocusStats()]).then(([cur, st]) => [cur, cats, st])).then(([cur, cats, st]) => {
            if (!active)
                return;
            setSession(cur);
            setCategories(cats);
            setStats(st);
        }).catch((error) => {
            if (active)
                void showToast(Toast.Style.Failure, "读取专注状态失败", error instanceof Error ? error.message : String(error));
        });
        return () => {
            active = false;
        };
    }, []);
    // 当存在活动专注会话时，启动真实的 1000ms setInterval 倒计时刷新与主进程同步
    const isSessionRunning = Boolean(session && (session.status === "active" || session.status === "running"));
    useEffect(() => {
        if (!isSessionRunning)
            return;
        let tickCount = 0;
        const timer = setInterval(() => {
            tickCount += 1;
            setSession((prev) => {
                if (!prev || (prev.status !== "active" && prev.status !== "running")) {
                    return prev;
                }
                const nextRem = Math.max(0, prev.remainingSeconds - 1);
                if (memoryCurrentSession && memoryCurrentSession.id === prev.id) {
                    memoryCurrentSession = { ...memoryCurrentSession, remainingSeconds: nextRem };
                }
                return {
                    ...prev,
                    remainingSeconds: nextRem
                };
            });
            if (tickCount % 10 === 0 && isRealElectronHost()) {
                getFocusCurrentSession().then((remote) => {
                    setSession(remote);
                }).catch((error) => {
                    void showToast(Toast.Style.Failure, "同步专注状态失败", error instanceof Error ? error.message : String(error));
                });
            }
        }, 1000);
        return () => {
            clearInterval(timer);
        };
    }, [isSessionRunning]);
    const filteredCategories = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        return categories.filter((c) => {
            if (durationPreset === "short" && c.defaultDurationMinutes > 30)
                return false;
            if (durationPreset === "long" && c.defaultDurationMinutes <= 30)
                return false;
            if (!q)
                return true;
            return (c.name.toLowerCase().includes(q) ||
                c.blockedApps.join(" ").toLowerCase().includes(q) ||
                c.blockedSites.join(" ").toLowerCase().includes(q));
        });
    }, [categories, searchText, durationPreset]);
    const handleStartCategory = async (cat) => {
        const goal = searchText.trim() || cat.name;
        const started = await startFocusSession({
            goal,
            categoryId: cat.id,
            durationMinutes: cat.defaultDurationMinutes
        });
        setSession(started);
        await showToast(Toast.Style.Success, `🎯 已开启专注: ${started.goal}`, `${started.durationMinutes} 分钟`);
    };
    const handleControl = async (action) => {
        const res = await controlFocusSession(action);
        if (!res.ok) {
            await showToast(Toast.Style.Failure, res.message);
            return;
        }
        setSession(res.session);
        const latestStats = await getFocusStats();
        setStats(latestStats);
        await showToast(Toast.Style.Success, res.message);
    };
    const renderSessionProgressBar = (s) => {
        const totalSecs = Math.max(1, s.durationMinutes * 60);
        const elapsedSecs = Math.max(0, totalSecs - s.remainingSeconds);
        const ratio = Math.min(1, Math.max(0, elapsedSecs / totalSecs));
        const filled = Math.round(ratio * 20);
        const bar = "█".repeat(filled) + "░".repeat(20 - filled);
        const pct = Math.round(ratio * 100);
        return `[${bar}] ${pct}% (剩余 ${formatRemainingTime(s.remainingSeconds)})`;
    };
    const activeCategory = useMemo(() => filteredCategories.find((c) => c.id === selectedId) || filteredCategories[0] || null, [filteredCategories, selectedId]);
    return (React.createElement(List, { isShowingDetail: true, searchBarPlaceholder: "\u8F93\u5165\u4ECA\u65E5\u4E13\u6CE8\u76EE\u6807\u6216\u641C\u7D22\u4E13\u6CE8\u6A21\u5F0F (\u5982 Deep Coding, 25m Pomodoro)...", onSearchTextChange: setSearchText, onSelectionChange: setSelectedId, filterBar: {
            summaryText: session
                ? `🎯 正在专注: ${session.goal} (${session.status === "paused" ? "已暂停" : `剩余 ${formatRemainingTime(session.remainingSeconds)}`}) | 累计完成 ${stats.completedSessions} 次 (${stats.totalFocusedMinutes} 分钟)`
                : `🧘 当前空闲 • 累计完成 ${stats.completedSessions} 次专注 (${stats.totalFocusedMinutes} 分钟) | 连续打卡 ${stats.currentStreakDays} 天`,
            groups: [
                {
                    id: "duration-preset",
                    value: durationPreset,
                    onChange: setDurationPreset,
                    options: [
                        { title: "全部场景", value: "all", count: categories.length },
                        {
                            title: "短冲刺 (≤30m)",
                            value: "short",
                            count: categories.filter((c) => c.defaultDurationMinutes <= 30).length
                        },
                        {
                            title: "深度心流 (>30m)",
                            value: "long",
                            count: categories.filter((c) => c.defaultDurationMinutes > 30).length
                        }
                    ]
                }
            ],
            actions: session
                ? [
                    {
                        id: "toggle-focus-session",
                        label: session.status === "paused" ? "▶️ 继续专注" : "⏸️ 暂停/继续专注",
                        title: session.status === "paused" ? "▶️ 继续专注" : "⏸️ 暂停/继续专注",
                        style: "primary",
                        onAction: () => handleControl("toggle")
                    },
                    {
                        id: "complete-focus-session",
                        label: "✅ 完成并结算专注",
                        title: "✅ 完成并结算专注",
                        style: "primary",
                        onAction: () => handleControl("complete")
                    },
                    {
                        id: "cancel-focus-session",
                        label: "✖️ 取消本次专注",
                        title: "✖️ 取消本次专注",
                        style: "danger",
                        onAction: () => handleControl("cancel")
                    },
                    {
                        id: "create-focus-category",
                        label: "➕ 新建专注屏蔽分类",
                        title: "➕ 新建专注屏蔽分类",
                        style: "secondary",
                        onAction: () => {
                            push(React.createElement(CreateFocusCategoryForm, { onCreated: (created) => setCategories((prev) => [created, ...prev]) }));
                        }
                    }
                ]
                : [
                    {
                        id: "start-focus-now",
                        label: "🎯 立即开始专注",
                        title: "🎯 立即开始专注",
                        style: "primary",
                        onAction: async () => {
                            if (activeCategory) {
                                await handleStartCategory(activeCategory);
                            }
                        }
                    },
                    {
                        id: "quick-pomodoro-25",
                        label: "🍅 25分钟番茄钟",
                        title: "🍅 25分钟番茄钟",
                        style: "secondary",
                        onAction: async () => {
                            const cat = activeCategory || categories[0];
                            if (!cat)
                                return;
                            const started = await startFocusSession({
                                goal: searchText.trim() || "25m 极速番茄钟",
                                categoryId: cat.id,
                                durationMinutes: 25
                            });
                            setSession(started);
                            await showToast(Toast.Style.Success, `🍅 已开启 25 分钟番茄钟: ${started.goal}`);
                        }
                    },
                    {
                        id: "create-focus-category",
                        label: "➕ 新建专注屏蔽分类",
                        title: "➕ 新建专注屏蔽分类",
                        style: "secondary",
                        onAction: () => {
                            push(React.createElement(CreateFocusCategoryForm, { onCreated: (created) => setCategories((prev) => [created, ...prev]) }));
                        }
                    }
                ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6309\u4E13\u6CE8\u65F6\u957F\u7B5B\u9009", value: durationPreset, onChange: setDurationPreset },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u4E13\u6CE8\u573A\u666F (All)", value: "all", icon: Icon.Clock }),
            React.createElement(List.Dropdown.Item, { title: "\u77ED\u51B2\u523A (\u2264 30 \u5206\u949F)", value: "short", icon: Icon.Bolt }),
            React.createElement(List.Dropdown.Item, { title: "\u6DF1\u5EA6\u5FC3\u6D41 (> 30 \u5206\u949F)", value: "long", icon: Icon.Shield })), actions: React.createElement(ActionPanel, { title: "\u4E13\u6CE8\u7BA1\u7406" },
            React.createElement(Action.Push, { title: "\u65B0\u5EFA\u4E13\u6CE8\u5C4F\u853D\u5206\u7C7B (Create Focus Category)", icon: Icon.Plus, target: React.createElement(CreateFocusCategoryForm, { onCreated: (created) => setCategories((prev) => [created, ...prev]) }) })) },
        session && (React.createElement(List.Section, { title: "\u6B63\u5728\u8FDB\u884C\u7684\u4E13\u6CE8\u4F1A\u8BDD (Active Focus Session)" },
            React.createElement(List.Item, { key: "active-focus-session", id: "active-focus-session", title: `🎯 ${session.goal} (${session.categoryName})`, subtitle: `状态: ${session.status === "active" ? "专注计时中" : "已暂停"} • 剩余 ${formatRemainingTime(session.remainingSeconds)} / ${session.durationMinutes}:00`, icon: session.status === "active" ? Icon.Clock : Icon.Pause, accessories: [
                    {
                        text: `${formatRemainingTime(session.remainingSeconds)} left`,
                        icon: Icon.Bolt
                    }
                ], detail: React.createElement(List.Item.Detail, { markdown: [
                        `# 🎯 ${session.goal}`,
                        `> **当前状态**: \`${session.status.toUpperCase()}\` &nbsp;|&nbsp; **分类**: \`${session.categoryName}\``,
                        `---`,
                        `### ⏱️ 实时倒计时进度 (1s 刷新)`,
                        `\`\`\`text\n${renderSessionProgressBar(session)}\n\`\`\``,
                        `---`,
                        `### 🛡️ 正在生效的防分心屏蔽列表`,
                        `- **已拦截应用**: ${session.blockedApps.map((a) => `\`${a}\``).join(" • ") || "无"}`,
                        `- **已拦截网站**: ${session.blockedSites.map((s) => `\`${s}\``).join(" • ") || "无"}`
                    ].join("\n\n") }), actions: React.createElement(ActionPanel, { title: "\u5F53\u524D\u4E13\u6CE8\u63A7\u5236" },
                    session.status === "active" ? (React.createElement(Action, { title: "\u6682\u505C\u4E13\u6CE8 (Pause Focus)", icon: Icon.Pause, onAction: () => handleControl("pause") })) : (React.createElement(Action, { title: "\u7EE7\u7EED\u4E13\u6CE8 (Resume Focus)", icon: Icon.Play, onAction: () => handleControl("resume") })),
                    React.createElement(Action, { title: "\u5B8C\u6210\u5E76\u7ED3\u7B97\u4E13\u6CE8 (Complete Focus)", icon: Icon.CheckCircle, onAction: () => handleControl("complete") }),
                    React.createElement(Action.Push, { title: "\u65B0\u5EFA\u4E13\u6CE8\u5C4F\u853D\u5206\u7C7B (Create Focus Category)", icon: Icon.Plus, shortcut: { modifiers: ["ctrl"], key: "n" }, target: React.createElement(CreateFocusCategoryForm, { onCreated: (created) => setCategories((prev) => [created, ...prev]) }) }),
                    React.createElement(Action, { title: "\u53D6\u6D88\u672C\u6B21\u4E13\u6CE8 (Cancel Focus)", icon: Icon.XMarkCircle, style: Action.Style.Destructive, onAction: () => handleControl("cancel") })) }))),
        React.createElement(List.Section, { title: `启动专注模式 (Focus Categories · ${filteredCategories.length})` }, filteredCategories.map((cat) => (React.createElement(List.Item, { key: cat.id, id: cat.id, title: `${cat.icon} ${cat.name}`, subtitle: `默认 ${cat.defaultDurationMinutes} 分钟 • 屏蔽 ${cat.blockedApps.slice(0, 3).join(", ")}`, icon: Icon.Clock, accessories: [{ text: `${cat.defaultDurationMinutes} min` }], detail: React.createElement(List.Item.Detail, { markdown: [
                    `# ${cat.icon} ${cat.name}`,
                    `**标准时长**: \`${cat.defaultDurationMinutes} 分钟\``,
                    `---`,
                    `### 🚫 屏蔽干扰应用 (Blocked Applications)`,
                    cat.blockedApps.map((a) => `- \`${a}\``).join("\n"),
                    `### 🌐 屏蔽干扰网站 (Blocked Websites)`,
                    cat.blockedSites.map((s) => `- \`${s}\``).join("\n"),
                    `---`,
                    `### 📊 历史心流专注统计`,
                    `- **累计完成专注**: \`${stats.completedSessions} 次\` (\`${stats.totalFocusedMinutes} 分钟\`)`,
                    `- **连续专注天数**: \`${stats.currentStreakDays} 天 🔥\``,
                    `- **已拦截分心次数**: \`${stats.blockedDistractionsCount} 次\``
                ].join("\n\n"), metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6A21\u5F0F\u540D\u79F0", text: cat.name, icon: Icon.Rocket }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8BBE\u5B9A\u65F6\u957F", text: `${cat.defaultDurationMinutes} 分钟`, icon: Icon.Clock }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7D2F\u8BA1\u4E13\u6CE8\u65F6\u957F", text: `${stats.totalFocusedMinutes} 分钟`, icon: Icon.BarChart }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8FDE\u7EED\u6253\u5361", text: `${stats.currentStreakDays} 天`, icon: Icon.Star })) }), actions: React.createElement(ActionPanel, { title: cat.name },
                React.createElement(Action, { title: `开始 ${cat.defaultDurationMinutes} 分钟专注 (Start Focus)`, icon: Icon.Play, onAction: () => handleStartCategory(cat) }),
                React.createElement(Action, { title: "\u5FEB\u901F\u5207\u6362\u4E13\u6CE8\u72B6\u6001 (Toggle Focus)", icon: Icon.Bolt, onAction: () => handleControl("toggle") }),
                React.createElement(Action.Push, { title: "\u65B0\u5EFA\u4E13\u6CE8\u5C4F\u853D\u5206\u7C7B (Create Focus Category)", icon: Icon.Plus, shortcut: { modifiers: ["ctrl"], key: "n" }, target: React.createElement(CreateFocusCategoryForm, { onCreated: (created) => setCategories((prev) => [created, ...prev]) }) })) }))))));
}
export default RaycastFocusCommand;
