/**
 * Calendar (极客日程表、视频会议直达与 ICS 日历中枢)
 *
 * 深度对齐 Raycast 官方 `calendar` (`My Schedule` & `Create Event`)：
 * - 按日期分组展示今天与近期日程，会议链接 (Zoom / Feishu / Teams / Google Meet) 一键直达
 * - 支持通过 <Form> 快速新建日程（日期 + 时间，提交前校验）、删除日程（需确认）与导出标准 RFC 5545 `.ics` 日历文件
 * - 对接主进程 `calendar_upcoming_events`, `calendar_list_events`, `calendar_create_event`, `calendar_delete_event`, `calendar_export_ics` IPC
 */

import React from "@ztools/declarative-ui";
import {
  List,
  Detail,
  Form,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  showToast,
  Toast,
  confirmAlert,
  useNavigation
} from "@ztools/declarative-ui";
import { useState, useEffect, useMemo } from "@ztools/declarative-ui";
import { callHostTransport, isRealElectronHost } from "./native-ipc.js";

export type CalendarFilterScope = "all" | "upcoming" | "meetings" | "today" | "past";

/** 单次从宿主加载的日程上限（宿主上限 1000） */
export const CALENDAR_PAGE_LIMIT = 500;

export interface CalendarPage {
  readonly events: CalendarEventItem[];
  /** 符合条件的日程总数（宿主不支持计数时等于已加载数量） */
  readonly total: number;
  /** 搜索词是否已由宿主处理（含拼音匹配）；为 false 时界面需在本地按搜索词过滤 */
  readonly searchedOnHost: boolean;
}

export interface CalendarEventItem {
  readonly id: string;
  readonly title: string;
  /** 开始时刻「时:分」（仅用于显示） */
  readonly startTime: string;
  /** 结束时刻「时:分」（仅用于显示） */
  readonly endTime: string;
  /** 开始时间戳（毫秒）；宿主数据都有，本地演示数据可能没有 */
  readonly startAt?: number;
  /** 结束时间戳（毫秒） */
  readonly endAt?: number;
  readonly location: string;
  /** 可直接打开的 http/https 会议链接 */
  readonly conferenceUrl?: string;
  /** 宿主里存着但不是 http/https 网址的会议链接（旧数据），只展示不标为可入会 */
  readonly invalidConferenceUrl?: string;
  readonly calendarName: string;
  readonly notes: string;
  readonly attendees: readonly string[];
  readonly isAllDay?: boolean;
}

