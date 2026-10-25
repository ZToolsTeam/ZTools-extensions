export declare const LocalStorage: {
    compareAndSet(key: string, expected: unknown, value: unknown): Promise<boolean>;
    updateItem<T>(key: string, update: (current: unknown) => T): Promise<T>;
    /**
     * 获取存储项
     */
    getItem<T = unknown>(key: string): Promise<T | undefined>;
    /**
     * 写入存储项
     */
    setItem(key: string, value: unknown): Promise<void>;
    /**
     * 删除存储项
     */
    removeItem(key: string): Promise<void>;
    /**
     * 清空所有存储项
     */
    clear(): Promise<void>;
    /**
     * 获取所有存储项
     */
    allItems<T = unknown>(): Promise<Record<string, T>>;
};
