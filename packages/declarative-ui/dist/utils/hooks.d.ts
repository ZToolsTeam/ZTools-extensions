/**
 * @raycast/utils 兼容层实现
 * 覆盖社区扩展高频使用的 usePromise, useCachedPromise, useFetch, useCachedState
 * 支持标准 React Hooks 环境与 ZTools 声明式微运行时自适应
 *
 * 插件可用的名字由 ./index.ts 列出；createCacheScope 只给宿主用，经 ../host/index.ts 引出，不进包入口。
 */
import { Cache } from "../api/cache.js";
export interface UsePromiseOptions<T> {
    execute?: boolean;
    initialData?: T;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
}
export interface UsePromiseResult<T> {
    data: T | undefined;
    error: Error | undefined;
    isLoading: boolean;
    revalidate: () => Promise<T | undefined>;
    mutate: (asyncUpdate?: Promise<any> | ((currentData: T | undefined) => Promise<T> | T), options?: {
        shouldRevalidate?: boolean;
    }) => Promise<T | undefined>;
}
export declare function usePromise<T, TArgs extends any[] = any[]>(fn: (...args: TArgs) => Promise<T>, args?: TArgs, options?: UsePromiseOptions<T>): UsePromiseResult<T>;
export interface UseCachedPromiseOptions<T> extends UsePromiseOptions<T> {
    keepPreviousData?: boolean;
}
export declare function useCachedPromise<T, TArgs extends any[] = any[]>(fn: (...args: TArgs) => Promise<T>, args?: TArgs, options?: UseCachedPromiseOptions<T>): UsePromiseResult<T>;
export interface UseFetchOptions<T> {
    headers?: Record<string, string>;
    method?: string;
    body?: any;
    execute?: boolean;
    initialData?: T;
    parseResponse?: (response: Response) => Promise<T>;
}
export declare function useFetch<T = any>(url: string | (() => string), options?: UseFetchOptions<T>): UsePromiseResult<T>;
export declare function useCachedState<T>(key: string, initialValue: T, options?: {
    cache?: Cache;
}): [T, (val: T | ((prev: T) => T)) => void];
/** 一个缓存作用域内的 Cache 类与绑定到该作用域的缓存 Hook */
export interface CacheScope {
    Cache: typeof Cache;
    useCachedPromise: typeof useCachedPromise;
    useCachedState: typeof useCachedState;
}
/**
 * 创建一个独立的缓存作用域。客户端为每个插件调用一次，插件拿到的 Cache、useCachedPromise、
 * useCachedState 都落在本插件的作用域里，读不到其他插件的缓存。
 * 只供宿主加载器使用（@ztools/declarative-ui/host），不从包入口导出给插件。
 */
export declare function createCacheScope(): CacheScope;
