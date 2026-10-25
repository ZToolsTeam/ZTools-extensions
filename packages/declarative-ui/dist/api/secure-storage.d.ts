/**
 * SecureStorage：用操作系统钥匙串（Electron safeStorage）加密保存插件机密（TOTP 密钥、令牌等）。
 *
 * - 加密不可用（钥匙串被拒、Linux basic_text 等）时 setItem 直接报错，**绝不**回落为明文、localStorage 或内存；
 * - 防的是「磁盘 / 备份 / 其他本机程序读到明文」；不防同一宿主里的其他 ZTools 插件（插件与宿主同一 JS 上下文）；
 * - 值以 JSON 保存，单个值 JSON 后不超过 64 KiB。
 */
export type SecureStorageUnavailableReason = "encryption-unavailable" | "insecure-backend" | "backend-unknown" | "host-unsupported" | "identity-required";
export type SecureStorageStatus = {
    available: true;
} | {
    available: false;
    reason: SecureStorageUnavailableReason;
};
export interface SecureStorageImportResult {
    status: "imported" | "not-found" | "kept-secure";
    value?: unknown;
    /** 加密存储与明文同时存在且内容不同：交给插件合并，合并写回后调用 discardLocalStorage 删除明文 */
    legacyValue?: unknown;
}
export interface SecureStorageApi {
    status(): Promise<SecureStorageStatus>;
    getItem<T = unknown>(key: string): Promise<T | undefined>;
    setItem(key: string, value: unknown): Promise<void>;
    compareAndSet(key: string, expected: unknown, value: unknown): Promise<boolean>;
    updateItem<T>(key: string, update: (current: unknown) => T): Promise<T>;
    removeItem(key: string): Promise<void>;
    /** 把 LocalStorage 里的明文条目搬进加密存储：写入 → 读回校验 → 删除明文（宿主库 + 浏览器旧键）→ 压缩 */
    importFromLocalStorage(key: string, options?: {
        targetKey?: string;
    }): Promise<SecureStorageImportResult>;
    /** 删除 LocalStorage 里的明文条目（宿主库 + 浏览器旧键）并压缩插件数据库 */
    discardLocalStorage(key: string): Promise<void>;
}
/** 与宿主 credential_v1_* 的 key 规则一致 */
export declare const SECURE_STORAGE_KEY_PATTERN: RegExp;
export declare const SECURE_STORAGE_MAX_VALUE_BYTES: number;
export declare function assertSecureStorageKey(key: unknown): asserts key is string;
export declare const SecureStorage: SecureStorageApi;
