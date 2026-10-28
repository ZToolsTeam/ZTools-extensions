type DynamicBridge = ReturnType<typeof JSON.parse>;
import { confirmAlert, terminateProcess as hostTerminateProcess } from "@ztools/declarative-ui";
import { callHostTransport, isRealElectronHost, showRealItemInFolder } from "./native-ipc.js";

export const NOT_IN_CLIENT_MESSAGE = "需要在 ZTools 客户端中使用";

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
    return { ok: false, processes: [], error: NOT_IN_CLIENT_MESSAGE };
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
    else snapshotError = "进程快照为空";
  } else {
    snapshotError = snapshot.error || "读取进程快照失败";
  }

  const basic = await callHostTransport<DynamicBridge>("process_list", {}, hostOverride);
  if (basic.ok) {
    const rows = extractProcessRows(basic.data);
    if (rows && rows.length > 0) return { ok: true, processes: rows.map(mapRawToProcessInfo) };
  }
  return {
    ok: false,
    processes: [],
    error: `读取进程列表失败：${basic.ok ? "列表为空" : basic.error || "未知错误"}（完整快照：${snapshotError}）`
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
      return rawMessage || "该进程受保护，不能结束";
    case "PROCESS_ACCESS_DENIED":
      return "没有权限结束该进程：它可能属于系统或其他用户，需要以管理员身份运行 ZTools";
    case "PROCESS_IDENTITY_MISMATCH":
      return "该 PID 已不是列表里的进程（可能已退出并被复用），为避免误结束未执行，请刷新后重试";
    case "PROCESS_TERMINATE_TIMEOUT":
      return mode === "graceful"
        ? "进程没有响应正常关闭请求，可以改用强制结束"
        : "进程没有在限定时间内退出";
    case "PLUGIN_PERMISSION_REQUIRED":
      return "插件没有获得结束进程的权限，请更新插件";
    case "PLUGIN_IDENTITY_REQUIRED":
      return "无法确认插件身份，请关闭后重新打开插件再试";
    default:
      return rawMessage || "结束进程失败";
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
    return { ok: false, code: "HOST_CALL_FAILED", message: notInClient ? NOT_IN_CLIENT_MESSAGE : res.error || "调用客户端失败" };
  }
  const payload = parseJsonPayload(res.data?.result !== undefined ? res.data.result : res.data);
  if (payload?.error) return { ok: false, code: "TERMINATE_FAILED", message: String(payload.error) };
  if (payload?.terminated === true) return { ok: true };
  return { ok: false, code: "RESULT_UNCONFIRMED", message: "客户端没有确认进程已结束，请刷新列表查看" };
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
      message: `${proc.name || proc.pid} 是系统关键进程，不能结束`
    };
  }

  if (!Number.isFinite(proc.pid) || proc.pid <= 0) {
    return {
      success: false,
      command: "",
      error: "INVALID_PID",
      message: "无效的进程 PID"
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
    return { success: true, alreadyExited: true, command: cmd, message: `${label} 已经退出` };
  }
  const modeText = mode === "tree" ? "结束进程树" : mode === "graceful" ? "结束" : "强制结束";
  return { success: true, command: cmd, message: `已${modeText} ${label}` };
}

export const killProcessById = terminateProcess;

export const KILL_MODE_LABEL: Record<KillMode, string> = {
  graceful: "结束进程",
  force: "强制结束",
  tree: "结束进程树"
};

const KILL_MODE_WARNING: Record<KillMode, string> = {
  graceful: "会请求程序正常退出，程序可能弹出保存提示或拒绝关闭。",
  force: "会立即强制结束该进程，进程里未保存的内容会丢失。",
  tree: "会强制结束该进程及其全部子进程，未保存的内容会丢失。"
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
  const confirmed = await confirmAlert({
    title: `${KILL_MODE_LABEL[mode]}：${proc.name || proc.pid}？`,
    message: `PID ${proc.pid}。${KILL_MODE_WARNING[mode]}`,
    primaryAction: { title: KILL_MODE_LABEL[mode], style: "destructive" }
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
