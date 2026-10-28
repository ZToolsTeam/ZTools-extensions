/**
 * Windows 系统操作集合
 * 只收录客户端确实能执行的操作：电源与会话、系统声音、隐藏文件、回收站、防止熄屏。
 * 每项写明调用的客户端接口，执行结果以客户端的返回为准，失败如实报错。
 */

import { Icon, confirmAlert } from "@ztools/declarative-ui";
import { callHostTransport } from "./native-ipc.js";

export type SystemCategory = "power" | "audio" | "maintenance";

/** 客户端执行方式：直接调用某个宿主方法 / 交给宿主内置的系统操作处理器 / 走 system_execute_action */
export type SystemActionInvoke =
  | { kind: "method"; method: string; params: Record<string, unknown> }
  | { kind: "system-actions"; func: string }
  | { kind: "execute-action"; actionKey: string };

export interface SystemActionItem {
  id: string;
  title: string;
  description: string;
  category: SystemCategory;
  icon: Icon | string;
  /** 会结束会话、关闭程序或永久删除数据的操作：执行前必须确认 */
  destructive?: boolean;
  confirmationMessage?: string;
  keywords?: string[];
  invoke: SystemActionInvoke;
}

export interface SystemActionResult {
  success: boolean;
  executed: boolean;
  canceled?: boolean;
  message: string;
}

export const SYSTEM_ACTIONS_PLUGIN = "SystemActionsPlugin";
export const HOST_REQUIRED_MESSAGE = "需要在 ZTools 客户端中使用";

export const CATEGORY_TITLES: Record<SystemCategory, string> = {
  power: "电源与会话",
  audio: "系统声音",
  maintenance: "文件与维护"
};

export const SYSTEM_ACTIONS: readonly SystemActionItem[] = Object.freeze([
  {
    id: "lock-screen",
    title: "锁定屏幕",
    description: "立即锁定电脑，回来时需要重新登录",
    category: "power",
    icon: Icon.Lock,
    keywords: ["lock", "锁屏", "锁定"],
    invoke: { kind: "method", method: "system_lock", params: {} }
  },
  {
    id: "sleep",
    title: "睡眠",
    description: "让电脑进入睡眠状态",
    category: "power",
    icon: Icon.Moon,
    keywords: ["sleep", "suspend", "睡眠", "待机"],
    invoke: { kind: "method", method: "system_sleep", params: {} }
  },
  {
    id: "hibernate",
    title: "休眠",
    description: "把内存内容写入硬盘后断电，需要系统已启用休眠功能",
    category: "power",
    icon: Icon.Power,
    keywords: ["hibernate", "休眠", "深度休眠"],
    invoke: { kind: "method", method: "system_hibernate", params: {} }
  },
  {
    id: "restart",
    title: "重新启动",
    description: "立即重启电脑",
    category: "power",
    icon: Icon.RotateClockwise,
    destructive: true,
    confirmationMessage: "确认立即重新启动电脑？未保存的内容可能会丢失。",
    keywords: ["restart", "reboot", "重启"],
    invoke: { kind: "method", method: "system_restart", params: { force: false } }
  },
  {
    id: "shut-down",
    title: "关机",
    description: "立即关闭电脑",
    category: "power",
    icon: Icon.Power,
    destructive: true,
    confirmationMessage: "确认立即关闭电脑？未保存的内容可能会丢失。",
    keywords: ["shutdown", "power off", "关机"],
    invoke: { kind: "method", method: "system_shutdown", params: { force: false, timeout: 0 } }
  },
  {
    id: "log-out",
    title: "注销",
    description: "退出当前用户，回到登录界面",
    category: "power",
    icon: Icon.Circle,
    destructive: true,
    confirmationMessage: "确认注销当前用户？未保存的内容可能会丢失。",
    keywords: ["logout", "sign out", "注销", "登出"],
    invoke: { kind: "method", method: "system_logout", params: { force: false } }
  },
  {
    id: "toggle-mute",
    title: "切换系统静音",
    description: "静音或恢复系统声音，相当于按一次键盘上的静音键",
    category: "audio",
    icon: Icon.SpeakerOff,
    keywords: ["mute", "unmute", "静音", "恢复声音"],
    invoke: { kind: "system-actions", func: "toggleMute" }
  },
  {
    id: "volume-up",
    title: "调高系统音量",
    description: "相当于按一次键盘上的音量加键",
    category: "audio",
    icon: Icon.ArrowUp,
    keywords: ["volume up", "调高音量", "音量加", "大声"],
    invoke: { kind: "system-actions", func: "volumeUp" }
  },
  {
    id: "volume-down",
    title: "调低系统音量",
    description: "相当于按一次键盘上的音量减键",
    category: "audio",
    icon: Icon.ArrowDown,
    keywords: ["volume down", "调低音量", "音量减", "小声"],
    invoke: { kind: "system-actions", func: "volumeDown" }
  },
  {
    id: "toggle-hidden-files",
    title: "切换显示隐藏的文件",
    description: "切换资源管理器的“显示隐藏的项目”设置",
    category: "maintenance",
    icon: Icon.Folder,
    keywords: ["hidden files", "隐藏文件", "显示隐藏文件"],
    invoke: { kind: "system-actions", func: "toggleHiddenFiles" }
  },
  {
    id: "empty-trash",
    title: "清空回收站",
    description: "永久删除回收站里的全部文件",
    category: "maintenance",
    icon: Icon.Trash,
    destructive: true,
    confirmationMessage: "确认永久清空回收站？清空后文件无法从回收站还原。",
    keywords: ["empty recycle bin", "empty trash", "清空回收站"],
    invoke: { kind: "system-actions", func: "emptyTrash" }
  },
  {
    id: "toggle-caffeinate",
    title: "开启或关闭防止熄屏",
    description: "让屏幕保持常亮、电脑不自动睡眠，再执行一次关闭；退出 ZTools 后失效",
    category: "maintenance",
    icon: Icon.Bolt,
    keywords: ["caffeinate", "keep awake", "prevent sleep", "防休眠", "防止熄屏", "常亮"],
    invoke: { kind: "execute-action", actionKey: "toggle-caffeinate" }
  }
]);

