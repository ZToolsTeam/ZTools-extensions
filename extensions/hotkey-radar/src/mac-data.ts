import { t } from './i18n.js'
import { MAC_SHORTCUTS, type MacShortcut } from './mac-data.zh-data.js'

export { MAC_SHORTCUTS, type MacShortcut }
export const MAC_PRESETS = ['Command+Space', 'Control+Space', 'Shift+Command+4', 'Shift+Command+5', 'Control+Up', 'Shift+Command+P']
export const MAC_CATEGORIES = [['os', 'macOS'], ['vscode', 'VS Code'], ['excel', 'Excel'], ['ps', 'Photoshop'], ['browser', 'Chrome / Edge']] as const

const MAC_SHORTCUT_KEYS: Record<string, { titleKey: Parameters<typeof t>[0]; subKey: Parameters<typeof t>[0]; ownerKey?: Parameters<typeof t>[0] }> = {
  spotlight: { titleKey: 'macScSpotlightTitle', subKey: 'macScSpotlightSub', ownerKey: 'macScSpotlightOwner' },
  mission: { titleKey: 'macScMissionTitle', subKey: 'macScMissionSub', ownerKey: 'macScMissionOwner' },
  'force-quit': { titleKey: 'macScForceQuitTitle', subKey: 'macScForceQuitSub', ownerKey: 'macScForceQuitOwner' },
  screenshot: { titleKey: 'macScScreenshotTitle', subKey: 'macScScreenshotSub', ownerKey: 'macScScreenshotOwner' },
  'screenshot-panel': { titleKey: 'macScScreenshotPanelTitle', subKey: 'macScScreenshotPanelSub', ownerKey: 'macScScreenshotPanelOwner' },
  'vsc-palette': { titleKey: 'macScVscPaletteTitle', subKey: 'macScVscPaletteSub' },
  'vsc-multi': { titleKey: 'macScVscMultiTitle', subKey: 'macScVscMultiSub' },
  'vsc-open': { titleKey: 'macScVscOpenTitle', subKey: 'macScVscOpenSub' },
  'vsc-symbol': { titleKey: 'macScVscSymbolTitle', subKey: 'macScVscSymbolSub' },
  'vsc-split': { titleKey: 'macScVscSplitTitle', subKey: 'macScVscSplitSub' },
  'xls-ref': { titleKey: 'macScXlsRefTitle', subKey: 'macScXlsRefSub' },
  'xls-sum': { titleKey: 'macScXlsSumTitle', subKey: 'macScXlsSumSub' },
  'xls-format': { titleKey: 'macScXlsFormatTitle', subKey: 'macScXlsFormatSub' },
  'xls-edit': { titleKey: 'macScXlsEditTitle', subKey: 'macScXlsEditSub' },
  'ps-transform': { titleKey: 'macScPsTransformTitle', subKey: 'macScPsTransformSub' },
  'ps-stamp': { titleKey: 'macScPsStampTitle', subKey: 'macScPsStampSub' },
  'web-reopen': { titleKey: 'macScWebReopenTitle', subKey: 'macScWebReopenSub' },
  'web-reload': { titleKey: 'macScWebReloadTitle', subKey: 'macScWebReloadSub' },
  'web-private': { titleKey: 'macScWebPrivateTitle', subKey: 'macScWebPrivateSub' }
}

export function getMacShortcuts(): MacShortcut[] {
  return MAC_SHORTCUTS.map((item) => {
    const keys = MAC_SHORTCUT_KEYS[item.id]
    return keys ? { ...item, title: t(keys.titleKey), subtitle: t(keys.subKey) } : item
  })
}

/** 检测结果与插件自带的 macOS 系统默认快捷键表对照：命中时返回系统功能名（如“调度中心”），未命中返回 null */
export function macSystemAssignment(combo: string, fingerprint: (combo: string) => string): string | null {
  const key = fingerprint(macPlusForm(combo))
  const hit = MAC_SHORTCUTS.find((s) => s.category === 'os' && fingerprint(s.combo) === key)
  if (!hit) return null
  const entry = MAC_SHORTCUT_KEYS[hit.id]
  if (entry?.ownerKey) return t(entry.ownerKey)
  return entry ? t(entry.titleKey) : hit.title
}

export function getMacProbeHelp(): string {
  return t('macProbeHelpMarkdown')
}

/** 修饰键按 macOS 菜单的固定顺序 ⌃ ⌥ ⇧ ⌘ 排列 */
const MODIFIER_SYMBOLS: Array<[RegExp, string]> = [
  [/^(ctrl|control|⌃)$/i, '⌃'],
  [/^(option|opt|alt|⌥)$/i, '⌥'],
  [/^(shift|⇧)$/i, '⇧'],
  [/^(cmd|command|⌘)$/i, '⌘']
]
const KEY_SYMBOLS: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→', escape: 'Esc', esc: 'Esc', return: '↩', enter: '↩', tab: '⇥', delete: '⌫', backspace: '⌫', space: 'Space', plus: '+' }

/** 把 Cmd+Space、Command+Space、Control+Up 等写法统一显示为 ⌘Space、⌃↑ 这类 Mac 符号写法 */
export function macSymbols(combo: string): string {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return combo
  const mods: string[] = []
  const keys: string[] = []
  for (const part of parts) {
    const hit = MODIFIER_SYMBOLS.find(([re]) => re.test(part))
    if (hit) mods.push(hit[1])
    else keys.push(KEY_SYMBOLS[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part))
  }
  const ordered = MODIFIER_SYMBOLS.map(([, sym]) => sym).filter((sym) => mods.includes(sym))
  return ordered.join('') + keys.join('+')
}

const SYMBOL_NAMES: Record<string, string> = { '⌃': 'Ctrl', '⌥': 'Option', '⇧': 'Shift', '⌘': 'Cmd' }
const KEY_NAMES: Record<string, string> = { '↑': 'Up', '↓': 'Down', '←': 'Left', '→': 'Right', '↩': 'Return', '⇥': 'Tab', '⌫': 'Delete' }

/** 把输入的符号写法（如 ⇧⌘P、⌃↑）转回检测接口使用的加号写法；本来就是加号写法或无法识别时原样返回 */
export function macPlusForm(input: string): string {
  const text = input.trim()
  if (!/^[⌃⌥⇧⌘]+/.test(text) || text.includes('+') && !/^[⌃⌥⇧⌘]+\+$/.test(text)) return text
  const mods = [...text.match(/^[⌃⌥⇧⌘]+/)![0]]
  const key = text.slice(mods.length).trim()
  if (!key) return text
  return [...mods.map((m) => SYMBOL_NAMES[m]), KEY_NAMES[key] ?? (key === '+' ? 'Plus' : key)].join('+')
}