export const DEFAULT_CALENDAR_EVENTS: readonly CalendarEventItem[] = Object.freeze([
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

let memoryCalendarEvents: CalendarEventItem[] = [...DEFAULT_CALENDAR_EVENTS];

// ---------------------------------------------------------------------------
// 日期与时间
// ---------------------------------------------------------------------------

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const DAY_MS = 24 * 3600 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfToday(): number {
  return startOfDay(Date.now());
}

/** 本地日期键 YYYY-MM-DD */
export function formatDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 分组标题：今天 / 明天 / 昨天 加具体日期与星期；不在今年时带年份 */
export function formatDayLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = `${sameYear ? "" : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
  const diffDays = Math.round((startOfDay(ms) - startOfDay(now)) / DAY_MS);
  if (diffDays === 0) return `今天 · ${date}`;
  if (diffDays === 1) return `明天 · ${date}`;
  if (diffDays === -1) return `昨天 · ${date}`;
  return date;
}

/** 列表行右侧的时间段：同一天只显示时分，跨天时结束时间带日期 */
export function formatEventRange(evt: CalendarEventItem): string {
  if (evt.isAllDay) return "全天";
  if (typeof evt.startAt === "number" && typeof evt.endAt === "number") {
    const sameDay = formatDateKey(evt.startAt) === formatDateKey(evt.endAt);
    if (sameDay) return `${formatClock(evt.startAt)} - ${formatClock(evt.endAt)}`;
    const end = new Date(evt.endAt);
    return `${formatClock(evt.startAt)} - ${end.getMonth() + 1}月${end.getDate()}日 ${formatClock(evt.endAt)}`;
  }
  return `${evt.startTime} - ${evt.endTime}`;
}

/** 带日期的完整时间，用于摘要、详情与提示 */
export function formatEventWhen(evt: CalendarEventItem): string {
  if (typeof evt.startAt !== "number") return formatEventRange(evt);
  const start = new Date(evt.startAt);
  const day = `${formatDateKey(evt.startAt)} ${WEEKDAYS[start.getDay()]}`;
  if (evt.isAllDay) return `${day} 全天`;
  if (typeof evt.endAt === "number" && formatDateKey(evt.startAt) !== formatDateKey(evt.endAt)) {
    return `${day} ${formatClock(evt.startAt)} - ${formatDateKey(evt.endAt)} ${formatClock(evt.endAt)}`;
  }
  return `${day} ${formatEventRange(evt)}`;
}

export function buildEventSummary(evt: CalendarEventItem): string {
  return `${evt.title} (${formatEventWhen(evt)})${evt.location ? ` @ ${evt.location}` : ""}`;
}

function isEventEnded(evt: CalendarEventItem, now = Date.now()): boolean {
  return typeof evt.endAt === "number" && evt.endAt < now;
}

const DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const CLOCK_RE = /^(\d{1,2})[:：](\d{2})$/;
const DATE_TIME_RE = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})[\sT]+(\d{1,2}[:：]\d{2})$/;

function parseDate(raw: string): { y: number; m: number; d: number } | null {
  const match = raw.trim().match(DATE_RE);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
  return { y, m, d };
}

function parseClock(raw: string): { h: number; min: number } | null {
  const match = raw.trim().match(CLOCK_RE);
  if (!match) return null;
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
}

export type EventFormField = "title" | "date" | "startTime" | "endTime" | "conferenceUrl";
export type EventFormErrors = Partial<Record<EventFormField, string>>;

/**
 * 把表单里的日期与时间换算成时间戳。
 * 时间字段写「HH:MM」时用日期字段的日期；也可以直接写「YYYY-MM-DD HH:MM」（跨天日程的结束时间就这样写）。
 */
export function parseEventTimes(input: {
  date?: string;
  startTime?: string;
  endTime?: string;
}): { ok: true; startAt: number; endAt: number } | { ok: false; errors: EventFormErrors } {
  const errors: EventFormErrors = {};
  const dateText = (input.date ?? formatDateKey(Date.now())).trim();
  const baseDate = dateText ? parseDate(dateText) : null;

  const resolve = (field: "startTime" | "endTime", label: string): number | null => {
    const text = (input[field] || "").trim();
    if (!text) {
      errors[field] = `请填写${label}`;
      return null;
    }
    const withDate = text.match(DATE_TIME_RE);
    const day = withDate ? parseDate(withDate[1]) : baseDate;
    const clock = parseClock(withDate ? withDate[2] : text);
    if (!clock || (withDate && !day)) {
      errors[field] = `${label}格式应为 HH:MM（00:00 - 23:59），例如 09:30`;
      return null;
    }
    if (!day) {
      errors.date = dateText ? "日期格式应为 YYYY-MM-DD，例如 2026-10-25" : "请填写日期";
      return null;
    }
    return new Date(day.y, day.m - 1, day.d, clock.h, clock.min, 0, 0).getTime();
  };

  const startAt = resolve("startTime", "开始时间");
  const endAt = resolve("endTime", "结束时间");
  if (startAt !== null && endAt !== null && endAt <= startAt) {
    errors.endTime = "结束时间必须晚于开始时间（跨天日程请写结束日期，例如 2026-10-23 01:00）";
  }
  if (Object.keys(errors).length > 0 || startAt === null || endAt === null) {
    return { ok: false, errors };
  }
  return { ok: true, startAt, endAt };
}

/**
 * 会议链接只接受 http/https 网址（宿主打开链接也只允许这两种）；没写协议时自动补 https://。
 * 返回 url 为空且无 error 表示没填。
 */
export function normalizeConferenceUrl(raw?: string): { url?: string; error?: string } {
  const text = (raw || "").trim();
  if (!text) return {};
  const invalid = "会议链接必须是 http:// 或 https:// 开头的网址，例如 https://vc.feishu.cn/j/123456";
  if (/\s/.test(text)) return { error: invalid };
  const schemeMatch = text.match(/^([a-z][a-z0-9+.-]*):(?!\d)/i);
  const candidate = schemeMatch ? text : `https://${text}`;
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1])) {
    return { error: `不支持「${schemeMatch[1]}:」链接，请填写会议的网页链接（http:// 或 https:// 开头）` };
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { error: invalid };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: invalid };
  if (parsed.username || parsed.password) return { error: "会议链接不能包含用户名或密码" };
  if (!parsed.hostname || (!parsed.hostname.includes(".") && parsed.hostname !== "localhost")) {
    return { error: invalid };
  }
  return { url: candidate };
}

/** 新建表单的完整校验，返回各字段的错误；没有错误时返回空对象 */
export function validateEventForm(values: {
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  conferenceUrl?: string;
}): EventFormErrors {
  const errors: EventFormErrors = {};
  if (!(values.title || "").trim()) errors.title = "请填写日程主题";
  const times = parseEventTimes(values);
  if (!times.ok) Object.assign(errors, times.errors);
  const url = normalizeConferenceUrl(values.conferenceUrl);
  if (url.error) errors.conferenceUrl = url.error;
  return errors;
}

/** 去掉错误信息前的错误码前缀，只给用户看原因 */
function readableError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return text.replace(/^[A-Z][A-Z0-9_]+:\s*/, "") || "未知错误";
}

