export declare const LocalStorage: {
    /**
     * 获取存储项
     */
    getItem<T = any>(key: string): Promise<T | undefined>;
    /**
     * 写入存储项
     */
    setItem(key: string, value: any): Promise<void>;
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
    allItems<T = any>(): Promise<Record<string, T>>;
};
