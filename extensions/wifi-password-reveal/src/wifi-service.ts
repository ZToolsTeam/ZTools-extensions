import { getLocale } from '@ztools/declarative-ui'
import {
  FetchWifiProfilesOptions,
  WifiBand,
  WifiParseDetailResult,
  WifiProfileInfo,
  WifiSecurityFilter,
  WifiSecurityType,
  WifiSortBy
} from './types.js'
import { callHostTransport, isRealElectronHost } from './native-ipc.js'
import { encodeQr } from './qr-encoder.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'
import {
  NETSH_ZH_PROFILE_LINE_REGEX,
  NETSH_ZH_OPEN_AUTH_VALUES,
  NETSH_ZH_ENTERPRISE_REGEX,
  NETSH_ZH_PROFILE_NOT_FOUND_MARKERS,
  NETSH_ZH_KEY_PREFIX_SSID,
  NETSH_ZH_KEY_AUTH,
  NETSH_ZH_KEY_CIPHERS,
  NETSH_ZH_KEY_SECURITY_KEY,
  NETSH_ZH_VAL_PRESENT,
  NETSH_ZH_VAL_ABSENT,
  NETSH_ZH_KEY_CONTENT
} from './netsh-zh.zh-data.js'

/** 不在 ZTools 客户端里运行时的稳定错误码 */
export const NOT_IN_CLIENT_ERROR_CODE = 'NOT_IN_CLIENT'

/** 不在 ZTools 客户端里运行（拿不到宿主通道）时的提示；此时不显示任何示例网络 */
export function getNotInClientMessage(): string {
  return t('notInClient')
}

export function parseNetshWlanProfiles(output: string): string[] {
  if (typeof output !== 'string' || !output.trim()) {
    return []
  }

  const userProfiles: string[] = []
  const seen = new Set<string>()
  const lines = output.split(/\r?\n/)

  for (const line of lines) {
    const match = line.match(NETSH_ZH_PROFILE_LINE_REGEX)
    const ssid = match?.[1]
    if (ssid && !seen.has(ssid)) {
      seen.add(ssid)
      userProfiles.push(ssid)
    }
  }

  return userProfiles
}

export const parseWindowsWlanProfiles = parseNetshWlanProfiles

const OPEN_AUTH_VALUES = new Set(['open', 'none', ...NETSH_ZH_OPEN_AUTH_VALUES])
const ENTERPRISE_AUTH_PATTERNS = [/enterprise/i, /802\.1x/i, NETSH_ZH_ENTERPRISE_REGEX]

export function normalizeSecurityType(rawAuth: string): WifiSecurityType {
  const val = (rawAuth || '').trim()
  if (!val) return 'Unknown'
  const lower = val.toLowerCase()

  if (OPEN_AUTH_VALUES.has(lower)) return 'Open'
  if (lower.includes('wpa3') && ENTERPRISE_AUTH_PATTERNS.some((p) => p.test(val))) return 'WPA3-Enterprise'
  if (lower.includes('wpa2') && ENTERPRISE_AUTH_PATTERNS.some((p) => p.test(val))) return 'WPA2-Enterprise'
  // 仅 WPA（第一代）时如实标注，不把它归为 WPA2
  if (/^wpa(?![23/])/.test(lower) && ENTERPRISE_AUTH_PATTERNS.some((p) => p.test(val))) return 'WPA-Enterprise'
  if (ENTERPRISE_AUTH_PATTERNS.some((p) => p.test(val))) return 'WPA2-Enterprise'
  if (lower.includes('wpa3')) return 'WPA3-Personal'
  if (lower.includes('wpa2') && lower.includes('wpa/')) return 'WPA/WPA2-Personal'
  if (lower.includes('wpa2')) return 'WPA2-Personal'
  if (/^wpa(?![23/])/.test(lower)) return 'WPA-Personal'
  if (lower.includes('wep')) return 'WEP'
  return 'Unknown'
}

