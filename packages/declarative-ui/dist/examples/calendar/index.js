/**
 * Calendar (极客日程表、视频会议直达与 ICS 日历中枢)
 *
 * 深度对齐 Raycast 官方 `calendar` (`My Schedule` & `Create Event`)：
 * - 双栏展示今日与近期日程 (Upcoming Events)、会议室链接 (Zoom / Feishu / Teams / Google Meet) 一键直达
 * - 支持通过 <Form> 快速新建日程 (Create Event)、删除日程与一键导出标准 RFC 5545 `.ics` 日历文件
 * - 对接主进程 `calendar_upcoming_events`, `calendar_list_events`, `calendar_create_event`, `calendar_delete_event`, `calendar_export_ics` IPC
 */
import React from "../../index.js";
import { List, Form, ActionPanel, Action, Icon, Color, Clipboard, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useEffect, useMemo } from "../../runtime/hooks.js";
import { callHostTransport, isRealElectronHost } from "../shared/native-ipc.js";
export const DEFAULT_CALENDAR_EVENTS = Object.freeze([
    {
        id: "evt-arch-sync",
        title: "ZTools 2.0 macOS 双端架构对齐评审会",
        startTime: "10:00",
        endTime: "11:00",
        location: "飞书视频会议 (Feishu Meet)",
        conferenceUrl: "https://vc.feishu.cn/j/882910421",
        calendarName: "Work",
        notes: "评审 32+ 款第一方内置声明式套件与 macOS 原生侧车/TCC 权限降级体验",
        attendees: ["arch@ztools.dev", "macos@ztools.dev", "qa@ztools.dev"]
    },
    {
        id: "evt-code-freeze",
        title: "Declarative UI 2.0 Release Candidate 发版冻结",
        startTime: "14:30",
        endTime: "15:30",
        location: "Zoom Conference Room",
        conferenceUrl: "https://zoom.us/j/918273645",
        calendarName: "Engineering",
        notes: "完成全量 E2E 集成与混沌破坏性测试门禁验收",
        attendees: ["release@ztools.dev"]
    },
    {
        id: "evt-1on1",
        title: "1:1 Developer Experience & Plugin Store Review",
        startTime: "16:30",
        endTime: "17:00",
        location: "Google Meet",
        conferenceUrl: "https://meet.google.com/ztools-dx-sync",
        calendarName: "Work",
        notes: "讨论 ZTools-extensions 社区 PR 自动 AST 扫描与 CDN 分发",
        attendees: ["dx@ztools.dev"]
    },
    {
        id: "evt-gym",
        title: "晚间有氧训练与拉伸恢复",
        startTime: "19:30",
        endTime: "20:30",
        location: "Fitness Center",
        calendarName: "Personal",
        notes: "保持充沛体能与极客状态",
        attendees: []
    }
]);
let memoryCalendarEvents = [...DEFAULT_CALENDAR_EVENTS];
/**
 * 生成符合 RFC 5545 规范的 iCalendar (.ics) 文本
 */
