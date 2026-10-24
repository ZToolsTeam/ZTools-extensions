import { EffectCallback } from "./context.js";
/**
 * 声明式微状态 Hook: useState
 */
export declare function useState<T>(initialState: T | (() => T)): [T, (action: T | ((prevState: T) => T)) => void];
export interface PopoutStateOptions<T> {
    /**
     * 值里引用的本地路径。弹出独立窗口时，宿主把当前窗口对这些路径已有的授权（不会更多）转交给新窗口；
     * 当前窗口没有授权的路径会被跳过。
     */
    paths?: (value: T) => readonly string[] | null | undefined;
}
/**
 * 与 useState 相同；值会在「弹出独立窗口」时交给新窗口，新窗口首次渲染时用它代替 initialValue（只用一次）。
 *
 * - 只在根页面（导航栈第一层）生效；推入的二级页面里调用等同 useState；
 * - 值必须能 JSON 序列化（普通对象 / 数组 / 字符串 / 有限数字 / 布尔 / null），否则该项不带，新窗口用 initialValue；
 * - 插件升级后旧值的形状可能变化，插件要自己做容错；
 * - key 为 1–64 个字符、同一页面内唯一，重复的 key 只有第一个生效。
 */
export declare function usePopoutState<T>(key: string, initialValue: T | (() => T), options?: PopoutStateOptions<T>): [T, (action: T | ((prevState: T) => T)) => void];
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
