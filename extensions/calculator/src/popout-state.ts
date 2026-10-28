/**
 * 「独立窗口带状态」的插件侧封装（基于 SDK 的 usePopoutState）
 *
 * - 只在根页面调用才会被带到独立窗口；二级页面的状态要先提升到根页面；
 * - 新窗口拿到的是弹出前存下的值（可能来自上一版插件），校验不通过时回落到默认值，坏数据不会进到界面；
 * - 旧宿主注入的 SDK 没有 usePopoutState，退化为普通 useState（弹出时不带状态）；
 * - 第三个返回值 restored 表示初值来自独立窗口交接且通过了校验。
 */
import { useCallback, useRef, useState, usePopoutState, type PopoutStateOptions } from "@ztools/declarative-ui";

export type PopoutSetter<T> = (action: T | ((prev: T) => T)) => void;

export function usePopoutValue<T>(
  key: string,
  makeDefault: () => T,
  isValid: (value: unknown) => value is T,
  options?: PopoutStateOptions<T>
): [T, PopoutSetter<T>, boolean] {
  const metaRef = useRef<{ restored: boolean; fallback?: { value: T } } | null>(null);
  let usedDefault = false;
  const init = () => {
    usedDefault = true;
    return makeDefault();
  };
  const paths = options?.paths;
  const hookOptions: PopoutStateOptions<T> | undefined = paths ? { paths: (v) => (isValid(v) ? paths(v) : []) } : undefined;
  const [raw, set] = typeof usePopoutState === "function" ? usePopoutState<T>(key, init, hookOptions) : useState<T>(init);
  const meta = metaRef.current ?? (metaRef.current = { restored: !usedDefault && isValid(raw) });
  const fallback = () => (meta.fallback ??= { value: makeDefault() }).value;
  const setValue = useCallback<PopoutSetter<T>>(
    (action) =>
      set((prev) => {
        const base = isValid(prev) ? prev : fallback();
        return typeof action === "function" ? (action as (p: T) => T)(base) : action;
      }),
    [set]
  );
  return [isValid(raw) ? raw : fallback(), setValue, meta.restored];
}
