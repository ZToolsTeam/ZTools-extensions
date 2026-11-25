import type { EncryptedVaultEnvelope, VaultCategory, VaultEntry, VaultNewEntryInput } from './types.js';
export declare function validateMasterPassword(password: string): {
    valid: boolean;
    error?: string;
};
export declare function validateNewEntryInput(input: VaultNewEntryInput): {
    valid: boolean;
    error?: string;
};
export declare function getVaultCategoryLabel(category: VaultCategory): string;
export declare function createVaultEntry(input: VaultNewEntryInput, nowMs?: number): VaultEntry;
export declare function encryptVaultEntries(masterPassword: string, entries: VaultEntry[]): Promise<EncryptedVaultEnvelope>;
export declare function decryptVaultEntries(masterPassword: string, envelope: EncryptedVaultEnvelope, options?: {
    knownOriginalCipherBase64?: string;
}): Promise<VaultEntry[]>;
export declare function generateSecurePassword(length?: number, includeSymbols?: boolean): string;
export interface ClipboardAdapter {
    copy: (text: string) => Promise<void>;
    readText: () => Promise<string | undefined>;
    clear: () => Promise<void>;
}
export declare function copySecretWithAutoClear(secret: string, clipboard: ClipboardAdapter, options?: {
    ttlMs?: number;
    scheduleTimer?: (fn: () => void, ms: number) => unknown;
}): Promise<{
    clearNow: () => Promise<boolean>;
}>;
