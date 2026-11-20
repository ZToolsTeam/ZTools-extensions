/**
 * Calendar (极客日程表、视频会议直达与 ICS 日历中枢)
 *
 * 包含「我的日程」与「新建日程」两部分：
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
  useNavigation,
  useLocale
} from "@ztools/declarative-ui";
import { useState, useEffect, useMemo, useRef } from "@ztools/declarative-ui";
import { callHostTransport, isRealElectronHost } from "./native-ipc.js";
import { t } from "./i18n.js";

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

export const NOT_IN_CLIENT_MESSAGE = t("notInClient");

// 本次会话里经宿主新建 / 删除后的日程缓存（不含任何示例数据）
let memoryCalendarEvents: CalendarEventItem[] = [];

// ---------------------------------------------------------------------------
// 日期与时间
// ---------------------------------------------------------------------------

function getWeekday(dayIndex: number): string {
  const keys = ["weekday0", "weekday1", "weekday2", "weekday3", "weekday4", "weekday5", "weekday6"] as const;
  return t(keys[dayIndex] ?? "weekday0");
}
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
  const date = t("dateFormat", {
    year: sameYear ? "" : t("yearSuffix", { y: d.getFullYear() }),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: getWeekday(d.getDay())
  });
  const diffDays = Math.round((startOfDay(ms) - startOfDay(now)) / DAY_MS);
  if (diffDays === 0) return t("todayLabel", { date });
  if (diffDays === 1) return t("tomorrowLabel", { date });
  if (diffDays === -1) return t("yesterdayLabel", { date });
  return date;
}

/** 列表行右侧的时间段：同一天只显示时分，跨天时结束时间带日期 */
export function formatEventRange(evt: CalendarEventItem): string {
  if (evt.isAllDay) return t("allDay");
  if (typeof evt.startAt === "number" && typeof evt.endAt === "number") {
    const sameDay = formatDateKey(evt.startAt) === formatDateKey(evt.endAt);
    if (sameDay) return `${formatClock(evt.startAt)} - ${formatClock(evt.endAt)}`;
    const end = new Date(evt.endAt);
    return t("rangeCrossDay", {
      start: formatClock(evt.startAt),
      month: end.getMonth() + 1,
      day: end.getDate(),
      end: formatClock(evt.endAt)
    });
  }
  return `${evt.startTime} - ${evt.endTime}`;
}

/** 带日期的完整时间，用于摘要、详情与提示 */
export function formatEventWhen(evt: CalendarEventItem): string {
  if (typeof evt.startAt !== "number") return formatEventRange(evt);
  const start = new Date(evt.startAt);
  const day = `${formatDateKey(evt.startAt)} ${getWeekday(start.getDay())}`;
  if (evt.isAllDay) return t("whenAllDay", { day });
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
      errors[field] = t("errRequiredField", { label });
      return null;
    }
    const withDate = text.match(DATE_TIME_RE);
    const day = withDate ? parseDate(withDate[1]) : baseDate;
    const clock = parseClock(withDate ? withDate[2] : text);
    if (!clock || (withDate && !day)) {
      errors[field] = t("errClockFormat", { label });
      return null;
    }
    if (!day) {
      errors.date = dateText ? t("errDateFormat") : t("errDateRequired");
      return null;
    }
    const at = new Date(day.y, day.m - 1, day.d, clock.h, clock.min, 0, 0);
    // 夏令时开始那天被跳过的时刻（如 02:30）会被系统顺延一小时，不能悄悄存成别的时间
    if (at.getDate() !== day.d || at.getHours() !== clock.h || at.getMinutes() !== clock.min) {
      errors[field] = t("errDstMissingTime", { label });
      return null;
    }
    return at.getTime();
  };

  const startAt = resolve("startTime", t("labelStartTime"));
  const endAt = resolve("endTime", t("labelEndTime"));
  if (startAt !== null && endAt !== null && endAt <= startAt) {
    errors.endTime = t("errEndBeforeStart");
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
  const invalid = t("errConfUrlInvalid");
  if (/\s/.test(text)) return { error: invalid };
  const schemeMatch = text.match(/^([a-z][a-z0-9+.-]*):(?!\d)/i);
  const candidate = schemeMatch ? text : `https://${text}`;
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1])) {
    return { error: t("errConfUrlScheme", { scheme: schemeMatch[1] }) };
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { error: invalid };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: invalid };
  if (parsed.username || parsed.password) return { error: t("errConfUrlAuth") };
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
  if (!(values.title || "").trim()) errors.title = t("errTitleRequired");
  const times = parseEventTimes(values);
  if (!times.ok) Object.assign(errors, times.errors);
  const url = normalizeConferenceUrl(values.conferenceUrl);
  if (url.error) errors.conferenceUrl = url.error;
  return errors;
}

