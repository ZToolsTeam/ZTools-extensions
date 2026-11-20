type DynamicBridge = ReturnType<typeof JSON.parse>;
import { confirmAlert, terminateProcess as hostTerminateProcess } from "@ztools/declarative-ui";
import { callHostTransport, isRealElectronHost, showRealItemInFolder } from "./native-ipc.js";
import { DEFAULT_MESSAGES, t } from "./i18n.js";

export const NOT_IN_CLIENT_MESSAGE = DEFAULT_MESSAGES.notInClient;

export interface ProcessInfo {
  pid: number;
  name: string;
  /** CPU 占用；客户端没有提供时为 null */
  cpuPercent: number | null;
  memoryMB: number;
  /** 运行用户；客户端没有提供时为空字符串 */
  user: string;
  /** 线程数；客户端没有提供时为 null */
  threads: number | null;
  /** 程序路径；客户端没有提供时为空字符串 */
  path: string;
  /** 启动命令行；客户端没有提供时为空字符串 */
  commandLine: string;
  status: "running" | "suspended";
  arch?: "x64" | "x86" | "arm64";
  isSystemCritical?: boolean;
  pinyin?: string;
}

export type ProcessSortBy = "memory" | "cpu" | "name" | "pid";
export type KillMode = "graceful" | "force" | "tree";

export const CRITICAL_PROCESSES = new Set([
  // Windows Critical Processes
  "csrss.exe",
  "explorer.exe",
  "svchost.exe",
  "winlogon.exe",
  "smss.exe",
  "services.exe",
  "lsass.exe",
  "dwm.exe",
  "wininit.exe",
  "system",
  "system idle process",
  "registry",
  "fontdrvhost.exe",
  "sihost.exe",
  // macOS Critical Daemons & System Processes
  "kernel_task",
  "launchd",
  "windowserver",
  "loginwindow",
  "dock",
  "finder",
  "systemuiserver",
  "coreaudiod",
  "bluetoothd",
  "mds",
  "opendirectoryd",
  "sysmond"
]);

/**
 * 判断是否为系统高危关键进程 (保护防误杀，含 Windows PID 0/4 与 macOS launchd PID 1)
 */
export function isSystemCriticalProcess(nameOrPid: string | number): boolean {
  if (typeof nameOrPid === "number") {
    return nameOrPid === 0 || nameOrPid === 1 || nameOrPid === 4;
  }
  return CRITICAL_PROCESSES.has(nameOrPid.trim().toLowerCase());
}

/**
 * 构建进程终止命令行 (支持 Windows taskkill 与 macOS/POSIX kill/pkill)
 */
