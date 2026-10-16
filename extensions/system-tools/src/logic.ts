export interface CapabilityActionItem {
  id: string
  title: string
  subtitle: string
  tag: string
  method: string
  params: Record<string, unknown>
}

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
}

export const DLL_PLUGIN_NAME = "SystemToolsPlugin"
export const FORBIDDEN_TARGET_PATTERN = new RegExp("^(?:format\\s+[a-z]:|del\\s+/f\\s+/s\\s+/q\\s+c:|rd\\s+/s\\s+/q\\s+c:).*", 'i')
export const FORBIDDEN_REASON = "系统工具启动器严禁执行格式化分区或递归清空系统盘等破坏性命令"

const PRESET_ITEMS: CapabilityActionItem[] = [
  {
    "id": "sys-list-tools",
    "title": "枚举全部 Windows 原生管理控制台与系统组件",
    "subtitle": "提取系统原生高清图标，包含 regedit / gpedit.msc / services.msc / diskmgmt.msc",
    "tag": "系统组件",
    "method": "GetToolsList",
    "params": {
      "includeIcons": true
    }
  },
  {
    "id": "sys-env-vars",
    "title": "快速打开系统环境变量与 PATH 编辑器",
    "subtitle": "直达 SystemPropertiesAdvanced 环境变量配置窗口",
    "tag": "环境变量",
    "method": "LaunchTool",
    "params": {
      "toolId": "env_vars",
      "command": "rundll32.exe sysdm.cpl,EditEnvironmentVariables"
    }
  },
  {
    "id": "sys-god-mode",
    "title": "一键唤起 Windows 上帝模式 (All Tasks 聚合控制台)",
    "subtitle": "汇总超过 200 项隐藏系统设置与故障排查入口",
    "tag": "上帝模式",
    "method": "LaunchTool",
    "params": {
      "toolId": "god_mode",
      "clsid": "{ED7BA470-8E54-465E-825C-99712043E01C}"
    }
  },
  {
    "id": "sys-devmgmt",
    "title": "打开设备管理器与硬件驱动诊断 (devmgmt.msc)",
    "subtitle": "检查外设驱动感叹号、COM 端口与硬件连接状态",
    "tag": "设备管理",
    "method": "LaunchTool",
    "params": {
      "toolId": "devmgmt",
      "command": "devmgmt.msc"
    }
  }
]

/**
 * 获取预设能力操作列表（返回深拷贝以防外部状态污染）
 */
export function getCapabilityItems(): CapabilityActionItem[] {
  return PRESET_ITEMS.map(item => ({
    ...item,
    params: { ...item.params }
  }))
}

/**
 * 关键词过滤（支持标题、副标题、标签与方法名不区分大小写检索）
 */
export function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[] {
  if (!Array.isArray(items)) return []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return items
  return items.filter(item => {
    if (!item || typeof item.title !== 'string') return false
    return (
      item.title.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.tag.toLowerCase().includes(q) ||
      item.method.toLowerCase().includes(q)
    )
  })
}

/**
 * 严格校验调用参数与安全边界（防御空值、类型错误、受保护系统目标与越界值）
 */
export function validateInvocationPayload(method: string, params: unknown): { valid: boolean; error?: string } {
  if (typeof method !== 'string' || method.trim().length === 0) {
    return { valid: false, error: 'INVALID_METHOD: 调用方法名不能为空' }
  }
  if (method.length > 128 || !/^[A-Za-z0-9_]+$/.test(method.trim())) {
    return { valid: false, error: 'INVALID_METHOD_FORMAT: 方法名包含非法字符或超长' }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: 'INVALID_PARAMS: 参数必须为非空对象' }
  }

  const record = params as Record<string, unknown>
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string') {
      if (val.length > 4096) {
        return { valid: false, error: `PARAM_TOO_LONG: 参数 ${key} 超过最大长度限制` }
      }
      if (FORBIDDEN_TARGET_PATTERN.test(val)) {
        return { valid: false, error: `SECURITY_INTERCEPTED: ${FORBIDDEN_REASON}` }
      }
    } else if (typeof val === 'number') {
      if (!Number.isFinite(val) || val < -1000 || val > 100_000_000) {
        return { valid: false, error: `PARAM_OUT_OF_RANGE: 数值参数 ${key} 越界或非有限数` }
      }
    }
  }

  return { valid: true }
}

/**
 * 调用底层 Native DLL 插件并处理异常降级
 */
export async function invokeNativeCapability(
  method: string,
  params: Record<string, unknown>,
  hostBridge?: { dllplugin?: { call?: (plugin: string, fn: string, payload: unknown) => Promise<unknown> } }
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(check.error || '参数校验失败')
  }

  const runtimeHost = hostBridge ?? (typeof (globalThis as any).ztools !== 'undefined' ? (globalThis as any).ztools : undefined)
  const callFn = runtimeHost?.dllplugin?.call

  if (typeof callFn === 'function') {
    try {
      const raw = await callFn(DLL_PLUGIN_NAME, method.trim(), params)
      let parsed: unknown = raw
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw)
        } catch {
          throw new Error('MALFORMED_DLL_RESPONSE: 原生组件返回了损坏的 JSON 数据')
        }
      }
      if (parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)) {
        const errMsg = String((parsed as Record<string, unknown>).error || '原生组件返回未知错误')
        return {
          ok: false,
          pluginName: DLL_PLUGIN_NAME,
          method: method.trim(),
          error: `DLL_ERROR: ${errMsg}`
        }
      }
      return {
        ok: true,
        pluginName: DLL_PLUGIN_NAME,
        method: method.trim(),
        data: parsed,
        fromFallback: false
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.startsWith('MALFORMED_DLL_RESPONSE:')) {
        throw err
      }
      return {
        ok: false,
        pluginName: DLL_PLUGIN_NAME,
        method: method.trim(),
        error: `NATIVE_CALL_FAILED: ${message}`
      }
    }
  }

  return {
    ok: true,
    pluginName: DLL_PLUGIN_NAME,
    method: method.trim(),
    data: { simulated: true, method: method.trim(), params },
    fromFallback: true
  }
}