/**
 * 按关键字与分类过滤
 */
export function filterSystemActions(query: string, category?: string): SystemActionItem[] {
  let list = [...SYSTEM_ACTIONS];
  if (category && category !== "all") {
    list = list.filter((item) => item.category === category);
  }
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!q) return list;
  return list.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.id.includes(q) ||
      Boolean(item.keywords?.some((k) => k.toLowerCase().includes(q)))
  );
}

function isHostMissing(error: string | undefined): boolean {
  return typeof error === "string" && (error === "NO_WINDOW_ENV" || error.startsWith("METHOD_NOT_AVAILABLE"));
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 宿主执行成功后的提示文字：有状态的操作按宿主返回的状态写，不能猜 */
function describeSuccess(item: SystemActionItem, data: Record<string, unknown>): string {
  switch (item.id) {
    case "hibernate":
      return "已发送休眠指令";
    case "toggle-hidden-files":
      if (typeof data.showHiddenFiles !== "boolean") return "已切换隐藏文件的显示设置";
      return data.showHiddenFiles
        ? "已设为显示隐藏的文件，已打开的资源管理器窗口刷新后生效"
        : "已设为不显示隐藏的文件，已打开的资源管理器窗口刷新后生效";
    case "empty-trash":
      return data.alreadyEmpty === true ? "回收站本来就是空的" : "已清空回收站";
    case "toggle-caffeinate": {
      const state = readRecord(data.state);
      if (typeof state.caffeinated !== "boolean") return "已切换防止熄屏";
      return state.caffeinated ? "已开启防止熄屏，退出 ZTools 后失效" : "已关闭防止熄屏";
    }
    default:
      return `已执行：${item.title}`;
  }
}

async function callHost(
  item: SystemActionItem,
  hostOverride?: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const invoke = item.invoke;
  if (invoke.kind === "method") {
    return callHostTransport(invoke.method, invoke.params, hostOverride);
  }
  if (invoke.kind === "execute-action") {
    return callHostTransport("system_execute_action", { actionKey: invoke.actionKey }, hostOverride);
  }
  return callHostTransport(
    "dllplugin_call",
    { plugin: SYSTEM_ACTIONS_PLUGIN, func: invoke.func, params: {} },
    hostOverride
  );
}

/**
 * 执行系统操作。会结束会话、关闭程序或永久删除数据的操作必须先经用户确认，取消或没有确认框时不执行。
 */
export async function executeSystemAction(
  itemOrId: SystemActionItem | string,
  options: { hostOverride?: Record<string, unknown> } = {}
): Promise<SystemActionResult> {
  const item =
    typeof itemOrId === "string" ? SYSTEM_ACTIONS.find((a) => a.id === itemOrId) : itemOrId;
  if (!item || typeof item !== "object" || !item.invoke) {
    return { success: false, executed: false, message: `未知的系统操作: ${String(itemOrId || "")}` };
  }

  if (item.destructive) {
    const confirmed = await confirmAlert({
      title: item.title,
      message: item.confirmationMessage ?? `确认执行「${item.title}」？`,
      primaryAction: { title: "确认执行", style: "destructive" },
      dismissAction: { title: "取消" }
    });
    if (!confirmed) {
      return { success: false, executed: false, canceled: true, message: "已取消，未执行" };
    }
  }

  const res = await callHost(item, options.hostOverride);
  if (!res.ok) {
    const message = isHostMissing(res.error) ? HOST_REQUIRED_MESSAGE : res.error || `执行失败：${item.title}`;
    return { success: false, executed: false, message };
  }
  const data = readRecord(res.data);
  if (data.ok === false || data.success === false) {
    const message = String(data.error || data.message || `执行失败：${item.title}`);
    return { success: false, executed: false, message };
  }
  return { success: true, executed: true, message: describeSuccess(item, data) };
}
