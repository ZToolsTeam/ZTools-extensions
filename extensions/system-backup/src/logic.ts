import { getHostTransport, type HostTransport, getLocale } from "@ztools/declarative-ui";
import {
  callHostTransport, formatBytes, getRealSystemPath, openRealPath,
  showRealItemInFolder, trashRealItem
} from "./native-ipc.js";
import { t } from "./i18n.js";
import { extractErrorCode, extractHostCode, resolveErrorMessage } from './error-i18n.js'

export { formatBytes };
export const DLL_PLUGIN_NAME = "SystemBackupPlugin";
export const FORBIDDEN_TARGET_PATTERN = /(^|[\\/])(Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|\.\.)($|[\\/])/i;
export function getForbiddenReason(): string {
  return t("forbiddenReason");
}

export type BackupCategory = "all" | "network_sys" | "dev_terminal" | "editor_tools" | "snapshot_archives";
export function getBackupCategories(): Array<{ id: BackupCategory; name: string; subtitle: string }> {
  return [
    { id: "network_sys", name: t("catNetworkName"), subtitle: t("catNetworkSub") },
    { id: "dev_terminal", name: t("catDevName"), subtitle: t("catDevSub") },
    { id: "editor_tools", name: t("catEditorName"), subtitle: t("catEditorSub") },
    { id: "snapshot_archives", name: t("catSnapshotName"), subtitle: t("catSnapshotSub") }
  ];
}

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
  if (!transport) throw new Error(t("errNeedZtoolsClient"));
  const raw = await transport.call<Record<string, unknown>>("dllplugin_call", {
    plugin: DLL_PLUGIN_NAME, func: action, params
  }, { timeoutMs: 120000 });
  if (!raw || typeof raw !== "object") throw new Error(t("errInvalidSnapshotService"));
  return (raw.data && typeof raw.data === "object" ? raw.data : raw) as T;
}

export function createInitialSystemBackupSnapshot(): SystemBackupSnapshot {
  return { backupVaultDir: "", items: [], totalSizeBytes: 0, updatedAt: "" };
}

export function latestBackupArchive(items: BackupConfigItem[]): BackupConfigItem | undefined {
  return items.filter(item => item.category === "snapshot_archives" && Number.isFinite(item.modifiedAtMs))
    .sort((a, b) => (b.modifiedAtMs ?? 0) - (a.modifiedAtMs ?? 0) || a.path.localeCompare(b.path, getLocale()))[0];
}

