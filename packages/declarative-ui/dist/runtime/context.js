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
    constructor(component, options) {
        this.component = component;
        this.onUpdateCallback = options?.onUpdate;
        this.onRenderEmptyCallback = options?.onRenderEmpty;
        this.onRenderEventCallback = options?.onRenderEvent;
        this.navigationHandler = options?.navigation;
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
                this.latestDescriptor = newDescriptor;
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
