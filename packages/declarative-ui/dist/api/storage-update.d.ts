export interface AtomicStorage {
    getItem<T = unknown>(key: string): Promise<T | undefined>;
    compareAndSet(key: string, expected: unknown, value: unknown): Promise<boolean>;
}
/** 更新函数只描述本次修改；冲突后会重新执行，不应有外部副作用。 */
export declare function updateStoredItem<T>(storage: AtomicStorage, key: string, update: (current: unknown) => T): Promise<T>;
