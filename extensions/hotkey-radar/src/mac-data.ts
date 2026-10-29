export const MAC_PRESETS = ['Command+Space', 'Control+Space', 'Shift+Command+4', 'Shift+Command+5', 'Control+Up', 'Shift+Command+P']
export const MAC_CATEGORIES = [['os', 'macOS'], ['vscode', 'VS Code'], ['excel', 'Excel'], ['ps', 'Photoshop'], ['browser', 'Chrome / Edge']] as const
export interface MacShortcut { id: string; category: string; combo: string; title: string; subtitle: string }
export const MAC_SHORTCUTS: MacShortcut[] = [
  { id: 'spotlight', category: 'os', combo: 'Cmd+Space', title: '打开 Spotlight 搜索', subtitle: '系统默认设置；可在系统设置中更改' },
  { id: 'mission', category: 'os', combo: 'Ctrl+Up', title: '打开调度中心', subtitle: '查看打开的窗口与桌面；不会直接新建桌面' },
  { id: 'force-quit', category: 'os', combo: 'Option+Cmd+Esc', title: '打开强制退出应用窗口', subtitle: '选择无响应的应用；不会直接打开活动监视器' },
  { id: 'screenshot', category: 'os', combo: 'Shift+Cmd+4', title: '截取选定区域', subtitle: '默认保存截图文件；加按 ⌃ 可拷贝到剪贴板' },
  { id: 'screenshot-panel', category: 'os', combo: 'Shift+Cmd+5', title: '打开截屏与录屏工具', subtitle: '选择范围和保存位置' },
  { id: 'vsc-palette', category: 'vscode', combo: 'Shift+Cmd+P', title: '打开命令面板', subtitle: 'VS Code 默认快捷键' },
  { id: 'vsc-multi', category: 'vscode', combo: 'Cmd+D', title: '选中下一个相同词并添加光标', subtitle: '在编辑器内使用' },
  { id: 'vsc-open', category: 'vscode', combo: 'Cmd+P', title: '按文件名打开文件', subtitle: '查找当前工作区文件' },
  { id: 'vsc-symbol', category: 'vscode', combo: 'Cmd+T', title: '搜索工作区符号', subtitle: '查找类、函数与其他符号' },
  { id: 'vsc-split', category: 'vscode', combo: 'Cmd+\\', title: '拆分编辑器', subtitle: '并排查看文件' },
  { id: 'xls-ref', category: 'excel', combo: 'Cmd+T', title: '切换公式引用方式', subtitle: '编辑公式时切换绝对、相对与混合引用' },
  { id: 'xls-sum', category: 'excel', combo: 'Shift+Cmd+T', title: '插入自动求和公式', subtitle: '在选中的单元格插入 AutoSum' },
  { id: 'xls-format', category: 'excel', combo: 'Cmd+1', title: '设置单元格格式', subtitle: '在 Excel 中打开格式对话框' },
  { id: 'xls-edit', category: 'excel', combo: 'Ctrl+U', title: '编辑当前单元格', subtitle: '把插入点放在单元格内容末尾' },
  { id: 'ps-transform', category: 'ps', combo: 'Cmd+T', title: '自由变换', subtitle: '变换当前选中的图层或选区' },
  { id: 'ps-stamp', category: 'ps', combo: 'Shift+Option+Cmd+E', title: '盖印可见图层', subtitle: '生成合并内容的新图层，保留原图层' },
  { id: 'web-reopen', category: 'browser', combo: 'Shift+Cmd+T', title: '重新打开关闭的标签页', subtitle: '在浏览器内使用' },
  { id: 'web-reload', category: 'browser', combo: 'Shift+Cmd+R', title: '忽略缓存重新加载网页', subtitle: '强制重新获取网页资源' },
  { id: 'web-private', category: 'browser', combo: 'Shift+Cmd+N', title: '打开无痕或 InPrivate 窗口', subtitle: '在浏览器内使用' }
]
/** 检测结果与插件自带的 macOS 系统默认快捷键表对照：命中时返回系统功能名（如“调度中心”），未命中返回 null */
export function macSystemAssignment(combo: string, fingerprint: (combo: string) => string): string | null {
  const key = fingerprint(macPlusForm(combo))
  const hit = MAC_SHORTCUTS.find((s) => s.category === 'os' && fingerprint(s.combo) === key)
  return hit ? hit.title.replace(/^打开\s*/, '') : null
}

export const MAC_PROBE_HELP = `# 快捷键检测范围

- **可独占注册**：系统允许本次临时独占注册，检测后已释放。macOS 仍允许其他应用存在共享注册，**此结果不代表没有冲突**。
- **存在独占占用**：系统返回独占注册冲突。接口不提供占用进程，不能据此判断是哪个程序。
- **系统已分配**：当前系统键盘设置中启用了此组合，或独占注册被拒绝且该组合是 macOS 默认系统快捷键（括号内为系统功能名），检测不会改变设置。
- **ZTools 已注册**：当前客户端已持有该快捷键，检测不会撤销它。

结果只代表检测时刻。其他应用的共享注册、事件拦截、键盘重映射和应用内快捷键无法完整枚举；请同时检查应用自身快捷键设置，或在系统设置的“键盘 → 键盘快捷键”中查看系统分配。按键按当前键盘布局解析，无法映射时停止并报错。

输入用加号连接，例如 Shift+Cmd+P，也可以直接输入符号 ⇧⌘P。⌘（Cmd）和 ⌃（Ctrl）是不同按键；⌥ 即 Option（Alt）。加号键写 Plus。仅支持单组组合键，连续序列和单独修饰键不支持。

速查展示应用的默认键位，用户修改过的绑定以应用设置为准。`

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
