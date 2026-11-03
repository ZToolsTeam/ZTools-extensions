import { getHostTransport, type HostTransport } from "@ztools/declarative-ui";
import {
  callHostTransport, formatBytes, getRealSystemPath, openRealPath,
  showRealItemInFolder
} from "./native-ipc.js";

export { formatBytes };
export const DLL_PLUGIN_NAME = "SystemBackupPlugin";
export const FORBIDDEN_TARGET_PATTERN = /(^|[\\/])(Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|\.\.)($|[\\/])/i;
export const FORBIDDEN_REASON = "输出位置不能是系统保护目录或包含上级路径";

export type BackupCategory = "all" | "network_sys" | "dev_terminal" | "editor_tools" | "snapshot_archives";
export const BACKUP_CATEGORIES: Array<{ id: BackupCategory; name: string; subtitle: string }> = [
  { id: "network_sys", name: "网络与系统配置", subtitle: "Windows Hosts 文件" },
  { id: "dev_terminal", name: "终端与开发配置", subtitle: "SSH、Git、npm、PowerShell 与 Windows Terminal 配置" },
  { id: "editor_tools", name: "编辑器配置", subtitle: "VS Code 用户设置" },
  { id: "snapshot_archives", name: "历史快照", subtitle: "解压到新目录，按需取回配置" }
];

export interface BackupConfigItem {
  id: string;
  name: string;
  path: string;
  category: BackupCategory;
  categoryName: string;
  sizeBytes: number;
  lastModified: string;
  modifiedAtMs?: number;
  statusTag: string;
}
export interface SystemBackupSnapshot {
  backupVaultDir: string;
  items: BackupConfigItem[];
  totalSizeBytes: number;
  updatedAt: string;
  error?: string;
}
export interface BackupFailure { path: string; error: string }
interface SnapshotHost { transport: HostTransport }
interface CreateSnapshotReply {
  ok?: boolean;
  success?: boolean;
  archivePath?: string;
  backedUpCount?: number;
  sizeBytes?: number;
  failedSources?: BackupFailure[];
  error?: string;
}
interface ExtractSnapshotReply {
  ok?: boolean;
  success?: boolean;
  targetDir?: string;
  error?: string;
}

/** 保留业务失败回执中的逐源结果，不能交给丢弃失败载荷的通用解包函数。 */
async function callSnapshotService<T>(action: string, params: Record<string, unknown>, host?: SnapshotHost): Promise<T> {
  const transport = host?.transport ?? getHostTransport();
  if (!transport) throw new Error("需要在 ZTools 客户端中使用");
  const raw = await transport.call<Record<string, unknown>>("dllplugin_call", {
    plugin: DLL_PLUGIN_NAME, func: action, params
  }, { timeoutMs: 120000 });
  if (!raw || typeof raw !== "object") throw new Error("快照服务返回格式无效");
  return (raw.data && typeof raw.data === "object" ? raw.data : raw) as T;
}

export function createInitialSystemBackupSnapshot(): SystemBackupSnapshot {
  return { backupVaultDir: "", items: [], totalSizeBytes: 0, updatedAt: "" };
}

export function latestBackupArchive(items: BackupConfigItem[]): BackupConfigItem | undefined {
  return items.filter(item => item.category === "snapshot_archives" && Number.isFinite(item.modifiedAtMs))
    .sort((a, b) => (b.modifiedAtMs ?? 0) - (a.modifiedAtMs ?? 0) || a.path.localeCompare(b.path))[0];
}

