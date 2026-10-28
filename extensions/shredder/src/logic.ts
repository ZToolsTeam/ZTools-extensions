type DynamicBridge = ReturnType<typeof JSON.parse>;
/**
 * 文件粉碎：列出临时文件夹与崩溃转储目录里的文件，勾选后由客户端多次覆写文件内容，再改成随机文件名删除。
 *
 * - 覆写方式：1 次（全 0）、3 次（全 0、全 1、随机）、7 次（全 0、全 1、5 次随机），覆写图样由客户端决定
 * - 候选文件只来自 %TEMP% 与 %LOCALAPPDATA%\CrashDumps；Windows 系统目录下的路径一律拒绝
 * - 不在客户端里运行时不显示任何示例文件，只提示需要在客户端中使用
 * - 任何一个文件粉碎失败都如实返回，不改用普通删除顶替
 */

import {
  formatBytes,
  getRealSystemPath,
  invokeHostCapability,
  isRealElectronHost,
  scanRealDirectoryTree,
  showRealItemInFolder,
  type NativeInvocationResult
} from "./native-ipc.js";

export { formatBytes };
export type { NativeInvocationResult };

export const FORBIDDEN_TARGET_PATTERN =
  /(^|[\\/])(Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|Boot|ntoskrnl\.exe|pagefile\.sys|\.\.)($|[\\/])/i;
export const FORBIDDEN_REASON = "不能粉碎 Windows 系统目录下的文件";
export const NOT_IN_CLIENT_MESSAGE = "需要在 ZTools 客户端中使用";
/** 单次最多列出的候选文件数 */
export const MAX_CANDIDATES = 30;
/** 确认框里最多逐个列出的文件数 */
export const CONFIRM_LIST_LIMIT = 10;

export type ShredStandardId = "dod_3pass" | "seven_pass" | "zero_1pass";

export interface ShredStandardMeta {
  id: ShredStandardId;
  name: string;
  passes: number;
  badge: string;
  description: string;
}

export const SHRED_STANDARDS: ShredStandardMeta[] = [
  {
    id: "dod_3pass",
    name: "3 次覆写（全 0、全 1、随机）",
    passes: 3,
    badge: "3 次覆写",
    description: "参照 DoD 5220.22-M 的三次覆写：依次写入全 0、全 1、随机数据"
  },
  {
    id: "seven_pass",
    name: "7 次覆写（全 0、全 1、5 次随机）",
    passes: 7,
    badge: "7 次覆写",
    description: "依次写入全 0、全 1，再写 5 次随机数据"
  },
  {
    id: "zero_1pass",
    name: "1 次覆写（全 0）",
    passes: 1,
    badge: "1 次覆写",
    description: "写入一次全 0，适合体积较大的普通临时文件"
  }
];

export type ShredCategory = "all" | "temp_zone" | "crash_dumps";

export interface ShredCategoryMeta {
  id: Exclude<ShredCategory, "all">;
  name: string;
  subtitle: string;
}

export const SHRED_CATEGORIES: ShredCategoryMeta[] = [
  {
    id: "temp_zone",
    name: "临时文件夹",
    subtitle: "%TEMP% 及其子目录里的文件"
  },
  {
    id: "crash_dumps",
    name: "崩溃转储",
    subtitle: "%LOCALAPPDATA%\\CrashDumps 里的转储文件"
  }
];

export interface ShredCandidateItem {
  id: string;
  name: string;
  path: string;
  category: Exclude<ShredCategory, "all">;
  categoryName: string;
  sizeBytes: number;
  isSystemLocked: boolean;
  lockedReason?: string;
}

export interface ShredderSnapshot {
  candidates: ShredCandidateItem[];
  totalShreddableBytes: number;
  updatedAt: string;
  /** 读取失败或不在客户端中运行时的原因；有值时界面直接显示它 */
  error?: string;
}

export interface ShredFailure {
  path: string;
  error: string;
}

export interface ShredResult {
  ok: boolean;
  shreddedCount: number;
  shreddedBytes: number;
  shreddedPaths: string[];
  failed: ShredFailure[];
  failedPaths: string[];
  message: string;
}

export function createEmptyShredderSnapshot(error?: string): ShredderSnapshot {
  return {
    candidates: [],
    totalShreddableBytes: 0,
    updatedAt: "",
    ...(error ? { error } : {})
  };
}

function hasClientHost(hostBridge?: DynamicBridge): boolean {
  return Boolean(hostBridge) || isRealElectronHost();
}