export function parseWindowsWlanProfileDetail(ssidInput: string, output: string): WifiParseDetailResult {
  const cleanInputSsid = ssidInput || ''
  if (typeof output !== 'string' || !output.trim()) {
    return {
      ssid: cleanInputSsid,
      password: '',
      authType: 'Unknown',
      cipher: 'Unknown',
      isOpenNetwork: false,
      isEnterprise: false,
      error: {
        code: 'InvalidInput',
        message: 'Empty netsh output'
      }
    }
  }

  if (
    (output.includes('Profile "') && output.includes('is not found on the system')) ||
    NETSH_ZH_PROFILE_NOT_FOUND_MARKERS.some((marker) => output.includes(marker))
  ) {
    return {
      ssid: cleanInputSsid,
      password: '',
      authType: 'Unknown',
      cipher: 'Unknown',
      isOpenNetwork: false,
      isEnterprise: false,
      error: {
        code: 'ProfileNotFound',
        message: t('errProfileNotFound', { ssid: cleanInputSsid })
      }
    }
  }

  let ssidName = cleanInputSsid
  let authentication = ''
  let cipher = 'Unknown'
  let securityKeyState: 'present' | 'absent' | null = null
  let keyContent = ''
  let keyContentFound = false

  const lines = output.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trimStart()
    const colonIdx = trimmed.indexOf(':') !== -1 ? trimmed.indexOf(':') : trimmed.indexOf('：')
    if (colonIdx === -1) continue

    const key = trimmed.slice(0, colonIdx).trim()
    const rawValue = trimmed.slice(colonIdx + 1).replace(/^ /, '')
    const val = rawValue.trim()

    if (key.startsWith('SSID name') || key.startsWith(NETSH_ZH_KEY_PREFIX_SSID)) {
      let parsedSsid = val
      if (parsedSsid.startsWith('"') && parsedSsid.endsWith('"')) {
        parsedSsid = parsedSsid.slice(1, -1)
      }
      if (parsedSsid) ssidName = parsedSsid
    } else if (key === 'Authentication' || key === NETSH_ZH_KEY_AUTH) {
      authentication = val
    } else if (key === 'Cipher' || NETSH_ZH_KEY_CIPHERS.includes(key)) {
      cipher = val
    } else if (key === 'Security key' || key === 'Security Key' || key === NETSH_ZH_KEY_SECURITY_KEY) {
      const lowerVal = val.toLowerCase()
      if (lowerVal === 'present' || val === NETSH_ZH_VAL_PRESENT) {
        securityKeyState = 'present'
      } else if (lowerVal === 'absent' || val === NETSH_ZH_VAL_ABSENT) {
        securityKeyState = 'absent'
      }
    } else if (key === 'Key Content' || key === NETSH_ZH_KEY_CONTENT) {
      keyContent = rawValue
      keyContentFound = true
    }
  }

  const authType = normalizeSecurityType(authentication)
  const isOpenNetwork = authType === 'Open'
  const isEnterprise = authType === 'WPA2-Enterprise' || authType === 'WPA3-Enterprise'

  if (isOpenNetwork) {
    return {
      ssid: ssidName,
      password: '',
      authType,
      cipher: 'None',
      isOpenNetwork: true,
      isEnterprise: false
    }
  }

  if (isEnterprise) {
    return {
      ssid: ssidName,
      password: '',
      authType: isEnterprise ? authType : 'WPA2-Enterprise',
      cipher,
      isOpenNetwork: false,
      isEnterprise: true,
      error: {
        code: 'EnterpriseNetwork',
        message: t('errEnterpriseNoPassword', { ssid: ssidName })
      }
    }
  }

  if (securityKeyState === 'present' && !keyContentFound) {
    return {
      ssid: ssidName,
      password: '',
      authType,
      cipher,
      isOpenNetwork: false,
      isEnterprise: false,
      error: {
        code: 'PermissionDenied',
        message: t('errPermissionDenied')
      }
    }
  }

  if (securityKeyState === null && !keyContentFound) {
    return {
      ssid: ssidName,
      password: '',
      authType,
      cipher,
      isOpenNetwork: false,
      isEnterprise: false,
      error: {
        code: 'Unknown',
        message: t('errUnknownKeyInfo')
      }
    }
  }

  return {
    ssid: ssidName,
    password: keyContent,
    authType,
    cipher,
    isOpenNetwork: false,
    isEnterprise: false
  }
}

