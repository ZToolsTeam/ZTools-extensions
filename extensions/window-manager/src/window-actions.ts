import {
  WindowActionDefinition,
  WindowFilterOptions,
  WindowManagementPreferences,
  WindowRect,
  WindowActionResult
} from "./types.js";
import { LocalStorage } from "@ztools/declarative-ui";
import { showHUD } from "@ztools/declarative-ui";
import { callHostTransport } from "./native-ipc.js";

export const DEFAULT_WINDOW_PREFERENCES: WindowManagementPreferences = {
  innerGap: 0,
  outerGap: 0,
  cycleMode: "sizes",
  percentage: 0.9
};

const PREFERENCES_STORAGE_KEY = "ztools-window-management-preferences-v1";

export async function getWindowPreferences(): Promise<WindowManagementPreferences> {
  try {
    const raw = await LocalStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const prefs = raw as Record<string, unknown>;
      return {
        innerGap: typeof prefs.innerGap === "number" ? Math.max(0, prefs.innerGap) : DEFAULT_WINDOW_PREFERENCES.innerGap,
        outerGap: typeof prefs.outerGap === "number" ? Math.max(0, prefs.outerGap) : DEFAULT_WINDOW_PREFERENCES.outerGap,
        cycleMode: prefs.cycleMode === "disabled" ? "disabled" : "sizes",
        percentage: typeof prefs.percentage === "number" ? prefs.percentage : DEFAULT_WINDOW_PREFERENCES.percentage
      };
    }
  } catch {
    // fallback
  }
  return { ...DEFAULT_WINDOW_PREFERENCES };
}

export async function saveWindowPreferences(
  prefs: Partial<WindowManagementPreferences>
): Promise<WindowManagementPreferences> {
  const current = await getWindowPreferences();
  const updated: WindowManagementPreferences = {
    ...current,
    ...prefs
  };
  await LocalStorage.setItem(PREFERENCES_STORAGE_KEY, updated);
  return updated;
}

