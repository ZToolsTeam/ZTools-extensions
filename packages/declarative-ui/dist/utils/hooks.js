/**
 * @raycast/utils 兼容层实现
 * 覆盖社区扩展高频使用的 usePromise, useCachedPromise, useFetch, useCachedState
 * 支持标准 React Hooks 环境与 ZTools 声明式微运行时自适应
 *
 * 插件可用的名字由 ./index.ts 列出；createCacheScope 只给宿主用，经 ../host/index.ts 引出，不进包入口。
 */
import { useState as microUseState, useEffect as microUseEffect, useCallback as microUseCallback, useRef as microUseRef } from "../runtime/hooks.js";
import { Cache, createScopedCacheClass } from "../api/cache.js";
// 探测是否处于标准 React 运行时环境
function getHooks() {
    try {
        const req = typeof globalThis.require === "function" ? globalThis.require : null;
        const react = globalThis.React || (req ? req("react") : null);
        if (react && typeof react.useState === "function") {
            return {
                useState: react.useState,
                useEffect: react.useEffect,
                useCallback: react.useCallback,
                useRef: react.useRef
            };
        }
    }
    catch { }
    return {
        useState: microUseState,
        useEffect: microUseEffect,
        useCallback: microUseCallback,
        useRef: microUseRef
    };
}
export function usePromise(fn, args, options) {
    const hooks = getHooks();
    const execute = options?.execute !== false;
    const initialData = options?.initialData;
    const [data, setData] = hooks.useState(initialData);
    const [error, setError] = hooks.useState(undefined);
    const [isLoading, setIsLoading] = hooks.useState(execute);
    const fnRef = hooks.useRef(fn);
    fnRef.current = fn;
    const argsKey = JSON.stringify(args || []);
    const revalidate = hooks.useCallback(async () => {
        if (!execute) {
            setIsLoading(false);
            return undefined;
        }
        setIsLoading(true);
        setError(undefined);
        try {
            const result = await fnRef.current(...(args || []));
            setData(result);
            setIsLoading(false);
            options?.onData?.(result);
            return result;
        }
        catch (err) {
            const errorObj = err instanceof Error ? err : new Error(String(err));
            setError(errorObj);
            setIsLoading(false);
            options?.onError?.(errorObj);
            return undefined;
        }
    }, [argsKey, execute]);
    hooks.useEffect(() => {
        let active = true;
        if (execute) {
            revalidate();
        }
        else {
            setIsLoading(false);
        }
        return () => {
            active = false;
        };
    }, [argsKey, execute]);
    const mutate = hooks.useCallback(async (asyncUpdate, mutateOptions) => {
        if (!asyncUpdate) {
            return revalidate();
        }
        try {
            if (typeof asyncUpdate === "function") {
                const next = await asyncUpdate(data);
                setData(next);
            }
            else {
                const next = await asyncUpdate;
                setData(next);
            }
            if (mutateOptions?.shouldRevalidate !== false) {
                return revalidate();
            }
            return data;
        }
        catch (err) {
            setError(err instanceof Error ? err : new Error(String(err)));
            return undefined;
        }
    }, [data, revalidate]);
    return {
        data,
        error,
        isLoading,
        revalidate,
        mutate
    };
}
// useCachedPromise / useCachedState 共用的缓存命名空间
const CACHED_HOOKS_NAMESPACE = "@raycast/utils.useCachedPromise";
// 默认作用域的缓存单例（未经宿主分配作用域时使用，如 Node 测试）
const internalPromiseCache = new Cache({ namespace: CACHED_HOOKS_NAMESPACE });
export function useCachedPromise(fn, args, options) {
    return useCachedPromiseWith(internalPromiseCache, fn, args, options);
}
function useCachedPromiseWith(cache, fn, args, options) {
    const cacheKey = `${fn.name || "anon"}:${JSON.stringify(args || [])}`;
    // 尝试命中缓存初始化
    let cachedData = options?.initialData;
    const rawCached = cache.get(cacheKey);
    if (rawCached !== undefined) {
        try {
            cachedData = JSON.parse(rawCached);
        }
        catch { }
    }
    const result = usePromise(async (...callArgs) => {
        const res = await fn(...callArgs);
        try {
            cache.set(cacheKey, JSON.stringify(res));
        }
        catch { }
        return res;
    }, args, {
        ...options,
        initialData: cachedData,
        onData: (data) => {
            try {
                cache.set(cacheKey, JSON.stringify(data));
            }
            catch { }
            options?.onData?.(data);
        }
    });
    return result;
}
export function useFetch(url, options) {
    const resolvedUrl = typeof url === "function" ? url() : url;
    return usePromise(async () => {
        const res = await fetch(resolvedUrl, {
            method: options?.method || "GET",
            headers: options?.headers,
            body: options?.body ? JSON.stringify(options.body) : undefined
        });
        if (!res.ok) {
            throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
        }
        if (options?.parseResponse) {
            return options.parseResponse(res);
        }
        return (await res.json());
    }, [resolvedUrl, JSON.stringify(options?.headers), options?.method], {
        execute: options?.execute !== false && !!resolvedUrl,
        initialData: options?.initialData
    });
}
export function useCachedState(key, initialValue, options) {
    return useCachedStateWith(internalPromiseCache, key, initialValue, options);
}
function useCachedStateWith(defaultCache, key, initialValue, options) {
    const hooks = getHooks();
    const cache = options?.cache || defaultCache;
    let startVal = initialValue;
    const raw = cache.get(key);
    if (raw !== undefined) {
        try {
            startVal = JSON.parse(raw);
        }
        catch { }
    }
    const [state, setState] = hooks.useState(startVal);
    const setCachedState = hooks.useCallback((newValOrFn) => {
        setState((prev) => {
            const next = typeof newValOrFn === "function" ? newValOrFn(prev) : newValOrFn;
            try {
                cache.set(key, JSON.stringify(next));
            }
            catch { }
            return next;
        });
    }, [key]);
    return [state, setCachedState];
}
/**
 * 创建一个独立的缓存作用域。客户端为每个插件调用一次，插件拿到的 Cache、useCachedPromise、
 * useCachedState 都落在本插件的作用域里，读不到其他插件的缓存。
 * 只供宿主加载器使用（@ztools/declarative-ui/host），不从包入口导出给插件。
 */
export function createCacheScope() {
    const ScopedCache = createScopedCacheClass();
    const hookCache = new ScopedCache({ namespace: CACHED_HOOKS_NAMESPACE });
    return {
        Cache: ScopedCache,
        useCachedPromise: (fn, args, options) => useCachedPromiseWith(hookCache, fn, args, options),
        useCachedState: (key, initialValue, options) => useCachedStateWith(hookCache, key, initialValue, options)
    };
}
