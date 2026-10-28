type DynamicBridge = ReturnType<typeof JSON.parse>;
/**
 * 回收站文件取回：由客户端列出 Windows 回收站（C、D、E 盘）里的文件，把勾选的文件复制到桌面的恢复文件夹。
 *
 * - 列表里是回收站内部的文件名（以 $R 开头），客户端不提供原始文件名、原路径和删除时间，界面也不编造
 * - 不能恢复已清空回收站、格式化或被覆盖的数据
 * - 每次恢复复制到一个新的、以时间命名的子文件夹，不覆盖已有文件；回收站里的文件保持不动
 * - 任何一个文件失败都如实列出原因，不改用其他方式顶替
 */

import {
  formatBytes,
  getRealSystemPath,
  invokeHostCapability,
  isRealElectronHost,
  openRealPath,
  showRealItemInFolder,
  type NativeInvocationResult
} from "./native-ipc.js";

export { formatBytes };
export type { NativeInvocationResult };

export const FORBIDDEN_TARGET_PATTERN =
  /(^|[\\/])(Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|\.\.)($|[\\/])/i;
export const FORBIDDEN_REASON = "不能向系统目录写入恢复文件，路径中也不能包含 ..";
export const NOT_IN_CLIENT_MESSAGE = "需要在 ZTools 客户端中使用";
export const RESTORE_FOLDER_NAME = "ZToolsRecovered";

export type RecoveryCategory = "all" | "documents" | "images" | "media" | "archives_code" | "other";

export interface RecoveryCategoryMeta {
  id: Exclude<RecoveryCategory, "all">;
  name: string;
  subtitle: string;
  exts: string[];
}

export const RECOVERY_CATEGORIES: RecoveryCategoryMeta[] = [
  {
    id: "documents",
    name: "文档",
    subtitle: "Word / Excel / PPT / PDF / 文本",
    exts: [".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".pdf", ".md", ".txt", ".csv", ".wps"]
  },
  {
    id: "images",
    name: "图片",
    subtitle: "PNG / JPG / PSD / RAW 等",
    exts: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".psd", ".svg", ".raw", ".cr2", ".heic"]
  },
  {
    id: "media",
    name: "视频音频",
    subtitle: "MP4 / MOV / MP3 / WAV 等",
    exts: [".mp4", ".mov", ".mkv", ".avi", ".mp3", ".wav", ".flac", ".m4a"]
  },
  {
    id: "archives_code",
    name: "压缩包与代码",
    subtitle: "ZIP / 7z / RAR / SQL / 源代码",
    exts: [".zip", ".7z", ".rar", ".tar", ".gz", ".sql", ".json", ".ts", ".js", ".py"]
  },
  {
    id: "other",
    name: "其他",
    subtitle: "不属于以上类型的文件",
    exts: []
  }
];

export interface RecoverableFileItem {
  id: string;
  /** 回收站内部文件名（以 $R 开头，保留扩展名） */
  name: string;
  /** 文件在回收站中的位置 */
  cachePath: string;
  category: Exclude<RecoveryCategory, "all">;
  categoryName: string;
  sizeBytes: number;
  /** 文件的修改时间（不是删除时间）；客户端没有提供时为空 */
  modifiedText: string;
}

export interface DataRecoverySnapshot {
  /** 恢复文件夹（每次恢复在其中新建以时间命名的子文件夹）；拿不到桌面路径时为空 */
  restoreTargetDir: string;
  items: RecoverableFileItem[];
  totalSizeBytes: number;
  updatedAt: string;
  error?: string;
}

export interface RestoreFailure {
  name: string;
  error: string;
}

export interface RestoreResult {
  ok: boolean;
  restoredCount: number;
  restoredBytes: number;
  restoredPaths: string[];
  failed: RestoreFailure[];
  outputDir: string;
  message: string;
}

export function createEmptyRecoverySnapshot(error?: string): DataRecoverySnapshot {
  return {
    restoreTargetDir: "",
    items: [],
    totalSizeBytes: 0,
    updatedAt: "",
    ...(error ? { error } : {})
  };
}

export function classifyRecoveryExt(extRaw: string): RecoveryCategoryMeta {
  const ext = String(extRaw || "").toLowerCase();
  for (const cat of RECOVERY_CATEGORIES) {
    if (cat.exts.includes(ext)) return cat;
  }
  return RECOVERY_CATEGORIES.find((c) => c.id === "other")!;
}

