export interface MacShortcut { id: string; category: string; combo: string; title: string; subtitle: string }

/** macOS 常见快捷键静态中文默认数据（UI 展示由 getMacShortcuts() 走 i18n） */
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
