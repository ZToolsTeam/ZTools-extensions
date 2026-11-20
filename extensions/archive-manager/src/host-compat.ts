/**
 * 旧版客户端兼容：插件运行在比自己更旧的 ZTools 里时，给出明确的升级提示或安全的退路。
 *
 * - 插件里的 `@ztools/declarative-ui` 由客户端在运行时提供，SDK 里新增的方法在旧客户端上并不存在；
 * - 宿主接口在旧客户端上不存在时返回「未知方法」，这里统一换成用户看得懂的升级提示。
 */

import { getLocale } from '@ztools/declarative-ui'

const HOST_COMPAT_MESSAGES: Record<string, {
  upgradeHint: string
  featureUpgradeError: (feature: string, hint: string) => string
}> = {
  'zh-CN': {
    upgradeHint: '当前 ZTools 版本过低，请升级到最新版本后再试',
    featureUpgradeError: (feature, hint) => `${feature}需要新版 ZTools，${hint}`
  },
  'en-US': {
    upgradeHint: 'Your ZTools version is too old. Please upgrade to the latest version and try again.',
    featureUpgradeError: (feature, hint) => `${feature} requires a newer version of ZTools. ${hint}`
  }
}

function hostCompatStrings() {
  const locale = getLocale()
  return HOST_COMPAT_MESSAGES[locale] ?? HOST_COMPAT_MESSAGES['en-US']
}

export function getHostUpgradeHint(): string {
  return hostCompatStrings().upgradeHint
}

export const HOST_UPGRADE_HINT = getHostUpgradeHint()

/** 宿主是否因为不认识这个接口而失败（旧客户端） */
export function isHostMethodMissing(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '')
  return /METHOD_NOT_FOUND|METHOD_NOT_AVAILABLE|未知方法|is not a function/.test(text)
}

/** 生成「某功能需要新版客户端」的报错 */
export function hostUpgradeError(feature: string): Error {
  const s = hostCompatStrings()
  return new Error(s.featureUpgradeError(feature, s.upgradeHint))
}

export interface UpdatableStorage {
  getItem<T = unknown>(key: string): Promise<T | undefined>
  setItem(key: string, value: unknown): Promise<void>
  updateItem?: <T>(key: string, update: (current: unknown) => T) => Promise<T>
}

/**
 * 读出最新值、修改后写回。
 * 客户端提供 updateItem 时用它保证多窗口不互相覆盖；旧客户端没有时退回读后写（与旧版插件行为一致）。
 */
export async function updateStorageItem<T>(
  storage: UpdatableStorage,
  key: string,
  update: (current: unknown) => T
): Promise<T> {
  if (typeof storage.updateItem === 'function') return storage.updateItem(key, update)
  const current = await storage.getItem(key)
  const next = update(current)
  if (JSON.stringify(next) !== JSON.stringify(current)) await storage.setItem(key, next)
  return next
}

export interface CompatFileInputConfig {
  /** 允许的扩展名列表（如 ['.png', '.jpg']），不填表示允许任意扩展名 */
  extensions?: string[]
  /** 是否允许接收文件夹（默认 false） */
  allowDirectories?: boolean
  /** 是否允许将剪贴板纯位图（截图）落盘为临时 PNG 接收（默认 false） */
  allowClipboardImage?: boolean
  /** 拖放遮罩提示文案 */
  dropTitle?: string
  dropSubtitle?: string
  /** 双模粘贴（文件优先，纯文本回退）：当焦点位于空搜索框或非输入区域且剪贴板仅含文本时触发 */
  onTextPaste?: (text: string) => boolean | void | Promise<boolean | void>
}

export interface CompatFileInputPayload {
  files: string[]
  source: 'drop' | 'paste' | 'launch'
  targetFieldId?: string
  rejectedCount?: number
}

/**
 * 从宿主事件信封、FileInputPayload 或裸路径数组中安全提取规范化非空文件路径列表
 */
export function extractCompatInputFiles(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => {
        if (typeof item === 'string') return item.trim()
        if (item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string') {
          return String((item as { path: string }).path).trim()
        }
        return ''
      })
      .filter(Boolean)
  }
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  const inner = record.payload && typeof record.payload === 'object' ? (record.payload as Record<string, unknown>) : record
  if (Array.isArray(inner.files)) return extractCompatInputFiles(inner.files)
  if (Array.isArray(inner.paths)) return extractCompatInputFiles(inner.paths)
  return []
}

/**
 * 判断当前宿主渲染器是否已原生支持栈顶 <List/Form/Detail onFileInput={...}> 单点消费路由。
 * - 新版宿主会注入 window.__ztoolsDeclarativeFeatures.fileInput === true；
 * - 旧版宿主未注入该标记时，插件可保留原有的 plugin_files_dropped 事件订阅作为回退，避免新旧宿主双重触发。
 */
export function isDeclarativeFileInputSupported(): boolean {
  if (typeof window === 'undefined') return true
  const w = window as unknown as { __ztoolsDeclarativeFeatures?: { fileInput?: boolean } }
  return w.__ztoolsDeclarativeFeatures?.fileInput === true
}

/**
 * 生成可直接展开到 <List {...fileInputProps}> / <Form {...fileInputProps}> / <Detail {...fileInputProps}> 的属性对象。
 * 旧版客户端会静默忽略未知的 descriptor.props.fileInput / onFileInput 属性而不报错；
 * 新版客户端由 DeclarativeView 栈顶单点消费拖放与 Ctrl+V / ⌘V 粘贴输入。
 */
export function createCompatFileInputProps(
  onFiles: (files: string[], payload: CompatFileInputPayload) => void | Promise<void>,
  config?: CompatFileInputConfig
): {
  fileInput: CompatFileInputConfig
  onFileInput: (payload: CompatFileInputPayload | string[]) => void
} {
  return {
    fileInput: config ? { ...config } : {},
    onFileInput: (raw: CompatFileInputPayload | string[]) => {
      const files = extractCompatInputFiles(raw)
      if (files.length === 0) return
      const normalizedPayload: CompatFileInputPayload = Array.isArray(raw)
        ? { files, source: 'drop' }
        : {
            files,
            source: raw?.source || 'drop',
            ...(typeof raw?.targetFieldId === 'string' && raw.targetFieldId ? { targetFieldId: raw.targetFieldId } : {}),
            ...(typeof raw?.rejectedCount === 'number' ? { rejectedCount: raw.rejectedCount } : {})
          }
      void onFiles(files, normalizedPayload)
    }
  }
}
