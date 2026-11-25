/**
 * Windows 系统操作集合
 * 只收录客户端确实能执行的操作：电源与会话、系统声音、隐藏文件、回收站、防止熄屏。
 * 每项写明调用的客户端接口，执行结果以客户端的返回为准，失败如实报错。
 */

import { Icon, confirmAlert } from "@ztools/declarative-ui";
import { callHostTransport } from "./native-ipc.js";
import { t } from "./i18n.js";
import { resolveErrorMessage } from './error-i18n.js'
import { SYSTEM_ACTION_ZH_KEYWORDS } from "./system-actions.zh-data.js";

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
export function getHostRequiredMessage(): string {
  return t("hostRequired");
}

export const CATEGORY_TITLES: Record<SystemCategory, string> = {
  get power() {
    return t("catPower");
  },
  get audio() {
    return t("catAudio");
  },
  get maintenance() {
    return t("catMaintenance");
  }
};

type SystemActionSpec = Omit<SystemActionItem, "title" | "description" | "confirmationMessage"> & {
  titleKey: Parameters<typeof t>[0];
  descKey: Parameters<typeof t>[0];
  confirmKey?: Parameters<typeof t>[0];
};

function createSystemAction(spec: SystemActionSpec): SystemActionItem {
  const { titleKey, descKey, confirmKey, keywords, ...rest } = spec;
  const zhKeywords = SYSTEM_ACTION_ZH_KEYWORDS[rest.id] ?? [];
  const item: SystemActionItem = {
    ...rest,
    keywords: [...(keywords ?? []), ...zhKeywords],
    get title() {
      return t(titleKey);
    },
    get description() {
      return t(descKey);
    },
    ...(confirmKey
      ? {
          get confirmationMessage() {
            return t(confirmKey);
          }
        }
      : {})
  };
  return item;
}

