/**
 * Raycast Focus (极客心流专注时钟与分心应用/站点屏蔽工作台)
 *
 * 深度对齐 Raycast 官方 `raycast-focus` 套件：
 * - 支持开启专注会话 (Start Focus Session)、暂停/恢复、完成结算与中途取消
 * - 支持专注分类管理 (Deep Coding / Writing / Design / Reading) 与屏蔽应用/域名规则配置
 * - 对接主进程 `focus_start`, `focus_toggle`, `focus_pause`, `focus_resume`, `focus_complete`,
 *   `focus_cancel`, `focus_get_current`, `focus_list_categories`, `focus_create_category`, `focus_get_stats` IPC
 */
export type FocusSessionState = "idle" | "active" | "paused" | "completed";
export interface FocusCategory {
    readonly id: string;
    readonly name: string;
    readonly icon: string;
    readonly defaultDurationMinutes: number;
    readonly blockedApps: readonly string[];
    readonly blockedSites: readonly string[];
}
export interface FocusSession {
    readonly id: string;
    readonly goal: string;
    readonly categoryId: string;
    readonly categoryName: string;
    readonly durationMinutes: number;
    readonly remainingSeconds: number;
    readonly status: FocusSessionState;
    readonly startedAt: number;
    readonly blockedApps: readonly string[];
    readonly blockedSites: readonly string[];
}
export interface FocusStatsSummary {
    readonly completedSessions: number;
    readonly totalFocusedMinutes: number;
    readonly currentStreakDays: number;
    readonly blockedDistractionsCount: number;
}
export declare const DEFAULT_FOCUS_CATEGORIES: readonly FocusCategory[];
export declare function getFocusCurrentSession(hostOverride?: unknown): Promise<FocusSession | null>;
export declare function listFocusCategories(hostOverride?: any): Promise<FocusCategory[]>;
export declare function getFocusStats(hostOverride?: any): Promise<FocusStatsSummary>;
export declare function startFocusSession(params: {
    goal: string;
    categoryId?: string;
    durationMinutes?: number;
}, hostOverride?: any): Promise<FocusSession>;
export declare function controlFocusSession(action: "toggle" | "pause" | "resume" | "complete" | "cancel", hostOverride?: any): Promise<{
    ok: boolean;
    session: FocusSession | null;
    message: string;
}>;
export declare function createFocusCategory(input: {
    name: string;
    defaultDurationMinutes: number;
    blockedApps?: string[];
    blockedSites?: string[];
}, hostOverride?: any): Promise<FocusCategory>;
export declare function formatRemainingTime(remainingSeconds: number): string;
export declare const getFocusStatus: typeof getFocusCurrentSession;
export declare const pauseFocusSession: (hostOverride?: any) => Promise<{
    ok: boolean;
    session: FocusSession | null;
    message: string;
}>;
export declare const resumeFocusSession: (hostOverride?: any) => Promise<{
    ok: boolean;
    session: FocusSession | null;
    message: string;
}>;
export declare const completeFocusSession: (hostOverride?: any) => Promise<{
    ok: boolean;
    session: FocusSession | null;
    message: string;
}>;
export declare function CreateFocusCategoryForm({ onCreated }: {
    onCreated?: (cat: FocusCategory) => void;
}): JSX.Element;
export declare function RaycastFocusCommand(): JSX.Element;
export default RaycastFocusCommand;
