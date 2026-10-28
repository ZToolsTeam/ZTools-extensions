type DynamicBridge = ReturnType<typeof JSON.parse>;
/**
 * C 盘搬家业务逻辑
 *
 * 1. 扫描 C 盘用户目录下的微信、QQ 文件、下载、文档、视频与 npm / pip / NuGet 缓存目录
 * 2. 通过客户端把目录复制到其他分区（<盘符>\ZToolsMoved\<目录名>），再在原位置建立目录联接 (Junction)
 * 3. 迁移前检查：目录互不包含、迁移后不重名、目标位置没有同名文件或文件夹、原目录不是已有的联接
 * 4. 迁移失败时，只有确认原目录仍完整、且目标位置是本次新建的，才删除复制到目标位置的内容；无法确认时不删除，如实提示手动检查
 */

import {
  callHostTransport,
  formatBytes,
  getRealSystemPath,
  invokePluginService,
  isRealElectronHost,
  probeRealDiskDrives,
  resolveRealSpecialPaths,
  scanRealDirectoryTree,
  showRealItemInFolder
} from "./native-ipc.js";

export { formatBytes };

export const NOT_IN_CLIENT_MESSAGE = "需要在 ZTools 客户端中使用";
export const DLL_PLUGIN_NAME = "MoverPlugin";
export const FORBIDDEN_TARGET_PATTERN =
  /(^|[\\/])(Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|Boot|Recovery|\.\.)($|[\\/])/i;
export const FORBIDDEN_REASON = "禁止迁移 Windows 系统核心目录或包含路径穿越字符";
/** 客户端迁移中途出错时，原目录会被改名为带这个标记的备份 */
export const BACKUP_MARKER = ".ztools-mover-bak-";

export type MoverCategory = "all" | "social_office" | "user_profile" | "dev_cache";

export interface MoverCategoryMeta {
  id: MoverCategory;
  name: string;
  subtitle: string;
}

export const MOVER_CATEGORIES: MoverCategoryMeta[] = [
  { id: "social_office", name: "微信与 QQ 文件", subtitle: "WeChat Files、xwechat_files、Tencent Files" },
  { id: "user_profile", name: "个人文件夹", subtitle: "下载、文档、视频" },
  { id: "dev_cache", name: "开发缓存", subtitle: "npm、pip、NuGet 缓存" }
];

export interface TargetDriveOption {
  id: string;
  driveLetter: string;
  targetRoot: string;
  label: string;
  freeBytes: number;
  totalBytes: number;
}

export interface MovableFolderItem {
  id: string;
  name: string;
  sourcePath: string;
  category: MoverCategory;
  categoryName: string;
  sizeBytes: number;
  fileCount: number;
}

export interface MoverSnapshot {
  cDriveTotalBytes: number;
  cDriveFreeBytes: number;
  targetDrives: TargetDriveOption[];
  folders: MovableFolderItem[];
  totalMovableBytes: number;
  error?: string;
}

export type MoveItemStatus = "moved" | "failed" | "needs_check" | "skipped" | "not_attempted";

export interface MoveItemResult {
  name: string;
  sourcePath: string;
  destinationPath: string;
  status: MoveItemStatus;
  detail: string;
}

export interface MoveBatchResult {
  ok: boolean;
  movedCount: number;
  freedBytes: number;
  message: string;
  results: MoveItemResult[];
}

export function createEmptyMoverSnapshot(error?: string): MoverSnapshot {
  return {
    cDriveTotalBytes: 0,
    cDriveFreeBytes: 0,
    targetDrives: [],
    folders: [],
    totalMovableBytes: 0,
    ...(error ? { error } : {})
  };
}

function trimTrailingSeparators(value: string): string {
  return String(value || "").trim().replace(/[\\/]+$/, "");
}