export const WINDOW_ACTIONS: WindowActionDefinition[] = [
  {
    id: "left-half",
    name: "左半屏 (Left Half)",
    category: "halves",
    description: "将活动窗口吸附至屏幕左半侧，占满垂直高度",
    iconName: "sidebar-left",
    keywords: ["left", "50%", "half", "左", "左半"]
  },
  {
    id: "right-half",
    name: "右半屏 (Right Half)",
    category: "halves",
    description: "将活动窗口吸附至屏幕右半侧，占满垂直高度",
    iconName: "sidebar-right",
    keywords: ["right", "50%", "half", "右", "右半"]
  },
  {
    id: "top-half",
    name: "上半屏 (Top Half)",
    category: "halves",
    description: "将活动窗口吸附至屏幕上半侧，占满水平宽度",
    iconName: "arrow-up",
    keywords: ["top", "up", "50%", "half", "上", "上半"]
  },
  {
    id: "bottom-half",
    name: "下半屏 (Bottom Half)",
    category: "halves",
    description: "将活动窗口吸附至屏幕下半侧，占满水平宽度",
    iconName: "arrow-down",
    keywords: ["bottom", "down", "50%", "half", "下", "下半"]
  },
  {
    id: "first-third",
    name: "左三分之一 (First Third)",
    category: "thirds",
    description: "占据屏幕最左侧 33.3% 宽度",
    iconName: "sidebar-left",
    keywords: ["first third", "left third", "1/3", "左三分之一"]
  },
  {
    id: "center-third",
    name: "中三分之一 (Center Third)",
    category: "thirds",
    description: "居中放置并占据屏幕中间 33.3% 宽度",
    iconName: "columns",
    keywords: ["center third", "middle third", "1/3", "中三分之一"]
  },
  {
    id: "last-third",
    name: "右三分之一 (Last Third)",
    category: "thirds",
    description: "占据屏幕最右侧 33.3% 宽度",
    iconName: "sidebar-right",
    keywords: ["last third", "right third", "1/3", "右三分之一"]
  },
  {
    id: "first-two-thirds",
    name: "左三分之二 (First Two Thirds)",
    category: "thirds",
    description: "占据左侧 66.6% 宽度，适用于主工作核心窗口",
    iconName: "layout",
    keywords: ["first two thirds", "left 2/3", "2/3", "左三分之二"]
  },
  {
    id: "last-two-thirds",
    name: "右三分之二 (Last Two Thirds)",
    category: "thirds",
    description: "占据屏幕右侧 66.6% 宽度",
    iconName: "layout",
    keywords: ["last two thirds", "right 2/3", "2/3", "右三分之二"]
  },
  {
    id: "top-left",
    name: "左上角四分之一 (Top Left Quarter)",
    category: "quarters",
    description: "占据屏幕左上角 25% 区域 (50% 宽 x 50% 高)",
    iconName: "arrow-ne",
    keywords: ["top-left", "corner", "25%", "左上角"]
  },
  {
    id: "top-right",
    name: "右上角四分之一 (Top Right Quarter)",
    category: "quarters",
    description: "占据屏幕右上角 25% 区域 (50% 宽 x 50% 高)",
    iconName: "arrow-ne",
    keywords: ["top-right", "corner", "25%", "右上角"]
  },
  {
    id: "bottom-left",
    name: "左下角四分之一 (Bottom Left Quarter)",
    category: "quarters",
    description: "占据屏幕左下角 25% 区域 (50% 宽 x 50% 高)",
    iconName: "arrow-se",
    keywords: ["bottom-left", "corner", "25%", "左下角"]
  },
  {
    id: "bottom-right",
    name: "右下角四分之一 (Bottom Right Quarter)",
    category: "quarters",
    description: "占据屏幕右下角 25% 区域 (50% 宽 x 50% 高)",
    iconName: "arrow-se",
    keywords: ["bottom-right", "corner", "25%", "右下角"]
  },
  {
    id: "maximize",
    name: "最大化 (Maximize)",
    category: "center-max",
    description: "将窗口最大化充满整个可用工作区（主动避让系统任务栏）",
    iconName: "maximize",
    keywords: ["max", "fullscreen", "最大化", "满屏"]
  },
  {
    id: "restore",
    name: "还原上一位置 (Restore)",
    category: "center-max",
    description: "将窗口还原到宿主保存的上一位置与尺寸",
    iconName: "window",
    keywords: ["restore", "还原", "上一位置"]
  },
  {
    id: "reasonable-size",
    name: "黄金适中尺寸 (Reasonable Size 60%)",
    category: "center-max",
    description: "调整窗口至 60% 屏幕宽度与 80% 高度",
    iconName: "app-window",
    keywords: ["reasonable size", "default", "适中尺寸", "黄金比例"]
  },
  {
    id: "center",
    name: "屏幕居中 (Center)",
    category: "center-max",
    description: "保持当前视窗尺寸并在当前显示器屏幕正中居中",
    iconName: "center",
    keywords: ["center", "middle", "居中", "屏幕中央"]
  },
  {
    id: "next-display",
    name: "移动到下一显示器 (Next Display)",
    category: "displays",
    description: "将当前窗口投递至下一物理显示器相对等比坐标",
    iconName: "monitor",
    keywords: ["next display", "screen", "monitor", "下一显示器", "多屏"]
  },
  {
    id: "previous-display",
    name: "移动到上一显示器 (Previous Display)",
    category: "displays",
    description: "将当前窗口投递至上一物理显示器相对等比坐标",
    iconName: "monitor",
    keywords: ["previous display", "screen", "monitor", "上一显示器", "多屏"]
  },
  {
    id: "make-larger",
    name: "视窗放大 (Make Larger)",
    category: "resize",
    description: "窗口宽高各增加 100 像素，限制在当前工作区内",
    iconName: "plus",
    keywords: ["make larger", "grow", "zoom in", "放大"]
  },
  {
    id: "make-smaller",
    name: "视窗缩小 (Make Smaller)",
    category: "resize",
    description: "窗口宽高各缩小 100 像素，保留最小尺寸并限制在工作区内",
    iconName: "minus",
    keywords: ["make smaller", "shrink", "zoom out", "缩小"]
  }
];

