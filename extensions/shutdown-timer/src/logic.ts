export type PowerAction = 'shutdown' | 'reboot' | 'sleep' | 'lock' | 'cancel'

export interface QuickScheduleItem {
  id: string
  title: string
  subtitle: string
  action: PowerAction
  seconds: number
  description: string
}

/**
 * 根据动作和倒计时秒数生成 Windows 系统执行指令
 */
export function getCommandForAction(action: PowerAction, seconds: number = 0): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  switch (action) {
    case 'shutdown':
      return `shutdown.exe /s /t ${safeSeconds}`
    case 'reboot':
      return `shutdown.exe /r /t ${safeSeconds}`
    case 'cancel':
      return `shutdown.exe /a`
    case 'lock':
      return `rundll32.exe user32.dll,LockWorkStation`
    case 'sleep':
      return `rundll32.exe powrprof.dll,SetSuspendState 0,1,0`
    default:
      throw new Error(`未知电源动作: ${action}`)
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
 * 计算执行目标的具体时间点（如 "23:45"）
 */
export function calculateTargetTime(seconds: number): string {
  const target = new Date(Date.now() + seconds * 1000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(target.getHours())}:${pad(target.getMinutes())}:${pad(target.getSeconds())}`
}

/**
 * 预设快捷选项
 */
export function getQuickScheduleOptions(): QuickScheduleItem[] {
  return [
    {
      id: 'cancel-task',
      title: '取消当前关机/重启任务',
      subtitle: '执行 shutdown.exe /a',
      action: 'cancel',
      seconds: 0,
      description: '清除系统当前正在排队的定时关机任务'
    },
    {
      id: 'shutdown-10m',
      title: '10 分钟后自动关机',
      subtitle: '倒计时 600 秒',
      action: 'shutdown',
      seconds: 600,
      description: '保存当前工作，电脑将在 10 分钟后平稳关机'
    },
    {
      id: 'shutdown-30m',
      title: '30 分钟后自动关机',
      subtitle: '倒计时 1800 秒',
      action: 'shutdown',
      seconds: 1800,
      description: '适合睡前挂机下载或渲染完成后自动关机'
    },
    {
      id: 'shutdown-1h',
      title: '1 小时后自动关机',
      subtitle: '倒计时 3600 秒',
      action: 'shutdown',
      seconds: 3600,
      description: '电脑将在 1 小时后自动关机'
    },
    {
      id: 'shutdown-2h',
      title: '2 小时后自动关机',
      subtitle: '倒计时 7200 秒',
      action: 'shutdown',
      seconds: 7200,
      description: '长任务定时关机'
    },
    {
      id: 'reboot-10m',
      title: '10 分钟后自动重启',
      subtitle: '倒计时 600 秒',
      action: 'reboot',
      seconds: 600,
      description: '系统更新或环境清理后自动重启'
    },
    {
      id: 'immediate-lock',
      title: '立即锁定屏幕 (Lock)',
      subtitle: 'Win + L 快捷锁屏',
      action: 'lock',
      seconds: 0,
      description: '离开工位时快速保护屏幕与隐私'
    },
    {
      id: 'immediate-sleep',
      title: '立即进入休眠 (Sleep)',
      subtitle: '系统低功耗睡眠',
      action: 'sleep',
      seconds: 0,
      description: '让电脑立即进入低功耗待机睡眠状态'
    }
  ]
}
