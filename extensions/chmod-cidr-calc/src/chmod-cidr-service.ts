import type {
  ChmodCalculationResult,
  ChmodRoleBreakdown,
  CidrCalculationResult,
} from './types.js'

function ipToUint32(ip: string): number {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) {
    throw new Error('IPv4 地址必须包含四段十进制数字。')
  }
  let val = 0
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) {
      throw new Error('IPv4 每段必须是无前导零的十进制数字。')
    }
    const num = Number(part)
    if (num < 0 || num > 255) {
      throw new Error('IPv4 每段必须在 0～255 之间。')
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

// 地址用途依据 IANA IPv4 特殊用途登记；分类不代表实际网络可达性。
const SPECIAL_SCOPES: ReadonlyArray<readonly [string, number, string]> = [
  ['0.0.0.0', 32, '本网络上的本机（未指定地址）'],
  ['255.255.255.255', 32, '有限广播地址'],
  ['192.0.0.8', 32, 'IPv4 占位地址'],
  ['192.0.0.9', 32, 'PCP 任播地址'],
  ['192.0.0.10', 32, 'TURN 任播地址'],
  ['192.0.0.170', 31, 'NAT64 / DNS64 发现地址'],
  ['192.88.99.2', 32, '6a44 中继任播地址'],
  ['192.0.0.0', 29, 'IPv4 服务连续性前缀'],
  ['192.0.0.0', 24, 'IETF 协议专用地址'],
  ['192.0.2.0', 24, '文档示例地址 TEST-NET-1'],
  ['198.51.100.0', 24, '文档示例地址 TEST-NET-2'],
  ['203.0.113.0', 24, '文档示例地址 TEST-NET-3'],
  ['192.31.196.0', 24, 'AS112-v4 服务地址'],
  ['192.52.193.0', 24, 'AMT 自动组播隧道地址'],
  ['192.88.99.0', 24, '已弃用的 6to4 中继任播地址段'],
  ['192.175.48.0', 24, 'AS112 直接委派服务地址'],
  ['169.254.0.0', 16, '链路本地地址'],
  ['192.168.0.0', 16, 'RFC 1918 私有地址'],
  ['198.18.0.0', 15, '网络设备基准测试地址'],
  ['172.16.0.0', 12, 'RFC 1918 私有地址'],
  ['100.64.0.0', 10, '运营商共享地址 CGNAT'],
  ['0.0.0.0', 8, '本网络地址段'],
  ['10.0.0.0', 8, 'RFC 1918 私有地址'],
  ['127.0.0.0', 8, '本地回环地址'],
  ['224.0.0.0', 4, 'IPv4 组播地址'],
  ['240.0.0.0', 4, '协议保留地址']
]

function classifyIpScope(ipUint: number): string {
  for (const [network, prefix, label] of SPECIAL_SCOPES) {
    const mask = (0xffffffff << (32 - prefix)) >>> 0
    if (((ipUint & mask) >>> 0) === ipToUint32(network)) return `${label} (${network}/${prefix})`
  }
  return '普通单播地址（未命中特殊用途；公网可达性未验证）'
}

export function calculateIpv4Cidr(rawInput: string): CidrCalculationResult {
  const trimmed = String(rawInput || '').trim()
  if (!trimmed) {
    throw new Error('EMPTY_CIDR_INPUT: 请输入 IPv4 CIDR（如 192.168.1.0/24）')
  }

  const parts = trimmed.split('/')
  if (parts.length > 2) throw new Error('CIDR 只能包含一个斜线和一个前缀长度。')
  const ipStr = parts[0].trim()
  const prefixStr = parts.length > 1 ? parts[1].trim() : '24'

  if (!/^\d{1,2}$/.test(prefixStr)) {
    throw new Error('CIDR 前缀必须是 0～32 的整数。')
  }
  const prefixLength = Number(prefixStr)
  if (prefixLength < 0 || prefixLength > 32) {
    throw new Error(`CIDR_PREFIX_OUT_OF_RANGE: 掩码前缀必须在 /0 ~ /32 之间 (当前 /${prefixLength})`)
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
    usageHint = '/32 单机主机路由 (Host Route)，仅包含唯一指定 IP'
  } else if (prefixLength === 31) {
    usableHosts = 2
    firstUsableUint = networkUint
    lastUsableUint = broadcastUint
    usageHint = '/31 点对点链路 (RFC 3021 Point-to-Point)，无独立广播地址浪费'
  } else {
    usableHosts = Math.max(0, totalHosts - 2)
    firstUsableUint = (networkUint + 1) >>> 0
    lastUsableUint = (broadcastUint - 1) >>> 0
    usageHint = `标准子网，已扣除网络地址 (${uint32ToIp(networkUint)}) 与广播地址 (${uint32ToIp(
      broadcastUint,
    )})`
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
    usageHint: `${usageHint}。主机容量仅为数学计算，未排除特殊用途地址，也不代表公网可达。`,
  }
}

function digitToSymbolic(d: number): string {
  return `${(d & 4) !== 0 ? 'r' : '-'}${(d & 2) !== 0 ? 'w' : '-'}${(d & 1) !== 0 ? 'x' : '-'}`
}

export function convertChmod(rawInput: string): ChmodCalculationResult {
  const cleaned = String(rawInput || '').trim().replace(/^chmod[ \t]+(?:-R[ \t]+)?/, '').trim()
  if (!cleaned) throw new Error('请输入三至四位八进制权限，或九位符号权限。')
  let digits: [number, number, number]
  let special = 0, fileType = '-'
  if (/^[0-7]{3,4}$/.test(cleaned)) {
    const ordinary = cleaned.slice(-3)
    digits = [Number(ordinary[0]), Number(ordinary[1]), Number(ordinary[2])]
    special = cleaned.length === 4 ? Number(cleaned[0]) : 0
  } else {
    const symbolic = cleaned.length === 10 && /^[dlcbps-]/.test(cleaned) ? cleaned.slice(1) : cleaned
    if (!/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(symbolic)) throw new Error('权限格式不正确：支持 000～7777 或 rwxr-xr-x；s/S 仅位于属主或组执行位，t/T 仅位于其他用户执行位。')
    if (cleaned.length === 10) fileType = cleaned[0]!
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
      ? `其他用户具有写入权限 (${octal})。实际访问还受目录执行位、sticky 位和 ACL 等规则约束，请按目标用途设置。`
      : undefined,
    roles,
  }
}