function hasClientHost(hostBridge?: DynamicBridge): boolean {
  return Boolean(hostBridge) || isRealElectronHost();
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatModified(raw: DynamicBridge): string {
  const iso = typeof raw?.modifiedAt === "string" ? Date.parse(raw.modifiedAt) : NaN;
  const ms = Number.isFinite(iso) ? iso : Number(raw?.deletedAtMs);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleString();
}

export async function fetchRecoverableFiles(hostBridge?: DynamicBridge): Promise<DataRecoverySnapshot> {
  if (!hasClientHost(hostBridge)) {
    return createEmptyRecoverySnapshot(NOT_IN_CLIENT_MESSAGE);
  }
  try {
    const [desktop, hostScanRes] = await Promise.all([
      getRealSystemPath("desktop", hostBridge),
      invokeHostCapability<DynamicBridge>("recovery.scanDeletedFiles", {}, hostBridge)
    ]);
    const restoreTargetDir = desktop ? `${desktop.replace(/[\\/]+$/, "")}\\${RESTORE_FOLDER_NAME}` : "";

    if (!hostScanRes.ok || !hostScanRes.data) {
      return {
        ...createEmptyRecoverySnapshot(`读取回收站失败：${hostScanRes.error || hostScanRes.message || "客户端没有返回结果"}`),
        restoreTargetDir
      };
    }
    const data = hostScanRes.data;
    const rawItems: DynamicBridge[] = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.files)
          ? data.files
          : [];

    const items: RecoverableFileItem[] = [];
    const seen = new Set<string>();
    for (const raw of rawItems) {
      const cachePath = String(raw?.cachePath || raw?.path || raw?.sourcePath || "").trim();
      if (!cachePath) continue;
      const key = cachePath.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const name = String(raw?.name || cachePath.split(/[\\/]/).pop() || "");
      const extMatch = name.match(/\.[^.\\/]+$/);
      const cat = classifyRecoveryExt(extMatch ? extMatch[0] : "");
      items.push({
        id: String(raw?.id || `rec_${items.length}`),
        name,
        cachePath,
        category: cat.id,
        categoryName: cat.name,
        sizeBytes: Math.max(0, Number(raw?.sizeBytes ?? raw?.size ?? 0) || 0),
        modifiedText: formatModified(raw)
      });
    }

    return {
      restoreTargetDir,
      items,
      totalSizeBytes: items.reduce((s, i) => s + i.sizeBytes, 0),
      updatedAt: new Date().toLocaleTimeString(),
      ...(restoreTargetDir ? {} : { error: "无法获取桌面路径，不能恢复文件" })
    };
  } catch (err) {
    return createEmptyRecoverySnapshot(`读取回收站失败：${errorText(err)}`);
  }
}

export const scanRecoverableFiles = fetchRecoverableFiles;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** 本次恢复使用的新子文件夹名，例如 20261028-153012-045 */
export function restoreRunFolderName(now: Date = new Date()): string {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
}

/** 同一次恢复里文件名重复时追加序号，保证不互相覆盖 */
function uniqueName(name: string, used: Set<string>): string {
  const lower = name.toLowerCase();
  if (!used.has(lower)) {
    used.add(lower);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i += 1) {
    const candidate = `${stem} (${i})${ext}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

export async function restoreSelectedFiles(
  items: RecoverableFileItem[],
  restoreDir: string,
  hostOverride?: DynamicBridge,
  now: Date = new Date()
): Promise<RestoreResult> {
  const baseDir = String(restoreDir || "").trim().replace(/[\\/]+$/, "");
  const empty = (message: string): RestoreResult => ({
    ok: false,
    restoredCount: 0,
    restoredBytes: 0,
    restoredPaths: [],
    failed: [],
    outputDir: "",
    message
  });
  if (!baseDir) return empty("无法获取桌面路径，不能恢复文件");
  if (FORBIDDEN_TARGET_PATTERN.test(baseDir)) return empty(FORBIDDEN_REASON);
  if (!items || items.length === 0) return empty("请先勾选要恢复的文件");

  const outputDir = `${baseDir}\\${restoreRunFolderName(now)}`;
  const used = new Set<string>();
  const restoredPaths: string[] = [];
  const failed: RestoreFailure[] = [];
  let restoredBytes = 0;

  for (const item of items) {
    const src = String(item?.cachePath || "").trim();
    const name = String(item?.name || "").trim();
    if (!src || !name || /[\\/]/.test(name) || name === "." || name === "..") {
      failed.push({ name: name || src || "（未知文件）", error: "文件路径无效" });
      continue;
    }
    if (FORBIDDEN_TARGET_PATTERN.test(src)) {
      failed.push({ name, error: FORBIDDEN_REASON });
      continue;
    }
    const dest = `${outputDir}\\${uniqueName(name, used)}`;
    const res = await invokeHostCapability<DynamicBridge>(
      "recovery.restoreFile",
      { sourcePath: src, targetPath: dest },
      hostOverride
    );
    if (res.ok) {
      restoredPaths.push(String(res.data?.targetPath || dest));
      restoredBytes += item.sizeBytes;
    } else {
      failed.push({ name, error: res.error || res.message || "复制失败" });
    }
  }

  const failureText = failed[0] ? `${failed[0].name}：${failed[0].error}` : "";
  let message: string;
  if (failed.length === 0) {
    message = `已将 ${restoredPaths.length} 个文件 (${formatBytes(restoredBytes)}) 复制到 ${outputDir}`;
  } else if (restoredPaths.length === 0) {
    message = `恢复失败，${failed.length} 个文件均未复制。${failureText}`;
  } else {
    message = `已复制 ${restoredPaths.length} 个文件到 ${outputDir}，${failed.length} 个失败。${failureText}`;
  }

  return {
    ok: failed.length === 0,
    restoredCount: restoredPaths.length,
    restoredBytes,
    restoredPaths,
    failed,
    outputDir: restoredPaths.length > 0 ? outputDir : "",
    message
  };
}

export async function showRecoveryItem(targetPath: string, hostBridge?: DynamicBridge): Promise<boolean> {
  if (!targetPath) return false;
  return showRealItemInFolder(targetPath, hostBridge);
}

export async function openRecoveryFolder(dirPath: string, hostBridge?: DynamicBridge): Promise<boolean> {
  if (!dirPath) return false;
  return openRealPath(dirPath, hostBridge);
}