export function getKillCommandLine(pid: number, mode: KillMode, isPosix?: boolean): string {
  const usePosix =
    typeof isPosix === "boolean"
      ? isPosix
      : typeof process !== "undefined" && process.platform === "darwin";

  if (usePosix) {
    switch (mode) {
      case "graceful":
        return `kill -15 ${pid}`;
      case "force":
        return `kill -9 ${pid}`;
      case "tree":
        return `pkill -9 -P ${pid}`;
      default:
        return `kill -9 ${pid}`;
    }
  }

  switch (mode) {
    case "graceful":
      return `taskkill /PID ${pid}`;
    case "force":
      return `taskkill /F /PID ${pid}`;
    case "tree":
      return `taskkill /F /T /PID ${pid}`;
    default:
      return `taskkill /F /PID ${pid}`;
  }
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function trimmedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function mapRawToProcessInfo(raw: DynamicBridge): ProcessInfo {
  const pid = Number(raw?.pid);
  const safePid = Number.isFinite(pid) && pid >= 0 ? Math.floor(pid) : 0;
  const name = trimmedText(raw?.name) || `PID-${safePid}`;

  // 客户端标明某字段不可用时（例如只有进程名和内存的基础列表）如实留空，不填默认值
  const availability = raw?.fieldAvailability ?? {};
  const cpuRaw = availability.cpuUsage === false ? null : optionalNumber(raw?.cpuUsage ?? raw?.cpuPercent ?? raw?.cpu);
  const cpuPercent = cpuRaw !== null && cpuRaw >= 0 ? Math.round(cpuRaw * 10) / 10 : null;

  let memoryMB = optionalNumber(raw?.memoryMB) ?? NaN;
  if (!Number.isFinite(memoryMB)) {
    const bytes = optionalNumber(raw?.memoryWorkingSet ?? raw?.workingSetBytes ?? raw?.memoryUsage ?? raw?.memoryBytes) ?? 0;
    memoryMB = bytes >= 0 ? Math.round((bytes / (1024 * 1024)) * 10) / 10 : 0;
  }

  const threadsRaw = optionalNumber(raw?.threadCount ?? raw?.threads);
  const threads = threadsRaw !== null && threadsRaw > 0 ? Math.floor(threadsRaw) : null;
  const isCritical = Boolean(raw?.isSystemCritical) || isSystemCriticalProcess(name) || isSystemCriticalProcess(safePid);

  return {
    pid: safePid,
    name,
    cpuPercent,
    memoryMB,
    user: trimmedText(raw?.user) || trimmedText(raw?.userName),
    threads,
    path: availability.path === false ? "" : trimmedText(raw?.path),
    commandLine: trimmedText(raw?.commandLine),
    status: raw?.status === "suspended" ? "suspended" : "running",
    arch: raw?.arch === "x64" || raw?.arch === "x86" || raw?.arch === "arm64" ? raw.arch : undefined,
    isSystemCritical: isCritical,
    pinyin: typeof raw?.pinyin === "string" ? raw.pinyin : undefined
  };
}

function parseJsonPayload(payload: unknown): DynamicBridge {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function extractProcessRows(payload: unknown): DynamicBridge[] | null {
  const parsed = parseJsonPayload(payload);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.processes)) return parsed.processes;
  if (Array.isArray(parsed?.data)) return parsed.data;
  if (Array.isArray(parsed?.data?.processes)) return parsed.data.processes;
  return null;
}

export interface ProcessListResult {
  ok: boolean;
  processes: ProcessInfo[];
  error?: string;
}

/**
 * 从客户端读取进程列表。
 * 先读带路径、CPU、线程数的完整快照，读不到再用只含进程名和内存的基础列表；两者都失败时如实返回错误。
 */
export async function loadProcesses(hostOverride?: DynamicBridge): Promise<ProcessListResult> {
  if (!hostOverride && !isRealElectronHost()) {
    return { ok: false, processes: [], error: t("notInClient") };
  }

  let snapshotError = "";
  const snapshot = await callHostTransport<DynamicBridge>(
    "dllplugin_call",
    { plugin: "ProcessMonitorPlugin", func: "GetProcessList", params: {} },
    hostOverride
  );
  if (snapshot.ok) {
    const payload = parseJsonPayload(snapshot.data?.result !== undefined ? snapshot.data.result : snapshot.data);
    const rows = extractProcessRows(payload);
    if (payload?.error) snapshotError = String(payload.error);
    else if (rows && rows.length > 0) return { ok: true, processes: rows.map(mapRawToProcessInfo) };
    else snapshotError = t("snapshotEmpty");
  } else {
    snapshotError = snapshot.error || t("snapshotFailed");
  }

  const basic = await callHostTransport<DynamicBridge>("process_list", {}, hostOverride);
  if (basic.ok) {
    const rows = extractProcessRows(basic.data);
    if (rows && rows.length > 0) return { ok: true, processes: rows.map(mapRawToProcessInfo) };
  }
  return {
    ok: false,
    processes: [],
    error: t("loadProcessListFailed", {
      reason: basic.ok ? t("listEmpty") : basic.error || t("unknownError"),
      snapshot: snapshotError
    })
  };
}