// ---------------------------------------------------------------------------
// ICS
// ---------------------------------------------------------------------------

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function formatIcsUtc(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

/** 按 RFC 5545 每行不超过 75 字节折行，不拆开多字节字符 */
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** 没有时间戳的本地演示数据：按今天的「时:分」换算 */
function resolveEventSpan(evt: CalendarEventItem): { startAt: number; endAt: number } {
  if (typeof evt.startAt === "number" && typeof evt.endAt === "number") {
    return { startAt: evt.startAt, endAt: evt.endAt };
  }
  const today = formatDateKey(Date.now());
  const parsed = parseEventTimes({ date: today, startTime: evt.startTime, endTime: evt.endTime });
  if (parsed.ok) return { startAt: parsed.startAt, endAt: parsed.endAt };
  const fallback = startOfToday();
  return { startAt: fallback, endAt: fallback + 3600 * 1000 };
}

/**
 * 生成符合 RFC 5545 规范的 iCalendar (.ics) 文本（带 DTSTAMP / DTSTART / DTEND，文本已转义并折行）。
 * 只在没有宿主的环境使用；有宿主时以宿主生成的为准。
 */
export function buildCalendarIcsContent(events: readonly CalendarEventItem[], now = Date.now()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ZTools//Declarative Calendar 2.0//CN", "CALSCALE:GREGORIAN"];
  for (const ev of events) {
    const span = resolveEventSpan(ev);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.id}@ztools.dev`,
      `DTSTAMP:${formatIcsUtc(now)}`,
      `DTSTART:${formatIcsUtc(span.startAt)}`,
      `DTEND:${formatIcsUtc(span.endAt)}`,
      `SUMMARY:${escapeIcsText(ev.title)}`
    );
    if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
    if (ev.notes) lines.push(`DESCRIPTION:${escapeIcsText(ev.notes)}`);
    if (ev.conferenceUrl) lines.push(`URL:${ev.conferenceUrl}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n");
}

export function countIcsEvents(ics: string): number {
  return (ics.match(/^BEGIN:VEVENT\r?$/gm) || []).length;
}

/** 导出文件的默认文件名（去掉文件名里不允许的字符） */
export function defaultIcsFileName(events: readonly CalendarEventItem[], now = Date.now()): string {
  if (events.length === 1) {
    const safe = events[0].title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 60);
    if (safe) return `${safe}.ics`;
  }
  return `ztools-calendar-${formatDateKey(now).replace(/-/g, "")}.ics`;
}

// ---------------------------------------------------------------------------
// 宿主读写
// ---------------------------------------------------------------------------

function toTimestamp(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^\d{10,13}$/.test(raw.trim())) return Number(raw.trim());
  return undefined;
}

function mapHostEvent(e: any, idx: number): CalendarEventItem {
  const startAt = toTimestamp(e.startTime ?? e.start);
  const endAt = toTimestamp(e.endTime ?? e.end);
  const rawStart = typeof (e.startTime ?? e.start) === "string" ? String(e.startTime ?? e.start).trim() : "";
  const rawEnd = typeof (e.endTime ?? e.end) === "string" ? String(e.endTime ?? e.end).trim() : "";
  const rawUrl = e.conferenceUrl || e.meetingUrl ? String(e.conferenceUrl || e.meetingUrl).trim() : "";
  const link = normalizeConferenceUrl(rawUrl);
  return {
    id: String(e.id || `evt-${idx}`),
    title: String(e.title || e.summary || "Untitled Event"),
    startTime: startAt !== undefined ? formatClock(startAt) : rawStart || "09:00",
    endTime: endAt !== undefined ? formatClock(endAt) : rawEnd || "10:00",
    ...(startAt !== undefined ? { startAt } : {}),
    ...(endAt !== undefined ? { endAt } : {}),
    location: String(e.location || ""),
    conferenceUrl: link.url,
    ...(rawUrl && !link.url ? { invalidConferenceUrl: rawUrl } : {}),
    calendarName: String(e.calendarName || e.calendar || "Calendar"),
    notes: String(e.notes || e.description || ""),
    attendees: Array.isArray(e.attendees) ? e.attendees.map(String) : [],
    isAllDay: Boolean(e.isAllDay ?? e.allDay)
  };
}

/**
 * 「全部日程 / 视频会议」从今天 0 点起按时间升序；「历史日程」按时间倒序；
 * 有搜索词时在全部时间范围内由宿主搜索（「历史日程」仍限定在今天以前）。
 */
export function buildCalendarQuery(scope: CalendarFilterScope, search = ""): Record<string, unknown> {
  const q = (search || "").trim();
  const todayStart = startOfToday();
  if (scope === "past") {
    return { endTime: todayStart - 1, order: "desc", ...(q ? { search: q } : {}) };
  }
  return q ? { search: q } : { startTime: todayStart };
}

/**
 * 读取日程。宿主读取失败时抛出 LOAD_EVENTS_FAILED，调用方据此提示失败并保留原列表，
 * 不能把「读取失败」显示成「没有日程」。
 */
export async function fetchCalendarPage(
  scope: CalendarFilterScope = "all",
  search = "",
  hostOverride?: any
): Promise<CalendarPage> {
  if (hostOverride || isRealElectronHost()) {
    const useUpcoming = scope === "upcoming";
    const query = useUpcoming ? { scope } : buildCalendarQuery(scope, search);
    const res = useUpcoming
      ? await callHostTransport<any>("calendar_upcoming_events", query, hostOverride)
      : await callHostTransport<any>("calendar_list_events", { ...query, limit: CALENDAR_PAGE_LIMIT }, hostOverride);
    const rawList = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.data?.events)
        ? res.data.events
        : null;
    if (!res.ok || !rawList) {
      throw new Error(`LOAD_EVENTS_FAILED: ${res.ok ? "宿主返回的日程格式无法识别" : res.error || "宿主读取日程失败"}`);
    }
    const events: CalendarEventItem[] = rawList.map(mapHostEvent);
    let total = events.length;
    if (!useUpcoming) {
      try {
        // 计数只按筛选条件，不带排序
        const { order: _order, ...countQuery } = query as Record<string, unknown>;
        const countRes = await callHostTransport<any>("calendar_count_events", countQuery, hostOverride);
        const counted = Number(countRes.ok ? countRes.data?.total : NaN);
        if (Number.isInteger(counted) && counted >= events.length) total = counted;
      } catch {
        // 旧宿主没有计数接口：总数按已加载数量
      }
    }
    return { events, total, searchedOnHost: !useUpcoming && Boolean(search.trim()) };
  }
  const events = [...memoryCalendarEvents];
  return { events, total: events.length, searchedOnHost: false };
}