/** Windows 路径不区分大小写，统一成小写、反斜杠、去掉末尾分隔符后比较 */
function normalizeWinPath(value: string): string {
  return trimTrailingSeparators(value).replace(/\//g, "\\").toLowerCase();
}

function isSameOrInside(child: string, parent: string): boolean {
  const c = normalizeWinPath(child);
  const p = normalizeWinPath(parent);
  return c === p || c.startsWith(`${p}\\`);
}

export function destinationPathFor(sourcePath: string, targetRoot: string): string {
  const source = trimTrailingSeparators(sourcePath);
  const base = source.split(/[\\/]/).pop() || "";
  return `${trimTrailingSeparators(targetRoot)}\\${base}`;
}

export async function fetchMoverSnapshot(hostBridge?: DynamicBridge): Promise<MoverSnapshot> {
  if (!hostBridge && !isRealElectronHost()) return createEmptyMoverSnapshot(NOT_IN_CLIENT_MESSAGE);
  try {
    // 拿不到真实用户目录时不能退回默认用户目录去扫描
    const home = await getRealSystemPath("home", hostBridge);
    if (!home) return createEmptyMoverSnapshot("无法获取用户目录位置");
    const [paths, drives] = await Promise.all([
      resolveRealSpecialPaths(hostBridge),
      probeRealDiskDrives(["C", "D", "E", "F", "G", "H"], hostBridge)
    ]);

    const cDrive = drives.find((d) => d.drive.toUpperCase() === "C:");
    const targetDrives: TargetDriveOption[] = drives
      .filter((d) => /^[A-Z]:$/i.test(d.drive) && d.drive.toUpperCase() !== "C:")
      .map((d) => {
        const letter = d.drive.toUpperCase();
        const root = `${letter}\\ZToolsMoved`;
        return {
          id: root,
          driveLetter: letter,
          targetRoot: root,
          label: `迁移至 ${root}（可用 ${formatBytes(d.availableBytes)}）`,
          freeBytes: d.availableBytes,
          totalBytes: d.totalBytes
        };
      });

    const candidateDefs: Array<Omit<MovableFolderItem, "sizeBytes" | "fileCount">> = [
      { id: "mover_wechat", name: "WeChat Files（微信文件）", sourcePath: `${paths.documents}\\WeChat Files`, category: "social_office", categoryName: "微信与 QQ 文件" },
      { id: "mover_xwechat", name: "xwechat_files（新版微信文件）", sourcePath: `${paths.documents}\\xwechat_files`, category: "social_office", categoryName: "微信与 QQ 文件" },
      { id: "mover_qq", name: "Tencent Files（QQ 文件）", sourcePath: `${paths.documents}\\Tencent Files`, category: "social_office", categoryName: "微信与 QQ 文件" },
      { id: "mover_downloads", name: "下载", sourcePath: paths.downloads, category: "user_profile", categoryName: "个人文件夹" },
      { id: "mover_documents", name: "文档", sourcePath: paths.documents, category: "user_profile", categoryName: "个人文件夹" },
      { id: "mover_videos", name: "视频", sourcePath: paths.videos, category: "user_profile", categoryName: "个人文件夹" },
      { id: "mover_npm_cache", name: "npm 缓存（npm-cache）", sourcePath: `${paths.localAppData}\\npm-cache`, category: "dev_cache", categoryName: "开发缓存" },
      { id: "mover_pip_cache", name: "pip 缓存", sourcePath: `${paths.localAppData}\\pip\\Cache`, category: "dev_cache", categoryName: "开发缓存" },
      { id: "mover_nuget_cache", name: "NuGet 包缓存", sourcePath: `${paths.userProfile}\\.nuget\\packages`, category: "dev_cache", categoryName: "开发缓存" }
    ];

    const scanned = await Promise.all(
      candidateDefs.map(async (def): Promise<MovableFolderItem | null> => {
        // 只列 C 盘上的目录：已在其他分区的目录迁移后不能为 C 盘腾出空间
        if (!/^c:\\/i.test(def.sourcePath)) return null;
        const scan = await scanRealDirectoryTree(def.sourcePath, { maxDepth: 2, maxFiles: 120 }, hostBridge);
        if (scan.totalFiles <= 0 && scan.totalBytes <= 0 && scan.files.length === 0) return null;
        return { ...def, sizeBytes: scan.totalBytes, fileCount: Math.max(scan.totalFiles, scan.files.length) };
      })
    );
    const folders = scanned.filter((item): item is MovableFolderItem => item !== null);
    return {
      cDriveTotalBytes: cDrive?.totalBytes || 0,
      cDriveFreeBytes: cDrive?.availableBytes || 0,
      targetDrives,
      folders,
      totalMovableBytes: folders.reduce((acc, item) => acc + item.sizeBytes, 0)
    };
  } catch (err) {
    return createEmptyMoverSnapshot(`扫描失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 迁移前的本地检查，返回错误说明；通过时返回 null。
 * targetFreeBytes 为目标分区可用空间（未知时传 0 或不传，跳过空间检查）
 */
export function validateMoveSelection(
  items: MovableFolderItem[],
  targetRoot: string,
  targetFreeBytes = 0
): string | null {
  const list = (items || []).filter(Boolean);
  if (list.length === 0) return "请先勾选要迁移的目录";
  const root = trimTrailingSeparators(targetRoot);
  if (!/^[A-Za-z]:\\./.test(root) || FORBIDDEN_TARGET_PATTERN.test(root)) return FORBIDDEN_REASON;
  if (/^c:/i.test(root)) return "目标位置不能在 C 盘";
  for (const item of list) {
    if (!item.sourcePath || FORBIDDEN_TARGET_PATTERN.test(item.sourcePath)) return FORBIDDEN_REASON;
    if (isSameOrInside(root, item.sourcePath) || isSameOrInside(item.sourcePath, root)) {
      return `目标位置与「${item.name}」重叠，请换一个目标位置`;
    }
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i !== j && isSameOrInside(list[i].sourcePath, list[j].sourcePath)) {
        return `「${list[i].name}」位于「${list[j].name}」里面，请只勾选其中一个`;
      }
    }
  }
  const seen = new Map<string, MovableFolderItem>();
  for (const item of list) {
    const key = normalizeWinPath(destinationPathFor(item.sourcePath, root));
    const other = seen.get(key);
    if (other) return `「${other.name}」和「${item.name}」迁移后会同名，请分两次迁移到不同位置`;
    seen.set(key, item);
  }
  const totalBytes = list.reduce((acc, item) => acc + (item.sizeBytes || 0), 0);
  if (targetFreeBytes > 0 && totalBytes > targetFreeBytes) {
    return `所选目录约 ${formatBytes(totalBytes)}，超过目标分区可用空间 ${formatBytes(targetFreeBytes)}`;
  }
  return null;
}

/**
 * 让用户在系统窗口里选择目标分区根目录（或目标文件夹本身），授权插件检查目标位置是否已有内容、失败时清理本次复制的内容
 */
export async function authorizeMoveTarget(
  targetRoot: string,
  hostOverride?: DynamicBridge
): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  const root = trimTrailingSeparators(targetRoot);
  const driveRoot = `${root.slice(0, 2).toUpperCase()}\\`;
  const picked = await callHostTransport<{ canceled?: boolean; folderPath?: string }>(
    "window_show_select_folder_dialog",
    { title: `选择 ${driveRoot} 以允许迁移到 ${root}`, defaultPath: driveRoot },
    hostOverride
  );
  if (!picked.ok) return { ok: false, error: picked.error || "无法打开选择文件夹窗口" };
  if (picked.data?.canceled) return { ok: false, canceled: true };
  const folder = String(picked.data?.folderPath || "");
  if (!folder || !isSameOrInside(root, folder)) {
    return { ok: false, error: `请选择 ${driveRoot} 或 ${root}，没有迁移任何目录` };
  }
  return { ok: true };
}

interface SourceStates {
  ok: boolean;
  error?: string;
  /** 规范化路径 → 是否已是目录联接；不在表中表示目录不存在或读取不到 */
  map: Map<string, { isJunction: boolean }>;
}

/** 通过客户端读取原目录状态（存在与否、是否已经是目录联接） */
async function readSourceStates(sourcePaths: string[], hostOverride?: DynamicBridge): Promise<SourceStates> {
  const res = await invokePluginService<DynamicBridge>(
    DLL_PLUGIN_NAME,
    "scanCandidates",
    { customPaths: sourcePaths },
    hostOverride
  );
  if (!res.ok || res.data?.ok === false || res.data?.success === false) {
    return { ok: false, error: String(res.error || res.data?.error || "读取失败"), map: new Map() };
  }
  const list = Array.isArray(res.data?.items) ? res.data.items : Array.isArray(res.data?.candidates) ? res.data.candidates : null;
  if (!list) return { ok: false, error: "客户端返回的数据格式不正确", map: new Map() };
  const map = new Map<string, { isJunction: boolean }>();
  for (const entry of list) {
    if (entry && typeof entry.sourcePath === "string") {
      map.set(normalizeWinPath(entry.sourcePath), { isJunction: entry.isJunction === true });
    }
  }
  return { ok: true, map };
}

async function checkDestinationFree(dest: string, hostOverride?: DynamicBridge): Promise<string | null> {
  const [dir, file] = await Promise.all([
    callHostTransport<{ exists?: boolean }>("filesystem_directory_exists", { path: dest }, hostOverride),
    callHostTransport<{ exists?: boolean }>("filesystem_file_exists", { path: dest }, hostOverride)
  ]);
  for (const res of [dir, file]) {
    if (!res.ok || typeof res.data?.exists !== "boolean") {
      return `无法确认目标位置 ${dest} 是否已有内容（${res.error || "客户端没有返回结果"}），没有迁移`;
    }
  }
  if (dir.data?.exists) return `目标位置已有同名文件夹 ${dest}，为避免合并或覆盖，没有迁移`;
  if (file.data?.exists) return `目标位置已有同名文件 ${dest}，没有迁移`;
  return null;
}

/**
 * 迁移失败后的回滚：目标位置是本次新建的（迁移前已确认不存在），
 * 且原目录仍在原处、不是联接时，才删除复制到目标位置的内容。
 */
async function rollbackAfterFailure(
  sourcePath: string,
  dest: string,
  hostOverride?: DynamicBridge
): Promise<{ status: "failed" | "needs_check"; detail: string }> {
  const destNow = await callHostTransport<{ exists?: boolean }>("filesystem_directory_exists", { path: dest }, hostOverride);
  if (!destNow.ok || typeof destNow.data?.exists !== "boolean") {
    return { status: "needs_check", detail: `无法确认目标位置 ${dest} 的状态，请手动检查是否留有复制了一半的文件` };
  }
  if (!destNow.data.exists) return { status: "failed", detail: "目标位置没有留下文件，原目录未改动" };

  const states = await readSourceStates([sourcePath], hostOverride);
  if (!states.ok) {
    return { status: "needs_check", detail: `无法确认原目录状态（${states.error}），没有清理目标位置 ${dest}，请手动检查` };
  }
  const state = states.map.get(normalizeWinPath(sourcePath));
  if (!state) {
    return {
      status: "needs_check",
      detail: `原目录已不在原处，可能已改名为带 ${BACKUP_MARKER} 的备份；没有清理目标位置 ${dest}，请手动检查`
    };
  }
  if (state.isJunction) {
    return {
      status: "needs_check",
      detail: `原位置已建立指向 ${dest} 的联接，但客户端报告失败；没有清理目标位置，请检查原目录旁是否留有带 ${BACKUP_MARKER} 的文件夹`
    };
  }
  const del = await callHostTransport<{ success?: boolean }>("filesystem_delete_directory", { path: dest }, hostOverride);
  if (del.ok && del.data?.success === true) {
    return { status: "failed", detail: `已删除复制到 ${dest} 的文件，原目录未改动` };
  }
  return { status: "needs_check", detail: `清理目标位置失败（${del.error || "客户端没有确认删除"}），请手动删除 ${dest}；原目录未改动` };
}

function summarizeMoveResults(results: MoveItemResult[], targetRoot: string, freedBytes: number): string {
  const moved = results.filter((r) => r.status === "moved");
  const problem = results.find((r) => r.status === "failed" || r.status === "needs_check");
  const skipped = results.filter((r) => r.status === "skipped");
  const notAttempted = results.filter((r) => r.status === "not_attempted");
  const parts: string[] = [];
  if (moved.length > 0) parts.push(`已把 ${moved.length} 个目录迁移到 ${targetRoot}，C 盘约腾出 ${formatBytes(freedBytes)}`);
  if (problem) parts.push(`「${problem.name}」迁移失败：${problem.detail}`);
  if (skipped.length > 0) parts.push(`跳过 ${skipped.length} 个：「${skipped[0].name}」${skipped[0].detail}`);
  if (notAttempted.length > 0) parts.push(`其余 ${notAttempted.length} 个没有执行`);
  return parts.join("；") || "没有迁移任何目录";
}

/**
 * 逐个迁移已勾选的目录。调用前应先经用户确认并完成 authorizeMoveTarget 授权。
 * 遇到迁移失败立即停止，其余目录不再执行。
 */
export async function executeDirectoryMove(
  items: MovableFolderItem[],
  targetRoot: string,
  hostOverride?: DynamicBridge
): Promise<MoveBatchResult> {
  const invalid = validateMoveSelection(items, targetRoot);
  if (invalid) return { ok: false, movedCount: 0, freedBytes: 0, message: invalid, results: [] };
  const root = trimTrailingSeparators(targetRoot);

  const states = await readSourceStates(items.map((i) => i.sourcePath), hostOverride);
  if (!states.ok) {
    return {
      ok: false,
      movedCount: 0,
      freedBytes: 0,
      message: `无法确认原目录状态（${states.error}），没有迁移任何目录`,
      results: []
    };
  }

  const results: MoveItemResult[] = [];
  let freedBytes = 0;
  let stopped = false;
  for (const item of items) {
    const base = { name: item.name, sourcePath: item.sourcePath, destinationPath: destinationPathFor(item.sourcePath, root) };
    if (stopped) {
      results.push({ ...base, status: "not_attempted", detail: "前一个目录迁移失败，没有执行" });
      continue;
    }
    const state = states.map.get(normalizeWinPath(item.sourcePath));
    if (!state) {
      results.push({ ...base, status: "skipped", detail: "原目录不存在或读取不到" });
      continue;
    }
    if (state.isJunction) {
      results.push({ ...base, status: "skipped", detail: "原位置已经是目录联接（可能之前迁移过）" });
      continue;
    }
    const occupied = await checkDestinationFree(base.destinationPath, hostOverride);
    if (occupied) {
      results.push({ ...base, status: "skipped", detail: occupied });
      continue;
    }
    const res = await invokePluginService<DynamicBridge>(
      DLL_PLUGIN_NAME,
      "relocateWithJunction",
      { sourcePath: item.sourcePath, targetRoot: root },
      hostOverride
    );
    if (res.ok && res.data?.ok !== false && res.data?.success !== false) {
      freedBytes += item.sizeBytes;
      results.push({ ...base, status: "moved", detail: `已迁移到 ${base.destinationPath}` });
      continue;
    }
    const hostError = String(res.error || res.data?.error || "客户端没有完成迁移");
    const rollback = await rollbackAfterFailure(item.sourcePath, base.destinationPath, hostOverride);
    results.push({ ...base, status: rollback.status, detail: `${hostError}。${rollback.detail}` });
    stopped = true;
  }

  const movedCount = results.filter((r) => r.status === "moved").length;
  return {
    ok: movedCount > 0 && results.every((r) => r.status === "moved"),
    movedCount,
    freedBytes,
    message: summarizeMoveResults(results, root, freedBytes),
    results
  };
}

export async function openMoverFolderLocation(folderPath: string, hostBridge?: DynamicBridge): Promise<boolean> {
  if (!folderPath) return false;
  return showRealItemInFolder(folderPath, hostBridge);
}