// 兼容别名映射 (Aliases)
const ALIASES: Record<string, string> = {
  "top-left": "top-left-quarter",
  "top-right": "top-right-quarter",
  "bottom-left": "bottom-left-quarter",
  "bottom-right": "bottom-right-quarter",
  "maximize-almost": "almost-maximize"
};

/**
 * 过滤与搜索窗口动作
 */
export function filterWindowActions(
  actions: WindowActionDefinition[],
  options: WindowFilterOptions
): WindowActionDefinition[] {
  let result = [...actions];

  if (options.category && options.category !== "all") {
    result = result.filter(a => a.category === options.category);
  }

  if (options.query && options.query.trim()) {
    const q = options.query.trim().toLowerCase();
    result = result.filter(a => {
      const inId = a.id.toLowerCase().includes(q);
      const inName = a.name.toLowerCase().includes(q);
      const inDesc = a.description.toLowerCase().includes(q);
      const inShortcut = a.shortcut ? a.shortcut.toLowerCase().includes(q) : false;
      const inKeywords = a.keywords ? a.keywords.some(k => k.toLowerCase().includes(q)) : false;
      return inId || inName || inDesc || inShortcut || inKeywords;
    });
  }

  return result;
}

/**
 * 窗口几何运算引擎 (Pure Geometry Calculator)
 * 按半屏 / 三分屏 / 四分屏 / 六分屏等常用栅格计算窗口位置，支持 innerGap 与 outerGap 边距调整
 */
