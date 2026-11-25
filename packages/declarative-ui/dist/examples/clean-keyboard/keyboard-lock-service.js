import { LocalStorage } from '../../index.js';
import { callHostTransport, invokePluginService, isRealElectronHost } from '../shared/native-ipc.js';
export const CLEAN_KEYBOARD_STATS_KEY = 'ztools.clean-keyboard.stats.v1';
export const CLEAN_KEYBOARD_SHORTCUT_KEY = 'ztools.clean-keyboard.shortcut.v1';
export const CLEAN_DURATION_PRESETS = Object.freeze([
    {
        id: 'preset-15s',
        display: '15 seconds',
        title: '15 秒 (快速擦拭)',
        subtitle: '适合用气吹或毛刷快速扫除表面浮尘',
        seconds: 15,
        icon: '15s',
        recommended: true
    },
    {
        id: 'preset-30s',
        display: '30 seconds',
        title: '30 秒 (标准清洁)',
        subtitle: '适合使用湿巾擦拭键帽与触控板',
        seconds: 30,
        icon: '30s',
        recommended: true
    },
    {
        id: 'preset-60s',
        display: '1 minute',
        title: '1 分钟 (深度清洁)',
        subtitle: '适合仔细擦拭全键盘每个角落与屏幕',
        seconds: 60,
        icon: '1m'
    },
    {
        id: 'preset-120s',
        display: '2 minutes',
        title: '2 分钟 (键帽缝隙清理)',
        subtitle: '适合使用清洁泥与酒精棉片清理键帽缝隙',
        seconds: 120,
        icon: '2m'
    },
    {
        id: 'preset-300s',
        display: '5 minutes',
        title: '5 分钟 (拔键帽大扫除)',
        subtitle: '适合局部拆卸键帽清理轴体周围灰尘',
        seconds: 300,
        icon: '5m'
    },
    {
        id: 'preset-3600s',
        display: '1 hour',
        title: '1 小时 (防宠物/猫咪踩踏模式)',
        subtitle: '临时离开座位，防止家猫踩踏键盘误发消息',
        seconds: 3600,
        icon: '1h'
    },
    {
        id: 'preset-86400s',
        display: '24 hours',
        title: '24 小时 (全天锁定)',
        subtitle: '长时间外接展示或展览模式',
        seconds: 86400,
        icon: '24h'
    },
    {
        id: 'preset-forever',
        display: 'Forever',
        title: '无限期锁定 (手动按 Ctrl+U 解锁)',
        subtitle: '保持锁定直到按下紧急解锁组合键',
        seconds: undefined,
        icon: 'forever'
    }
]);
export const DEFAULT_EMERGENCY_SHORTCUT = Object.freeze({
    modifiers: ['ctrl'],
    key: 'u',
    display: 'Ctrl + U'
});
const VALID_MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'cmd', 'opt']);
let cleanSessionSeq = 0;
export function formatCleanDuration(seconds) {
    if (seconds === null || seconds === undefined)
        return '无限期 (手动解锁)';
    if (!Number.isFinite(seconds) || seconds <= 0)
        return '0 秒';
    const sec = Math.floor(seconds);
    if (sec < 60)
        return `${sec} 秒`;
    const mins = Math.floor(sec / 60);
    const remSec = sec % 60;
    if (mins < 60) {
        return remSec > 0 ? `${mins} 分 ${remSec} 秒` : `${mins} 分钟`;
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hours} 小时 ${remMins} 分` : `${hours} 小时`;
}
export class KeyboardLockManager {
    state;
    mutexBusy = false;
    watchdogTimer = null;
    domListenerAttached = false;
    lastHostOverride = undefined;
    history = [];
    totalCleanedSeconds = 0;
    totalBlockedKeystrokes = 0;
    lastCleanedAt = null;
    domKeyInterceptor = (rawEvt) => {
        if (this.state.status !== 'locked')
            return;
        const e = (rawEvt && typeof rawEvt === 'object' ? rawEvt : {});
        const eventType = e?.type || 'keydown';
        const key = String(e?.key || '');
        const lowerKey = key.toLowerCase();
        const isEmergencyCombo = lowerKey === this.state.emergencyShortcut.key.toLowerCase() &&
            Boolean(e?.ctrlKey || e?.metaKey);
        if (typeof e?.preventDefault === 'function') {
            e.preventDefault();
        }
        if (typeof e?.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
        }
        if (eventType === 'keydown') {
            if (isEmergencyCombo) {
                void this.unlockKeyboard('emergency_hotkey');
                return;
            }
            const mods = [];
            if (e?.ctrlKey)
                mods.push('ctrl');
            if (e?.metaKey)
                mods.push('cmd');
            if (e?.altKey)
                mods.push('alt');
            if (e?.shiftKey)
                mods.push('shift');
            void this.interceptKeystroke(key || 'Unknown', mods);
        }
    };
    constructor() {
        this.state = {
            status: 'unlocked',
            lockedAt: null,
            expiresAt: null,
            durationSeconds: null,
            remainingSeconds: null,
            blockedKeystrokes: 0,
            lastBlockedKey: null,
            activePresetTitle: null,
            activeIcon: null,
            emergencyShortcut: { ...DEFAULT_EMERGENCY_SHORTCUT },
            lastModifiedAt: Date.now()
        };
        void this.hydrateFromStorage();
    }
    async hydrateFromStorage() {
        try {
            const rawStats = await LocalStorage.getItem(CLEAN_KEYBOARD_STATS_KEY);
            if (rawStats && this.history.length === 0 && this.totalCleanedSeconds === 0) {
                const parsed = JSON.parse(rawStats);
                if (Array.isArray(parsed.history)) {
                    this.history = parsed.history;
                }
                if (typeof parsed.totalCleanedSeconds === 'number') {
                    this.totalCleanedSeconds = parsed.totalCleanedSeconds;
                }
                if (typeof parsed.totalBlockedKeystrokes === 'number') {
                    this.totalBlockedKeystrokes = parsed.totalBlockedKeystrokes;
                }
                if (typeof parsed.lastCleanedAt === 'number') {
                    this.lastCleanedAt = parsed.lastCleanedAt;
                }
            }
            const rawShortcut = await LocalStorage.getItem(CLEAN_KEYBOARD_SHORTCUT_KEY);
            if (rawShortcut && this.state.emergencyShortcut.display === DEFAULT_EMERGENCY_SHORTCUT.display) {
                const parsedShortcut = JSON.parse(rawShortcut);
                if (parsedShortcut && typeof parsedShortcut.key === 'string' && Array.isArray(parsedShortcut.modifiers)) {
                    this.state = {
                        ...this.state,
                        emergencyShortcut: parsedShortcut
                    };
                }
            }
        }
        catch {
            // ignore storage hydration errors
        }
    }
    attachDomInterceptor(hostOverride) {
        this.lastHostOverride = hostOverride;
        const win = globalThis.window;
        if (!this.domListenerAttached && win && typeof win.addEventListener === 'function') {
            win.addEventListener('keydown', this.domKeyInterceptor, { capture: true });
            win.addEventListener('keyup', this.domKeyInterceptor, { capture: true });
            win.addEventListener('keypress', this.domKeyInterceptor, { capture: true });
            this.domListenerAttached = true;
        }
        if (hostOverride || isRealElectronHost()) {
            void callHostTransport('window_set_always_on_top', { flag: true }, hostOverride);
            void invokePluginService('CleanKeyboardPlugin', 'startCleanLock', { durationSeconds: this.state.durationSeconds }, hostOverride);
        }
    }
    detachDomInterceptor(hostOverride) {
        const targetHost = hostOverride ?? this.lastHostOverride;
        const win = globalThis.window;
        if (this.domListenerAttached && win && typeof win.removeEventListener === 'function') {
            win.removeEventListener('keydown', this.domKeyInterceptor, { capture: true });
            win.removeEventListener('keyup', this.domKeyInterceptor, { capture: true });
            win.removeEventListener('keypress', this.domKeyInterceptor, { capture: true });
            this.domListenerAttached = false;
        }
        if (targetHost || isRealElectronHost()) {
            void callHostTransport('window_set_always_on_top', { flag: false }, targetHost);
            void invokePluginService('CleanKeyboardPlugin', 'stopCleanLock', {}, targetHost);
        }
        this.lastHostOverride = undefined;
    }
    getState() {
        return {
            ...this.state,
            emergencyShortcut: {
                ...this.state.emergencyShortcut,
                modifiers: [...this.state.emergencyShortcut.modifiers]
            }
        };
    }
    getStats() {
        return {
            totalSessions: this.history.length,
            totalCleanedSeconds: this.totalCleanedSeconds,
            totalBlockedKeystrokes: this.totalBlockedKeystrokes,
            lastCleanedAt: this.lastCleanedAt,
            history: [...this.history]
        };
    }
    clearWatchdog() {
        if (this.watchdogTimer !== null) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }
    async lockKeyboard(durationSeconds, options = {}) {
        if (this.mutexBusy) {
            return {
                success: false,
                status: this.state.status,
                message: '键盘锁正在切换状态中，请勿并发重复操作',
                state: this.getState(),
                error: 'Mutex lock is busy',
                code: 'MUTEX_BUSY'
            };
        }
        if (this.state.status === 'locked' || this.state.status === 'locking') {
            return {
                success: false,
                status: this.state.status,
                message: '键盘当前已处于锁定状态',
                state: this.getState(),
                error: 'Keyboard is already locked',
                code: 'ALREADY_LOCKED'
            };
        }
        if (durationSeconds !== null && durationSeconds !== undefined) {
            if (typeof durationSeconds !== 'number' ||
                !Number.isFinite(durationSeconds) ||
                durationSeconds <= 0 ||
                durationSeconds > 86400 * 7) {
                return {
                    success: false,
                    status: this.state.status,
                    message: '锁定时长无效（需在 1 秒 ~ 7 天之间）',
                    state: this.getState(),
                    error: 'Invalid lock duration',
                    code: 'INVALID_DURATION'
                };
            }
        }
        this.mutexBusy = true;
        try {
            const now = Date.now();
            const normalizedSeconds = durationSeconds !== null && durationSeconds !== undefined
                ? Math.floor(durationSeconds)
                : null;
            this.state = {
                ...this.state,
                status: 'locking',
                lastModifiedAt: now
            };
            this.clearWatchdog();
            const expiresAt = normalizedSeconds !== null ? now + normalizedSeconds * 1000 : null;
            this.state = {
                ...this.state,
                status: 'locked',
                lockedAt: now,
                expiresAt,
                durationSeconds: normalizedSeconds,
                remainingSeconds: normalizedSeconds,
                blockedKeystrokes: 0,
                lastBlockedKey: null,
                activePresetTitle: options.presetTitle ||
                    (normalizedSeconds ? `${normalizedSeconds} 秒清洁锁` : '无限期清洁锁'),
                activeIcon: options.icon || '1m',
                lastModifiedAt: now
            };
            this.attachDomInterceptor(options.hostOverride);
            const watchdogDelayMs = options.watchdogMs ??
                (normalizedSeconds !== null && normalizedSeconds <= 60 ? normalizedSeconds * 1000 : null);
            if (watchdogDelayMs !== null && watchdogDelayMs > 0 && watchdogDelayMs <= 60_000) {
                this.watchdogTimer = setTimeout(() => {
                    if (this.state.status === 'locked') {
                        void this.unlockKeyboard('watchdog_timeout');
                    }
                }, watchdogDelayMs);
                const timerObj = this.watchdogTimer;
                if (typeof timerObj?.unref === 'function') {
                    timerObj.unref();
                }
            }
            return {
                success: true,
                status: 'locked',
                message: `键盘已锁定 (${formatCleanDuration(normalizedSeconds)})，按 ${this.state.emergencyShortcut.display} (或 Cmd + U) 可随时解锁`,
                state: this.getState()
            };
        }
        finally {
            this.mutexBusy = false;
        }
    }
    async unlockKeyboard(reason = 'manual', hostOverride) {
        if (this.mutexBusy) {
            return {
                success: false,
                status: this.state.status,
                message: '键盘锁正在切换状态中',
                state: this.getState(),
                error: 'Mutex lock is busy',
                code: 'MUTEX_BUSY'
            };
        }
        if (this.state.status !== 'locked') {
            return {
                success: false,
                status: this.state.status,
                message: '键盘当前未处于锁定状态',
                state: this.getState(),
                error: 'Keyboard is not locked',
                code: 'NOT_LOCKED'
            };
        }
        this.mutexBusy = true;
        try {
            this.clearWatchdog();
            this.detachDomInterceptor(hostOverride);
            const now = Date.now();
            const startedAt = this.state.lockedAt ?? now;
            const plannedSeconds = this.state.durationSeconds;
            const elapsedSeconds = Math.max(1, Math.round((now - startedAt) / 1000));
            const actualSeconds = reason === 'timer_expired' && plannedSeconds !== null ? plannedSeconds : elapsedSeconds;
            this.state = {
                ...this.state,
                status: 'unlocking',
                lastModifiedAt: now
            };
            const record = {
                id: `clean-${now}-${++cleanSessionSeq}`,
                startedAt,
                endedAt: now,
                plannedDurationSeconds: plannedSeconds,
                actualDurationSeconds: actualSeconds,
                blockedKeystrokes: this.state.blockedKeystrokes,
                unlockReason: reason,
                presetTitle: this.state.activePresetTitle || '清洁会话'
            };
            this.history = [record, ...this.history].slice(0, 30);
            this.totalCleanedSeconds += actualSeconds;
            this.totalBlockedKeystrokes += record.blockedKeystrokes;
            this.lastCleanedAt = now;
            await this.persistStats();
            this.state = {
                ...this.state,
                status: 'unlocked',
                lockedAt: null,
                expiresAt: null,
                durationSeconds: null,
                remainingSeconds: null,
                blockedKeystrokes: 0,
                lastBlockedKey: null,
                activePresetTitle: null,
                activeIcon: null,
                lastModifiedAt: now
            };
            return {
                success: true,
                status: 'unlocked',
                message: `键盘已恢复正常输入（本次拦截 ${record.blockedKeystrokes} 次误触按键）`,
                state: this.getState(),
                sessionRecord: record
            };
        }
        finally {
            this.mutexBusy = false;
        }
    }
    async interceptKeystroke(key, modifiers = []) {
        if (this.state.status !== 'locked') {
            return { blocked: false, unlocked: false, state: this.getState() };
        }
        const cleanKey = (key || '').trim().toLowerCase();
        const targetShortcut = this.state.emergencyShortcut;
        const modSet = new Set((modifiers || []).map((m) => m.toLowerCase()));
        const exactMatch = cleanKey === targetShortcut.key.toLowerCase() &&
            targetShortcut.modifiers.every((m) => modSet.has(m));
        const crossPlatformDefaultMatch = cleanKey === targetShortcut.key.toLowerCase() &&
            targetShortcut.modifiers.length === 1 &&
            targetShortcut.modifiers[0] === 'ctrl' &&
            (modSet.has('ctrl') || modSet.has('cmd'));
        if (exactMatch || crossPlatformDefaultMatch) {
            await this.unlockKeyboard('emergency_hotkey');
            return { blocked: true, unlocked: true, state: this.getState() };
        }
        this.state = {
            ...this.state,
            blockedKeystrokes: this.state.blockedKeystrokes + 1,
            lastBlockedKey: key || 'Unknown',
            lastModifiedAt: Date.now()
        };
        if (this.lastHostOverride || isRealElectronHost()) {
            void invokePluginService('CleanKeyboardPlugin', 'recordBlockedKey', { key: key || 'Unknown' }, this.lastHostOverride);
        }
        return { blocked: true, unlocked: false, state: this.getState() };
    }
    async tick(stepSeconds = 1) {
        if (this.state.status !== 'locked' || this.state.remainingSeconds === null) {
            return this.getState();
        }
        const step = Number.isFinite(stepSeconds) && stepSeconds > 0 ? Math.floor(stepSeconds) : 1;
        const nextRemaining = Math.max(0, this.state.remainingSeconds - step);
        this.state = {
            ...this.state,
            remainingSeconds: nextRemaining,
            lastModifiedAt: Date.now()
        };
        if (nextRemaining === 0) {
            await this.unlockKeyboard('timer_expired');
        }
        return this.getState();
    }
    async updateEmergencyShortcut(modifiers, key) {
        const cleanKey = (key || '').trim().toLowerCase();
        const validMods = Array.isArray(modifiers)
            ? modifiers.filter((m) => VALID_MODIFIERS.has(m))
            : [];
        if (!cleanKey || cleanKey.length !== 1 || validMods.length === 0) {
            return {
                success: false,
                status: this.state.status,
                message: '紧急解锁快捷键必须包含至少一个修饰键 (Ctrl/Alt/Shift/Cmd) 与单个字母或数字键',
                state: this.getState(),
                error: 'Invalid emergency shortcut',
                code: 'INVALID_SHORTCUT'
            };
        }
        const display = `${validMods.map((m) => m[0].toUpperCase() + m.slice(1)).join(' + ')} + ${cleanKey.toUpperCase()}`;
        this.state = {
            ...this.state,
            emergencyShortcut: {
                modifiers: validMods,
                key: cleanKey,
                display
            },
            lastModifiedAt: Date.now()
        };
        await LocalStorage.setItem(CLEAN_KEYBOARD_SHORTCUT_KEY, JSON.stringify(this.state.emergencyShortcut));
        return {
            success: true,
            status: this.state.status,
            message: `紧急解锁快捷键已更新为 ${display}`,
            state: this.getState()
        };
    }
    async persistStats() {
        try {
            await LocalStorage.setItem(CLEAN_KEYBOARD_STATS_KEY, JSON.stringify(this.getStats()));
        }
        catch {
            // ignore
        }
    }
    async resetAll() {
        this.clearWatchdog();
        this.detachDomInterceptor();
        this.mutexBusy = false;
        this.history = [];
        this.totalCleanedSeconds = 0;
        this.totalBlockedKeystrokes = 0;
        this.lastCleanedAt = null;
        this.state = {
            status: 'unlocked',
            lockedAt: null,
            expiresAt: null,
            durationSeconds: null,
            remainingSeconds: null,
            blockedKeystrokes: 0,
            lastBlockedKey: null,
            activePresetTitle: null,
            activeIcon: null,
            emergencyShortcut: { ...DEFAULT_EMERGENCY_SHORTCUT },
            lastModifiedAt: Date.now()
        };
        await LocalStorage.removeItem(CLEAN_KEYBOARD_STATS_KEY);
        await LocalStorage.removeItem(CLEAN_KEYBOARD_SHORTCUT_KEY);
    }
}
export const defaultKeyboardLockManager = new KeyboardLockManager();