/** 去掉错误信息前的错误码前缀，只给用户看原因 */
function readableError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return text.replace(/^[A-Z][A-Z0-9_]+:\s*/, "") || t("errUnknown");
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

/** 宿主返回的原始日程对象，字段名随宿主版本不同 */
type HostRecord = Record<string, unknown>;

/** 等同于 `data?.[key]`：宿主数据为 null / undefined 时返回 undefined */
function hostField(data: unknown, key: string): unknown {
  return data == null ? undefined : (data as HostRecord)[key];
}

function mapHostEvent(input: unknown, idx: number): CalendarEventItem {
  const e = input as HostRecord;
  const attendees = e.attendees;
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
    attendees: Array.isArray(attendees) ? attendees.map(String) : [],
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
  hostOverride?: unknown
): Promise<CalendarPage> {
  if (hostOverride || isRealElectronHost()) {
    const useUpcoming = scope === "upcoming";
    const query = useUpcoming ? { scope } : buildCalendarQuery(scope, search);
    const res = useUpcoming
      ? await callHostTransport<unknown>("calendar_upcoming_events", query, hostOverride)
      : await callHostTransport<unknown>("calendar_list_events", { ...query, limit: CALENDAR_PAGE_LIMIT }, hostOverride);
    const listedEvents = hostField(res.data, "events");
    const rawList: unknown[] | null = Array.isArray(res.data)
      ? res.data
      : Array.isArray(listedEvents)
        ? listedEvents
        : null;
    if (!res.ok || !rawList) {
      throw new Error(`LOAD_EVENTS_FAILED: ${res.ok ? t("errHostFormatUnrecognized") : res.error || t("errHostLoadFailed")}`);
    }
    const events: CalendarEventItem[] = rawList.map(mapHostEvent);
    let total = events.length;
    if (!useUpcoming) {
      try {
        // 计数只按筛选条件，不带排序
        const { order: _order, ...countQuery } = query as Record<string, unknown>;
        const countRes = await callHostTransport<unknown>("calendar_count_events", countQuery, hostOverride);
        const counted = Number(countRes.ok ? hostField(countRes.data, "total") : NaN);
        if (Number.isInteger(counted) && counted >= events.length) total = counted;
      } catch {
        // 旧宿主没有计数接口：总数按已加载数量
      }
    }
    return { events, total, searchedOnHost: !useUpcoming && Boolean(search.trim()) };
  }
  // 日程保存在客户端的本机数据库里，没有客户端时不能显示示例日程冒充
  throw new Error(`NOT_IN_CLIENT: ${t("notInClient")}`);
}

export async function fetchCalendarEvents(
  scope: CalendarFilterScope = "all",
  hostOverride?: unknown
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
  hostOverride?: unknown
): Promise<CalendarEventItem> {
  const cleanTitle = (input.title || "").trim();
  if (!cleanTitle) {
    throw new Error(t("errEventTitleRequired"));
  }
  const times = parseEventTimes(input);
  if (!times.ok) {
    const first = Object.values(times.errors)[0] || t("errInvalidTimeFallback");
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
    const res = await callHostTransport<HostRecord>("calendar_create_event", payload, hostOverride);
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
    throw new Error(`CREATE_EVENT_FAILED: ${res.error || t("errCreateNoId")}`);
  }

  // 没有客户端时无处保存，不能只存在内存里提示「已创建」
  throw new Error(`NOT_IN_CLIENT: ${t("notInClient")}`);
}

export async function deleteCalendarEvent(id: string, hostOverride?: unknown): Promise<boolean> {
  const cleanId = (id || "").trim();
  if (!cleanId) return false;
  if (hostOverride || isRealElectronHost()) {
    const res = await callHostTransport("calendar_delete_event", { id: cleanId }, hostOverride);
    if (!res.ok) return false;
    memoryCalendarEvents = memoryCalendarEvents.filter((e) => e.id !== cleanId);
    return true;
  }
  return false;
}

