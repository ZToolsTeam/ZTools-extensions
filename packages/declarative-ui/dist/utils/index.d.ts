/**
 * @raycast/utils 兼容层实现
 * 覆盖社区扩展高频使用的 usePromise, useCachedPromise, useFetch, useCachedState
 * 支持标准 React Hooks 环境与 ZTools 声明式微运行时自适应
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