export async function fetchCalendarEvents(
  scope: CalendarFilterScope = "all",
  hostOverride?: any
): Promise<CalendarEventItem[]> {
  return (await fetchCalendarPage(scope, "", hostOverride)).events;
}

export async function createCalendarEvent(
  input: {
    title: string;
    /** 日期 YYYY-MM-DD，缺省为今天 */
    date?: string;
    startTime: string;
    endTime: string;
    location?: string;
    conferenceUrl?: string;
    calendarName?: string;
    notes?: string;
  },
  hostOverride?: any
): Promise<CalendarEventItem> {
  const cleanTitle = (input.title || "").trim();
  if (!cleanTitle) {
    throw new Error("EVENT_TITLE_REQUIRED: 日程标题不能为空");
  }
  const times = parseEventTimes(input);
  if (!times.ok) {
    const first = Object.values(times.errors)[0] || "时间无效";
    throw Object.assign(new Error(`INVALID_EVENT_TIME: ${first}`), { fieldErrors: times.errors });
  }
  const link = normalizeConferenceUrl(input.conferenceUrl);
  if (link.error) {
    throw Object.assign(new Error(`INVALID_CONFERENCE_URL: ${link.error}`), { fieldErrors: { conferenceUrl: link.error } });
  }

  const newEvent: CalendarEventItem = {
    id: `evt-${Date.now()}`,
    title: cleanTitle,
    startTime: formatClock(times.startAt),
    endTime: formatClock(times.endAt),
    startAt: times.startAt,
    endAt: times.endAt,
    location: (input.location || "").trim(),
    conferenceUrl: link.url,
    calendarName: (input.calendarName || "Work").trim(),
    notes: (input.notes || "").trim(),
    attendees: []
  };

  if (hostOverride || isRealElectronHost()) {
    // 时间一律以时间戳发给宿主，避免宿主把无法解析的文字当成「现在」
    const payload: Record<string, unknown> = {
      title: newEvent.title,
      startTime: times.startAt,
      endTime: times.endAt,
      location: newEvent.location,
      calendarName: newEvent.calendarName,
      notes: newEvent.notes,
      ...(link.url ? { conferenceUrl: link.url } : {})
    };
    const res = await callHostTransport<any>("calendar_create_event", payload, hostOverride);
    if (res.ok && res.data && res.data.id) {
      // 以宿主实际保存的时间、会议链接与日历为准（宿主会识别或忽略链接）
      const saved = mapHostEvent({ ...payload, ...res.data }, 0);
      const merged: CalendarEventItem = {
        ...newEvent,
        id: String(res.data.id),
        startTime: saved.startTime,
        endTime: saved.endTime,
        startAt: saved.startAt ?? newEvent.startAt,
        endAt: saved.endAt ?? newEvent.endAt,
        conferenceUrl:
          typeof res.data.conferenceUrl === "string" && res.data.conferenceUrl ? saved.conferenceUrl : undefined,
        calendarName: res.data.calendarName ? String(res.data.calendarName) : newEvent.calendarName
      };
      memoryCalendarEvents = [merged, ...memoryCalendarEvents];
      return merged;
    }
    // 宿主没存进去就如实报错，不能当作创建成功（否则关掉插件日程就没了）
    throw new Error(`CREATE_EVENT_FAILED: ${res.error || "宿主没有返回日程 ID"}`);
  }

  memoryCalendarEvents = [newEvent, ...memoryCalendarEvents];
  return newEvent;
}

export async function deleteCalendarEvent(id: string, hostOverride?: any): Promise<boolean> {
  const cleanId = (id || "").trim();
  if (!cleanId) return false;
  if (hostOverride || isRealElectronHost()) {
    const res = await callHostTransport("calendar_delete_event", { id: cleanId }, hostOverride);
    if (!res.ok) return false;
    memoryCalendarEvents = memoryCalendarEvents.filter((e) => e.id !== cleanId);
    return true;
  }
  const before = memoryCalendarEvents.length;
  memoryCalendarEvents = memoryCalendarEvents.filter((e) => e.id !== cleanId);
  return memoryCalendarEvents.length < before;
}

/**
 * 生成 ICS 文本。有宿主时由宿主按日程 id 生成；宿主失败直接抛错（EXPORT_ICS_FAILED），
 * 不能退回一份缺时间的本地 ICS 还提示成功。没有宿主时用本地生成。
 */
export async function exportCalendarIcs(
  events: readonly CalendarEventItem[] = memoryCalendarEvents,
  hostOverride?: any
): Promise<string> {
  if (hostOverride || isRealElectronHost()) {
    const res = await callHostTransport<any>("calendar_export_ics", { eventIds: events.map((e) => e.id) }, hostOverride);
    if (!res.ok) throw new Error(`EXPORT_ICS_FAILED: ${res.error || "宿主导出失败"}`);
    const ics = typeof res.data === "string" ? res.data : res.data?.ics;
    if (typeof ics !== "string" || !ics.includes("BEGIN:VCALENDAR")) {
      throw new Error("EXPORT_ICS_FAILED: 宿主返回的不是 ICS 日历内容");
    }
    return ics;
  }
  return buildCalendarIcsContent(events);
}

export type IcsFileExportResult =
  | { status: "saved"; filePath: string; count: number }
  | { status: "canceled" };

