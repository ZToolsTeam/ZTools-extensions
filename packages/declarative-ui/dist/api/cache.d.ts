/**
 * cache.ts
 * Raycast 官方 Cache 内存/本地持久化缓存类
 */
export interface CacheOptions {
    namespace?: string;
}
export type CacheSubscriber = (key: string | undefined, data: string | undefined) => void;
export declare class Cache {
    private namespace;
    private store;
    private subscribers;
    constructor(options?: CacheOptions);
    get(key: string): string | undefined;
    set(key: string, data: string): void;
    has(key: string): boolean;
    remove(key: string): boolean;
    clear(options?: {
        notifySubscribers?: boolean;
    }): void;
    get isEmpty(): boolean;
    subscribe(subscriber: CacheSubscriber): () => void;
}
