import type { EnvFilterCategory, EnvItem, EnvScope } from './types.js';
export declare function expandEnvVariablesInString(rawValue: string, envMap: Record<string, string>): string;
export declare function loadAllEnvVariables(customEnv?: Record<string, string>, hostOverride?: unknown): Promise<EnvItem[]>;
export declare function cleanInvalidPathEntries(options?: {
    rawPath?: string;
    customEnv?: Record<string, string>;
    scope?: EnvScope;
}, hostOverride?: unknown): Promise<{
    removedCount: number;
    cleanedPath: string;
    remainingEntries: string[];
}>;
export declare function writeEnvVariable(key: string, value: string, scope?: EnvScope, options?: {
    simulateNoAdmin?: boolean;
}, hostOverride?: unknown): Promise<{
    ok: boolean;
    errorCode?: string;
    error?: string;
}>;
export declare function exportEnvSnapshot(items: EnvItem[]): string;
export declare function filterEnvItems(items: EnvItem[], searchText: string, category: EnvFilterCategory): EnvItem[];