export function parseWifiInterface(output: string): string {
  if (typeof output !== 'string' || !output.trim()) return 'en0'
  const lines = output.split(/\r?\n/)
  let inWifiSection = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === 'Hardware Port: Wi-Fi' || trimmed === 'Hardware Port: AirPort') {
      inWifiSection = true
      continue
    }
    if (inWifiSection && trimmed.startsWith('Device:')) {
      const dev = trimmed.slice('Device:'.length).trim()
      return dev || 'en0'
    }
    if (inWifiSection && trimmed.startsWith('Hardware Port:')) {
      break
    }
  }
  return 'en0'
}

export function escapeWifiQrField(value: string): string {
  if (typeof value !== 'string') return ''
  return value.replace(/([\\;,:""])/g, '\\$1')
}

export function generateWifiQrString(
  ssid: string,
  password = '',
  authType: WifiSecurityType = 'WPA2-Personal'
): string {
  if (typeof ssid !== 'string' || ssid.length === 0) throw new Error(t('errEmptySsid'))
  if (authType === 'Unknown') throw new Error(t('errSelectSecurityFirst'))
  if (authType.includes('Enterprise')) throw new Error(t('errEnterpriseNoQr'))
  const isOpen = authType === 'Open'
  if (!isOpen && !password) throw new Error(t('errNoPasswordForQr'))
  const qrType = isOpen ? 'nopass' : authType === 'WEP' ? 'WEP' : 'WPA'
  return `WIFI:T:${qrType};S:${escapeWifiQrField(ssid)};${isOpen ? '' : `P:${escapeWifiQrField(password)};`};`
}

export function generateWifiQrSvgDataUrl(profile: WifiProfileInfo): string {
  const payload = generateWifiQrString(profile.ssid, profile.password, profile.authType)
  const qr = encodeQr(payload, 'M')
  const dim = qr.size + 8
  let path = ''
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) path += `M${x + 4},${y + 4}h1v1h-1z`
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim * 8}" height="${dim * 8}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${path}" fill="black"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** 至少一个网络带有系统给出的连接状态时，“当前连接”筛选才有意义。 */
export function hasConnectionInfo(profiles: readonly WifiProfileInfo[]): boolean {
  return profiles.some(item => typeof item?.isConnected === 'boolean')
}

export function filterAndSortWifiProfiles(
  profiles: readonly WifiProfileInfo[],
  options: {
    query?: string
    securityFilter?: WifiSecurityFilter
    sortBy?: WifiSortBy
  } = {}
): WifiProfileInfo[] {
  if (!Array.isArray(profiles)) return []
  const q = (options.query || '').trim().toLowerCase()
  const sec = options.securityFilter || 'all'
  const sortBy = options.sortBy || 'connected'

  const filtered = profiles.filter((item) => {
    if (!item || typeof item.ssid !== 'string') return false
    if (sec === 'connected' && !item.isConnected) return false
    if (sec === 'wpa3' && !item.authType.includes('WPA3')) return false
    if (sec === 'wpa2' && !item.authType.includes('WPA2')) return false
    if (sec === 'open' && !item.isOpenNetwork) return false
    if (sec === 'enterprise' && !item.isEnterprise) return false

    if (!q) return true
    const haystack = `${item.ssid} ${item.profileName || ''} ${item.authType} ${item.band || ''} ${item.pinyin || ''} ${item.notes || ''}`.toLowerCase()
    return haystack.includes(q)
  })

  return [...filtered].sort((a, b) => {
    if (sortBy === 'connected') {
      if (Boolean(a.isConnected) !== Boolean(b.isConnected)) {
        return a.isConnected ? -1 : 1
      }
      return (b.signalPercent ?? 0) - (a.signalPercent ?? 0)
    }
    if (sortBy === 'signal') {
      return (b.signalPercent ?? 0) - (a.signalPercent ?? 0)
    }
    if (sortBy === 'ssid') {
      return a.ssid.localeCompare(b.ssid, getLocale())
    }
    return a.authType.localeCompare(b.authType, getLocale())
  })
}