export function buildCalendarIcsContent(events) {
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//ZTools//Declarative Calendar 2.0//CN",
        "CALSCALE:GREGORIAN"
    ];
    for (const ev of events) {
        lines.push("BEGIN:VEVENT", `UID:${ev.id}@ztools.dev`, `SUMMARY:${ev.title}`, `LOCATION:${ev.location || ""}`, `DESCRIPTION:${(ev.notes || "").replace(/\r?\n/g, "\\n")}`, "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
}
function formatEventClockTime(raw, fallback) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
        const d = new Date(raw);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `${hh}:${mm}`;
    }
    if (typeof raw === "string" && raw.trim()) {
        const trimmed = raw.trim();
        if (/^\d{10,13}$/.test(trimmed)) {
            const d = new Date(Number(trimmed));
            const hh = String(d.getHours()).padStart(2, "0");
            const mm = String(d.getMinutes()).padStart(2, "0");
            return `${hh}:${mm}`;
        }
        return trimmed;
    }
    return fallback;
}
export async function fetchCalendarEvents(scope = "all", hostOverride) {
    if (hostOverride || isRealElectronHost(hostOverride)) {
        const method = scope === "upcoming" ? "calendar_upcoming_events" : "calendar_list_events";
        const res = await callHostTransport(method, { scope }, hostOverride);
        const dataObj = (!Array.isArray(res.data) && res.data && typeof res.data === "object" ? res.data : {});
        const rawList = Array.isArray(res.data)
            ? res.data
            : Array.isArray(dataObj.events)
                ? dataObj.events
                : null;
        if (res.ok && rawList) {
            if (rawList.length > 0 || isRealElectronHost(hostOverride)) {
                return rawList.map((rawEvt, idx) => {
                    const e = (rawEvt && typeof rawEvt === "object" ? rawEvt : {});
                    return {
                        id: String(e.id || `evt-${idx}`),
                        title: String(e.title || e.summary || "Untitled Event"),
                        startTime: formatEventClockTime(e.startTime ?? e.start, "09:00"),
                        endTime: formatEventClockTime(e.endTime ?? e.end, "10:00"),
                        location: String(e.location || ""),
                        conferenceUrl: e.conferenceUrl || e.meetingUrl ? String(e.conferenceUrl || e.meetingUrl) : undefined,
                        calendarName: String(e.calendarName || e.calendar || "Calendar"),
                        notes: String(e.notes || e.description || ""),
                        attendees: Array.isArray(e.attendees) ? e.attendees.map(String) : [],
                        isAllDay: Boolean(e.isAllDay ?? e.allDay)
                    };
                });
            }
        }
        if (isRealElectronHost(hostOverride)) {
            return [];
        }
    }
    return [...memoryCalendarEvents];
}
export async function createCalendarEvent(input, hostOverride) {
    const cleanTitle = (input.title || "").trim();
    if (!cleanTitle) {
        throw new Error("EVENT_TITLE_REQUIRED: 日程标题不能为空");
    }
    const newEvent = {
        id: `evt-${Date.now()}`,
        title: cleanTitle,
        startTime: (input.startTime || "10:00").trim(),
        endTime: (input.endTime || "11:00").trim(),
        location: (input.location || "Online").trim(),
        conferenceUrl: input.conferenceUrl?.trim() || undefined,
        calendarName: (input.calendarName || "Work").trim(),
        notes: (input.notes || "").trim(),
        attendees: []
    };
    if (hostOverride || isRealElectronHost(hostOverride)) {
        const res = await callHostTransport("calendar_create_event", { ...newEvent }, hostOverride);
        if (res.ok && res.data && res.data.id) {
            const merged = {
                ...newEvent,
                id: String(res.data.id)
            };
            memoryCalendarEvents = [merged, ...memoryCalendarEvents];
            return merged;
        }
        if (isRealElectronHost(hostOverride)) {
            throw new Error(res.error || "CALENDAR_CREATE_FAILED: 宿主创建日程失败");
        }
    }
    memoryCalendarEvents = [newEvent, ...memoryCalendarEvents];
    return newEvent;
}
export async function deleteCalendarEvent(id, hostOverride) {
    const cleanId = (id || "").trim();
    if (!cleanId)
        return false;
    if (hostOverride || isRealElectronHost(hostOverride)) {
        const res = await callHostTransport("calendar_delete_event", { id: cleanId }, hostOverride);
        if (!res.ok && isRealElectronHost(hostOverride)) {
            return false;
        }
    }
    const before = memoryCalendarEvents.length;
    memoryCalendarEvents = memoryCalendarEvents.filter((e) => e.id !== cleanId);
    return memoryCalendarEvents.length < before;
}
export async function exportCalendarIcs(events = isRealElectronHost() ? [] : memoryCalendarEvents, hostOverride) {
    if (hostOverride || isRealElectronHost(hostOverride)) {
        const res = await callHostTransport("calendar_export_ics", { eventIds: events.map((e) => e.id) }, hostOverride);
        if (res.ok && res.data) {
            const ics = typeof res.data === "string" ? res.data : res.data.ics;
            if (typeof ics === "string" && ics.includes("BEGIN:VCALENDAR")) {
                return ics;
            }
        }
    }
    return buildCalendarIcsContent(events);
}
export function CreateCalendarEventForm({ onCreated }) {
    const [title, setTitle] = useState("");
    const [startTime, setStartTime] = useState("15:00");
    const [endTime, setEndTime] = useState("16:00");
    const [calendarName, setCalendarName] = useState("Work");
    const [location, setLocation] = useState("Feishu / Zoom");
    const [conferenceUrl, setConferenceUrl] = useState("");
    const [notes, setNotes] = useState("");
    const { pop } = useNavigation();
    const handleSubmit = async () => {
        try {
            const created = await createCalendarEvent({
                title,
                startTime,
                endTime,
                calendarName,
                location,
                conferenceUrl,
                notes
            });
            onCreated?.(created);
            await showToast(Toast.Style.Success, `已创建日程: ${created.title}`, `${created.startTime} - ${created.endTime}`);
            pop();
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            await showToast(Toast.Style.Failure, "创建日程失败", errMsg);
        }
    };
    return (React.createElement(Form, { navigationTitle: "\u65B0\u5EFA\u65E5\u7A0B\u4E8B\u4EF6 (Create Calendar Event)", actions: React.createElement(ActionPanel, null,
            React.createElement(Action, { title: "\u4FDD\u5B58\u65E5\u7A0B", icon: Icon.Check, onAction: handleSubmit })) },
        React.createElement(Form.TextField, { id: "title", title: "\u65E5\u7A0B\u4E3B\u9898", placeholder: "\u4F8B\u5982: \u4EA7\u54C1\u5468\u4F1A / \u67B6\u6784\u8BC4\u5BA1", value: title, onChange: setTitle }),
        React.createElement(Form.TextField, { id: "startTime", title: "\u5F00\u59CB\u65F6\u95F4", placeholder: "15:00", value: startTime, onChange: setStartTime }),
        React.createElement(Form.TextField, { id: "endTime", title: "\u7ED3\u675F\u65F6\u95F4", placeholder: "16:00", value: endTime, onChange: setEndTime }),
        React.createElement(Form.Dropdown, { id: "calendarName", title: "\u6240\u5C5E\u65E5\u5386", value: calendarName, onChange: setCalendarName },
            React.createElement(Form.Dropdown.Item, { value: "Work", title: "\u5DE5\u4F5C\u65E5\u7A0B (Work)" }),
            React.createElement(Form.Dropdown.Item, { value: "Engineering", title: "\u5DE5\u7A0B\u7814\u53D1 (Engineering)" }),
            React.createElement(Form.Dropdown.Item, { value: "Personal", title: "\u4E2A\u4EBA\u751F\u6D3B (Personal)" })),
        React.createElement(Form.TextField, { id: "location", title: "\u5730\u70B9 / \u4F1A\u8BAE\u5BA4", placeholder: "\u4F8B\u5982: \u98DE\u4E66\u4F1A\u8BAE / 3F \u4F1A\u8BAE\u5BA4", value: location, onChange: setLocation }),
        React.createElement(Form.TextField, { id: "conferenceUrl", title: "\u5728\u7EBF\u4F1A\u8BAE\u94FE\u63A5 (\u53EF\u9009)", placeholder: "https://vc.feishu.cn/j/...", value: conferenceUrl, onChange: setConferenceUrl }),
        React.createElement(Form.TextArea, { id: "notes", title: "\u8BAE\u7A0B\u4E0E\u5907\u6CE8", placeholder: "\u586B\u5199\u4F1A\u8BAE\u8BAE\u7A0B\u6216\u51C6\u5907\u4E8B\u9879...", value: notes, onChange: setNotes })));
}
export function CalendarCommand() {
    const realHost = isRealElectronHost();
    const [events, setEvents] = useState(realHost ? [] : [...DEFAULT_CALENDAR_EVENTS]);
    const [searchText, setSearchText] = useState("");
    const [scope, setScope] = useState("all");
    const [selectedId, setSelectedId] = useState(null);
    const [isLoading, setIsLoading] = useState(realHost);
    const { push } = useNavigation();
    useEffect(() => {
        let active = true;
        setIsLoading(true);
        fetchCalendarEvents(scope)
            .then((list) => {
            if (!active)
                return;
            setEvents(list);
            setIsLoading(false);
        })
            .catch((err) => {
            console.warn("[calendar] fetchCalendarEvents failed:", err);
            if (active)
                setIsLoading(false);
        });
        return () => {
            active = false;
        };
    }, [scope]);
    const displayedEvents = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        return events.filter((e) => {
            if (scope === "meetings" && !e.conferenceUrl)
                return false;
            if (!q)
                return true;
            return (e.title.toLowerCase().includes(q) ||
                e.location.toLowerCase().includes(q) ||
                e.calendarName.toLowerCase().includes(q) ||
                e.notes.toLowerCase().includes(q));
        });
    }, [events, searchText, scope]);
    const handleDelete = async (evt) => {
        await deleteCalendarEvent(evt.id);
        setEvents((prev) => prev.filter((item) => item.id !== evt.id));
        await showToast(Toast.Style.Success, `已删除日程: ${evt.title}`);
    };
    const handleExportIcs = async () => {
        const ics = await exportCalendarIcs(displayedEvents);
        await Clipboard.copy(ics);
        await showToast(Toast.Style.Success, "已导出并复制 ICS 日历文件", `包含 ${displayedEvents.length} 个日程事件`);
    };
    const activeEvent = useMemo(() => displayedEvents.find((e) => e.id === selectedId) || displayedEvents[0] || null, [displayedEvents, selectedId]);
    const nextMeeting = useMemo(() => events.find((e) => Boolean(e.conferenceUrl)) || events[0] || null, [events]);
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchBarPlaceholder: "\u641C\u7D22\u8FD1\u671F\u65E5\u7A0B\u3001\u89C6\u9891\u4F1A\u8BAE\u6216\u521B\u5EFA\u65B0\u4E8B\u4EF6 (My Schedule & Conferences)...", onSearchTextChange: setSearchText, onSelectionChange: setSelectedId, filterBar: {
            summaryText: nextMeeting
                ? `日程安排 • 共 ${events.length} 场日程 (视频会议 ${events.filter((e) => Boolean(e.conferenceUrl)).length} 场) | 下一场: ${nextMeeting.title} (${nextMeeting.startTime})`
                : `日程安排 • 当前共 ${events.length} 场日程`,
            actions: [
                {
                    id: "join-video-meeting",
                    label: "一键加入视频会议",
                    title: "一键加入视频会议",
                    style: "primary",
                    onAction: async () => {
                        const targetEvt = activeEvent?.conferenceUrl
                            ? activeEvent
                            : displayedEvents.find((e) => Boolean(e.conferenceUrl)) || activeEvent;
                        if (!targetEvt || !targetEvt.conferenceUrl) {
                            await showToast(Toast.Style.Failure, "当前选中日程未包含在线视频会议链接");
                            return;
                        }
                        const res = await callHostTransport("shell_open_external", {
                            url: targetEvt.conferenceUrl
                        });
                        if (!res.ok) {
                            await Clipboard.copy(targetEvt.conferenceUrl);
                        }
                        await showToast(Toast.Style.Success, `正在加入会议: ${targetEvt.title}`, targetEvt.conferenceUrl);
                    }
                },
                {
                    id: "create-calendar-event",
                    label: "➕ 新建日程事件...",
                    title: "➕ 新建日程事件...",
                    style: "primary",
                    onAction: () => {
                        push(React.createElement(CreateCalendarEventForm, { onCreated: (created) => setEvents((prev) => [created, ...prev]) }));
                    }
                },
                {
                    id: "export-all-ics",
                    label: "导出全部日程 (.ics)",
                    title: "导出全部日程 (.ics)",
                    style: "secondary",
                    onAction: handleExportIcs
                },
                {
                    id: "copy-event-summary",
                    label: "复制日程摘要",
                    title: "复制日程摘要",
                    style: "secondary",
                    onAction: async () => {
                        if (!activeEvent)
                            return;
                        const summary = `${activeEvent.title} (${activeEvent.startTime}-${activeEvent.endTime}) @ ${activeEvent.location}`;
                        await Clipboard.copy(summary);
                        await showToast(Toast.Style.Success, "已复制日程摘要", summary);
                    }
                },
                {
                    id: "delete-selected-event",
                    label: "删除选中日程",
                    title: "删除选中日程",
                    style: "danger",
                    onAction: async () => {
                        if (activeEvent) {
                            await handleDelete(activeEvent);
                        }
                    }
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u7B5B\u9009\u65E5\u7A0B\u8303\u56F4", value: scope, onChange: (val) => setScope(val) },
            React.createElement(List.Dropdown.Item, { title: `全部日程 (All Events · ${events.length})`, value: "all", icon: Icon.Calendar }),
            React.createElement(List.Dropdown.Item, { title: "\u5373\u5C06\u5F00\u59CB (Upcoming Events)", value: "upcoming", icon: Icon.Clock }),
            React.createElement(List.Dropdown.Item, { title: "\u542B\u89C6\u9891\u4F1A\u8BAE\u94FE\u63A5 (Video Meetings)", value: "meetings", icon: Icon.Video })) },
        React.createElement(List.Section, { title: `日程安排 (My Schedule · ${displayedEvents.length})` },
            displayedEvents.length === 0 && (React.createElement(List.Item, { id: "calendar-empty-create", title: "\u65B0\u5EFA\u65E5\u7A0B\u4E8B\u4EF6 (Create Calendar Event)...", subtitle: "\u5F53\u524D\u6682\u65E0\u65E5\u7A0B\u5B89\u6392\uFF0C\u6309 Enter \u7ACB\u5373\u521B\u5EFA\u65B0\u65E5\u7A0B\u6216\u5728\u7EBF\u4F1A\u8BAE", icon: Icon.Plus, detail: React.createElement(List.Item.Detail, { markdown: `# 暂无日程事件\n\n按 \`Enter\` 即可新建工作日程、会议室预约或视频会议直达链接。` }), actions: React.createElement(ActionPanel, { title: "\u65E5\u7A0B\u7BA1\u7406" },
                    React.createElement(Action.Push, { title: "\u65B0\u5EFA\u65E5\u7A0B\u4E8B\u4EF6 (Create Event)...", icon: Icon.Plus, shortcut: { modifiers: ["ctrl"], key: "n" }, target: React.createElement(CreateCalendarEventForm, { onCreated: (created) => setEvents((prev) => [created, ...prev]) }) })) })),
            displayedEvents.map((evt) => (React.createElement(List.Item, { key: evt.id, id: evt.id, title: evt.title, subtitle: `${evt.startTime} - ${evt.endTime} • ${evt.location}`, icon: evt.conferenceUrl ? Icon.Video : Icon.Calendar, accessories: [
                    { text: evt.calendarName },
                    { text: `${evt.startTime} - ${evt.endTime}` }
                ], detail: React.createElement(List.Item.Detail, { markdown: [
                        `# ${evt.title}`,
                        `> **时间**: \`${evt.startTime} - ${evt.endTime}\` &nbsp;|&nbsp; **日历**: \`${evt.calendarName}\``,
                        `---`,
                        `- **地点 / 会议室**: ${evt.location || "未指定"}`,
                        evt.conferenceUrl
                            ? `- **在线会议直达**: [${evt.conferenceUrl}](${evt.conferenceUrl})`
                            : "",
                        evt.notes ? `### 议程与备注\n${evt.notes}` : "",
                        evt.attendees.length > 0
                            ? `### 参会人 (${evt.attendees.length})\n` +
                                evt.attendees.map((a) => `- \`${a}\``).join("\n")
                            : ""
                    ]
                        .filter(Boolean)
                        .join("\n\n"), metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u65F6\u95F4\u6BB5", text: `${evt.startTime} - ${evt.endTime}`, icon: Icon.Clock }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u65E5\u5386\u5206\u7EC4", text: evt.calendarName, icon: Icon.Calendar }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5730\u70B9", text: evt.location || "-", icon: Icon.Globe }),
                        evt.conferenceUrl && (React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u4F1A\u8BAE\u72B6\u6001" },
                            React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: "\u53EF\u4E00\u952E\u5165\u4F1A (Join Ready)", color: Color.Green })))) }), actions: React.createElement(ActionPanel, { title: evt.title },
                    evt.conferenceUrl && (React.createElement(Action.OpenInBrowser, { title: "\u4E00\u952E\u52A0\u5165\u89C6\u9891\u4F1A\u8BAE (Join Meeting)", url: evt.conferenceUrl })),
                    React.createElement(Action.Push, { title: "\u65B0\u5EFA\u65E5\u7A0B\u4E8B\u4EF6 (Create Event)...", icon: Icon.Plus, shortcut: { modifiers: ["ctrl"], key: "n" }, target: React.createElement(CreateCalendarEventForm, { onCreated: (created) => setEvents((prev) => [created, ...prev]) }) }),
                    React.createElement(Action, { title: "\u5BFC\u51FA\u5168\u90E8\u65E5\u7A0B\u4E3A ICS", icon: Icon.Download, shortcut: { modifiers: ["ctrl"], key: "e" }, onAction: handleExportIcs }),
                    React.createElement(Action, { title: "\u590D\u5236\u65E5\u7A0B\u6458\u8981", icon: Icon.CopyClipboard, shortcut: { modifiers: ["ctrl"], key: "c" }, onAction: async () => {
                            const summary = `${evt.title} (${evt.startTime}-${evt.endTime}) @ ${evt.location}`;
                            await Clipboard.copy(summary);
                            await showToast(Toast.Style.Success, "已复制日程摘要", summary);
                        } }),
                    React.createElement(Action, { title: "\u5220\u9664\u6B64\u65E5\u7A0B", icon: Icon.Trash, style: Action.Style.Destructive, shortcut: { modifiers: ["ctrl"], key: "x" }, onAction: () => handleDelete(evt) })) }))))));
}
export default CalendarCommand;