export interface TerminateResult {
  success: boolean;
  command: string;
  error?: string;
  message: string;
  /** 结束前进程已经退出 */
  alreadyExited?: boolean;
}

type TerminateOutcome =
  | { ok: true; alreadyExited?: boolean }
  | { ok: false; code: string; message: string };

function hostErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

function describeTerminateFailure(code: string, mode: KillMode, rawMessage: string): string {
  switch (code) {
    case "PROCESS_PROTECTED":
      return rawMessage || t("errProtected");
    case "PROCESS_ACCESS_DENIED":
      return t("errAccessDenied");
    case "PROCESS_IDENTITY_MISMATCH":
      return t("errIdentityMismatch");
    case "PROCESS_TERMINATE_TIMEOUT":
      return mode === "graceful" ? t("errTimeoutGraceful") : t("errTimeoutForce");
    case "PLUGIN_PERMISSION_REQUIRED":
      return t("errPermissionRequired");
    case "PLUGIN_IDENTITY_REQUIRED":
      return t("errIdentityRequired");
    default:
      return rawMessage || t("errTerminateFallback");
  }
}

/** 旧版客户端没有结束任意进程的接口时使用：只有客户端明确返回 terminated: true 才算成功 */
async function legacyTerminate(pid: number, mode: KillMode, hostOverride?: DynamicBridge): Promise<TerminateOutcome> {
  const res = await callHostTransport<DynamicBridge>(
    "dllplugin_call",
    { plugin: "ProcessMonitorPlugin", func: "TerminateProcessByPID", params: { pid, mode } },
    hostOverride
  );
  if (!res.ok) {
    const notInClient = res.error === "NO_WINDOW_ENV" || String(res.error || "").startsWith("METHOD_NOT_AVAILABLE");
    return { ok: false, code: "HOST_CALL_FAILED", message: notInClient ? t("notInClient") : res.error || t("errHostCallFailed") };
  }
  const payload = parseJsonPayload(res.data?.result !== undefined ? res.data.result : res.data);
  if (payload?.error) return { ok: false, code: "TERMINATE_FAILED", message: String(payload.error) };
  if (payload?.terminated === true) return { ok: true };
  return { ok: false, code: "RESULT_UNCONFIRMED", message: t("errResultUnconfirmed") };
}

async function requestTermination(
  pid: number,
  name: string,
  mode: KillMode,
  hostOverride?: DynamicBridge
): Promise<TerminateOutcome> {
  if (typeof hostTerminateProcess === "function") {
    // 列表里没拿到进程名时（显示为 PID-<pid>）不做名称校验，避免误拒
    const expectedName = name && name !== `PID-${pid}` ? name : undefined;
    try {
      await hostTerminateProcess(pid, {
        mode: mode === "graceful" ? "graceful" : "force",
        tree: mode === "tree",
        ...(expectedName ? { expectedName } : {})
      });
      return { ok: true };
    } catch (err) {
      const code = hostErrorCode(err);
      if (code === "PROCESS_NOT_FOUND") return { ok: true, alreadyExited: true };
      if (code !== "HOST_FEATURE_UNAVAILABLE") {
        const raw = err instanceof Error ? err.message : String(err);
        return { ok: false, code: code || "TERMINATE_FAILED", message: describeTerminateFailure(code, mode, raw) };
      }
    }
  }
  return legacyTerminate(pid, mode, hostOverride);
}

/**
 * 结束进程：拦截系统关键进程，经客户端结束并确认进程确实退出，失败时如实返回原因
 */