export async function revealWifiPasswordFromHost(ssid: string, hostOverride?: unknown): Promise<string> {
  if (typeof ssid !== 'string' || ssid.length === 0) throw new Error(t('errEmptySsid'))
  const res = await callHostTransport<Record<string, unknown> | string>(
    'wifi_get_password', { ssid }, hostOverride
  )
  if (!res.ok) throw new Error(resolveErrorMessage(res, t('errReadPasswordFailed')))
  const data = res.data
  if (data && typeof data === 'object' && data.error) throw new Error(String(data.error))
  const password = typeof data === 'string' ? data : data?.password
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error(t('errPasswordNotRead'))
  }
  return password
}

function mapWifiProfile(raw: unknown, interfaceName?: string): WifiProfileInfo | null {
  const record = typeof raw === 'string' ? { ssid: raw } : raw
  if (!record || typeof record !== 'object') return null
  const item = record as Record<string, unknown>
  const ssid = typeof item.ssid === 'string' ? item.ssid : item.name
  if (typeof ssid !== 'string' || ssid.length === 0) return null
  const profileName = typeof item.profileName === 'string' && item.profileName.length > 0 ? item.profileName : undefined
  const authType = item.isOpenNetwork === true ? 'Open' : normalizeSecurityType(String(item.authType ?? item.security ?? ''))
  return {
    id: typeof item.id === 'string' ? item.id : `host-wifi-${profileName ?? ssid}`,
    ssid,
    ...(profileName ? { profileName } : {}),
    password: '',
    authType,
    isOpenNetwork: authType === 'Open',
    isEnterprise: item.isEnterprise === true || authType.includes('Enterprise'),
    // 系统没给出连接状态时保持 undefined（未知），不能当成“未连接”。
    isConnected: typeof item.isConnected === 'boolean' ? item.isConnected : typeof item.current === 'boolean' ? item.current : undefined,
    cipher: typeof item.cipher === 'string' ? item.cipher : undefined,
    band: typeof item.band === 'string' ? item.band as WifiBand : undefined,
    signalPercent: typeof item.signalPercent === 'number' && Number.isFinite(item.signalPercent) ? item.signalPercent : undefined,
    interfaceName: typeof item.interfaceName === 'string' ? item.interfaceName : interfaceName,
    lastConnected: typeof item.lastConnected === 'string' ? item.lastConnected : undefined
  }
}

export async function fetchSavedWifiProfiles(options: FetchWifiProfilesOptions = {}): Promise<WifiProfileInfo[]> {
  if (options.executor) {
    const execute = async (command: string, args: string[]) => {
      const result = await options.executor!(command, args)
      if (typeof result === 'string') return result
      if (result.exitCode) throw new Error(result.stderr || t('errReadProfilesFailed'))
      return result.stdout
    }
    let ssids: string[]
    let iface = options.interfaceName
    if (options.platform === 'darwin') {
      iface = iface || parseWifiInterface(await execute('/usr/sbin/networksetup', ['-listallhardwareports']))
      const output = await execute('/usr/sbin/networksetup', ['-listpreferredwirelessnetworks', iface])
      ssids = output.split(/\r?\n/).slice(1).map(line => line.replace(/^\t/, '')).filter(Boolean)
    } else if (options.platform === 'win32' || !options.platform) {
      ssids = parseNetshWlanProfiles(await execute('netsh', ['wlan', 'show', 'profiles']))
    } else {
      throw new Error(t('errUnsupportedPlatform'))
    }
    return ssids.map(ssid => mapWifiProfile(ssid, iface)).filter((item): item is WifiProfileInfo => item !== null)
  }
  if (!options.hostOverride && !isRealElectronHost()) {
    // 拿不到客户端就无法读取，如实报不可用；不能返回空列表冒充「没有已保存的网络」
    throw Object.assign(new Error(t('notInClient')), { code: NOT_IN_CLIENT_ERROR_CODE })
  }
  const result = await callHostTransport<unknown>('wifi_get_profiles', {}, options.hostOverride)
  if (!result.ok) throw new Error(resolveErrorMessage(result, t('errReadProfilesFailed')))
  const data = result.data
  const records = Array.isArray(data) ? data : data && typeof data === 'object' ? (data as Record<string, unknown>).profiles : undefined
  if (!Array.isArray(records)) throw new Error(t('errInvalidHostProfiles'))
  return records.map(item => mapWifiProfile(item, options.interfaceName)).filter((item): item is WifiProfileInfo => item !== null)
}