/**
 * 生成 ICS 文本。有宿主时由宿主按日程 id 生成；宿主失败直接抛错（EXPORT_ICS_FAILED），
 * 不能退回一份缺时间的本地 ICS 还提示成功。没有宿主时用本地生成。
 */
export async function exportCalendarIcs(
  events: readonly CalendarEventItem[] = memoryCalendarEvents,
  hostOverride?: unknown
): Promise<string> {
  if (hostOverride || isRealElectronHost()) {
    const res = await callHostTransport<unknown>("calendar_export_ics", { eventIds: events.map((e) => e.id) }, hostOverride);
    if (!res.ok) throw new Error(`EXPORT_ICS_FAILED: ${res.error || t("errExportFailed")}`);
    const ics = typeof res.data === "string" ? res.data : hostField(res.data, "ics");
    if (typeof ics !== "string" || !ics.includes("BEGIN:VCALENDAR")) {
      throw new Error(t("errExportNotIcs"));
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
  hostOverride?: unknown
): Promise<IcsFileExportResult> {
  if (!hostOverride && !isRealElectronHost()) {
    throw new Error(t("errExportNotSupported"));
  }
  const ics = await exportCalendarIcs(events, hostOverride);
  const picked = await callHostTransport<{ filePath?: unknown; canceled?: unknown }>(
    "window_show_save_dialog",
    { title: t("saveIcsTitle"), defaultName: defaultIcsFileName(events), filters: t("saveIcsFilter") },
    hostOverride
  );
  if (!picked.ok) throw new Error(`SAVE_DIALOG_FAILED: ${picked.error || t("errSaveDialogFailed")}`);
  const pickedPath = picked.data?.filePath;
  const filePath = typeof pickedPath === "string" ? pickedPath : "";
  if (picked.data?.canceled || !filePath) return { status: "canceled" };
  const written = await callHostTransport<unknown>(
    "filesystem_write_file",
    { path: filePath, content: ics, encoding: "utf8" },
    hostOverride
  );
  if (!written.ok) throw new Error(`WRITE_FILE_FAILED: ${written.error || t("errWriteFileFailed")}`);
  return { status: "saved", filePath, count: countIcsEvents(ics) };
}

// ---------------------------------------------------------------------------
// 界面
// ---------------------------------------------------------------------------

export function CreateCalendarEventForm({ onCreated }: { onCreated?: (evt: CalendarEventItem) => void }) {
  useLocale();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => formatDateKey(Date.now()));
  const [startTime, setStartTime] = useState("15:00");
  const [endTime, setEndTime] = useState("16:00");
  const [calendarName, setCalendarName] = useState("Work");
  const [location, setLocation] = useState("");
  const [conferenceUrl, setConferenceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
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
    // 连按 ⌘Enter 不能重复创建；保存中途按 Esc 离开后，迟到的结果不能再弹回或关掉列表页
    if (savingRef.current) return;
    const found = validateEventForm({ title, date, startTime, endTime, conferenceUrl });
    setErrors(found);
    const firstError = Object.values(found)[0];
    if (firstError) {
      await showToast(Toast.Style.Failure, t("formFixRedFields"), firstError);
      return;
    }
    savingRef.current = true;
    setSaving(true);
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
      await showToast(Toast.Style.Success, t("toastCreatedTitle", { title: created.title }), formatEventWhen(created));
      if (alive.current) pop();
    } catch (err: unknown) {
      if (!alive.current) return;
      const fieldErrors = err != null ? (err as { fieldErrors?: EventFormErrors }).fieldErrors : undefined;
      if (fieldErrors) setErrors(fieldErrors);
      await showToast(Toast.Style.Failure, t("toastCreateFailed"), readableError(err));
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };

  return (
    <Form
      navigationTitle={t("formNavTitle")}
      isLoading={saving}
      actions={
        <ActionPanel>
          <Action title={t("actionSaveEvent")} icon={Icon.Check} onAction={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title={t("fieldTitleLabel")}
        placeholder={t("fieldTitlePlaceholder")}
        value={title}
        error={errors.title}
        onChange={(v: string) => {
          setTitle(v);
          clearErrors("title");
        }}
      />
      <Form.TextField
        id="date"
        title={t("fieldDateLabel")}
        placeholder="YYYY-MM-DD"
        info={t("fieldDateInfo")}
        value={date}
        error={errors.date}
        onChange={(v: string) => {
          setDate(v);
          clearErrors(...timeFields);
        }}
      />
      <Form.TextField
        id="startTime"
        title={t("fieldStartTimeLabel")}
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
        title={t("fieldEndTimeLabel")}
        placeholder="16:00"
        info={t("fieldEndTimeInfo")}
        value={endTime}
        error={errors.endTime}
        onChange={(v: string) => {
          setEndTime(v);
          clearErrors(...timeFields);
        }}
      />
      <Form.Dropdown id="calendarName" title={t("fieldCalendarLabel")} value={calendarName} onChange={setCalendarName}>
        <Form.Dropdown.Item value="Work" title={t("calWork")} />
        <Form.Dropdown.Item value="Engineering" title={t("calEngineering")} />
        <Form.Dropdown.Item value="Personal" title={t("calPersonal")} />
      </Form.Dropdown>
      <Form.TextField
        id="location"
        title={t("fieldLocationLabel")}
        placeholder={t("fieldLocationPlaceholder")}
        value={location}
        onChange={setLocation}
      />
      <Form.TextField
        id="conferenceUrl"
        title={t("fieldConfUrlLabel")}
        placeholder="https://vc.feishu.cn/j/..."
        info={t("fieldConfUrlInfo")}
        value={conferenceUrl}
        error={errors.conferenceUrl}
        onChange={(v: string) => {
          setConferenceUrl(v);
          clearErrors("conferenceUrl");
        }}
      />
      <Form.TextArea
        id="notes"
        title={t("fieldNotesLabel")}
        placeholder={t("fieldNotesPlaceholder")}
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
      section = { key, title: typeof evt.startAt === "number" ? formatDayLabel(evt.startAt, now) : t("sectionScheduleFallback"), events: [] };
      sections.push(section);
    }
    section.events.push(evt);
  }
  return sections;
}

export function CalendarCommand() {
  useLocale();
  const realHost = isRealElectronHost();
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [searchedOnHost, setSearchedOnHost] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [scope, setScope] = useState<CalendarFilterScope>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(realHost);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);

  // 「即将开始」只在本地过滤搜索词，不随输入重新请求宿主
  const hostSearch = scope === "upcoming" ? "" : searchText.trim();

  useEffect(() => {
    if (!realHost) return;
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
          void showToast(Toast.Style.Failure, t("toastLoadFailed"), reason);
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
      title: t("confirmDeleteTitle", { title: evt.title }),
      message: t("confirmDeleteMsg", { when: formatEventWhen(evt) }),
      primaryAction: { title: t("actionDelete"), style: "destructive" },
      dismissAction: { title: t("actionCancel") }
    });
    if (!confirmed) return;
    const ok = await deleteCalendarEvent(evt.id);
    if (!ok) {
      await showToast(Toast.Style.Failure, t("toastDeleteFailed"), evt.title);
      return;
    }
    setEvents((prev) => prev.filter((item) => item.id !== evt.id));
    setTotal((prev) => Math.max(0, prev - 1));
    await showToast(Toast.Style.Success, t("toastDeleted", { title: evt.title }));
  };

  // 新建后按当前范围与搜索词重新读取：本地插入会把一周后的日程塞进「即将开始」、把不匹配的日程塞进搜索结果
  const handleCreated = () => reload();

  const handleExportFile = async (list: readonly CalendarEventItem[]) => {
    if (list.length === 0) {
      await showToast(Toast.Style.Failure, t("noExportableTitle"), t("emptyListMsg"));
      return;
    }
    try {
      const result = await exportCalendarIcsToFile(list);
      if (result.status === "canceled") return;
      await showToast(Toast.Style.Success, t("toastExportedTitle", { count: result.count }), result.filePath);
    } catch (err) {
      await showToast(Toast.Style.Failure, t("toastExportFailedTitle"), readableError(err));
    }
  };

  const handleCopyIcs = async (list: readonly CalendarEventItem[]) => {
    if (list.length === 0) {
      await showToast(Toast.Style.Failure, t("noCopyableTitle"), t("emptyListMsg"));
      return;
    }
    try {
      const ics = await exportCalendarIcs(list);
      await Clipboard.copy(ics);
      await showToast(Toast.Style.Success, t("toastCopiedIcsTitle"), t("toastCopiedIcsMsg", { count: countIcsEvents(ics) }));
    } catch (err) {
      await showToast(Toast.Style.Failure, t("toastCopyIcsFailed"), readableError(err));
    }
  };

  const copySummary = async (evt: CalendarEventItem) => {
    const summary = buildEventSummary(evt);
    try {
      await Clipboard.copy(summary);
      await showToast(Toast.Style.Success, t("toastCopiedSummary"), summary);
    } catch (err) {
      await showToast(Toast.Style.Failure, t("toastCopySummaryFailed"), readableError(err));
    }
  };

  const truncatedHint = total > events.length ? t("truncatedHint", { shown: events.length, total }) : "";

  const activeEvent = useMemo(
    () => displayedEvents.find((e) => e.id === selectedId) || displayedEvents[0] || null,
    [displayedEvents, selectedId]
  );

  // 「下一场」是最早的未结束日程；「历史日程」里没有下一场
  const nextMeeting = useMemo(() => {
    if (scope === "past") return null;
    const now = Date.now();
    let best: CalendarEventItem | null = null;
    for (const e of events) {
      if (isEventEnded(e, now)) continue;
      if (!best || (typeof e.startAt === "number" && typeof best.startAt === "number" && e.startAt < best.startAt)) best = e;
    }
    return best;
  }, [events, scope]);

  if (!realHost) {
    return (
      <List searchBarPlaceholder={t("searchPlaceholderShort")}>
        <List.Section title={t("sectionSchedule")}>
          <List.Item
            id="calendar-client-required"
            title={t("notInClient")}
            subtitle={t("clientRequiredSub")}
            icon={Icon.Info}
          />
        </List.Section>
      </List>
    );
  }

  const summaryText = loadError
    ? events.length > 0
      ? t("summaryLoadErrKeep", { error: loadError })
      : t("summaryLoadErrEmpty", { error: loadError })
    : nextMeeting
      ? t("summaryWithNext", {
          total: events.length,
          meetings: events.filter((e) => Boolean(e.conferenceUrl)).length,
          title: nextMeeting.title,
          when: `${typeof nextMeeting.startAt === "number" ? `${formatDayLabel(nextMeeting.startAt).split(" · ")[0]} ` : ""}${nextMeeting.startTime}`,
          truncated: truncatedHint
        })
      : t("summaryNoNext", { total: events.length, truncated: truncatedHint });

  const createForm = <CreateCalendarEventForm onCreated={handleCreated} />;

  /** 与选中日程无关的全局动作，放在动作面板靠后 */
  const globalActions = (
    <ActionPanel.Section title={t("sectionAllEvents")}>
      <Action.Push
        title={t("actionNewEvent")}
        icon={Icon.Plus}
        shortcut={{ modifiers: ["ctrl"], key: "n" }}
        target={createForm}
      />
      <Action
        title={t("actionExportListIcs")}
        icon={Icon.Download}
        shortcut={{ modifiers: ["ctrl"], key: "e" }}
        onAction={() => handleExportFile(displayedEvents)}
      />
      <Action
        title={t("actionCopyListIcs")}
        icon={Icon.CopyClipboard}
        onAction={() => handleCopyIcs(displayedEvents)}
      />
      <Action
        title={t("actionReload")}
        icon={Icon.RotateClockwise}
        onAction={reload}
      />
    </ActionPanel.Section>
  );

  const renderEventActions = (evt: CalendarEventItem) => {
    const itemActions = [
      evt.conferenceUrl ? (
        <Action.OpenInBrowser key="join" title={t("actionJoinMeeting")} url={evt.conferenceUrl} />
      ) : null,
      evt.conferenceUrl ? (
        <Action.CopyToClipboard key="copy-link" title={t("actionCopyMeetingLink")} icon={Icon.Link} content={evt.conferenceUrl} />
      ) : null,
      <Action
        key="copy-summary"
        title={t("actionCopySummary")}
        icon={Icon.CopyClipboard}
        shortcut={{ modifiers: ["ctrl"], key: "c" }}
        onAction={() => copySummary(evt)}
      />,
      <Action key="export-one" title={t("actionExportOneIcs")} icon={Icon.Download} onAction={() => handleExportFile([evt])} />,
      <Action
        key="delete"
        title={t("actionDeleteOne")}
        icon={Icon.Trash}
        style={Action.Style.Destructive}
        shortcut={{ modifiers: ["ctrl", "shift"], key: "backspace" }}
        onAction={() => handleDelete(evt)}
      />
    ].filter(Boolean);
    return (
      <ActionPanel title={evt.title}>
        <ActionPanel.Section title={t("sectionThisEvent")}>{itemActions}</ActionPanel.Section>
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
          ...(ended ? [{ tag: t("tagEnded") }] : []),
          { text: evt.calendarName },
          { text: range }
        ]}
        detail={
          <List.Item.Detail
            markdown={[
              `# ${evt.title}`,
              `> **${t("mdTime")}**: \`${when}\`${ended ? t("mdEndedSuffix") : ""} &nbsp;|&nbsp; **${t("mdCalendar")}**: \`${evt.calendarName}\``,
              `---`,
              `- **${t("mdLocation")}**: ${evt.location || t("mdUnspecified")}`,
              evt.conferenceUrl ? `- **${t("mdOnlineMeeting")}**: [${evt.conferenceUrl}](${evt.conferenceUrl})` : "",
              evt.invalidConferenceUrl
                ? `- **${t("mdInvalidMeetingUrl")}**: \`${evt.invalidConferenceUrl.replace(/`/g, "'")}\``
                : "",
              evt.notes ? `### ${t("mdNotesTitle")}\n${evt.notes}` : "",
              evt.attendees.length > 0
                ? `### ${t("mdAttendeesTitle", { count: evt.attendees.length })}\n` + evt.attendees.map((a) => `- \`${a}\``).join("\n")
                : ""
            ]
              .filter(Boolean)
              .join("\n\n")}
            metadata={
              <List.Item.Detail.Metadata>
                <List.Item.Detail.Metadata.Label title={t("metaTimeSpan")} text={when} icon={Icon.Clock} />
                <List.Item.Detail.Metadata.Label title={t("metaCalendar")} text={evt.calendarName} icon={Icon.Calendar} />
                <List.Item.Detail.Metadata.Label title={t("metaLocation")} text={evt.location || "-"} icon={Icon.Globe} />
                {evt.conferenceUrl && (
                  <List.Item.Detail.Metadata.TagList title={t("metaMeetingStatus")}>
                    <List.Item.Detail.Metadata.TagList.Item text={t("metaCanJoin")} />
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
      searchBarPlaceholder={t("searchPlaceholder")}
      onSearchTextChange={setSearchText}
      onSelectionChange={setSelectedId}
      filterBar={{
        summaryText,
        actions: [
          {
            id: "export-all-ics",
            label: t("btnExportIcs"),
            title: t("btnExportIcs"),
            style: "secondary",
            onAction: () => handleExportFile(displayedEvents)
          },
        ]
      }}
      searchBarAccessory={
        <List.Dropdown tooltip={t("dropdownTooltip")} value={scope} onChange={(val) => setScope(val as CalendarFilterScope)}>
          <List.Dropdown.Item title={t("scopeAll")} value="all" icon={Icon.Calendar} />
          <List.Dropdown.Item title={t("scopeUpcoming")} value="upcoming" icon={Icon.Clock} />
          <List.Dropdown.Item title={t("scopeMeetings")} value="meetings" icon={Icon.Video} />
          <List.Dropdown.Item title={t("scopePast")} value="past" icon={Icon.Clock} />
        </List.Dropdown>
      }
    >
      {displayedEvents.length === 0 ? (
        <List.Section title={t("emptySectionTitle")}>
          {loadError ? (
            <List.Item
              id="calendar-load-error"
              title={t("loadErrorTitle")}
              subtitle={loadError}
              icon={Icon.ExclamationMark}
              detail={
                <List.Item.Detail markdown={t("loadErrorMd", { error: loadError })} />
              }
              actions={
                <ActionPanel title={t("panelManageTitle")}>
                  <Action title={t("actionReload")} icon={Icon.RotateClockwise} onAction={reload} />
                  <Action.Push
                    title={t("actionNewEvent")}
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
              title={t("actionNewEvent")}
              subtitle={t("emptyCreateSub")}
              icon={Icon.Plus}
              detail={
                <List.Item.Detail
                  markdown={t("emptyCreateMd")}
                />
              }
              actions={
                <ActionPanel title={t("panelManageTitle")}>
                  <Action.Push
                    title={t("actionNewEvent")}
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
          <List.Section key={section.key} title={t("daySectionTitle", { title: section.title, count: section.events.length })}>
            {section.events.map(renderEventItem)}
          </List.Section>
        ))
      )}
    </List>
  );
}

export default CalendarCommand;
