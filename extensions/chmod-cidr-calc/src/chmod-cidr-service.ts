import type {
  ChmodCalculationResult,
  ChmodRoleBreakdown,
  CidrCalculationResult,
} from './types.js'
import { t } from './i18n.js'

function ipToUint32(ip: string): number {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) {
    throw new Error(t('errIpFourOctets'))
  }
  let val = 0
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) {
      throw new Error(t('errIpNoLeadingZero'))
    }
    const num = Number(part)
    if (num < 0 || num > 255) {
      throw new Error(t('errIpOctetRange'))
    }
    val = ((val << 8) | num) >>> 0
  }
  return val >>> 0
}

function uint32ToIp(num: number): string {
  const u = num >>> 0
  return [
    (u >>> 24) & 255,
    (u >>> 16) & 255,
    (u >>> 8) & 255,
    u & 255,
  ].join('.')
}

function uint32ToBinaryDotted(num: number): string {
  const u = num >>> 0
  return [
    ((u >>> 24) & 255).toString(2).padStart(8, '0'),
    ((u >>> 16) & 255).toString(2).padStart(8, '0'),
    ((u >>> 8) & 255).toString(2).padStart(8, '0'),
    (u & 255).toString(2).padStart(8, '0'),
  ].join('.')
}

function getSpecialScopes(): ReadonlyArray<readonly [string, number, string]> {
  return [
    ['0.0.0.0', 32, t('scopeUnspecified')],
    ['255.255.255.255', 32, t('scopeLimitedBroadcast')],
    ['192.0.0.8', 32, t('scopePlaceholder')],
    ['192.0.0.9', 32, t('scopePcp')],
    ['192.0.0.10', 32, t('scopeTurn')],
    ['192.0.0.170', 31, t('scopeNat64')],
    ['192.88.99.2', 32, t('scope6to4Relay')],
    ['192.0.0.0', 29, t('scopeServiceCont')],
    ['192.0.0.0', 24, t('scopeIetf')],
    ['192.0.2.0', 24, t('scopeTestNet1')],
    ['198.51.100.0', 24, t('scopeTestNet2')],
    ['203.0.113.0', 24, t('scopeTestNet3')],
    ['192.31.196.0', 24, t('scopeAs112')],
    ['192.52.193.0', 24, t('scopeAmt')],
    ['192.88.99.0', 24, t('scopeDeprecated6to4')],
    ['192.175.48.0', 24, t('scopeAs112Direct')],
    ['169.254.0.0', 16, t('scopeLinkLocal')],
    ['192.168.0.0', 16, t('scopeRfc1918')],
    ['198.18.0.0', 15, t('scopeBenchmark')],
    ['172.16.0.0', 12, t('scopeRfc1918')],
    ['100.64.0.0', 10, t('scopeCgnat')],
    ['0.0.0.0', 8, t('scopeThisNetwork')],
    ['10.0.0.0', 8, t('scopeRfc1918')],
    ['127.0.0.0', 8, t('scopeLoopback')],
    ['224.0.0.0', 4, t('scopeMulticast')],
    ['240.0.0.0', 4, t('scopeReserved')]
  ]
}

function classifyIpScope(ipUint: number): string {
  for (const [network, prefix, label] of getSpecialScopes()) {
    const mask = (0xffffffff << (32 - prefix)) >>> 0
    if (((ipUint & mask) >>> 0) === ipToUint32(network)) return `${label} (${network}/${prefix})`
  }
  return t('scopeUnicastDefault')
}

/** 子网掩码转前缀长度：掩码的 1 必须从最高位开始连续，否则不是合法子网掩码 */
function maskToPrefix(maskUint: number): number {
  const inverted = (~maskUint) >>> 0
  if ((inverted & (inverted + 1)) !== 0) {
    throw new Error(t('errMaskContiguous'))
  }
  let hostBits = 0
  for (let v = inverted; v !== 0; v >>>= 1) hostBits += v & 1
  return 32 - hostBits
}

