import { confirmAlert, getHostTransport, type HostTransport } from '@ztools/declarative-ui'

/**
 * shutdown：倒计时关机（客户端 system_shutdown，Windows 上即 shutdown.exe /s /t 秒数）
 * lock / sleep：立即锁屏 / 睡眠（system_lock / system_sleep）
 * cancel：客户端没有取消关机计划的接口，只提供取消命令供用户自己运行
 */
export type PowerAction = 'shutdown' | 'sleep' | 'lock' | 'cancel'

export interface QuickScheduleItem {
  id: string
  title: string
  subtitle: string
  action: PowerAction
  seconds: number
}

export interface PowerActionResult {
  ok: boolean
  canceled?: boolean
  message: string
  detail?: string
}

export const HOST_REQUIRED_MESSAGE = '需要在 ZTools 客户端中使用'
export const CANCEL_COMMAND = 'shutdown.exe /a'
/** 客户端 system_shutdown 允许的最长倒计时（秒） */
export const MAX_SHUTDOWN_SECONDS = 86_400

/**
 * 返回与该动作等价、可在命令提示符中运行的命令；只有倒计时关机与取消关机有对应命令
 */
export function getCommandForAction(action: PowerAction, seconds: number = 0): string {
  const safeSeconds = Math.min(MAX_SHUTDOWN_SECONDS, Math.max(0, Math.floor(seconds)))
  switch (action) {
    case 'shutdown':
      return `shutdown.exe /s /t ${safeSeconds}`
    case 'cancel':
      return CANCEL_COMMAND
    default:
      throw new Error(`该电源动作没有对应的命令: ${action}`)
  }
}

/**
 * 格式化倒计时时间展示
 */
export function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/**
 * 计算执行目标的具体时间点（如 "23:45:00"）
 */
export function calculateTargetTime(seconds: number, now: number = Date.now()): string {
  const target = new Date(now + seconds * 1000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(target.getHours())}:${pad(target.getMinutes())}:${pad(target.getSeconds())}`
}

function shutdownPreset(minutes: number): QuickScheduleItem {
  const label = minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`
  return {
    id: `shutdown-${minutes}m`,
    title: `${label}后关机`,
    subtitle: `倒计时 ${minutes * 60} 秒，到时会关闭所有程序`,
    action: 'shutdown',
    seconds: minutes * 60
  }
}

/**
 * 预设选项
 */
export function getQuickScheduleOptions(): QuickScheduleItem[] {
  return [
    shutdownPreset(10),
    shutdownPreset(30),
    shutdownPreset(60),
    shutdownPreset(120),
    { id: 'immediate-lock', title: '立即锁定屏幕', subtitle: '锁定电脑，回来时需要重新登录', action: 'lock', seconds: 0 },
    { id: 'immediate-sleep', title: '立即睡眠', subtitle: '让电脑进入睡眠状态', action: 'sleep', seconds: 0 },
    {
      id: 'cancel-task',
      title: '取消已设定的关机计划',
      subtitle: `插件不能直接取消，复制 ${CANCEL_COMMAND} 后在命令提示符中运行`,
      action: 'cancel',
      seconds: 0
    }
  ]
}

export function shutdownConfirmMessage(seconds: number, now: number = Date.now()): string {
  return `将在 ${Math.round(seconds / 60)} 分钟后（约 ${calculateTargetTime(seconds, now)}）关机。到时系统会关闭所有程序，未保存的内容可能丢失。插件不能取消已设定的计划，需要取消时在命令提示符中运行 ${CANCEL_COMMAND}。`
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return String((err as { message: string }).message)
  }
  return String(err)
}

function isHostMissing(err: unknown): boolean {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined
  return code === 'HOST_FEATURE_UNAVAILABLE' || code === 'METHOD_NOT_FOUND' || code === 'HOST_METHOD_UNAVAILABLE'
}

async function callHost(transport: HostTransport, method: string, params: Record<string, unknown>): Promise<void> {
  const res = await transport.call<{ success?: boolean; error?: { message?: string } | string }>(method, params)
  if (res && typeof res === 'object' && res.success === false) {
    const err = res.error
    throw new Error(typeof err === 'string' ? err : err?.message || '客户端返回失败')
  }
}

/**
 * 执行电源动作。倒计时关机先确认，取消或没有确认框时不执行；客户端失败如实返回原因。
 * 取消关机计划不在这里执行（客户端不支持），由界面复制取消命令。
 */
export async function executePowerAction(
  item: QuickScheduleItem,
  options: { transport?: HostTransport | null; now?: number } = {}
): Promise<PowerActionResult> {
  if (item.action === 'cancel') {
    return { ok: false, message: `插件不能直接取消关机计划，请在命令提示符中运行 ${CANCEL_COMMAND}` }
  }
  if (item.action === 'shutdown') {
    if (!Number.isInteger(item.seconds) || item.seconds < 1 || item.seconds > MAX_SHUTDOWN_SECONDS) {
      return { ok: false, message: '倒计时必须在 1 秒到 24 小时之间' }
    }
    const confirmed = await confirmAlert({
      title: item.title,
      message: shutdownConfirmMessage(item.seconds, options.now),
      primaryAction: { title: '设定关机', style: 'destructive' },
      dismissAction: { title: '取消' }
    })
    if (!confirmed) return { ok: false, canceled: true, message: '已取消，未设定关机' }
  }

  const transport = options.transport === undefined ? getHostTransport() : options.transport
  if (!transport) return { ok: false, message: HOST_REQUIRED_MESSAGE }

  try {
    if (item.action === 'shutdown') {
      await callHost(transport, 'system_shutdown', { force: false, timeout: item.seconds })
      return {
        ok: true,
        message: `已设定 ${item.title}`,
        detail: `预计 ${calculateTargetTime(item.seconds, options.now)} 关机，取消请在命令提示符中运行 ${CANCEL_COMMAND}`
      }
    }
    await callHost(transport, item.action === 'lock' ? 'system_lock' : 'system_sleep', {})
    return { ok: true, message: item.action === 'lock' ? '已锁定屏幕' : '已发送睡眠指令' }
  } catch (err) {
    if (isHostMissing(err)) return { ok: false, message: HOST_REQUIRED_MESSAGE }
    const reason = errorMessage(err)
    return {
      ok: false,
      message: reason,
      ...(item.action === 'shutdown'
        ? { detail: `如果之前已经设定过关机计划，需要先运行 ${CANCEL_COMMAND} 取消` }
        : {})
    }
  }
}
