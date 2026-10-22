import { setActiveNavigation } from "../api/navigation.js";
export function areViewTreesEqual(a, b) {
    if (a === b)
        return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object")
        return false;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    }
    catch {
        return false;
    }
}
export class DeclarativeRenderInstance {
    component;
    hooks = [];
    currentHookIndex = 0;
    isQueued = false;
    isMounted = true;
    latestDescriptor = null;
    emptyRenderCount = 0;
    hasWarnedInfiniteLoop = false;
    onUpdateCallback;
    onRenderEmptyCallback;
    onRenderEventCallback;
    navigationHandler;
    popoutSeed = null;
    popoutRegistry = new Map();
    constructor(component, options) {
        this.component = component;
        this.onUpdateCallback = options?.onUpdate;
        this.onRenderEmptyCallback = options?.onRenderEmpty;
        this.onRenderEventCallback = options?.onRenderEvent;
        this.navigationHandler = options?.navigation;
        const seed = options?.handoffSeed;
        if (seed && typeof seed === "object" && !Array.isArray(seed)) {
            // 拷一份 key 表：宿主传入的对象不会被改动，也不受原型链上的属性影响
            this.popoutSeed = new Map(Object.entries(seed));
        }
    }
    /** 取出并删除某个 key 的交接初值（只用一次） */
    consumePopoutSeed(key) {
        if (!this.popoutSeed || !this.popoutSeed.has(key))
            return { found: false };
        const value = this.popoutSeed.get(key);
        this.popoutSeed.delete(key);
        return { found: true, value };
    }
    /** 登记 usePopoutState；同一实例里 key 重复时只保留第一个，返回 false */
    registerPopoutState(key, index, paths) {
        const existing = this.popoutRegistry.get(key);
        if (existing && existing.index !== index)
            return false;
        this.popoutRegistry.set(key, { index, paths });
        return true;
    }
    /** 读取当前登记的状态最新值（独立窗口弹出前调用） */
    collectPopoutState() {
        const entries = [];
        const rejected = [];
        for (const [key, registration] of this.popoutRegistry) {
            const hook = this.hooks[registration.index];
            if (!hook || hook.type !== "state")
                continue;
            const value = hook.value;
            let paths = [];
            if (typeof registration.paths === "function") {
                let raw;
                try {
                    raw = registration.paths(value);
                }
                catch (err) {
                    console.warn(`[usePopoutState] "${key}" 的 paths 计算失败，该项不带到独立窗口:`, err);
                    rejected.push(key);
                    continue;
                }
                if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
                    rejected.push(key);
                    continue;
                }
                paths = Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : [];
            }
            entries.push({ key, value, paths });
        }
        return { entries, rejected };
    }
    get hookIndex() {
        return this.currentHookIndex;
    }
    set hookIndex(idx) {
        this.currentHookIndex = idx;
    }
    getHooks() {
        return this.hooks;
    }
    getLatestDescriptor() {
        return this.latestDescriptor;
    }
    getEmptyRenderCount() {
        return this.emptyRenderCount;
    }
    hasInfiniteLoopWarning() {
        return this.hasWarnedInfiniteLoop;
    }
    scheduleRender() {
        if (!this.isMounted || this.isQueued)
            return;
        this.isQueued = true;
        queueMicrotask(() => {
            if (!this.isMounted)
                return;
            this.isQueued = false;
            this.executeRender();
        });
    }
    executeRender() {
        if (!this.isMounted) {
            return this.latestDescriptor;
        }
        const prevInstance = currentInstance;
        currentInstance = this;
        this.currentHookIndex = 0;
        if (this.navigationHandler) {
            setActiveNavigation(this.navigationHandler);
        }
        try {
            let rawResult = this.component();
            // 如果返回的是嵌套函数或者 promise
            if (typeof rawResult === "function") {
                rawResult = rawResult();
            }
            const newDescriptor = rawResult;
            const isUnchanged = this.latestDescriptor !== null && areViewTreesEqual(this.latestDescriptor, newDescriptor);
            // 始终更新 latestDescriptor，防止因 JSON.stringify 忽略函数引用导致事件回调闭包陈旧
            this.latestDescriptor = newDescriptor;
            if (isUnchanged) {
                this.emptyRenderCount++;
                this.onRenderEmptyCallback?.();
                this.onRenderEventCallback?.({ type: "renderEmpty" });
                if (this.emptyRenderCount >= 20 && !this.hasWarnedInfiniteLoop) {
                    console.warn("[RaycastCompat] Looks like the command is rendering a lot without any changes. " +
                        "This might indicate a rendering loop caused by a `setState` not being wrapped in a `useEffect`...");
                    this.hasWarnedInfiniteLoop = true;
                }
            }
            else {
                this.emptyRenderCount = 0;
                this.hasWarnedInfiniteLoop = false;
                this.onUpdateCallback?.(this.latestDescriptor);
                this.onRenderEventCallback?.({ type: "renderTree", descriptor: this.latestDescriptor });
            }
            // 执行所有的 effects
            this.runPendingEffects();
            return this.latestDescriptor ?? newDescriptor;
        }
        finally {
            currentInstance = prevInstance;
            setActiveNavigation(null);
        }
    }
    runPendingEffects() {
        for (const hook of this.hooks) {
            if (hook.type === "effect" && typeof hook.value === "function") {
                const effectFn = hook.value;
                hook.value = null;
                // 如果有之前的清理函数，先执行
                if (typeof hook.cleanup === "function") {
                    try {
                        hook.cleanup();
                    }
                    catch (err) {
                        console.error("[RaycastCompat] Error during effect cleanup:", err);
                    }
                    hook.cleanup = undefined;
                }
                try {
                    const cleanup = effectFn();
                    if (typeof cleanup === "function") {
                        hook.cleanup = cleanup;
                    }
                }
                catch (err) {
                    console.error("[RaycastCompat] Error running effect:", err);
                }
            }
        }
    }
    unmount() {
        this.isMounted = false;
        for (const hook of this.hooks) {
            if (hook.type === "effect" && typeof hook.cleanup === "function") {
                try {
                    hook.cleanup();
                }
                catch (err) {
                    console.error("[RaycastCompat] Error unmounting effect:", err);
                }
            }
        }
        this.hooks = [];
        this.latestDescriptor = null;
        this.popoutRegistry.clear();
        this.popoutSeed = null;
    }
}
export let currentInstance = null;
export let isEvaluatingChildElement = false;
export function setCurrentInstance(instance) {
    const prev = currentInstance;
    currentInstance = instance;
    return prev;
}
export function setEvaluatingChildElement(flag) {
    const prev = isEvaluatingChildElement;
    isEvaluatingChildElement = flag;
    return prev;
}
