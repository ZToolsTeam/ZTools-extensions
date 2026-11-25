import type { CountdownCategory, CountdownItem, EnrichedCountdownItem, PomodoroPhase, PomodoroState } from './types.js';
export declare const FOCUS_DURATION_MS: number;
export declare const SHORT_BREAK_DURATION_MS: number;
export declare const LONG_BREAK_DURATION_MS: number;
export declare const DEFAULT_COUNTDOWNS: CountdownItem[];
export declare function formatRemainingMmSs(remainingMs: number): string;
/**
 * 基于真实物理时间戳 (Date.now() - startTime) 的防休眠漂移番茄工作钟内核
 */
export declare class PomodoroTimerEngine {
    #private;
    constructor(initialState?: Partial<PomodoroState>, onNotification?: (title: string, body: string, nextPhase: PomodoroPhase) => void);
    getState(): PomodoroState;
    startFocus(nowMs?: number, durationMs?: number): PomodoroState;
    pause(nowMs?: number): PomodoroState;
    resume(nowMs?: number): PomodoroState;
    reset(): PomodoroState;
    getRemainingMs(nowMs?: number): number;
    /**
     * 推进时钟状态：若倒计时归零，自动流转至下一阶段并触发原生系统通知回调
     */
    tick(nowMs?: number): {
        state: PomodoroState;
        remainingMs: number;
        transitioned: boolean;
    };
}
export declare function validateCountdownInput(input: {
    title: string;
    targetDate: string;
    category?: CountdownCategory;
}): {
    valid: boolean;
    error?: string;
};
/**
 * 计算倒数天数，支持按月循环日程（如每月 31 号发薪日在 2 月自动对齐至 28/29 号，绝不产生 NaN 或越界）
 */
export declare function calculateDaysLeft(targetDate: string, isRecurring?: boolean, referenceDate?: Date | string): {
    days: number;
    text: string;
    resolvedDate: string;
};
export declare function enrichAndSortCountdowns(items: CountdownItem[], referenceDate?: Date | string): EnrichedCountdownItem[];
