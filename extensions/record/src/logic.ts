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

export const DLL_PLUGIN_NAME = "RecordPlugin"
export const FORBIDDEN_TARGET_PATTERN = new RegExp("\\\\Windows\\\\System32|\\.\\.\\\\|\\.\\./", 'i')
export const FORBIDDEN_REASON = "录屏输出文件路径禁止包含目录穿越或指向受保护系统目录"

const PRESET_ITEMS: CapabilityActionItem[] = [
  {
    "id": "rec-start-60fps",
    "title": "启动 60FPS 高清全屏录制 (含系统内录立体声)",
    "subtitle": "使用硬件 H.264 编码器，极低 CPU 占用录制桌面演示",
    "tag": "60帧高清",
    "method": "StartRecord",
    "params": {
      "fps": 60,
      "captureAudio": true,
      "mode": "fullscreen"
    }
  },
  {
    "id": "rec-start-region",
    "title": "启动无边框选区录制模式 (适合教程与动图制作)",
    "subtitle": "精准锁定指定矩形区域并高亮鼠标点击轨迹",
    "tag": "区域录屏",
    "method": "StartRecord",
    "params": {
      "fps": 30,
      "captureAudio": false,
      "mode": "region"
    }
  },
  {
    "id": "rec-to-gif",
    "title": "将录屏片段直接转码为高帧率 GIF 动图",
    "subtitle": "自适应调色板优化，一键粘贴至文档或 Issue",
    "tag": "导出 GIF",
    "method": "ConvertToGif",
    "params": {
      "fps": 15,
      "maxWidth": 800
    }
  },
  {
    "id": "rec-stop",
    "title": "停止当前录制并封装保存 MP4 文件",
    "subtitle": "安全刷写音视频缓冲流并生成索引头",
    "tag": "完成录制",
    "method": "StopRecord",
    "params": {}
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
