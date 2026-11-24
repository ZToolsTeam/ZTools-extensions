import { CleanDurationPreset, CleaningStats, EmergencyShortcutConfig, KeyboardLockActionResult, KeyboardLockState, LockKeyboardOptions, ShortcutModifier, UnlockReason } from './types.js';
export declare const CLEAN_KEYBOARD_STATS_KEY = "ztools.clean-keyboard.stats.v1";
export declare const CLEAN_KEYBOARD_SHORTCUT_KEY = "ztools.clean-keyboard.shortcut.v1";
export declare const CLEAN_DURATION_PRESETS: readonly CleanDurationPreset[];
export declare const DEFAULT_EMERGENCY_SHORTCUT: EmergencyShortcutConfig;
export declare function formatCleanDuration(seconds: number | null | undefined): string;
export declare class KeyboardLockManager {
    private state;
    private mutexBusy;
    private watchdogTimer;
    private domListenerAttached;
    private lastHostOverride;
    private history;
    private totalCleanedSeconds;
    private totalBlockedKeystrokes;
    private lastCleanedAt;
    private readonly domKeyInterceptor;
    constructor();
    private hydrateFromStorage;
    private attachDomInterceptor;
    private detachDomInterceptor;
    getState(): KeyboardLockState;
    getStats(): CleaningStats;
    private clearWatchdog;
    lockKeyboard(durationSeconds: number | null | undefined, options?: LockKeyboardOptions): Promise<KeyboardLockActionResult>;
    unlockKeyboard(reason?: UnlockReason, hostOverride?: unknown): Promise<KeyboardLockActionResult>;
    interceptKeystroke(key: string, modifiers?: ShortcutModifier[]): Promise<{
        blocked: boolean;
        unlocked: boolean;
        state: KeyboardLockState;
    }>;
    tick(stepSeconds?: number): Promise<KeyboardLockState>;
    updateEmergencyShortcut(modifiers: ShortcutModifier[], key: string): Promise<KeyboardLockActionResult>;
    private persistStats;
    resetAll(): Promise<void>;
}
export declare const defaultKeyboardLockManager: KeyboardLockManager;
