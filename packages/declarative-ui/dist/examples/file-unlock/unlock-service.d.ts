import { pickExampleFolderFiles } from '../shared/file-import.js';
import type { FileUnlockExecutionResult, FileUnlockInspectionResult, LockingProcessItem, RemovableDriveItem, ServiceTypeLabel, UnlockProcessFilter } from './types.js';
export declare const FILE_UNLOCK_PLUGIN_NAME = "FileUnlockPlugin";
export declare const CRITICAL_KERNEL_PROCESS_NAMES: Set<string>;
export declare function normalizeProcessBaseName(name: string): string;
export declare function isKernelProtectedProcess(pid: number, name: string): boolean;
export declare function resolveServiceTypeLabel(pid: number, name: string, rawLabel?: string): ServiceTypeLabel;
export declare function sanitizeInputPath(rawInput: string): string;
export declare function looksLikeFilePath(rawInput: string): boolean;
export declare function validateTargetPath(rawInput: string): {
    valid: boolean;
    normalizedPath: string;
    errorCode?: string;
    error?: string;
};
export declare function normalizeLockingProcess(raw: Record<string, unknown>, fallbackTargetPath: string): LockingProcessItem;
export declare function detectClipboardCandidatePath(hostOverride?: unknown): Promise<string>;
export declare function pickUnlockTargetPath(directory: boolean, hostOverride?: unknown): Promise<{
    canceled: boolean;
    path?: string;
    error?: string;
}>;
export declare function listRemovableDrives(hostOverride?: unknown): Promise<RemovableDriveItem[]>;
export declare function inspectTargetLocks(rawTargetPath: string, hostOverride?: unknown, extraParams?: Record<string, unknown>): Promise<FileUnlockInspectionResult>;
export declare function unlockSingleProcess(proc: LockingProcessItem, targetPath: string, options?: {
    trashAfterUnlock?: boolean;
    renameTo?: string;
    extraParams?: Record<string, unknown>;
}, hostOverride?: unknown): Promise<FileUnlockExecutionResult>;
export declare function unlockAllProcesses(processes: LockingProcessItem[], targetPath: string, options?: {
    trashAfterUnlock?: boolean;
    renameTo?: string;
    extraParams?: Record<string, unknown>;
}, hostOverride?: unknown): Promise<FileUnlockExecutionResult>;
export declare function unlockAndTrashTarget(processes: LockingProcessItem[], targetPath: string, hostOverride?: unknown, extraParams?: Record<string, unknown>): Promise<FileUnlockExecutionResult>;
export declare function filterLockingProcesses(processes: LockingProcessItem[], filter: UnlockProcessFilter, query: string): LockingProcessItem[];
export declare function revealLockedTargetInFolder(targetPath: string, hostOverride?: unknown): Promise<boolean>;
export declare function revealProcessExecutableInFolder(executablePath: string, hostOverride?: unknown): Promise<boolean>;
export declare function openUnlockedTarget(targetPath: string, hostOverride?: unknown): Promise<boolean>;
export declare function copyProcessInfoToClipboard(text: string, hostOverride?: unknown): Promise<boolean>;
export { pickExampleFolderFiles };
