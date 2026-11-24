/**
 * Calendar (极客日程表、视频会议直达与 ICS 日历中枢)
 *
 * 深度对齐 Raycast 官方 `calendar` (`My Schedule` & `Create Event`)：
 * - 双栏展示今日与近期日程 (Upcoming Events)、会议室链接 (Zoom / Feishu / Teams / Google Meet) 一键直达
 * - 支持通过 <Form> 快速新建日程 (Create Event)、删除日程与一键导出标准 RFC 5545 `.ics` 日历文件
 * - 对接主进程 `calendar_upcoming_events`, `calendar_list_events`, `calendar_create_event`, `calendar_delete_event`, `calendar_export_ics` IPC
 */
export type CalendarFilterScope = "all" | "upcoming" | "meetings" | "today";
export interface CalendarEventItem {
    readonly id: string;
    readonly title: string;
    readonly startTime: string;
    readonly endTime: string;
    readonly location: string;
    readonly conferenceUrl?: string;
    readonly calendarName: string;
    readonly notes: string;
    readonly attendees: readonly string[];
    readonly isAllDay?: boolean;
}
export declare const DEFAULT_CALENDAR_EVENTS: readonly CalendarEventItem[];
/**
 * 生成符合 RFC 5545 规范的 iCalendar (.ics) 文本
 */
export declare function buildCalendarIcsContent(events: readonly CalendarEventItem[]): string;
export declare function fetchCalendarEvents(scope?: CalendarFilterScope, hostOverride?: unknown): Promise<CalendarEventItem[]>;
export declare function createCalendarEvent(input: {
    title: string;
    startTime: string;
    endTime: string;
    location?: string;
    conferenceUrl?: string;
    calendarName?: string;
    notes?: string;
}, hostOverride?: unknown): Promise<CalendarEventItem>;
export declare function deleteCalendarEvent(id: string, hostOverride?: unknown): Promise<boolean>;
export declare function exportCalendarIcs(events?: readonly CalendarEventItem[], hostOverride?: unknown): Promise<string>;
export declare function CreateCalendarEventForm({ onCreated }: {
    onCreated?: (evt: CalendarEventItem) => void;
}): JSX.Element;
export declare function CalendarCommand(): JSX.Element;
export default CalendarCommand;
