/**
 * ZTools 2.0 标杆原生插件: 系统与开发环境关键配置备份工坊 (System Backup 2.0)
 *
 * 核心能力：
 * 1. 自动扫描并汇总本机关键系统与极客开发配置项：
 *    - 网络与系统配置：Windows Hosts 文件、系统/用户 PATH 环境变量快照、防火墙与代理规则配置
 *    - 开发者密钥与终端配置：~/.ssh/config、~/.gitconfig、~/.npmrc、PowerShell $PROFILE、Windows Terminal settings.json
 *    - 编辑器与效率工具配置：VSCode settings.json / keybindings.json、ZTools 本地快捷指令与配置库
 *    - 历史备份快照归档：已创建的增量与全量配置归档包 (.zip / .zbak)
 * 2. 支持一键打包创建时间戳快照备份、还原指定配置项、在资源管理器中定位原配置文件
 */
import { formatBytes, type NativeInvocationResult } from "../shared/native-ipc.js";
export { formatBytes };
export type { NativeInvocationResult };
export declare const DLL_PLUGIN_NAME = "SystemBackupPlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u5907\u4EFD\u76EE\u6807\u8DEF\u5F84\u4E25\u7981\u6307\u5411\u7CFB\u7EDF\u6838\u5FC3\u4FDD\u62A4\u76EE\u5F55\u6216\u5305\u542B\u8DEF\u5F84\u7A7F\u8D8A\u5B57\u7B26";
export type BackupCategory = "all" | "network_sys" | "dev_terminal" | "editor_tools" | "snapshot_archives";
export interface BackupCategoryMeta {
    id: BackupCategory;
    name: string;
    subtitle: string;
}
export declare const BACKUP_CATEGORIES: BackupCategoryMeta[];
export type BackupProfileMode = "full_bundle" | "dotfiles_only" | "incremental_fast";
export declare const BACKUP_PROFILES: Array<{
    id: BackupProfileMode;
    label: string;
    desc: string;
}>;
export interface BackupConfigItem {
    id: string;
    name: string;
    path: string;
    category: BackupCategory;
    categoryName: string;
    sizeBytes: number;
    lastModified: string;
    statusTag: string;
}
export interface SystemBackupSnapshot {
    backupVaultDir: string;
    items: BackupConfigItem[];
    totalSizeBytes: number;
    updatedAt: string;
}
export declare function validateInvocationPayload(method: string, params: Record<string, unknown>): {
    valid: boolean;
    reason?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostOverride?: any): Promise<NativeInvocationResult>;
export declare function createInitialSystemBackupSnapshot(): SystemBackupSnapshot;
export declare function fetchSystemBackupSnapshot(hostBridge?: any): Promise<SystemBackupSnapshot>;
export declare function createBackupArchive(items: BackupConfigItem[], profileMode: BackupProfileMode, vaultDir: string, hostOverride?: any): Promise<{
    ok: boolean;
    archivePath: string;
    backedUpCount: number;
    sizeBytes?: number;
    message: string;
}>;
export declare function restoreBackupSnapshot(archivePath: string, targetDirOrHost?: any, hostOverride?: any): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function openBackupConfigLocation(targetPath: string, hostBridge?: any): Promise<boolean>;