export async function fetchSystemBackupSnapshot(host?: SnapshotHost): Promise<SystemBackupSnapshot> {
  try {
    const [userProfile, appData, docs] = await Promise.all([
      getRealSystemPath("home", host), getRealSystemPath("appData", host), getRealSystemPath("documents", host)
    ]);
    if (!userProfile || !appData || !docs) throw new Error(t("errNoLocalConfigDir"));
    const localAppData = `${userProfile}\\AppData\\Local`;
    const backupVaultDir = `${docs}\\ZToolsBackups`;
    const candidateConfigs: Array<Omit<BackupConfigItem, "sizeBytes" | "lastModified">> = [
      {
        id: "bak_hosts",
        name: t("itemHostsName"),
        path: "C:\\Windows\\System32\\drivers\\etc\\hosts",
        category: "network_sys",
        categoryName: t("catNetworkName"),
        statusTag: t("tagCoreConfig")
      },
      {
        id: "bak_ssh_config",
        name: t("itemSshName"),
        path: `${userProfile}\\.ssh\\config`,
        category: "dev_terminal",
        categoryName: t("catDevFullName"),
        statusTag: "Dotfiles"
      },
      {
        id: "bak_gitconfig",
        name: t("itemGitName"),
        path: `${userProfile}\\.gitconfig`,
        category: "dev_terminal",
        categoryName: t("catDevFullName"),
        statusTag: "Dotfiles"
      },
      {
        id: "bak_npmrc",
        name: t("itemNpmName"),
        path: `${userProfile}\\.npmrc`,
        category: "dev_terminal",
        categoryName: t("catDevFullName"),
        statusTag: "Dotfiles"
      },
      {
        id: "bak_wt_settings",
        name: t("itemWtName"),
        path: `${localAppData}\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json`,
        category: "dev_terminal",
        categoryName: t("catDevFullName"),
        statusTag: t("tagTerminalConfig")
      },
      {
        id: "bak_ps_profile",
        name: t("itemPsName"),
        path: `${docs}\\PowerShell\\Microsoft.PowerShell_profile.ps1`,
        category: "dev_terminal",
        categoryName: t("catDevFullName"),
        statusTag: t("tagTerminalScript")
      },
      {
        id: "bak_vscode_settings",
        name: t("itemVscodeName"),
        path: `${appData}\\Code\\User\\settings.json`,
        category: "editor_tools",
        categoryName: t("catEditorFullName"),
        statusTag: t("tagIdeConfig")
      }
    ];

    const [probedSizes, archiveResult] = await Promise.all([
      Promise.all(candidateConfigs.map(async config => {
        const result = await callHostTransport<number | { size?: number }>("filesystem_get_file_size", { path: config.path }, host);
        if (!result.ok) {
          const code = extractErrorCode(result).toUpperCase();
          const hostCode = extractHostCode(result).toUpperCase();
          const errStr = String(result.error || "");
          if (
            code === "FILE_NOT_FOUND" || code === "ENOENT" ||
            hostCode === "FILE_NOT_FOUND" || hostCode === "ENOENT" ||
            /\b(?:ENOENT|FILE_NOT_FOUND)\b|not found/i.test(errStr) ||
            // i18n-allow: legacy host fallback
            /不存在/.test(errStr)
          ) return null;
          throw new Error(resolveErrorMessage(result, t("errReadConfigFailed")));
        }
        const size = typeof result.data === "number" ? result.data : result.data?.size;
        if (typeof size !== "number" || !Number.isFinite(size) || size < 0) throw new Error(t("errInvalidConfigSize"));
        return size;
      })),
      callSnapshotService<{ success?: boolean; error?: string; backups?: Array<{ path: string; name: string; sizeBytes: number; createdAt: string }> }>(
        "scanSnapshots", { backupDir: backupVaultDir }, host
      )
    ]);
    if (archiveResult.success !== true || !Array.isArray(archiveResult.backups)) {
      throw new Error(resolveErrorMessage(archiveResult, t("errReadArchiveListFailed")));
    }
    const items: BackupConfigItem[] = candidateConfigs.flatMap((config, index) => {
      const size = probedSizes[index];
      return size === null || size === undefined ? [] : [{ ...config, sizeBytes: size, lastModified: t("verifiedExists") }];
    });
    for (const archive of archiveResult.backups) {
      const modifiedAtMs = Date.parse(archive.createdAt);
      if (!archive.path || !Number.isFinite(modifiedAtMs) || !Number.isFinite(archive.sizeBytes)) {
        throw new Error(t("errInvalidArchiveItem"));
      }
      items.push({
        id: `archive:${archive.path}`, name: archive.name, path: archive.path,
        category: "snapshot_archives", categoryName: t("catSnapshotName"), sizeBytes: archive.sizeBytes,
        modifiedAtMs, lastModified: new Date(modifiedAtMs).toLocaleString(getLocale()), statusTag: t("tagExtractableSnapshot")
      });
    }
    return { backupVaultDir, items, totalSizeBytes: items.reduce((total, item) => total + item.sizeBytes, 0), updatedAt: new Date().toLocaleTimeString(getLocale()) };
  } catch (error) {
    return { ...createInitialSystemBackupSnapshot(), error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createBackupArchive(items: BackupConfigItem[], vaultDir: string, host?: SnapshotHost) {
  const failed = (message: string, failedSources: BackupFailure[] = []) => ({
    ok: false, partial: false, archivePath: "", backedUpCount: 0, sizeBytes: 0, failedSources, message
  });
  if (!vaultDir || FORBIDDEN_TARGET_PATTERN.test(vaultDir)) return failed(t("forbiddenReason"));
  const targets = items.filter(item => item.category !== "snapshot_archives");
  if (targets.length === 0) return failed(t("errSelectAtLeastOne"));
  try {
    const result = await callSnapshotService<CreateSnapshotReply>("createSnapshotArchive", {
      sourcePaths: [...new Set(targets.map(item => item.path))], backupDir: vaultDir
    }, host);
    const failures = Array.isArray(result.failedSources) ? result.failedSources : [];
    const details = failures.map(item => `${item.path}: ${item.error}`).join("; ");
    if (result.success !== true || result.ok !== true) {
      return failed(details || resolveErrorMessage(result, t("errCreateSnapshotFailed")), failures);
    }
    if (!result.archivePath || !Number.isInteger(result.backedUpCount) || !(result.backedUpCount! > 0) ||
        typeof result.sizeBytes !== "number" || !Number.isFinite(result.sizeBytes) || !Array.isArray(result.failedSources)) {
      return failed(t("errIncompleteBackupResult"));
    }
    const partial = failures.length > 0;
    return {
      ok: !partial, partial, archivePath: result.archivePath, backedUpCount: result.backedUpCount!,
      sizeBytes: result.sizeBytes, failedSources: failures,
      message: t("msgBackupSummary", {
        prefix: partial ? t("msgPartialDone") : t("msgSnapshotCreated"),
        count: result.backedUpCount!,
        size: formatBytes(result.sizeBytes),
        path: result.archivePath,
        failed: partial ? t("msgBackupFailedPart", { count: failures.length, details }) : ""
      })
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

export async function extractBackupSnapshot(archivePath: string, host?: SnapshotHost): Promise<{ ok: boolean; outputDir: string; message: string }> {
  if (!archivePath.trim() || FORBIDDEN_TARGET_PATTERN.test(archivePath)) return { ok: false, outputDir: "", message: t("forbiddenReason") };
  try {
    const result = await callSnapshotService<ExtractSnapshotReply>("extractSnapshotArchive", { archivePath }, host);
    if (result.ok !== true || result.success !== true || !result.targetDir) {
      return { ok: false, outputDir: result.targetDir || "", message: resolveErrorMessage(result, t("errExtractUnconfirmed")) };
    }
    return { ok: true, outputDir: result.targetDir, message: t("msgExtractedTo", { dir: result.targetDir }) };
  } catch (error) {
    return { ok: false, outputDir: "", message: error instanceof Error ? error.message : String(error) };
  }
}

export async function deleteBackupSnapshot(archivePath: string, host?: SnapshotHost): Promise<{ ok: boolean; message: string }> {
  const clean = String(archivePath || "").trim();
  if (!clean || FORBIDDEN_TARGET_PATTERN.test(clean)) {
    return { ok: false, message: t("forbiddenReason") };
  }
  const res = await trashRealItem(clean, host);
  if (!res.ok) {
    return { ok: false, message: resolveErrorMessage(res, t("errDeleteSnapshotFailed")) };
  }
  return { ok: true, message: t("msgSnapshotDeleted", { path: clean }) };
}

export async function openBackupConfigLocation(targetPath: string, host?: SnapshotHost): Promise<boolean> {
  return targetPath ? showRealItemInFolder(targetPath, host) : false;
}

export async function openExtractedDirectory(targetPath: string, host?: SnapshotHost): Promise<boolean> {
  return targetPath ? openRealPath(targetPath, host) : false;
}