export function calculateWindowGeometry(
  actionId: string,
  curWin: WindowRect,
  monRect: WindowRect,
  prefs: Partial<WindowManagementPreferences> = {}
): WindowRect {
  const outerGap = Math.max(0, prefs.outerGap ?? DEFAULT_WINDOW_PREFERENCES.outerGap);
  const innerGap = Math.max(0, prefs.innerGap ?? DEFAULT_WINDOW_PREFERENCES.innerGap);
  const percentage = prefs.percentage ?? DEFAULT_WINDOW_PREFERENCES.percentage;

  // 有效工作区 (减去 outerGap)
  const effX = monRect.x + outerGap;
  const effY = monRect.y + outerGap;
  const effW = Math.max(100, monRect.width - 2 * outerGap);
  const effH = Math.max(100, monRect.height - 2 * outerGap);

  const resolvedId = ALIASES[actionId] || actionId;

  switch (resolvedId) {
    // --- 1. Halves ---
    case "left-half": {
      const halfW = Math.floor((effW - innerGap) / 2);
      return { x: effX, y: effY, width: halfW, height: effH };
    }
    case "right-half": {
      const halfW = Math.floor((effW - innerGap) / 2);
      const rightW = effW - halfW - innerGap;
      return { x: effX + halfW + innerGap, y: effY, width: rightW, height: effH };
    }
    case "top-half": {
      const halfH = Math.floor((effH - innerGap) / 2);
      return { x: effX, y: effY, width: effW, height: halfH };
    }
    case "bottom-half": {
      const halfH = Math.floor((effH - innerGap) / 2);
      const bottomH = effH - halfH - innerGap;
      return { x: effX, y: effY + halfH + innerGap, width: effW, height: bottomH };
    }
    case "center-half": {
      const w = Math.floor(effW * 0.5);
      const x = effX + Math.floor((effW - w) / 2);
      return { x, y: effY, width: w, height: effH };
    }

    // --- 2. Thirds ---
    case "first-third": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      return { x: effX, y: effY, width: unitW, height: effH };
    }
    case "center-third": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      return { x: effX + unitW + innerGap, y: effY, width: unitW, height: effH };
    }
    case "last-third": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      const lastW = effW - 2 * unitW - 2 * innerGap;
      return { x: effX + 2 * (unitW + innerGap), y: effY, width: lastW, height: effH };
    }
    case "first-two-thirds": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      const twoThirdsW = 2 * unitW + innerGap;
      return { x: effX, y: effY, width: twoThirdsW, height: effH };
    }
    case "center-two-thirds": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      const twoThirdsW = 2 * unitW + innerGap;
      const x = effX + Math.floor((effW - twoThirdsW) / 2);
      return { x, y: effY, width: twoThirdsW, height: effH };
    }
    case "last-two-thirds": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      const twoThirdsW = effW - unitW - innerGap;
      return { x: effX + unitW + innerGap, y: effY, width: twoThirdsW, height: effH };
    }
    case "top-third": {
      const unitH = Math.floor((effH - 2 * innerGap) / 3);
      return { x: effX, y: effY, width: effW, height: unitH };
    }
    case "middle-third": {
      const unitH = Math.floor((effH - 2 * innerGap) / 3);
      return { x: effX, y: effY + unitH + innerGap, width: effW, height: unitH };
    }
    case "bottom-third": {
      const unitH = Math.floor((effH - 2 * innerGap) / 3);
      const bottomH = effH - 2 * unitH - 2 * innerGap;
      return { x: effX, y: effY + 2 * (unitH + innerGap), width: effW, height: bottomH };
    }

    // --- 3. Quarters ---
    case "top-left-quarter": {
      const halfW = Math.floor((effW - innerGap) / 2);
      const halfH = Math.floor((effH - innerGap) / 2);
      return { x: effX, y: effY, width: halfW, height: halfH };
    }
    case "top-right-quarter": {
      const halfW = Math.floor((effW - innerGap) / 2);
      const rightW = effW - halfW - innerGap;
      const halfH = Math.floor((effH - innerGap) / 2);
      return { x: effX + halfW + innerGap, y: effY, width: rightW, height: halfH };
    }
    case "bottom-left-quarter": {
      const halfW = Math.floor((effW - innerGap) / 2);
      const halfH = Math.floor((effH - innerGap) / 2);
      const bottomH = effH - halfH - innerGap;
      return { x: effX, y: effY + halfH + innerGap, width: halfW, height: bottomH };
    }
    case "bottom-right-quarter": {
      const halfW = Math.floor((effW - innerGap) / 2);
      const rightW = effW - halfW - innerGap;
      const halfH = Math.floor((effH - innerGap) / 2);
      const bottomH = effH - halfH - innerGap;
      return { x: effX + halfW + innerGap, y: effY + halfH + innerGap, width: rightW, height: bottomH };
    }

    // --- 4. Sixths (3 columns x 2 rows) ---
    case "top-left-sixth": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      const halfH = Math.floor((effH - innerGap) / 2);
      return { x: effX, y: effY, width: unitW, height: halfH };
    }
    case "top-center-sixth": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      const halfH = Math.floor((effH - innerGap) / 2);
      return { x: effX + unitW + innerGap, y: effY, width: unitW, height: halfH };
    }
    case "top-right-sixth": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      const rightW = effW - 2 * unitW - 2 * innerGap;
      const halfH = Math.floor((effH - innerGap) / 2);
      return { x: effX + 2 * (unitW + innerGap), y: effY, width: rightW, height: halfH };
    }
    case "bottom-left-sixth": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      const halfH = Math.floor((effH - innerGap) / 2);
      const bottomH = effH - halfH - innerGap;
      return { x: effX, y: effY + halfH + innerGap, width: unitW, height: bottomH };
    }
    case "bottom-center-sixth": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      const halfH = Math.floor((effH - innerGap) / 2);
      const bottomH = effH - halfH - innerGap;
      return { x: effX + unitW + innerGap, y: effY + halfH + innerGap, width: unitW, height: bottomH };
    }
    case "bottom-right-sixth": {
      const unitW = Math.floor((effW - 2 * innerGap) / 3);
      const rightW = effW - 2 * unitW - 2 * innerGap;
      const halfH = Math.floor((effH - innerGap) / 2);
      const bottomH = effH - halfH - innerGap;
      return { x: effX + 2 * (unitW + innerGap), y: effY + halfH + innerGap, width: rightW, height: bottomH };
    }

    // --- 5. Center & Maximize ---
    case "maximize": {
      return { x: effX, y: effY, width: effW, height: effH };
    }
    case "restore": {
      const w = Math.round(effW * 0.7);
      const h = Math.round(effH * 0.7);
      return {
        x: effX + Math.round((effW - w) / 2),
        y: effY + Math.round((effH - h) / 2),
        width: w,
        height: h
      };
    }
    case "almost-maximize": {
      const w = Math.round(effW * percentage);
      const h = Math.round(effH * percentage);
      return {
        x: effX + Math.round((effW - w) / 2),
        y: effY + Math.round((effH - h) / 2),
        width: w,
        height: h
      };
    }
    case "almost-maximize-80": {
      const w = Math.round(effW * 0.8);
      const h = Math.round(effH * 0.8);
      return {
        x: effX + Math.round((effW - w) / 2),
        y: effY + Math.round((effH - h) / 2),
        width: w,
        height: h
      };
    }
    case "almost-maximize-70": {
      const w = Math.round(effW * 0.7);
      const h = Math.round(effH * 0.7);
      return {
        x: effX + Math.round((effW - w) / 2),
        y: effY + Math.round((effH - h) / 2),
        width: w,
        height: h
      };
    }
    case "almost-maximize-60": {
      const w = Math.round(effW * 0.6);
      const h = Math.round(effH * 0.6);
      return {
        x: effX + Math.round((effW - w) / 2),
        y: effY + Math.round((effH - h) / 2),
        width: w,
        height: h
      };
    }
    case "reasonable-size": {
      const w = Math.min(1024, Math.round(effW * 0.6));
      const h = Math.min(900, Math.round(effH * 0.8));
      return {
        x: effX + Math.round((effW - w) / 2),
        y: effY + Math.round((effH - h) / 2),
        width: w,
        height: h
      };
    }
    case "center": {
      const w = Math.max(300, Math.min(curWin.width, effW));
      const h = Math.max(200, Math.min(curWin.height, effH));
      return {
        x: effX + Math.round((effW - w) / 2),
        y: effY + Math.round((effH - h) / 2),
        width: w,
        height: h
      };
    }
    case "maximize-height": {
      return {
        x: curWin.x,
        y: effY,
        width: curWin.width,
        height: effH
      };
    }
    case "maximize-width": {
      return {
        x: effX,
        y: curWin.y,
        width: effW,
        height: curWin.height
      };
    }

    // --- 6. Resize ---
    case "make-larger": {
      const addW = Math.round(curWin.width * 0.1);
      const addH = Math.round(curWin.height * 0.1);
      const newW = Math.min(effW, curWin.width + addW);
      const newH = Math.min(effH, curWin.height + addH);
      return {
        x: Math.max(effX, curWin.x - Math.round(addW / 2)),
        y: Math.max(effY, curWin.y - Math.round(addH / 2)),
        width: newW,
        height: newH
      };
    }
    case "make-smaller": {
      const subW = Math.round(curWin.width * 0.1);
      const subH = Math.round(curWin.height * 0.1);
      const newW = Math.max(300, curWin.width - subW);
      const newH = Math.max(200, curWin.height - subH);
      return {
        x: curWin.x + Math.round(subW / 2),
        y: curWin.y + Math.round(subH / 2),
        width: newW,
        height: newH
      };
    }

    default:
      return { ...curWin };
  }
}