export async function fetchSystemBackupSnapshot(host?: SnapshotHost): Promise<SystemBackupSnapshot> {
  try {
    const [userProfile, appData, docs] = await Promise.all([
      getRealSystemPath("home", host), getRealSystemPath("appData", host), getRealSystemPath("documents", host)
    ]);
    if (!userProfile || !appData || !docs) throw new Error("无法获取本机配置目录");
    const localAppData = `${userProfile}\\AppData\\Local`;
    const backupVaultDir = `${docs}\\ZToolsBackups`;
    const candidateConfigs: Array<Omit<BackupConfigItem, "sizeBytes" | "lastModified">> = [
      {
        id: "bak_hosts",
        name: "Windows Hosts 域名映射表 (etc\\hosts)",
        path: "C:\\Windows\\System32\\drivers\\etc\\hosts",
        category: "network_sys",
        categoryName: "网络与系统配置",
        statusTag: "核心配置"
      },
      {
        id: "bak_ssh_config",
        name: "SSH 客户端主机与跳板机配置 (.ssh\\config)",
        path: `${userProfile}\\.ssh\\config`,
        category: "dev_terminal",
        categoryName: "开发者密钥与终端配置",
        statusTag: "Dotfiles"
      },
      {
        id: "bak_gitconfig",
        name: "Git 全局别名与签名配置 (.gitconfig)",
        path: `${userProfile}\\.gitconfig`,
        category: "dev_terminal",
        categoryName: "开发者密钥与终端配置",
        statusTag: "Dotfiles"
      },
      {
        id: "bak_npmrc",
        name: "NPM 全局镜像与凭证配置 (.npmrc)",
        path: `${userProfile}\\.npmrc`,
        category: "dev_terminal",
        categoryName: "开发者密钥与终端配置",
        statusTag: "Dotfiles"
      },
      {
        id: "bak_wt_settings",
        name: "Windows Terminal 终端配置 (settings.json)",
        path: `${localAppData}\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json`,
        category: "dev_terminal",
        categoryName: "开发者密钥与终端配置",
        statusTag: "终端配置"
      },
      {
        id: "bak_ps_profile",
        name: "PowerShell 7 终端启动脚本 (Microsoft.PowerShell_profile.ps1)",
        path: `${docs}\\PowerShell\\Microsoft.PowerShell_profile.ps1`,
        category: "dev_terminal",
        categoryName: "开发者密钥与终端配置",
        statusTag: "终端脚本"
      },
      {
        id: "bak_vscode_settings",
        name: "VSCode 全局设置 (settings.json)",
        path: `${appData}\\Code\\User\\settings.json`,
        category: "editor_tools",
        categoryName: "编辑器与效率工具配置",
        statusTag: "IDE 配置"
      }
    ];

    const [probedSizes, archiveResult] = await Promise.all([
      Promise.all(candidateConfigs.map(async config => {
        const result = await callHostTransport<number | { size?: number }>("filesystem_get_file_size", { path: config.path }, host);
        if (!result.ok) {
          if (/ENOENT|FILE_NOT_FOUND|不存在/i.test(result.error || "")) return null;
          throw new Error(result.error || "配置文件读取失败");
        }
        const size = typeof result.data === "number" ? result.data : result.data?.size;
        if (typeof size !== "number" || !Number.isFinite(size) || size < 0) throw new Error("配置文件大小返回无效");
        return size;
      })),
      callSnapshotService<{ success?: boolean; error?: string; backups?: Array<{ path: string; name: string; sizeBytes: number; createdAt: string }> }>(
        "scanSnapshots", { backupDir: backupVaultDir }, host
      )
    ]);
    if (archiveResult.success !== true || !Array.isArray(archiveResult.backups)) {
      throw new Error(archiveResult.error || "读取快照列表失败");
    }
    const items: BackupConfigItem[] = candidateConfigs.flatMap((config, index) => {
      const size = probedSizes[index];
      return size === null || size === undefined ? [] : [{ ...config, sizeBytes: size, lastModified: "本机已验证存在" }];
    });
    for (const archive of archiveResult.backups) {
      const modifiedAtMs = Date.parse(archive.createdAt);
      if (!archive.path || !Number.isFinite(modifiedAtMs) || !Number.isFinite(archive.sizeBytes)) {
        throw new Error("快照列表中的路径、时间或大小无效");
      }
      items.push({
        id: `archive:${archive.path}`, name: archive.name, path: archive.path,
        category: "snapshot_archives", categoryName: "历史快照", sizeBytes: archive.sizeBytes,
        modifiedAtMs, lastModified: new Date(modifiedAtMs).toLocaleString(), statusTag: "可解压快照"
      });
    }
    return { backupVaultDir, items, totalSizeBytes: items.reduce((total, item) => total + item.sizeBytes, 0), updatedAt: new Date().toLocaleTimeString() };
  } catch (error) {
    return { ...createInitialSystemBackupSnapshot(), error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createBackupArchive(items: BackupConfigItem[], vaultDir: string, host?: SnapshotHost) {
  const failed = (message: string, failedSources: BackupFailure[] = []) => ({
    ok: false, partial: false, archivePath: "", backedUpCount: 0, sizeBytes: 0, failedSources, message
  });
  if (!vaultDir || FORBIDDEN_TARGET_PATTERN.test(vaultDir)) return failed(FORBIDDEN_REASON);
  const targets = items.filter(item => item.category !== "snapshot_archives");
  if (targets.length === 0) return failed("请先勾选至少一项配置文件");
  try {
    const result = await callSnapshotService<CreateSnapshotReply>("createSnapshotArchive", {
      sourcePaths: [...new Set(targets.map(item => item.path))], backupDir: vaultDir
    }, host);
    const failures = Array.isArray(result.failedSources) ? result.failedSources : [];
    const details = failures.map(item => `${item.path}：${item.error}`).join("；");
    if (result.success !== true || result.ok !== true) {
      return failed(details || result.error || "创建快照失败", failures);
    }
    if (!result.archivePath || !Number.isInteger(result.backedUpCount) || !(result.backedUpCount! > 0) ||
        typeof result.sizeBytes !== "number" || !Number.isFinite(result.sizeBytes) || !Array.isArray(result.failedSources)) {
      return failed("客户端没有返回完整的备份结果，请更新客户端后重试");
    }
    const partial = failures.length > 0;
    return {
      ok: !partial, partial, archivePath: result.archivePath, backedUpCount: result.backedUpCount!,
      sizeBytes: result.sizeBytes, failedSources: failures,
      message: `${partial ? "部分完成" : "已创建快照"}：已备份 ${result.backedUpCount} 项配置（${formatBytes(result.sizeBytes)}），归档：${result.archivePath}` +
        (partial ? `；${failures.length} 项失败：${details}` : "")
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

export async function extractBackupSnapshot(archivePath: string, host?: SnapshotHost): Promise<{ ok: boolean; outputDir: string; message: string }> {
  if (!archivePath.trim() || FORBIDDEN_TARGET_PATTERN.test(archivePath)) return { ok: false, outputDir: "", message: FORBIDDEN_REASON };
  try {
    const result = await callSnapshotService<ExtractSnapshotReply>("extractSnapshotArchive", { archivePath }, host);
    if (result.ok !== true || result.success !== true || !result.targetDir) {
      return { ok: false, outputDir: result.targetDir || "", message: result.error || "客户端未确认快照的解压结果，请更新客户端后重试" };
    }
    return { ok: true, outputDir: result.targetDir, message: `快照已解压到 ${result.targetDir}，可按需取回配置文件` };
  } catch (error) {
    return { ok: false, outputDir: "", message: error instanceof Error ? error.message : String(error) };
  }
}

export async function openBackupConfigLocation(targetPath: string, host?: SnapshotHost): Promise<boolean> {
  return targetPath ? showRealItemInFolder(targetPath, host) : false;
}

export async function openExtractedDirectory(targetPath: string, host?: SnapshotHost): Promise<boolean> {
  return targetPath ? openRealPath(targetPath, host) : false;
}
