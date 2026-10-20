import { EffectCallback } from "./context.js";
/**
 * 声明式微状态 Hook: useState
 */
export declare function useState<T>(initialState: T | (() => T)): [T, (action: T | ((prevState: T) => T)) => void];
/**
 * 声明式微副作用 Hook: useEffect
 */
export declare function useEffect(effect: EffectCallback, deps?: any[]): void;
/**
 * 声明式记忆化 Hook: useMemo
 */
export declare function useMemo<T>(factory: () => T, deps?: any[]): T;
/**
 * 声明式回调 Hook: useCallback
 */
export declare function useCallback<T extends (...args: any[]) => any>(callback: T, deps?: any[]): T;
/**
 * 声明式引用 Hook: useRef
 */
export declare function useRef<T>(initialValue: T): {
    current: T;
};
