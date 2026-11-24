import type { VaultEntry, VaultNewEntryInput } from './types.js';
export * from './types.js';
export * from './vault-crypto.js';
interface VaultEntryFormProps {
    initialPassword?: string;
    onSave: (input: VaultNewEntryInput) => Promise<void>;
}
export declare function VaultEntryForm({ initialPassword, onSave }: VaultEntryFormProps): JSX.Element;
export interface PasswordVaultProps {
    featureCode?: string;
    initialUnlockedEntries?: VaultEntry[];
    initialMasterPassword?: string;
}
export declare function PasswordVault({ featureCode, initialUnlockedEntries, initialMasterPassword }?: PasswordVaultProps): JSX.Element;
export declare const PasswordVaultCommand: typeof PasswordVault;
export default PasswordVault;
export declare function VaultEntryDetailView(props?: Record<string, unknown>): JSX.Element;
export declare function VaultUnlockForm(props?: Record<string, unknown>): JSX.Element;
export declare function VaultImportCsvForm(props?: Record<string, unknown>): JSX.Element;
