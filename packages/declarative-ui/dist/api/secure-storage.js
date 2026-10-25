import { updateStoredItem } from "./storage-update.js";
import { getDeclarativeBridge } from "./bridge.js";
import { ZToolsHostError } from "./host-error.js";
/** 与宿主 credential_v1_* 的 key 规则一致 */
export const SECURE_STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const SECURE_STORAGE_MAX_VALUE_BYTES = 64 * 1024;
export function assertSecureStorageKey(key) {
    if (typeof key !== "string" || !SECURE_STORAGE_KEY_PATTERN.test(key)) {
        throw new ZToolsHostError("INVALID_STORAGE_KEY", "SecureStorage 的 key 必须是 1–128 个字符，以字母或数字开头，只含字母、数字和 . _ : -");
    }
}
function unavailable() {
    return new ZToolsHostError("SECURE_STORAGE_UNAVAILABLE", "当前宿主不支持加密存储，请升级 ZTools");
}
function implementation() {
    return getDeclarativeBridge()?.secureStorage;
}
export const SecureStorage = {
    async status() {
        const impl = implementation();
        if (!impl?.status)
            return { available: false, reason: "host-unsupported" };
        return impl.status();
    },
    async getItem(key) {
        assertSecureStorageKey(key);
        const impl = implementation();
        if (!impl?.getItem)
            throw unavailable();
        return impl.getItem(key);
    },
    async setItem(key, value) {
        assertSecureStorageKey(key);
        const impl = implementation();
        if (!impl?.setItem)
            throw unavailable();
        return impl.setItem(key, value);
    },
    async compareAndSet(key, expected, value) {
        assertSecureStorageKey(key);
        const impl = implementation();
        if (!impl?.compareAndSet)
            throw unavailable();
        return impl.compareAndSet(key, expected, value);
    },
    async updateItem(key, update) {
        return updateStoredItem(SecureStorage, key, update);
    },
    async removeItem(key) {
        assertSecureStorageKey(key);
        const impl = implementation();
        if (!impl?.removeItem)
            throw unavailable();
        return impl.removeItem(key);
    },
    async importFromLocalStorage(key, options) {
        const impl = implementation();
        if (!impl?.importFromLocalStorage)
            throw unavailable();
        return impl.importFromLocalStorage(key, options);
    },
    async discardLocalStorage(key) {
        const impl = implementation();
        if (!impl?.discardLocalStorage)
            throw unavailable();
        return impl.discardLocalStorage(key);
    }
};