export function calculateIpv4Cidr(rawInput: string): CidrCalculationResult {
  const trimmed = String(rawInput || '').trim()
  if (!trimmed) {
    throw new Error(t('errEmptyCidr'))
  }

  // 也接受「地址 掩码」写法（如 ifconfig / ipconfig 输出里的 192.168.1.5 255.255.255.0）
  const spaced = trimmed.split(/\s+/)
  if (spaced.length > 2) throw new Error(t('errCidrSyntax'))
  if (spaced.length === 2 && spaced[0].includes('/')) throw new Error(t('errCidrSingleSlash'))
  const parts = spaced.length === 2 ? spaced : trimmed.split('/')
  if (parts.length > 2) throw new Error(t('errCidrSingleSlash'))
  const ipStr = parts[0].trim()
  const prefixStr = parts.length > 1 ? parts[1].trim() : '24'

  let prefixLength: number
  if (/^\d{1,2}$/.test(prefixStr)) {
    prefixLength = Number(prefixStr)
  } else if (/^0x[0-9a-f]{8}$/i.test(prefixStr) || prefixStr.split('.').length === 4) {
    // 点分子网掩码（255.255.255.0）或 macOS ifconfig 的十六进制掩码（0xffffff00）
    prefixLength = maskToPrefix(/^0x/i.test(prefixStr) ? parseInt(prefixStr.slice(2), 16) >>> 0 : ipToUint32(prefixStr))
  } else {
    throw new Error(t('errCidrPrefixType'))
  }
  if (prefixLength < 0 || prefixLength > 32) {
    throw new Error(t('errCidrPrefixRange', { prefix: prefixLength }))
  }

  const ipUint = ipToUint32(ipStr)
  const maskUint =
    prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0
  const wildcardUint = (~maskUint) >>> 0
  const networkUint = (ipUint & maskUint) >>> 0
  const broadcastUint = (networkUint | wildcardUint) >>> 0

  const totalHosts = Math.pow(2, 32 - prefixLength)
  let usableHosts: number
  let firstUsableUint: number
  let lastUsableUint: number
  let usageHint: string

  if (prefixLength === 32) {
    usableHosts = 1
    firstUsableUint = networkUint
    lastUsableUint = networkUint
    usageHint = t('hint32')
  } else if (prefixLength === 31) {
    usableHosts = 2
    firstUsableUint = networkUint
    lastUsableUint = broadcastUint
    usageHint = t('hint31')
  } else {
    usableHosts = Math.max(0, totalHosts - 2)
    firstUsableUint = (networkUint + 1) >>> 0
    lastUsableUint = (broadcastUint - 1) >>> 0
    usageHint = t('hintStandard', { network: uint32ToIp(networkUint), broadcast: uint32ToIp(broadcastUint) })
  }

  return {
    input: `${uint32ToIp(ipUint)}/${prefixLength}`,
    ipAddress: uint32ToIp(ipUint),
    prefixLength,
    netmask: uint32ToIp(maskUint),
    wildcardMask: uint32ToIp(wildcardUint),
    networkAddress: uint32ToIp(networkUint),
    broadcastAddress: uint32ToIp(broadcastUint),
    hasBroadcast: prefixLength < 31,
    firstUsableIp: uint32ToIp(firstUsableUint),
    lastUsableIp: uint32ToIp(lastUsableUint),
    totalHosts,
    usableHosts,
    netmaskBinary: uint32ToBinaryDotted(maskUint),
    addressScope: classifyIpScope(ipUint),
    usageHint: t('usageHintSuffix', { hint: usageHint }),
  }
}

function digitToSymbolic(d: number): string {
  return `${(d & 4) !== 0 ? 'r' : '-'}${(d & 2) !== 0 ? 'w' : '-'}${(d & 1) !== 0 ? 'x' : '-'}`
}

export function convertChmod(rawInput: string): ChmodCalculationResult {
  const cleaned = String(rawInput || '').trim().replace(/^chmod[ \t]+(?:-R[ \t]+)?/, '').trim()
  if (!cleaned) throw new Error(t('errChmodEmpty'))
  let digits: [number, number, number]
  let special = 0, fileType = '-'
  if (/^[0-7]{3,4}$/.test(cleaned)) {
    const ordinary = cleaned.slice(-3)
    digits = [Number(ordinary[0]), Number(ordinary[1]), Number(ordinary[2])]
    special = cleaned.length === 4 ? Number(cleaned[0]) : 0
  } else {
    // macOS 的 ls -l 在权限后用 @ 表示扩展属性、+ 表示 ACL，Linux 用 . 表示 SELinux 上下文；这些标记不影响权限位
    const withoutMarker = cleaned.length === 11 && /^[dlcbps-]/.test(cleaned) && /[@+.]$/.test(cleaned) ? cleaned.slice(0, 10) : cleaned
    const symbolic = withoutMarker.length === 10 && /^[dlcbps-]/.test(withoutMarker) ? withoutMarker.slice(1) : withoutMarker
    if (!/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(symbolic)) throw new Error(t('errChmodFormat'))
    if (withoutMarker.length === 10) fileType = withoutMarker[0]!
    digits = [0, 1, 2].map(index => {
      const triad = symbolic.slice(index * 3, index * 3 + 3)
      if (/[sStT]/.test(triad[2]!)) special |= [4, 2, 1][index]!
      return (triad[0] === 'r' ? 4 : 0) + (triad[1] === 'w' ? 2 : 0) + (/[xst]/.test(triad[2]!) ? 1 : 0)
    }) as [number, number, number]
  }

  const roleNames: Array<'Owner (u)' | 'Group (g)' | 'Others (o)'> = [
    'Owner (u)',
    'Group (g)',
    'Others (o)',
  ]

  const roles: ChmodRoleBreakdown[] = digits.map((digit, idx) => ({
    role: roleNames[idx],
    digit,
    symbolic: digitToSymbolic(digit),
    read: (digit & 4) !== 0,
    write: (digit & 2) !== 0,
    execute: (digit & 1) !== 0,
  }))

  const octal = (special ? String(special) : '') + digits.join('')
  const symbolic = roles.map((role, index) => {
    if (!(special & [4, 2, 1][index]!)) return role.symbolic
    const letter = index === 2 ? 't' : 's'
    return role.symbolic.slice(0, 2) + (role.execute ? letter : letter.toUpperCase())
  }).join('')
  const isWorldWritable = (digits[2] & 2) !== 0

  return {
    octal,
    symbolic,
    lsSymbolic: `${fileType}${symbolic}`,
    specialBits: [special & 4 ? 'setuid' : '', special & 2 ? 'setgid' : '', special & 1 ? 'sticky' : ''].filter(Boolean),
    chmodCommand: `chmod ${octal} <file>`,
    chmodRecursiveCommand: `chmod -R ${octal} <directory>`,
    isWorldWritable,
    securityWarning: isWorldWritable
      ? t('worldWritableWarning', { octal })
      : undefined,
    roles,
  }
}
