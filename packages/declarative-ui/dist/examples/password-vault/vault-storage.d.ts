/**
 * 密码保险箱核心存储与加密服务 (vault-storage.ts)
 *
 * 借鉴 Raycast `keepassxc` & `rpass` 源码改造：
 * - 单一职责：管理网站/应用名称、账号、密码、URL、分类文件夹、私密备注（不含 2FA TOTP）
 * - 支持主密码设置、加锁 (locked) / 解锁 (unlocked) 状态机与密文 envelope 校验
 * - 支持 Chrome / Edge 标准 CSV (`name,url,username,password,note`) 一键导入与导出
 * - 内置高强度密码生成器与密码熵值强度评估
 */
import { CsvImportResult, EncryptedVaultEnvelope, PasswordGeneratorOptions, PasswordStrengthResult, VaultEntry, VaultEntryInput, VaultLockState, VaultUnlockResult } from "./types.js";
export declare const VAULT_STORAGE_KEY = "ztools.password-vault.entries.v1";
export declare const VAULT_MASTER_HASH_KEY = "ztools.password-vault.master.v1";
export declare const INITIAL_VAULT_ENTRIES: readonly VaultEntry[];
/**
 * 使用 AEAD (AES-256-GCM + scrypt 密钥派生) 加密敏感凭据
 * 输出格式: enc:v1:<ivHex(24)>:<tagHex(32)>:<cipherHex>
 */
export declare function encryptSecret(plaintext: string, masterKey: string): string;
/**
 * 解密并严格验证 AEAD AuthTag，任何 1-bit 篡改或错误密钥立即抛出异常
 */
export declare function decryptSecret(ciphertext: string, masterKey: string): string;
export declare function encryptVaultPayload(entries: readonly VaultEntry[], masterPassword: string): EncryptedVaultEnvelope;
export declare function decryptVaultPayload(envelope: EncryptedVaultEnvelope, masterPassword: string): VaultEntry[];
/**
 * 生成高强度随机密码
 */
export declare function generateVaultPassword(options?: PasswordGeneratorOptions): string;
/**
 * 评估密码强度与信息熵
 */
export declare function evaluatePasswordStrength(password: string): PasswordStrengthResult;
/**
 * 解析单行 CSV 字段（支持双引号包裹与转义双引号）
 */
export declare function parseCsvLine(line: string): string[];
/**
 * 导出为 Chrome / Edge 标准兼容 CSV (`name,url,username,password,note`)
 */
export declare function exportEntriesToCsv(entries: readonly VaultEntry[]): string;
export declare class PasswordVaultManager {
    private entries;
    private lockState;
    private masterPasswordHash;
    private activeMasterKey;
    private lastEnvelope;
    constructor(initialEntries?: readonly VaultEntry[]);
    hydrateFromStorage(): Promise<boolean>;
    private persistEntriesToStorage;
    getLockState(): VaultLockState;
    hasMasterPassword(): boolean;
    setMasterPassword(masterPassword: string): void;
    lockVault(): VaultLockState;
    unlockVault(masterPassword: string): VaultUnlockResult;
    getEntries(options?: {
        query?: string;
        folder?: string;
    }): VaultEntry[];
    addOrUpdateEntry(input: VaultEntryInput): VaultEntry;
    deleteEntry(id: string): boolean;
    togglePinEntry(id: string): VaultEntry | undefined;
    /**
     * 导入 Chrome / Edge 导出的标准 CSV 密码表 (`name,url,username,password,note`)
     */
    importFromCsv(csvContent: string): CsvImportResult;
    resetToDefaults(): void;
}
export declare const defaultPasswordVaultManager: PasswordVaultManager;