const savedWindowStatesMap = new Map<string, WindowRect>();
const currentWindowRectsMap = new Map<string, WindowRect>();
let lastExternalForegroundHwnd = "external-active-window";

export function hasWindowBoundsChanged(a: WindowRect, b: WindowRect): boolean {
  return (
    Math.round(a.x) !== Math.round(b.x) ||
    Math.round(a.y) !== Math.round(b.y) ||
    Math.round(a.width) !== Math.round(b.width) ||
    Math.round(a.height) !== Math.round(b.height)
  );
}

export function recordExternalForegroundWindow(
  windowId: string,
  bounds?: WindowRect,
  isZToolsSelf = false
): string {
  const cleaned = String(windowId || "").trim();
  if (!cleaned || isZToolsSelf || cleaned.toLowerCase().startsWith("ztools")) {
    return lastExternalForegroundHwnd;
  }
  lastExternalForegroundHwnd = cleaned;
  if (bounds) {
    currentWindowRectsMap.set(cleaned, { ...bounds });
  }
  return lastExternalForegroundHwnd;
}

export function getLastExternalForegroundWindow(): string {
  return lastExternalForegroundHwnd;
}

export function saveWindowState(windowId: string, rect: WindowRect): void {
  if (!windowId) return;
  savedWindowStatesMap.set(windowId, {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  });
}

