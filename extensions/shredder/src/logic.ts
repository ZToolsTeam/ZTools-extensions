type DynamicBridge = ReturnType<typeof JSON.parse>;
/**
 * 文件粉碎：用户选择文件或文件夹导入待粉碎列表，勾选后由客户端多次覆写文件内容，再改成随机文件名删除。
 *
 * - 覆写方式：1 次（全 0）、3 次（全 0、全 1、随机）、7 次（全 0、全 1、5 次随机），覆写图样由客户端决定
 * - 不主动扫描任何目录；Windows 系统目录下的路径在导入与粉碎时一律拒绝
 * - 任何一个文件粉碎失败都如实返回，不改用普通删除顶替
 */

import { t } from "./i18n.js";
import {
  callHostTransport,
  formatBytes,
  invokeHostCapability,
  showRealItemInFolder,
  type NativeInvocationResult
} from "./native-ipc.js";
import {
  pathKey,
  type FileImportRules,
  type FileImportTransport,
  type ImportedFile
} from "./file-import.js";
import { resolveErrorMessage } from './error-i18n.js'

export { formatBytes };
export type { FileImportTransport, NativeInvocationResult };

/** 构建供共享导入模块使用的宿主传输适配器 */
export function createShredImportTransport(hostOverride?: DynamicBridge): FileImportTransport {
  return (method, params) => callHostTransport(method, params, hostOverride);
}

export const FORBIDDEN_TARGET_PATTERN =
  /(^|[\\/])(Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|Boot|ntoskrnl\.exe|pagefile\.sys|\.\.)($|[\\/])/i;
/** 确认框里最多逐个列出的文件数 */
export const CONFIRM_LIST_LIMIT = 10;
export const getForbiddenReason = () => t("forbiddenReason");
export const getNotInClientMessage = () => t("notInClient");
export const getShredSupportedText = () => t("supportedText");

/** 导入规则：任意非空普通文件，系统保护路径一律跳过 */
export const SHRED_IMPORT_RULES: FileImportRules = {
  forbiddenPath: FORBIDDEN_TARGET_PATTERN
};

export type ShredStandardId = "dod_3pass" | "seven_pass" | "zero_1pass";

export interface ShredStandardMeta {
  id: ShredStandardId;
  name: string;
  passes: number;
  badge: string;
  description: string;
}

export const getShredStandards = (): ShredStandardMeta[] => [
  {
    id: "dod_3pass",
    name: t("std3Name"),
    passes: 3,
    badge: t("std3Badge"),
    description: t("std3Desc")
  },
  {
    id: "seven_pass",
    name: t("std7Name"),
    passes: 7,
    badge: t("std7Badge"),
    description: t("std7Desc")
  },
  {
    id: "zero_1pass",
    name: t("std1Name"),
    passes: 1,
    badge: t("std1Badge"),
    description: t("std1Desc")
  }
];

/** 文件来源：手动选择 / 拖入的单个文件，或从文件夹导入 */
export type ShredSource = "manual" | "folder";

export const getShredSources = (): Array<{ id: ShredSource; name: string; subtitle: string }> => [
  { id: "manual", name: t("srcManualName"), subtitle: t("srcManualSub") },
  { id: "folder", name: t("srcFolderName"), subtitle: t("srcFolderSub") }
];

export interface ShredCandidateItem {
  id: string;
  name: string;
  path: string;
  source: ShredSource;
  sourceName: string;
  /** 字节数；宿主没有返回时为 null（显示“大小未识别”，不填默认值） */
  sizeBytes: number | null;
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

/** 体积文案：大小未知时如实显示 */
export function formatSize(sizeBytes: number | null): string {
  return sizeBytes === null ? t("sizeUnknown") : formatBytes(sizeBytes);
}

/** 已知体积之和（未知大小的文件不计入） */
export function sumKnownBytes(items: ShredCandidateItem[]): number {
  return items.reduce((acc, item) => acc + (item.sizeBytes ?? 0), 0);
}

/** 把导入结果转换成待粉碎条目（id 由规范化路径生成，同一文件重复导入时 id 不变） */
export function toShredCandidate(file: ImportedFile, source: ShredSource): ShredCandidateItem {
  const sources = getShredSources();
  const meta = sources.find((s) => s.id === source) || sources[0];
  return {
    id: `shred_${pathKey(file.path)}`,
    name: file.name,
    path: file.path,
    source: meta.id,
    sourceName: meta.name,
    sizeBytes: file.sizeBytes
  };
}

/** 粉碎前确认框的正文：逐个列出将被粉碎的文件（超过上限时注明其余数量） */
export function buildShredConfirmMessage(items: ShredCandidateItem[], standardId: ShredStandardId): string {
  const standards = getShredStandards();
  const standard = standards.find((s) => s.id === standardId) || standards[0];
  const listed = items.slice(0, CONFIRM_LIST_LIMIT).map((item) => t("confirmItemLine", { path: item.path, size: formatSize(item.sizeBytes) }));
  const rest = items.length - listed.length;
  const knownCount = items.filter((item) => item.sizeBytes !== null).length;
  const sizeSummary =
    knownCount === 0
      ? t("sizeSummaryUnknown")
      : knownCount < items.length
        ? t("sizeSummaryPartial", { bytes: formatBytes(sumKnownBytes(items)) })
        : t("sizeSummaryFull", { bytes: formatBytes(sumKnownBytes(items)) });
  return [
    t("confirmHeader", { standard: standard.name, count: items.length, sizeSummary }),
    ...listed,
    ...(rest > 0 ? [t("confirmMoreFiles", { count: rest })] : []),
    "",
    t("confirmWarning")
  ].join("\n");
}

export async function executeSecureShred(
  items: ShredCandidateItem[],
  standardId: ShredStandardId,
  hostOverride?: DynamicBridge
): Promise<ShredResult> {
  const standards = getShredStandards();
  const standard = standards.find((s) => s.id === standardId) || standards[0];
  const safeTargets = (items || []).filter((item) => item && item.path && !FORBIDDEN_TARGET_PATTERN.test(item.path));
  if (safeTargets.length === 0) {
    return {
      ok: false,
      shreddedCount: 0,
      shreddedBytes: 0,
      shreddedPaths: [],
      failed: [],
      failedPaths: [],
      message: (items || []).length > 0 ? getForbiddenReason() : t("selectFilesFirst")
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
      shreddedBytes += item.sizeBytes ?? 0;
    } else {
      failed.push({ path: item.path, error: resolveErrorMessage(wipeRes, t("shredFailed")) });
    }
  }

  const failedPaths = failed.map((f) => f.path);
  const firstFailure = failed[0];
  const failureText = firstFailure
    ? `${firstFailure.path.split(/[\\/]/).pop()}：${firstFailure.error}`
    : "";
  let message: string;
  if (failed.length === 0) {
    message = t("shredAllSuccess", { standard: standard.name, count: shreddedPaths.length, bytes: formatBytes(shreddedBytes) });
  } else if (shreddedPaths.length === 0) {
    message = t("shredAllFailed", { count: failed.length, detail: failureText });
  } else {
    message = t("shredPartialResult", { okCount: shreddedPaths.length, bytes: formatBytes(shreddedBytes), failCount: failed.length, detail: failureText });
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
