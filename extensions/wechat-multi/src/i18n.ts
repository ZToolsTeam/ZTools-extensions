import { createTranslator } from "@ztools/declarative-ui";

const rawT = createTranslator(
  {
    "zh-CN": {
      hostRequired: "需要在 ZTools 客户端中使用",
      launchLimitNote: "微信已在运行时通常只会切换到已有窗口，是否出现新的登录窗口以实际为准",
      defaultProcName: "微信",
      errReadProcessesFailed: "读取微信进程失败",
      errLaunchFailed: "启动微信失败",
      errNoNewProcess: "客户端没有返回新进程，微信可能没有启动",
      msgLaunchedAgain: "已再次运行微信程序",
      toastCopyFailed: "复制失败",
      toastRefreshedTitle: "已刷新",
      toastRefreshedMsg: "运行中的微信进程 {count} 个",
      actionLaunchAgain: "再运行一次微信",
      kwLaunch: "启动",
      launchMissingPathSub: "未检测到微信安装位置，启动时会提示失败原因",
      actionRetryRead: "重新读取",
      pidStartedAt: "PID {pid} · 启动于 {time}",
      actionCopyPid: "复制 PID",
      toastCopiedPid: "已复制 PID",
      navTitle: "微信多开",
      searchPlaceholder: "搜索微信进程名或 PID",
      summaryFailed: "读取失败：{error}",
      summaryRunning: "运行中的 WeChat / Weixin 进程 {count} 个（同一个微信也可能有多个同名进程）{warning}",
      actionRefresh: "刷新",
      sectionActions: "操作",
      sectionRunning: "正在运行的微信 ({count})"
    },
    "en-US": {
      hostRequired: "Must be used inside ZTools client",
      launchLimitNote: "If WeChat is already running, it usually switches to an existing window; whether a new login window opens depends on WeChat",
      defaultProcName: "WeChat",
      errReadProcessesFailed: "Failed to read WeChat processes",
      errLaunchFailed: "Failed to launch WeChat",
      errNoNewProcess: "Client did not return a new process; WeChat may not have started",
      msgLaunchedAgain: "Launched WeChat again",
      toastCopyFailed: "Copy failed",
      toastRefreshedTitle: "Refreshed",
      toastRefreshedMsg: "{count} running WeChat [[count:process|processes]]",
      actionLaunchAgain: "Launch Another WeChat",
      kwLaunch: "launch",
      launchMissingPathSub: "WeChat install path not detected; launching will report the reason if it fails",
      actionRetryRead: "Retry",
      pidStartedAt: "PID {pid} · Started {time}",
      actionCopyPid: "Copy PID",
      toastCopiedPid: "PID copied",
      navTitle: "WeChat Multi-Instance",
      searchPlaceholder: "Search WeChat process name or PID",
      summaryFailed: "Read failed: {error}",
      summaryRunning: "{count} running WeChat/Weixin process(es) (a single instance may spawn multiple processes){warning}",
      actionRefresh: "Refresh",
      sectionActions: "Actions",
      sectionRunning: "Running WeChat Processes ({count})"
    }
  },
  { defaultLocale: "en-US" }
)
export const t: typeof rawT = (key, params) => {
  const out = rawT(key, params)
  if (!out.includes('[[')) return out
  return out.replace(/\[\[([A-Za-z0-9_.-]+):([^|\]]+)\|([^\]]+)\]\]/g, (_m, k: string, one: string, other: string) => {
    const v = params?.[k]
    const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''))
    return n === 1 ? one : other
  })
}