export async function terminateProcess(
  proc: ProcessInfo | { pid: number; name: string; path?: string },
  mode: KillMode = "force",
  allowCriticalKill = false,
  hostOverride?: DynamicBridge
): Promise<TerminateResult> {
  const isCritical =
    (proc.name ? isSystemCriticalProcess(proc.name) : false) || isSystemCriticalProcess(proc.pid);

  if (isCritical && !allowCriticalKill) {
    return {
      success: false,
      command: "",
      error: "PROTECTED_CRITICAL_PROCESS",
      message: t("errCriticalProcess", { target: proc.name || proc.pid })
    };
  }

  if (!Number.isFinite(proc.pid) || proc.pid <= 0) {
    return {
      success: false,
      command: "",
      error: "INVALID_PID",
      message: t("errInvalidPid")
    };
  }
  const isPosixProc = typeof proc.path === "string" && proc.path.startsWith("/") ? true : undefined;
  const cmd = getKillCommandLine(proc.pid, mode, isPosixProc);
  const label = `${proc.name || proc.pid} (PID: ${proc.pid})`;

  const outcome = await requestTermination(proc.pid, proc.name, mode, hostOverride);
  if (!outcome.ok) {
    return { success: false, command: cmd, error: outcome.code, message: outcome.message };
  }
  if (outcome.alreadyExited) {
    return { success: true, alreadyExited: true, command: cmd, message: t("msgAlreadyExited", { label }) };
  }
  const msgKey = mode === "tree" ? "msgTerminatedTree" : mode === "graceful" ? "msgTerminatedGraceful" : "msgTerminatedForce";
  return { success: true, command: cmd, message: t(msgKey, { label }) };
}

export const killProcessById = terminateProcess;

export const KILL_MODE_LABEL: Record<KillMode, string> = {
  get graceful() {
    return t("killGraceful");
  },
  get force() {
    return t("killForce");
  },
  get tree() {
    return t("killTree");
  }
};

const KILL_MODE_WARNING: Record<KillMode, string> = {
  get graceful() {
    return t("warnGraceful");
  },
  get force() {
    return t("warnForce");
  },
  get tree() {
    return t("warnTree");
  }
};

/**
 * 先弹出确认框，用户确认后才结束进程；用户取消时返回 null。系统关键进程直接拒绝，不弹确认框。
 */
export async function confirmAndTerminate(
  proc: ProcessInfo | { pid: number; name: string; path?: string },
  mode: KillMode,
  hostOverride?: DynamicBridge
): Promise<TerminateResult | null> {
  if ((proc.name && isSystemCriticalProcess(proc.name)) || isSystemCriticalProcess(proc.pid)) {
    return terminateProcess(proc, mode, false, hostOverride);
  }
  const action = KILL_MODE_LABEL[mode];
  const confirmed = await confirmAlert({
    title: t("confirmTitle", { action, target: proc.name || proc.pid }),
    message: t("confirmMessage", { pid: proc.pid, warning: KILL_MODE_WARNING[mode] }),
    primaryAction: { title: action, style: "destructive" }
  });
  if (!confirmed) return null;
  return terminateProcess(proc, mode, false, hostOverride);
}

/**
 * 在资源管理器中定位可执行文件；不在客户端里或定位失败时返回 false
 */
export async function revealProcessInExplorer(filePath: string, hostOverride?: DynamicBridge): Promise<boolean> {
  if (!filePath) return false;
  if (!hostOverride && !isRealElectronHost()) return false;
  return showRealItemInFolder(filePath, hostOverride);
}

export function filterAndSortProcesses(
  processes: ProcessInfo[],
  query: string,
  sortBy: ProcessSortBy = "memory"
): ProcessInfo[] {
  let list = [...processes];

  if (query && query.trim()) {
    const q = query.toLowerCase().trim();
    list = list.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        String(p.pid).includes(q) ||
        p.user.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q) ||
        (p.pinyin && p.pinyin.toLowerCase().includes(q))
    );
  }

  list.sort((a, b) => {
    switch (sortBy) {
      case "memory":
        return b.memoryMB - a.memoryMB;
      case "cpu":
        return (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1);
      case "name":
        return a.name.localeCompare(b.name);
      case "pid":
        return a.pid - b.pid;
      default:
        return 0;
    }
  });

  return list;
}