function comparablePath(p: string): string {
  return String(p || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function isUnder(dir: string, target: string): boolean {
  if (!dir) return false;
  const base = comparablePath(dir);
  const t = comparablePath(target);
  return t.startsWith(`${base}\\`);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function fetchShredCandidates(hostBridge?: DynamicBridge): Promise<ShredderSnapshot> {
  if (!hasClientHost(hostBridge)) {
    return createEmptyShredderSnapshot(NOT_IN_CLIENT_MESSAGE);
  }
  try {
    const [temp, home] = await Promise.all([
      getRealSystemPath("temp", hostBridge),
      getRealSystemPath("home", hostBridge)
    ]);
    if (!temp) {
      return createEmptyShredderSnapshot("无法获取临时文件夹路径，没有扫描任何文件");
    }
    const crashDumpDir = home ? `${home.replace(/[\\/]+$/, "")}\\AppData\\Local\\CrashDumps` : "";
    const [tempScan, dumpScan] = await Promise.all([
      scanRealDirectoryTree(temp, { maxFiles: MAX_CANDIDATES }, hostBridge),
      crashDumpDir ? scanRealDirectoryTree(crashDumpDir, { maxFiles: 15 }, hostBridge) : Promise.resolve(null)
    ]);

    const seen = new Set<string>();
    const candidates: ShredCandidateItem[] = [];
    for (const entry of [...tempScan.files, ...(dumpScan ? dumpScan.files : [])]) {
      if (!entry || entry.isDirectory || !(entry.sizeBytes > 0) || !entry.path) continue;
      if (FORBIDDEN_TARGET_PATTERN.test(entry.path)) continue;
      const key = comparablePath(entry.path);
      if (seen.has(key)) continue;
      seen.add(key);
      const category = isUnder(crashDumpDir, entry.path) ? "crash_dumps" : "temp_zone";
      const meta = SHRED_CATEGORIES.find((c) => c.id === category)!;
      candidates.push({
        id: `shred_${candidates.length}_${key}`,
        name: entry.name,
        path: entry.path,
        category,
        categoryName: meta.name,
        sizeBytes: entry.sizeBytes,
        isSystemLocked: false
      });
      if (candidates.length >= MAX_CANDIDATES) break;
    }

    return {
      candidates,
      totalShreddableBytes: candidates.reduce((acc, item) => acc + item.sizeBytes, 0),
      updatedAt: new Date().toLocaleTimeString()
    };
  } catch (err) {
    return createEmptyShredderSnapshot(`扫描失败：${errorText(err)}`);
  }
}

/** 粉碎前确认框的正文：逐个列出将被粉碎的文件（超过上限时注明其余数量） */
export function buildShredConfirmMessage(items: ShredCandidateItem[], standardId: ShredStandardId): string {
  const standard = SHRED_STANDARDS.find((s) => s.id === standardId) || SHRED_STANDARDS[0];
  const listed = items.slice(0, CONFIRM_LIST_LIMIT).map((item) => `${item.path}（${formatBytes(item.sizeBytes)}）`);
  const rest = items.length - listed.length;
  const totalBytes = items.reduce((acc, item) => acc + item.sizeBytes, 0);
  return [
    `将按「${standard.name}」粉碎以下 ${items.length} 个文件，共 ${formatBytes(totalBytes)}：`,
    ...listed,
    ...(rest > 0 ? [`以及其余 ${rest} 个文件`] : []),
    "",
    "粉碎后无法从回收站找回。固态硬盘、系统还原点或卷影副本中仍可能留有副本。"
  ].join("\n");
}

export async function executeSecureShred(
  items: ShredCandidateItem[],
  standardId: ShredStandardId,
  hostOverride?: DynamicBridge
): Promise<ShredResult> {
  const standard = SHRED_STANDARDS.find((s) => s.id === standardId) || SHRED_STANDARDS[0];
  const safeTargets = (items || []).filter(
    (item) => item && item.path && !item.isSystemLocked && !FORBIDDEN_TARGET_PATTERN.test(item.path)
  );
  if (safeTargets.length === 0) {
    return {
      ok: false,
      shreddedCount: 0,
      shreddedBytes: 0,
      shreddedPaths: [],
      failed: [],
      failedPaths: [],
      message: (items || []).length > 0 ? FORBIDDEN_REASON : "请先勾选要粉碎的文件"
    };
  }

  const shreddedPaths: string[] = [];
  const failed: ShredFailure[] = [];
  let shreddedBytes = 0;
  for (const item of safeTargets) {
    const wipeRes = await invokeHostCapability(
      "shredder.secureWipeFile",
      {
        path: item.path,
        targetPath: item.path,
        standardId: standard.id,
        passes: standard.passes,
        zeroFillAndRename: true
      },
      hostOverride
    );
    if (wipeRes.ok) {
      shreddedPaths.push(item.path);
      shreddedBytes += item.sizeBytes;
    } else {
      failed.push({ path: item.path, error: wipeRes.error || wipeRes.message || "粉碎失败" });
    }
  }

  const failedPaths = failed.map((f) => f.path);
  const firstFailure = failed[0];
  const failureText = firstFailure
    ? `${firstFailure.path.split(/[\\/]/).pop()}：${firstFailure.error}`
    : "";
  let message: string;
  if (failed.length === 0) {
    message = `已按「${standard.name}」粉碎 ${shreddedPaths.length} 个文件（${formatBytes(shreddedBytes)}）`;
  } else if (shreddedPaths.length === 0) {
    message = `粉碎失败，${failed.length} 个文件均未处理。${failureText}`;
  } else {
    message = `已粉碎 ${shreddedPaths.length} 个文件（${formatBytes(shreddedBytes)}），${failed.length} 个失败。${failureText}`;
  }

  return {
    ok: failed.length === 0,
    shreddedCount: shreddedPaths.length,
    shreddedBytes,
    shreddedPaths,
    failed,
    failedPaths,
    message
  };
}

export async function openShredCandidateLocation(targetPath: string, hostBridge?: DynamicBridge): Promise<boolean> {
  if (!targetPath) return false;
  return showRealItemInFolder(targetPath, hostBridge);
}
