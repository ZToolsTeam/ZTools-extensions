/**
 * ZTools 2.0 标杆原生插件: C盘大目录无感乾坤大挪移 (Mover 2.0 - NTFS Junction 符号链接无感迁移引擎)
 *
 * 核心能力：
 * 1. 扫描 C:\Users 下的大体积目录（Downloads, Documents, Desktop, AppData\Local\Temp, 微信 WeChat Files, QQ Tencent Files, npm/pip/NuGet/VSCode 缓存）
 * 2. 支持将 C 盘高占用目录物理迁移至目标大容量分区（如 D:\ZToolsMoved、E:\ZToolsMoved），并在原路径建立 NTFS Junction 目录联接 (`mklink /J`)，应用无感知运行
 * 3. 严格拦截 C:\Windows、C:\Windows\System32、C:\Program Files 等系统核心路径，设置 lockedReason 禁止勾选迁移
 */
import { formatBytes, type NativeInvocationResult } from "../shared/native-ipc.js";
export { formatBytes };
export type { NativeInvocationResult };
export declare const DLL_PLUGIN_NAME = "MoverPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u7981\u6B62\u8FC1\u79FB Windows \u7CFB\u7EDF\u6838\u5FC3\u76EE\u5F55\u6216\u5305\u542B\u8DEF\u5F84\u7A7F\u8D8A\u5B57\u7B26";
export type MoverCategory = "all" | "social_office" | "user_profile" | "dev_cache" | "system_locked";
export interface MoverCategoryMeta {
    id: MoverCategory;
    name: string;
    subtitle: string;
}
export declare const MOVER_CATEGORIES: MoverCategoryMeta[];
export interface TargetDriveOption {
    id: string;
    driveLetter: string;
    targetRoot: string;
    label: string;
    freeBytes: number;
    totalBytes: number;
}
export declare const DEFAULT_TARGET_DRIVES: TargetDriveOption[];
export interface MovableFolderItem {
    id: string;
    name: string;
    sourcePath: string;
    category: MoverCategory;
    categoryName: string;
    sizeBytes: number;
    fileCount: number;
    junctionSupported: boolean;
    isSystemLocked: boolean;
    lockedReason?: string;
}
export interface MoverSnapshot {
    cDriveTotalBytes: number;
    cDriveFreeBytes: number;
    targetDrives: TargetDriveOption[];
    folders: MovableFolderItem[];
    totalMovableBytes: number;
    updatedAt: string;
}
export declare function validateInvocationPayload(method: string, params: Record<string, unknown>): {
    valid: boolean;
    reason?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostOverride?: any): Promise<NativeInvocationResult>;
export declare function createInitialMoverSnapshot(): MoverSnapshot;
export declare function fetchMoverSnapshot(hostBridge?: any): Promise<MoverSnapshot>;
export declare function executeDirectoryMove(items: MovableFolderItem[], targetRoot: string, hostOverride?: any): Promise<{
    ok: boolean;
    movedCount: number;
    freedBytes: number;
    message: string;
}>;
export declare function openMoverFolderLocation(folderPath: string, hostBridge?: any): Promise<boolean>;
export declare function invokeMoverAction(actionId: string, targetRoot: string, hostOverride?: any): Promise<NativeInvocationResult>;
