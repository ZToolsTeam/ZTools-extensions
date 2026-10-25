/**
 * cache.ts
 * 内存缓存类（与 Raycast Cache 用法一致），客户端重启后清空。
 *
 * 作用域：数据按「缓存作用域」隔离。宿主为每个插件调用 createCacheScope() 生成一个独立的 Cache 类，
 * 插件拿到的 Cache 只能读写本插件作用域里的命名空间；namespace 只在作用域内部区分，
 * 其他插件即使传同名 namespace 也读不到。直接使用 SDK 导出的 Cache（Node 测试、宿主自身）时落在默认作用域。
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
/**
 * 创建一个全新的缓存作用域，返回绑定到该作用域的 Cache 类（不从包入口导出，供 utils 的 createCacheScope 使用）。
 * 每次调用都是空的独立作用域，与默认作用域及其他作用域的数据互不可见；
 * 作用域只能通过持有返回的类访问，无法按名字取到别人的作用域。
 */
export declare function createScopedCacheClass(): typeof Cache;
