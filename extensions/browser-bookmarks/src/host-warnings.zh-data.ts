/** 宿主书签扫描返回中文提示的前缀与国产浏览器中文名映射（仅用于解析宿主警告） */
export const HOST_UNREADABLE_PREFIX_ZH = '未能读取任何浏览器书签：'

export const HOST_WARNING_NAMES_ZH: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '360se': ['360安全'],
  '360chrome': ['360极速'],
  qqbrowser: ['QQ浏览器']
})
