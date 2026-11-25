type DynamicBridge = ReturnType<typeof JSON.parse>;
/**
 * 微信进程查看与再次启动
 * 通过客户端读取正在运行的 WeChat / Weixin 进程（新版微信一个账号也会有多个同名进程，进程数不等于账号数），并可让客户端再运行一次微信程序。
 * 客户端只是再启动一次微信程序，不修改、不注入微信，也不会解除微信自身的单实例限制。
 */

import { invokePluginService, isRealElectronHost, formatBytes } from './native-ipc.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'

export { formatBytes }

export const DLL_PLUGIN_NAME = 'WeChatMultiPlugin'
export function getHostRequiredMessage(): string {
  return t('hostRequired')
}
export function getLaunchLimitNote(): string {
  return t('launchLimitNote')
}

export interface WechatInstanceItem {
  id: string
  pid: number
  name: string
  memoryBytes: number
  /** 宿主返回的启动时刻（HH:mm:ss），读不到时为空 */
  startTime: string
}

export interface WechatMultiSnapshot {
  ok: boolean
  error?: string
  /** 部分信息读取失败（例如读安装路径超时），列表仍可用 */
  warning?: string
  installed: boolean
  installPath: string
  instances: WechatInstanceItem[]
}

export interface WechatLaunchResult {
  ok: boolean
  pids: number[]
  executablePath: string
  message: string
}

function hostAvailable(hostOverride?: DynamicBridge): boolean {
  return Boolean(hostOverride) || isRealElectronHost(hostOverride)
}

function toInstance(raw: DynamicBridge): WechatInstanceItem | null {
  if (!raw || typeof raw !== 'object') return null
  const pid = Number(raw.pid)
  if (!Number.isInteger(pid) || pid <= 0) return null
  const memoryBytes = Number(raw.workingSetBytes ?? raw.memoryBytes ?? 0)
  return {
    id: `wx-proc-${pid}`,
    pid,
    name: String(raw.name || t('defaultProcName')),
    memoryBytes: Number.isFinite(memoryBytes) && memoryBytes > 0 ? memoryBytes : 0,
    startTime: typeof raw.startTime === 'string' ? raw.startTime : ''
  }
}

/**
 * 读取微信安装位置与正在运行的 WeChat / Weixin 进程；读取失败时 ok 为 false 并带上原因，不返回编造的进程
 */
export async function fetchWechatInstances(hostOverride?: DynamicBridge): Promise<WechatMultiSnapshot> {
  const empty = { installed: false, installPath: '', instances: [] as WechatInstanceItem[] }
  if (!hostAvailable(hostOverride)) {
    return { ok: false, error: t('hostRequired'), ...empty }
  }
  const res = await invokePluginService<DynamicBridge>(DLL_PLUGIN_NAME, 'getStatus', {}, hostOverride)
  if (!res.ok || !res.data || typeof res.data !== 'object') {
    return { ok: false, error: resolveErrorMessage(res, t('errReadProcessesFailed')), ...empty }
  }
  const data = res.data
  if (data.ok === false || data.success === false) {
    return { ok: false, error: String(resolveErrorMessage(data, t('errReadProcessesFailed'))), ...empty }
  }
  const rawList = Array.isArray(data.instances) ? data.instances : []
  const instances = rawList.map(toInstance).filter((i: WechatInstanceItem | null): i is WechatInstanceItem => i !== null)
  const installPath = String(data.installPath || data.wechatPath || '')
  return {
    ok: true,
    ...(data.partial === true && data.warning ? { warning: String(data.warning) } : {}),
    installed: data.installed === true || Boolean(installPath),
    installPath,
    instances
  }
}

export const fetchWeChatMultiSnapshot = fetchWechatInstances

/**
 * 让客户端再运行一次微信程序。成功只表示程序已启动，不代表出现了新的微信账号窗口。
 */
export async function launchWechatAgain(hostOverride?: DynamicBridge): Promise<WechatLaunchResult> {
  if (!hostAvailable(hostOverride)) {
    return { ok: false, pids: [], executablePath: '', message: t('hostRequired') }
  }
  const res = await invokePluginService<DynamicBridge>(DLL_PLUGIN_NAME, 'launchInstance', { count: 1 }, hostOverride)
  const data = res.data
  if (!res.ok || !data || typeof data !== 'object' || data.ok === false || data.success === false) {
    return {
      ok: false,
      pids: [],
      executablePath: '',
      message: resolveErrorMessage(data && typeof data === 'object' && data.error ? data : res, t('errLaunchFailed'))
    }
  }
  const pids = Array.isArray(data.pids) ? data.pids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : []
  if (pids.length === 0) {
    return { ok: false, pids: [], executablePath: '', message: t('errNoNewProcess') }
  }
  return {
    ok: true,
    pids,
    executablePath: String(data.wechatPath || data.installPath || ''),
    message: t('msgLaunchedAgain')
  }
}

export function filterWechatInstances(items: WechatInstanceItem[], query: string): WechatInstanceItem[] {
  if (!Array.isArray(items)) return []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return items
  return items.filter((i) => i.name.toLowerCase().includes(q) || String(i.pid).includes(q))
}