/** 弹出「另存为」并把 ICS 写成文件；用户取消时返回 canceled */
export async function exportCalendarIcsToFile(
  events: readonly CalendarEventItem[],
  hostOverride?: any
): Promise<IcsFileExportResult> {
  if (!hostOverride && !isRealElectronHost()) {
    throw new Error("NOT_SUPPORTED: 当前环境不能保存文件，请改用「复制 ICS 文本」");
  }
  const ics = await exportCalendarIcs(events, hostOverride);
  const picked = await callHostTransport<any>(
    "window_show_save_dialog",
    { title: "导出 ICS 日历文件", defaultName: defaultIcsFileName(events), filters: "iCalendar 日历|ics" },
    hostOverride
  );
  if (!picked.ok) throw new Error(`SAVE_DIALOG_FAILED: ${picked.error || "无法打开保存窗口"}`);
  const filePath = typeof picked.data?.filePath === "string" ? picked.data.filePath : "";
  if (picked.data?.canceled || !filePath) return { status: "canceled" };
  const written = await callHostTransport<any>(
    "filesystem_write_file",
    { path: filePath, content: ics, encoding: "utf8" },
    hostOverride
  );
  if (!written.ok) throw new Error(`WRITE_FILE_FAILED: ${written.error || "写入文件失败"}`);
  return { status: "saved", filePath, count: countIcsEvents(ics) };
}

// ---------------------------------------------------------------------------
// 界面
// ---------------------------------------------------------------------------

