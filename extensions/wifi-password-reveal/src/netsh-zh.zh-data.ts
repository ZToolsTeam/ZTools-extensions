/** 中文 Windows 系统下 netsh wlan 输出的静态字段名与状态词表 */
export const NETSH_ZH_PROFILE_LINE_REGEX = /^\s*(?:All User Profile|Current User Profile|所有用户配置文件|当前用户配置文件)[ \t]*[:：] ?(.*)$/
export const NETSH_ZH_OPEN_AUTH_VALUES: readonly string[] = Object.freeze(['开放式', '无'])
export const NETSH_ZH_ENTERPRISE_REGEX = /企业/
export const NETSH_ZH_PROFILE_NOT_FOUND_MARKERS: readonly string[] = Object.freeze([
  '系统上没有配置文件',
  '找不到配置文件'
])
export const NETSH_ZH_KEY_PREFIX_SSID = 'SSID 名称'
export const NETSH_ZH_KEY_AUTH = '身份验证'
export const NETSH_ZH_KEY_CIPHERS: readonly string[] = Object.freeze(['密码', '加密'])
export const NETSH_ZH_KEY_SECURITY_KEY = '安全密钥'
export const NETSH_ZH_VAL_PRESENT = '存在'
export const NETSH_ZH_VAL_ABSENT = '不存在'
export const NETSH_ZH_KEY_CONTENT = '关键内容'