export function getSavedWindowState(windowId: string): WindowRect | undefined {
  if (!windowId) return undefined;
  const saved = savedWindowStatesMap.get(windowId);
  return saved ? { ...saved } : undefined;
}

export function clearSavedWindowStates(): void {
  savedWindowStatesMap.clear();
  currentWindowRectsMap.clear();
  lastExternalForegroundHwnd = "external-active-window";
}

interface WindowHostResult {
  ok?: boolean;
  success?: boolean;
  rect?: WindowRect;
  error?: string;
  message?: string;
}
interface WindowActionHost { [key: string]: unknown }

function normalizeWindowActionName(action: string): string {
  return action.trim().toLowerCase().replace(/_/g, "-").replace(/^(top|bottom)-(left|right)-quarter$/, "$1-$2");
}

/** 宿主清单决定各平台可用动作；最低宿主版本由插件清单约束。 */
export async function loadSupportedWindowActions(hostBridge?: WindowActionHost): Promise<WindowActionDefinition[]> {
  const result = await callHostTransport<unknown>("window_manage_list_actions", {}, hostBridge);
  if (!result.ok || !Array.isArray(result.data)) {
    throw new Error(result.error || "无法读取窗口动作，请升级客户端后重试");
  }
  const supported = new Set(result.data.flatMap(item =>
    item && typeof item === "object" && typeof item.name === "string" ? [normalizeWindowActionName(item.name)] : []));
  return WINDOW_ACTIONS.filter(action => supported.has(action.id));
}

/** 只提交规范动作名；窗口目标、几何与成功状态全部由宿主确认。 */
export async function executeWindowAction(
  actionId: string,
  options: {
    windowId?: string;
    isZToolsSelf?: boolean;
    curWin?: WindowRect;
    monRect?: WindowRect;
    preferences?: Partial<WindowManagementPreferences>;
    hostBridge?: WindowActionHost;
    hostOverride?: WindowActionHost;
  } = {}
): Promise<WindowActionResult> {
  const canonical = typeof actionId === "string" ? normalizeWindowActionName(actionId) : "";
  const definition = WINDOW_ACTIONS.find(action => action.id === canonical);
  if (!definition) return { success: false, actionId, actionName: "", error: "不支持的窗口调度动作" };
  const result = await callHostTransport<WindowHostResult>("window_manage_action", { action: canonical }, options.hostBridge ?? options.hostOverride);
  const data = result.data;
  if (!result.ok || !data || data.success === false || data.ok === false || (data.success !== true && data.ok !== true)) {
    return { success: false, actionId: canonical, actionName: definition.name,
      error: result.error || data?.error || data?.message || "窗口操作未获宿主确认" };
  }
  const rect = data.rect;
  const actualRect = rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0 ? rect : undefined;
  try { await showHUD(`已调整: ${definition.name}`); } catch { /* 提示失败不改变已完成的窗口操作。 */ }
  return { success: true, actionId: canonical, actionName: definition.name, ...(actualRect ? { rect: actualRect } : {}) };
}