export function CreateCalendarEventForm({ onCreated }: { onCreated?: (evt: CalendarEventItem) => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => formatDateKey(Date.now()));
  const [startTime, setStartTime] = useState("15:00");
  const [endTime, setEndTime] = useState("16:00");
  const [calendarName, setCalendarName] = useState("Work");
  const [location, setLocation] = useState("");
  const [conferenceUrl, setConferenceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<EventFormErrors>({});
  const { pop } = useNavigation();

  const clearErrors = (...fields: EventFormField[]) => {
    setErrors((prev) => {
      if (!fields.some((f) => prev[f])) return prev;
      const next = { ...prev };
      for (const f of fields) delete next[f];
      return next;
    });
  };
  // 日期与两个时间互相影响（先后顺序），改其中一个就把三者的错误一起清掉，提交时重新校验
  const timeFields: EventFormField[] = ["date", "startTime", "endTime"];

  const handleSubmit = async () => {
    const found = validateEventForm({ title, date, startTime, endTime, conferenceUrl });
    setErrors(found);
    const firstError = Object.values(found)[0];
    if (firstError) {
      await showToast(Toast.Style.Failure, "请先修正标红的字段", firstError);
      return;
    }
    try {
      const created = await createCalendarEvent({
        title,
        date,
        startTime,
        endTime,
        calendarName,
        location,
        conferenceUrl,
        notes
      });
      onCreated?.(created);
      await showToast(Toast.Style.Success, `已创建日程: ${created.title}`, formatEventWhen(created));
      pop();
    } catch (err: any) {
      if (err?.fieldErrors) setErrors(err.fieldErrors);
      await showToast(Toast.Style.Failure, "创建日程失败", readableError(err));
    }
  };

  return (
    <Form
      navigationTitle="新建日程事件 (Create Calendar Event)"
      actions={
        <ActionPanel>
          <Action title="保存日程" icon={Icon.Check} onAction={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="日程主题"
        placeholder="例如: 产品周会 / 架构评审"
        value={title}
        error={errors.title}
        onChange={(v: string) => {
          setTitle(v);
          clearErrors("title");
        }}
      />
      <Form.TextField
        id="date"
        title="日期"
        placeholder="YYYY-MM-DD"
        info="格式 YYYY-MM-DD，默认今天"
        value={date}
        error={errors.date}
        onChange={(v: string) => {
          setDate(v);
          clearErrors(...timeFields);
        }}
      />
      <Form.TextField
        id="startTime"
        title="开始时间"
        placeholder="15:00"
        value={startTime}
        error={errors.startTime}
        onChange={(v: string) => {
          setStartTime(v);
          clearErrors(...timeFields);
        }}
      />
      <Form.TextField
        id="endTime"
        title="结束时间"
        placeholder="16:00"
        info="跨天日程写结束日期，例如 2026-10-23 01:00"
        value={endTime}
        error={errors.endTime}
        onChange={(v: string) => {
          setEndTime(v);
          clearErrors(...timeFields);
        }}
      />
      <Form.Dropdown id="calendarName" title="所属日历" value={calendarName} onChange={setCalendarName}>
        <Form.Dropdown.Item value="Work" title="工作日程 (Work)" />
        <Form.Dropdown.Item value="Engineering" title="工程研发 (Engineering)" />
        <Form.Dropdown.Item value="Personal" title="个人生活 (Personal)" />
      </Form.Dropdown>
      <Form.TextField
        id="location"
        title="地点 / 会议室"
        placeholder="例如: 飞书会议 / 3F 会议室"
        value={location}
        onChange={setLocation}
      />
      <Form.TextField
        id="conferenceUrl"
        title="在线会议链接 (可选)"
        placeholder="https://vc.feishu.cn/j/..."
        info="只支持 http:// 或 https:// 网址，没写协议时自动补 https://"
        value={conferenceUrl}
        error={errors.conferenceUrl}
        onChange={(v: string) => {
          setConferenceUrl(v);
          clearErrors("conferenceUrl");
        }}
      />
      <Form.TextArea
        id="notes"
        title="议程与备注"
        placeholder="填写会议议程或准备事项..."
        value={notes}
        onChange={setNotes}
      />
    </Form>
  );
}

interface DaySection {
  readonly key: string;
  readonly title: string;
  readonly events: CalendarEventItem[];
}

/** 按日期把（已排好序的）日程分组，保持原有顺序 */
export function groupEventsByDay(events: readonly CalendarEventItem[], now = Date.now()): DaySection[] {
  const sections: DaySection[] = [];
  for (const evt of events) {
    const key = typeof evt.startAt === "number" ? formatDateKey(evt.startAt) : "unknown";
    let section = sections.length > 0 && sections[sections.length - 1].key === key ? sections[sections.length - 1] : undefined;
    if (!section) {
      section = { key, title: typeof evt.startAt === "number" ? formatDayLabel(evt.startAt, now) : "日程安排", events: [] };
      sections.push(section);
    }
    section.events.push(evt);
  }
  return sections;
}

function belongsToScope(evt: CalendarEventItem, scope: CalendarFilterScope): boolean {
  if (typeof evt.startAt !== "number") return true;
  const todayStart = startOfToday();
  if (scope === "past") return evt.startAt < todayStart;
  if (scope === "meetings" && !evt.conferenceUrl) return false;
  return (evt.endAt ?? evt.startAt) >= todayStart;
}

export function CalendarCommand() {
  const realHost = isRealElectronHost();
  const [events, setEvents] = useState<CalendarEventItem[]>(realHost ? [] : [...DEFAULT_CALENDAR_EVENTS]);
  const [total, setTotal] = useState<number>(realHost ? 0 : DEFAULT_CALENDAR_EVENTS.length);
  const [searchedOnHost, setSearchedOnHost] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [scope, setScope] = useState<CalendarFilterScope>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(realHost);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);
  const { push } = useNavigation();

  // 「即将开始」只在本地过滤搜索词，不随输入重新请求宿主
  const hostSearch = scope === "upcoming" ? "" : searchText.trim();

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    // 输入搜索词时稍等再请求，避免每个字符都查询一次；旧请求的结果被丢弃
    const timer = setTimeout(() => {
      fetchCalendarPage(scope, hostSearch)
        .then((page) => {
          if (!active) return;
          setEvents(page.events);
          setTotal(page.total);
          setSearchedOnHost(page.searchedOnHost);
          setLoadError(null);
          setIsLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          // 读取失败：保留上一次的列表，如实提示，不显示成「没有日程」
          const reason = readableError(err);
          setLoadError(reason);
          setIsLoading(false);
          void showToast(Toast.Style.Failure, "读取日程失败", reason);
        });
    }, hostSearch ? 250 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [scope, hostSearch, reloadSeq]);

  const reload = () => setReloadSeq((n) => n + 1);

  const displayedEvents = useMemo(() => {
    const q = searchedOnHost ? "" : searchText.trim().toLowerCase();
    const filtered = events.filter((e) => {
      if (scope === "meetings" && !e.conferenceUrl) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.location.toLowerCase().includes(q) ||
        e.calendarName.toLowerCase().includes(q) ||
        e.notes.toLowerCase().includes(q)
      );
    });
    // 新建的日程插在最前面，这里按时间重新排序（「历史日程」倒序）；没有时间戳的保持原位置
    const dir = scope === "past" ? -1 : 1;
    return filtered
      .map((evt, idx) => ({ evt, idx }))
      .sort((a, b) => {
        const sa = a.evt.startAt;
        const sb = b.evt.startAt;
        if (typeof sa === "number" && typeof sb === "number" && sa !== sb) return (sa - sb) * dir;
        return a.idx - b.idx;
      })
      .map((x) => x.evt);
  }, [events, searchText, scope, searchedOnHost]);

  const sections = useMemo(() => groupEventsByDay(displayedEvents), [displayedEvents]);

  const handleDelete = async (evt: CalendarEventItem) => {
    const confirmed = await confirmAlert({
      title: `删除日程「${evt.title}」？`,
      message: `${formatEventWhen(evt)}。删除后无法恢复。`,
      primaryAction: { title: "删除", style: "destructive" },
      dismissAction: { title: "取消" }
    });
    if (!confirmed) return;
    const ok = await deleteCalendarEvent(evt.id);
    if (!ok) {
      await showToast(Toast.Style.Failure, "删除日程失败", evt.title);
      return;
    }
    setEvents((prev) => prev.filter((item) => item.id !== evt.id));
    setTotal((prev) => Math.max(0, prev - 1));
    await showToast(Toast.Style.Success, `已删除日程: ${evt.title}`);
  };

  const handleCreated = (created: CalendarEventItem) => {
    if (!belongsToScope(created, scope)) return;
    setEvents((prev) => [created, ...prev]);
    setTotal((prev) => prev + 1);
  };

  const handleExportFile = async (list: readonly CalendarEventItem[]) => {
    if (list.length === 0) {
      await showToast(Toast.Style.Failure, "没有可导出的日程", "当前列表为空");
      return;
    }
    try {
      const result = await exportCalendarIcsToFile(list);
      if (result.status === "canceled") return;
      await showToast(Toast.Style.Success, `已导出 ${result.count} 个日程到 ICS 文件`, result.filePath);
    } catch (err) {
      await showToast(Toast.Style.Failure, "导出 ICS 文件失败", readableError(err));
    }
  };

  const handleCopyIcs = async (list: readonly CalendarEventItem[]) => {
    if (list.length === 0) {
      await showToast(Toast.Style.Failure, "没有可复制的日程", "当前列表为空");
      return;
    }
    try {
      const ics = await exportCalendarIcs(list);
      await Clipboard.copy(ics);
      await showToast(Toast.Style.Success, "已复制 ICS 日历文本", `包含 ${countIcsEvents(ics)} 个日程事件`);
    } catch (err) {
      await showToast(Toast.Style.Failure, "复制 ICS 文本失败", readableError(err));
    }
  };

  const copySummary = async (evt: CalendarEventItem) => {
    const summary = buildEventSummary(evt);
    try {
      await Clipboard.copy(summary);
      await showToast(Toast.Style.Success, "已复制日程摘要", summary);
    } catch (err) {
      await showToast(Toast.Style.Failure, "复制日程摘要失败", readableError(err));
    }
  };

  const truncatedHint = total > events.length ? ` · 仅显示前 ${events.length} 条（共 ${total} 条）` : "";

  const activeEvent = useMemo(
    () => displayedEvents.find((e) => e.id === selectedId) || displayedEvents[0] || null,
    [displayedEvents, selectedId]
  );

  const nextMeeting = useMemo(
    () => events.find((e) => Boolean(e.conferenceUrl)) || events[0] || null,
    [events]
  );

  const summaryText = loadError
    ? events.length > 0
      ? `读取日程失败：${loadError} · 下方是上次读取的结果，可在动作面板选「重新读取日程」`
      : `读取日程失败：${loadError} · 按 Enter 重试`
    : nextMeeting
      ? `日程安排 • 共 ${events.length} 场日程 (视频会议 ${events.filter((e) => Boolean(e.conferenceUrl)).length} 场) | 下一场: ${nextMeeting.title} (${typeof nextMeeting.startAt === "number" ? `${formatDayLabel(nextMeeting.startAt).split(" · ")[0]} ` : ""}${nextMeeting.startTime})${truncatedHint}`
      : `日程安排 • 当前共 ${events.length} 场日程${truncatedHint}`;

  const createForm = <CreateCalendarEventForm onCreated={handleCreated} />;

  /** 与选中日程无关的全局动作，放在动作面板靠后 */
  const globalActions = (
    <ActionPanel.Section title="全部日程">
      <Action.Push
        title="新建日程事件 (Create Event)..."
        icon={Icon.Plus}
        shortcut={{ modifiers: ["ctrl"], key: "n" }}
        target={createForm}
      />
      <Action
        title="导出当前列表为 ICS 文件..."
        icon={Icon.Download}
        shortcut={{ modifiers: ["ctrl"], key: "e" }}
        onAction={() => handleExportFile(displayedEvents)}
      />
      <Action
        title="复制当前列表的 ICS 文本"
        icon={Icon.CopyClipboard}
        onAction={() => handleCopyIcs(displayedEvents)}
      />
      <Action
        title="重新读取日程"
        icon={Icon.RotateClockwise}
        shortcut={{ modifiers: ["ctrl"], key: "r" }}
        onAction={reload}
      />
    </ActionPanel.Section>
  );

  const renderEventActions = (evt: CalendarEventItem) => {
    const itemActions = [
      evt.conferenceUrl ? (
        <Action.OpenInBrowser key="join" title="加入视频会议 (Join Meeting)" url={evt.conferenceUrl} />
      ) : null,
      evt.conferenceUrl ? (
        <Action.CopyToClipboard key="copy-link" title="复制会议链接" icon={Icon.Link} content={evt.conferenceUrl} />
      ) : null,
      <Action
        key="copy-summary"
        title="复制日程摘要"
        icon={Icon.CopyClipboard}
        shortcut={{ modifiers: ["ctrl"], key: "c" }}
        onAction={() => copySummary(evt)}
      />,
      <Action key="export-one" title="导出此日程为 ICS 文件..." icon={Icon.Download} onAction={() => handleExportFile([evt])} />,
      <Action
        key="delete"
        title="删除此日程..."
        icon={Icon.Trash}
        style={Action.Style.Destructive}
        shortcut={{ modifiers: ["ctrl", "shift"], key: "backspace" }}
        onAction={() => handleDelete(evt)}
      />
    ].filter(Boolean);
    return (
      <ActionPanel title={evt.title}>
        <ActionPanel.Section title="此日程">{itemActions}</ActionPanel.Section>
        {globalActions}
      </ActionPanel>
    );
  };

  const renderEventItem = (evt: CalendarEventItem) => {
    const range = formatEventRange(evt);
    const when = formatEventWhen(evt);
    const ended = isEventEnded(evt);
    return (
      <List.Item
        key={evt.id}
        id={evt.id}
        title={evt.title}
        subtitle={evt.location}
        icon={evt.conferenceUrl ? Icon.Video : Icon.Calendar}
        accessories={[
          ...(ended ? [{ tag: "已结束" }] : []),
          { text: evt.calendarName },
          { text: range }
        ]}
        detail={
          <List.Item.Detail
            markdown={[
              `# ${evt.title}`,
              `> **时间**: \`${when}\`${ended ? " （已结束）" : ""} &nbsp;|&nbsp; **日历**: \`${evt.calendarName}\``,
              `---`,
              `- **地点 / 会议室**: ${evt.location || "未指定"}`,
              evt.conferenceUrl ? `- **在线会议直达**: [${evt.conferenceUrl}](${evt.conferenceUrl})` : "",
              evt.invalidConferenceUrl
                ? `- **会议链接（不是 http/https 网址，无法直接打开）**: \`${evt.invalidConferenceUrl.replace(/`/g, "'")}\``
                : "",
              evt.notes ? `### 议程与备注\n${evt.notes}` : "",
              evt.attendees.length > 0
                ? `### 参会人 (${evt.attendees.length})\n` + evt.attendees.map((a) => `- \`${a}\``).join("\n")
                : ""
            ]
              .filter(Boolean)
              .join("\n\n")}
            metadata={
              <List.Item.Detail.Metadata>
                <List.Item.Detail.Metadata.Label title="时间段" text={when} icon={Icon.Clock} />
                <List.Item.Detail.Metadata.Label title="日历分组" text={evt.calendarName} icon={Icon.Calendar} />
                <List.Item.Detail.Metadata.Label title="地点" text={evt.location || "-"} icon={Icon.Globe} />
                {evt.conferenceUrl && (
                  <List.Item.Detail.Metadata.TagList title="会议状态">
                    <List.Item.Detail.Metadata.TagList.Item text="可一键入会 (Join Ready)" color={Color.Green} />
                  </List.Item.Detail.Metadata.TagList>
                )}
              </List.Item.Detail.Metadata>
            }
          />
        }
        actions={renderEventActions(evt)}
      />
    );
  };

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={true}
      searchBarPlaceholder="搜索近期日程、视频会议或创建新事件 (My Schedule & Conferences)..."
      onSearchTextChange={setSearchText}
      onSelectionChange={setSelectedId}
      filterBar={{
        summaryText,
        groups: [
          {
            id: "calendar-scope",
            value: scope,
            onChange: (val) => setScope(val as CalendarFilterScope),
            options: [
              { title: "全部日程", value: "all", count: events.length },
              { title: "即将开始", value: "upcoming", count: events.length },
              {
                title: "视频会议",
                value: "meetings",
                count: events.filter((e) => Boolean(e.conferenceUrl)).length
              }
            ]
          }
        ],
        actions: [
          {
            id: "create-calendar-event",
            label: "新建日程事件...",
            title: "新建日程事件...",
            style: "primary",
            onAction: () => {
              push(createForm);
            }
          },
          {
            id: "export-all-ics",
            label: "导出当前列表 (.ics)",
            title: "导出当前列表 (.ics)",
            style: "secondary",
            onAction: () => handleExportFile(displayedEvents)
          },
          {
            id: "copy-event-summary",
            label: "复制日程摘要",
            title: "复制日程摘要",
            style: "secondary",
            onAction: async () => {
              if (activeEvent) await copySummary(activeEvent);
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
      }}
      searchBarAccessory={
        <List.Dropdown tooltip="筛选日程范围" value={scope} onChange={(val) => setScope(val as CalendarFilterScope)}>
          <List.Dropdown.Item title="全部日程 · 今天起 (All Events)" value="all" icon={Icon.Calendar} />
          <List.Dropdown.Item title="即将开始 (Upcoming Events)" value="upcoming" icon={Icon.Clock} />
          <List.Dropdown.Item title="含视频会议链接 (Video Meetings)" value="meetings" icon={Icon.Video} />
          <List.Dropdown.Item title="历史日程 (Past Events)" value="past" icon={Icon.Clock} />
        </List.Dropdown>
      }
    >
      {displayedEvents.length === 0 ? (
        <List.Section title="日程安排 (My Schedule · 0)">
          {loadError ? (
            <List.Item
              id="calendar-load-error"
              title="读取日程失败，按 Enter 重试"
              subtitle={loadError}
              icon={Icon.ExclamationMark}
              detail={
                <List.Item.Detail markdown={`# 读取日程失败\n\n${loadError}\n\n按 \`Enter\` 重新读取。日程仍保存在本机，没有被删除。`} />
              }
              actions={
                <ActionPanel title="日程管理">
                  <Action title="重新读取日程" icon={Icon.RotateClockwise} onAction={reload} />
                  <Action.Push
                    title="新建日程事件 (Create Event)..."
                    icon={Icon.Plus}
                    shortcut={{ modifiers: ["ctrl"], key: "n" }}
                    target={createForm}
                  />
                </ActionPanel>
              }
            />
          ) : (
            <List.Item
              id="calendar-empty-create"
              title="新建日程事件 (Create Calendar Event)..."
              subtitle="当前暂无日程安排，按 Enter 立即创建新日程或在线会议"
              icon={Icon.Plus}
              detail={
                <List.Item.Detail
                  markdown={`# 暂无日程事件\n\n按 \`Enter\` 即可新建工作日程、会议室预约或视频会议直达链接。`}
                />
              }
              actions={
                <ActionPanel title="日程管理">
                  <Action.Push
                    title="新建日程事件 (Create Event)..."
                    icon={Icon.Plus}
                    shortcut={{ modifiers: ["ctrl"], key: "n" }}
                    target={createForm}
                  />
                </ActionPanel>
              }
            />
          )}
        </List.Section>
      ) : (
        sections.map((section) => (
          <List.Section key={section.key} title={`${section.title} · ${section.events.length} 场`}>
            {section.events.map(renderEventItem)}
          </List.Section>
        ))
      )}
    </List>
  );
}

export default CalendarCommand;