export const SYSTEM_ACTIONS: readonly SystemActionItem[] = Object.freeze([
  createSystemAction({
    id: "lock-screen",
    titleKey: "itemTitleLockScreen",
    descKey: "itemDescLockScreen",
    category: "power",
    icon: Icon.Lock,
    keywords: ["lock"],
    invoke: { kind: "method", method: "system_lock", params: {} }
  }),
  createSystemAction({
    id: "sleep",
    titleKey: "itemTitleSleep",
    descKey: "itemDescSleep",
    category: "power",
    icon: Icon.Moon,
    keywords: ["sleep", "suspend"],
    invoke: { kind: "method", method: "system_sleep", params: {} }
  }),
  createSystemAction({
    id: "hibernate",
    titleKey: "itemTitleHibernate",
    descKey: "itemDescHibernate",
    category: "power",
    icon: Icon.Power,
    keywords: ["hibernate"],
    invoke: { kind: "method", method: "system_hibernate", params: {} }
  }),
  createSystemAction({
    id: "restart",
    titleKey: "itemTitleRestart",
    descKey: "itemDescRestart",
    category: "power",
    icon: Icon.RotateClockwise,
    destructive: true,
    confirmKey: "confirmRestart",
    keywords: ["restart", "reboot"],
    invoke: { kind: "method", method: "system_restart", params: { force: false } }
  }),
  createSystemAction({
    id: "shut-down",
    titleKey: "itemTitleShutDown",
    descKey: "itemDescShutDown",
    category: "power",
    icon: Icon.Power,
    destructive: true,
    confirmKey: "confirmShutDown",
    keywords: ["shutdown", "power off"],
    invoke: { kind: "method", method: "system_shutdown", params: { force: false, timeout: 0 } }
  }),
  createSystemAction({
    id: "log-out",
    titleKey: "itemTitleLogOut",
    descKey: "itemDescLogOut",
    category: "power",
    icon: Icon.Circle,
    destructive: true,
    confirmKey: "confirmLogOut",
    keywords: ["logout", "sign out"],
    invoke: { kind: "method", method: "system_logout", params: { force: false } }
  }),
  createSystemAction({
    id: "toggle-mute",
    titleKey: "itemTitleToggleMute",
    descKey: "itemDescToggleMute",
    category: "audio",
    icon: Icon.SpeakerOff,
    keywords: ["mute", "unmute"],
    invoke: { kind: "system-actions", func: "toggleMute" }
  }),
  createSystemAction({
    id: "volume-up",
    titleKey: "itemTitleVolumeUp",
    descKey: "itemDescVolumeUp",
    category: "audio",
    icon: Icon.ArrowUp,
    keywords: ["volume up"],
    invoke: { kind: "system-actions", func: "volumeUp" }
  }),
  createSystemAction({
    id: "volume-down",
    titleKey: "itemTitleVolumeDown",
    descKey: "itemDescVolumeDown",
    category: "audio",
    icon: Icon.ArrowDown,
    keywords: ["volume down"],
    invoke: { kind: "system-actions", func: "volumeDown" }
  }),
  createSystemAction({
    id: "toggle-hidden-files",
    titleKey: "itemTitleToggleHiddenFiles",
    descKey: "itemDescToggleHiddenFiles",
    category: "maintenance",
    icon: Icon.Folder,
    keywords: ["hidden files"],
    invoke: { kind: "system-actions", func: "toggleHiddenFiles" }
  }),
  createSystemAction({
    id: "empty-trash",
    titleKey: "itemTitleEmptyTrash",
    descKey: "itemDescEmptyTrash",
    category: "maintenance",
    icon: Icon.Trash,
    destructive: true,
    confirmKey: "confirmEmptyTrash",
    keywords: ["empty recycle bin", "empty trash"],
    invoke: { kind: "system-actions", func: "emptyTrash" }
  }),
  createSystemAction({
    id: "toggle-caffeinate",
    titleKey: "itemTitleToggleCaffeinate",
    descKey: "itemDescToggleCaffeinate",
    category: "maintenance",
    icon: Icon.Bolt,
    keywords: ["caffeinate", "keep awake", "prevent sleep"],
    invoke: { kind: "execute-action", actionKey: "toggle-caffeinate" }
  })
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
      return t("successHibernate");
    case "toggle-hidden-files":
      if (typeof data.showHiddenFiles !== "boolean") return t("successHiddenToggled");
      return data.showHiddenFiles ? t("successHiddenShown") : t("successHiddenHidden");
    case "empty-trash":
      return data.alreadyEmpty === true ? t("successTrashAlreadyEmpty") : t("successTrashEmptied");
    case "toggle-caffeinate": {
      const state = readRecord(data.state);
      if (typeof state.caffeinated !== "boolean") return t("successCaffeinateToggled");
      return state.caffeinated ? t("successCaffeinateOn") : t("successCaffeinateOff");
    }
    default:
      return t("successExecuted", { title: item.title });
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
    return { success: false, executed: false, message: t("unknownAction", { id: String(itemOrId || "") }) };
  }

  if (item.destructive) {
    const confirmed = await confirmAlert({
      title: item.title,
      message: item.confirmationMessage ?? t("confirmGeneric", { title: item.title }),
      primaryAction: { title: t("confirmBtn"), style: "destructive" },
      dismissAction: { title: t("cancelBtn") }
    });
    if (!confirmed) {
      return { success: false, executed: false, canceled: true, message: t("canceledResult") };
    }
  }

  const res = await callHost(item, options.hostOverride);
  if (!res.ok) {
    const message = isHostMissing(res.error) ? t("hostRequired") : resolveErrorMessage(res, t("execFailed", { title: item.title }));
    return { success: false, executed: false, message };
  }
  const data = readRecord(res.data);
  if (data.ok === false || data.success === false) {
    const message = resolveErrorMessage(data, t("execFailed", { title: item.title }));
    return { success: false, executed: false, message };
  }
  return { success: true, executed: true, message: describeSuccess(item, data) };
}
