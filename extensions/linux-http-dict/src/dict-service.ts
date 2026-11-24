import { getLocale } from '@ztools/declarative-ui'
import type { HttpStatusItem, LinuxCommandGroup, LinuxCommandItem, PortItem } from './types'
import { DICT_MESSAGES, t } from './i18n.js'
import {
  EXTRA_HTTP_SPECS,
  EXTRA_LINUX_SPECS,
  EXTRA_PORT_SPECS,
  type ExtraHttpSpec,
  type ExtraLinuxSpec,
  type ExtraPortSpec,
  type LocalizedText
} from './dict-data.js'

type DictKey = keyof (typeof DICT_MESSAGES)['zh-CN']

const GROUP_KEY: Record<LinuxCommandGroup, 'grpFile' | 'grpNet' | 'grpText' | 'grpSystem' | 'grpDisk'> = {
  file: 'grpFile',
  net: 'grpNet',
  text: 'grpText',
  system: 'grpSystem',
  disk: 'grpDisk',
  security: 'grpSystem',
}

interface LinuxCommandSpec {
  id: string
  name: string
  group: LinuxCommandGroup
  prefix: 'tar' | 'unzip' | 'find' | 'lsof' | 'ss' | 'netstat' | 'grep' | 'awk' | 'sys' | 'dudf'
  starsKey: 'stars5' | 'stars4'
  package: string
  paramFlags: readonly string[]
  examples: ReadonlyArray<{ cmd?: string; cmdKey?: DictKey; hasNote?: boolean }>
}

interface HttpStatusSpec {
  code: number
  phrase: string
  rfc: string
  isRetryable: boolean
  causeCount: number
  stepCount: number
}

interface PortSpec {
  port: number
  protocol: 'TCP' | 'UDP' | 'TCP/UDP'
  service: string
  catKey: DictKey
}

const LINUX_COMMAND_SPECS: readonly LinuxCommandSpec[] = [
  {
    id: 'cmd-tar',
    name: 'tar',
    group: 'file',
    prefix: 'tar',
    starsKey: 'stars5',
    package: 'tar',
    paramFlags: ['-x', '-c', '-z', '-j', '-v', '-f', '-C'],
    examples: [
      { cmd: 'tar -zxvf archive.tar.gz', hasNote: true },
      { cmd: 'tar -zxvf archive.tar.gz -C /opt/app' },
      { cmd: 'tar --exclude=node_modules -zcvf backup.tar.gz ./project' },
    ],
  },
  {
    id: 'cmd-unzip',
    name: 'unzip',
    group: 'file',
    prefix: 'unzip',
    starsKey: 'stars5',
    package: 'unzip',
    paramFlags: ['-d <dir>', '-l', '-O CP936'],
    examples: [
      { cmd: 'unzip dist.zip -d /var/www/html' },
      { cmdKey: 'unzipE2Cmd' },
    ],
  },
  {
    id: 'cmd-find',
    name: 'find',
    group: 'file',
    prefix: 'find',
    starsKey: 'stars5',
    package: 'findutils',
    paramFlags: ['-name', '-iname', '-size +100M', '-mtime +7'],
    examples: [
      { cmd: 'find /var/log -type f -size +100M -exec ls -lh {} +' },
      { cmd: 'find /data/logs -type f -name "*.log" -mtime +30 -delete' },
    ],
  },
  {
    id: 'cmd-lsof',
    name: 'lsof',
    group: 'net',
    prefix: 'lsof',
    starsKey: 'stars5',
    package: 'lsof',
    paramFlags: ['-i :<port>', '-p <pid>', '+D <dir>'],
    examples: [
      { cmd: 'lsof -i :8080' },
      { cmd: 'lsof | grep deleted' },
    ],
  },
  {
    id: 'cmd-ss',
    name: 'ss',
    group: 'net',
    prefix: 'ss',
    starsKey: 'stars5',
    package: 'iproute2',
    paramFlags: ['-t', '-u', '-l', '-p', '-n'],
    examples: [
      { cmd: 'ss -tulpn' },
      { cmd: 'ss -tulpn | grep :6379' },
    ],
  },
  {
    id: 'cmd-netstat',
    name: 'netstat',
    group: 'net',
    prefix: 'netstat',
    starsKey: 'stars4',
    package: 'net-tools',
    paramFlags: ['-tunlp', '-an'],
    examples: [
      { cmd: 'netstat -tunlp' },
      { cmd: "netstat -n | awk '/^tcp/ {++S[$NF]} END {for(a in S) print a, S[a]}'" },
    ],
  },
  {
    id: 'cmd-grep',
    name: 'grep',
    group: 'text',
    prefix: 'grep',
    starsKey: 'stars5',
    package: 'grep',
    paramFlags: ['-r / -R', '-n', '-i', '-C 5', '-v'],
    examples: [
      { cmd: 'grep -n -C 10 "OutOfMemoryError" /var/log/app/server.log' },
      { cmd: 'grep -rn --exclude-dir={node_modules,.git} "API_SECRET" ./src' },
    ],
  },
  {
    id: 'cmd-awk',
    name: 'awk',
    group: 'text',
    prefix: 'awk',
    starsKey: 'stars5',
    package: 'gawk',
    paramFlags: ['-F ":"', '$1 / $NF'],
    examples: [
      { cmd: "awk '{print $1}' access.log | sort | uniq -c | sort -nr | head -n 10" },
      { cmd: 'awk -F ":" \'{print $1, $3}\' /etc/passwd' },
    ],
  },
  {
    id: 'cmd-systemctl',
    name: 'systemctl',
    group: 'system',
    prefix: 'sys',
    starsKey: 'stars5',
    package: 'systemd',
    paramFlags: ['status <svc>', 'restart <svc>', 'enable --now', 'daemon-reload'],
    examples: [
      { cmd: 'systemctl restart nginx && systemctl status nginx' },
      { cmd: 'systemctl enable --now docker' },
    ],
  },
  {
    id: 'cmd-du-df',
    name: 'du / df',
    group: 'disk',
    prefix: 'dudf',
    starsKey: 'stars5',
    package: 'coreutils',
    paramFlags: ['df -h', 'df -i', 'du -sh *'],
    examples: [
      { cmd: 'du -h --max-depth=1 | sort -hr' },
      { cmd: 'df -h && df -i' },
    ],
  },
]

const HTTP_STATUS_SPECS: readonly HttpStatusSpec[] = [
  { code: 200, phrase: 'OK', rfc: 'RFC 9110 §15.3.1', isRetryable: true, causeCount: 1, stepCount: 1 },
  { code: 301, phrase: 'Moved Permanently', rfc: 'RFC 9110 §15.4.2', isRetryable: false, causeCount: 2, stepCount: 1 },
  { code: 304, phrase: 'Not Modified', rfc: 'RFC 9110 §15.4.5', isRetryable: true, causeCount: 2, stepCount: 1 },
  { code: 400, phrase: 'Bad Request', rfc: 'RFC 9110 §15.5.1', isRetryable: false, causeCount: 3, stepCount: 2 },
  { code: 401, phrase: 'Unauthorized', rfc: 'RFC 9110 §15.5.2', isRetryable: false, causeCount: 2, stepCount: 2 },
  { code: 403, phrase: 'Forbidden', rfc: 'RFC 9110 §15.5.4', isRetryable: false, causeCount: 3, stepCount: 1 },
  { code: 404, phrase: 'Not Found', rfc: 'RFC 9110 §15.5.5', isRetryable: false, causeCount: 2, stepCount: 2 },
  { code: 429, phrase: 'Too Many Requests', rfc: 'RFC 6585 §4', isRetryable: true, causeCount: 2, stepCount: 2 },
  { code: 499, phrase: 'Client Closed Request (Nginx)', rfc: 'Nginx Non-Standard', isRetryable: false, causeCount: 2, stepCount: 1 },
  { code: 500, phrase: 'Internal Server Error', rfc: 'RFC 9110 §15.6.1', isRetryable: false, causeCount: 2, stepCount: 1 },
  { code: 502, phrase: 'Bad Gateway', rfc: 'RFC 9110 §15.6.3', isRetryable: true, causeCount: 3, stepCount: 3 },
  { code: 503, phrase: 'Service Unavailable', rfc: 'RFC 9110 §15.6.4', isRetryable: true, causeCount: 2, stepCount: 1 },
  { code: 504, phrase: 'Gateway Timeout', rfc: 'RFC 9110 §15.6.5', isRetryable: false, causeCount: 2, stepCount: 2 },
]

const COMMON_PORT_SPECS: readonly PortSpec[] = [
  { port: 22, protocol: 'TCP', service: 'SSH / SFTP', catKey: 'pCatRemote' },
  { port: 53, protocol: 'TCP/UDP', service: 'DNS', catKey: 'pCatNetBase' },
  { port: 80, protocol: 'TCP', service: 'HTTP', catKey: 'pCatWeb' },
  { port: 443, protocol: 'TCP/UDP', service: 'HTTPS / HTTP3(QUIC)', catKey: 'pCatWeb' },
  { port: 3306, protocol: 'TCP', service: 'MySQL / MariaDB', catKey: 'pCatRdb' },
  { port: 5432, protocol: 'TCP', service: 'PostgreSQL', catKey: 'pCatRdb' },
  { port: 6379, protocol: 'TCP', service: 'Redis', catKey: 'pCatCache' },
  { port: 8080, protocol: 'TCP', service: 'HTTP Alternate (Spring Boot / Tomcat)', catKey: 'pCatApp' },
  { port: 8848, protocol: 'TCP', service: 'Nacos', catKey: 'pCatRegistry' },
  { port: 9092, protocol: 'TCP', service: 'Apache Kafka', catKey: 'pCatMq' },
  { port: 9200, protocol: 'TCP', service: 'Elasticsearch', catKey: 'pCatSearch' },
  { port: 27017, protocol: 'TCP', service: 'MongoDB', catKey: 'pCatNosql' },
]

function tr(key: string, locale?: 'zh-CN' | 'en-US'): string {
  if (locale) {
    return DICT_MESSAGES[locale][key as DictKey] ?? key
  }
  return t(key as DictKey)
}

function splitAliases(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function buildLinuxCommand(spec: LinuxCommandSpec, locale?: 'zh-CN' | 'en-US'): LinuxCommandItem {
  const { prefix } = spec
  return {
    id: spec.id,
    name: spec.name,
    group: spec.group,
    groupLabel: tr(GROUP_KEY[spec.group], locale),
    description: tr(`${prefix}Desc`, locale),
    aliases: splitAliases(tr(`${prefix}Aliases`, locale)),
    stars: tr(spec.starsKey, locale),
    package: spec.package,
    params: spec.paramFlags.map((flag, idx) => ({
      flag,
      desc: tr(`${prefix}P${idx + 1}`, locale),
    })),
    examples: spec.examples.map((ex, idx) => ({
      title: tr(`${prefix}E${idx + 1}Title`, locale),
      cmd: ex.cmdKey ? tr(ex.cmdKey, locale) : (ex.cmd ?? ''),
      ...(ex.hasNote ? { note: tr(`${prefix}E${idx + 1}Note`, locale) } : {}),
    })),
  }
}

function buildHttpStatus(spec: HttpStatusSpec, locale?: 'zh-CN' | 'en-US'): HttpStatusItem {
  const prefix = `h${spec.code}`
  return {
    code: spec.code,
    phrase: spec.phrase,
    meaning: tr(`${prefix}Mean`, locale),
    rfc: spec.rfc,
    isRetryable: spec.isRetryable,
    causes: Array.from({ length: spec.causeCount }, (_, idx) => tr(`${prefix}C${idx + 1}`, locale)),
    troubleshooting: Array.from({ length: spec.stepCount }, (_, idx) => ({
      step: tr(`${prefix}S${idx + 1}Step`, locale),
      action: tr(`${prefix}S${idx + 1}Act`, locale),
    })),
    architectureNotes: tr(`${prefix}Arch`, locale),
  }
}

function buildPortItem(spec: PortSpec, locale?: 'zh-CN' | 'en-US'): PortItem {
  return {
    port: spec.port,
    protocol: spec.protocol,
    service: spec.service,
    category: tr(spec.catKey, locale),
    description: tr(`p${spec.port}Desc`, locale),
    securityNotice: tr(`p${spec.port}Sec`, locale),
  }
}

function pickText(text: LocalizedText, locale?: 'zh-CN' | 'en-US'): string {
  const effective = locale ?? (getLocale() === 'zh-CN' ? 'zh-CN' : 'en-US')
  return effective === 'zh-CN' ? text.zh : text.en
}

function buildExtraLinuxCommand(spec: ExtraLinuxSpec, locale?: 'zh-CN' | 'en-US'): LinuxCommandItem {
  const effective = locale ?? (getLocale() === 'zh-CN' ? 'zh-CN' : 'en-US')
  return {
    id: spec.id,
    name: spec.name,
    group: spec.group,
    groupLabel: tr(GROUP_KEY[spec.group], locale),
    description: pickText(spec.description, locale),
    aliases: [...(effective === 'zh-CN' ? spec.aliases.zh : spec.aliases.en)],
    stars: tr(spec.starsKey, locale),
    package: spec.package,
    params: spec.params.map((p) => ({ flag: p.flag, desc: pickText(p.desc, locale) })),
    examples: spec.examples.map((ex) => ({
      title: pickText(ex.title, locale),
      cmd: ex.cmd,
      ...(ex.note ? { note: pickText(ex.note, locale) } : {}),
    })),
  }
}

function buildExtraHttpStatus(spec: ExtraHttpSpec, locale?: 'zh-CN' | 'en-US'): HttpStatusItem {
  return {
    code: spec.code,
    phrase: spec.phrase,
    meaning: pickText(spec.meaning, locale),
    rfc: spec.rfc,
    isRetryable: spec.isRetryable,
    causes: spec.causes.map((c) => pickText(c, locale)),
    troubleshooting: spec.troubleshooting.map((s) => ({
      step: pickText(s.step, locale),
      action: pickText(s.action, locale),
    })),
    architectureNotes: pickText(spec.architectureNotes, locale),
  }
}

function buildExtraPortItem(spec: ExtraPortSpec, locale?: 'zh-CN' | 'en-US'): PortItem {
  return {
    port: spec.port,
    protocol: spec.protocol,
    service: spec.service,
    category: pickText(spec.category, locale),
    description: pickText(spec.description, locale),
    securityNotice: pickText(spec.securityNotice, locale),
  }
}

/** 动态视图数组：所有文案字段通过 getter 实时按当前 locale 读取，避免模块顶层冻结与硬编码中文 */
export const LINUX_COMMANDS_DICT: LinuxCommandItem[] = [
  ...LINUX_COMMAND_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    group: spec.group,
    package: spec.package,
    get groupLabel() {
      return tr(GROUP_KEY[spec.group])
    },
    get description() {
      return tr(`${spec.prefix}Desc`)
    },
    get aliases() {
      return splitAliases(tr(`${spec.prefix}Aliases`))
    },
    get stars() {
      return tr(spec.starsKey)
    },
    get params() {
      return spec.paramFlags.map((flag, idx) => ({ flag, desc: tr(`${spec.prefix}P${idx + 1}`) }))
    },
    get examples() {
      return spec.examples.map((ex, idx) => ({
        title: tr(`${spec.prefix}E${idx + 1}Title`),
        cmd: ex.cmdKey ? tr(ex.cmdKey) : (ex.cmd ?? ''),
        ...(ex.hasNote ? { note: tr(`${spec.prefix}E${idx + 1}Note`) } : {}),
      }))
    },
  })),
  ...EXTRA_LINUX_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    group: spec.group,
    package: spec.package,
    get groupLabel() {
      return tr(GROUP_KEY[spec.group])
    },
    get description() {
      return pickText(spec.description)
    },
    get aliases() {
      return [...(getLocale() === 'zh-CN' ? spec.aliases.zh : spec.aliases.en)]
    },
    get stars() {
      return tr(spec.starsKey)
    },
    get params() {
      return spec.params.map((p) => ({ flag: p.flag, desc: pickText(p.desc) }))
    },
    get examples() {
      return spec.examples.map((ex) => ({
        title: pickText(ex.title),
        cmd: ex.cmd,
        ...(ex.note ? { note: pickText(ex.note) } : {}),
      }))
    },
  })),
]

export const HTTP_STATUS_DICT: HttpStatusItem[] = [
  ...HTTP_STATUS_SPECS.map((spec) => ({
    code: spec.code,
    phrase: spec.phrase,
    rfc: spec.rfc,
    isRetryable: spec.isRetryable,
    get meaning() {
      return tr(`h${spec.code}Mean`)
    },
    get causes() {
      return Array.from({ length: spec.causeCount }, (_, idx) => tr(`h${spec.code}C${idx + 1}`))
    },
    get troubleshooting() {
      return Array.from({ length: spec.stepCount }, (_, idx) => ({
        step: tr(`h${spec.code}S${idx + 1}Step`),
        action: tr(`h${spec.code}S${idx + 1}Act`),
      }))
    },
    get architectureNotes() {
      return tr(`h${spec.code}Arch`)
    },
  })),
  ...EXTRA_HTTP_SPECS.map((spec) => ({
    code: spec.code,
    phrase: spec.phrase,
    rfc: spec.rfc,
    isRetryable: spec.isRetryable,
    get meaning() {
      return pickText(spec.meaning)
    },
    get causes() {
      return spec.causes.map((c) => pickText(c))
    },
    get troubleshooting() {
      return spec.troubleshooting.map((s) => ({ step: pickText(s.step), action: pickText(s.action) }))
    },
    get architectureNotes() {
      return pickText(spec.architectureNotes)
    },
  })),
].sort((a, b) => a.code - b.code)

export const COMMON_PORTS_DICT: PortItem[] = [
  ...COMMON_PORT_SPECS.map((spec) => ({
    port: spec.port,
    protocol: spec.protocol,
    service: spec.service,
    get category() {
      return tr(spec.catKey)
    },
    get description() {
      return tr(`p${spec.port}Desc`)
    },
    get securityNotice() {
      return tr(`p${spec.port}Sec`)
    },
  })),
  ...EXTRA_PORT_SPECS.map((spec) => ({
    port: spec.port,
    protocol: spec.protocol,
    service: spec.service,
    get category() {
      return pickText(spec.category)
    },
    get description() {
      return pickText(spec.description)
    },
    get securityNotice() {
      return pickText(spec.securityNotice)
    },
  })),
].sort((a, b) => a.port - b.port)

function sanitizeSearchQuery(rawQuery: string): string {
  return String(rawQuery ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 120)
}

function matchesLinuxCommand(item: LinuxCommandItem, q: string): boolean {
  return (
    item.name.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    item.groupLabel.toLowerCase().includes(q) ||
    item.aliases.some((a) => a.toLowerCase().includes(q)) ||
    item.examples.some((e) => e.title.toLowerCase().includes(q) || e.cmd.toLowerCase().includes(q))
  )
}

export function searchLinuxCommands(query: string): LinuxCommandItem[] {
  const q = sanitizeSearchQuery(query)
  const baseLocalized = LINUX_COMMAND_SPECS.map((spec) => buildLinuxCommand(spec))
  const extraLocalized = EXTRA_LINUX_SPECS.map((spec) => buildExtraLinuxCommand(spec))
  if (!q) return [...baseLocalized, ...extraLocalized]
  return [
    ...baseLocalized.filter(
      (item, idx) =>
        matchesLinuxCommand(item, q) ||
        matchesLinuxCommand(buildLinuxCommand(LINUX_COMMAND_SPECS[idx], 'zh-CN'), q) ||
        matchesLinuxCommand(buildLinuxCommand(LINUX_COMMAND_SPECS[idx], 'en-US'), q)
    ),
    ...extraLocalized.filter(
      (item, idx) =>
        matchesLinuxCommand(item, q) ||
        matchesLinuxCommand(buildExtraLinuxCommand(EXTRA_LINUX_SPECS[idx], 'zh-CN'), q) ||
        matchesLinuxCommand(buildExtraLinuxCommand(EXTRA_LINUX_SPECS[idx], 'en-US'), q)
    ),
  ]
}

function matchesHttpStatus(item: HttpStatusItem, q: string): boolean {
  return (
    String(item.code).includes(q) ||
    item.phrase.toLowerCase().includes(q) ||
    item.meaning.toLowerCase().includes(q) ||
    item.causes.some((c) => c.toLowerCase().includes(q)) ||
    item.troubleshooting.some((stepItem) => stepItem.step.toLowerCase().includes(q) || stepItem.action.toLowerCase().includes(q))
  )
}

export function searchHttpStatus(query: string): HttpStatusItem[] {
  const q = sanitizeSearchQuery(query)
  const baseLocalized = HTTP_STATUS_SPECS.map((spec) => buildHttpStatus(spec))
  const extraLocalized = EXTRA_HTTP_SPECS.map((spec) => buildExtraHttpStatus(spec))
  if (!q) return [...baseLocalized, ...extraLocalized].sort((a, b) => a.code - b.code)
  return [
    ...baseLocalized.filter(
      (item, idx) =>
        matchesHttpStatus(item, q) ||
        matchesHttpStatus(buildHttpStatus(HTTP_STATUS_SPECS[idx], 'zh-CN'), q) ||
        matchesHttpStatus(buildHttpStatus(HTTP_STATUS_SPECS[idx], 'en-US'), q)
    ),
    ...extraLocalized.filter(
      (item, idx) =>
        matchesHttpStatus(item, q) ||
        matchesHttpStatus(buildExtraHttpStatus(EXTRA_HTTP_SPECS[idx], 'zh-CN'), q) ||
        matchesHttpStatus(buildExtraHttpStatus(EXTRA_HTTP_SPECS[idx], 'en-US'), q)
    ),
  ].sort((a, b) => a.code - b.code)
}

function matchesPort(item: PortItem, q: string): boolean {
  return (
    String(item.port).includes(q) ||
    item.service.toLowerCase().includes(q) ||
    item.category.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q)
  )
}

export function searchCommonPorts(query: string): PortItem[] {
  const q = sanitizeSearchQuery(query)
  const baseLocalized = COMMON_PORT_SPECS.map((spec) => buildPortItem(spec))
  const extraLocalized = EXTRA_PORT_SPECS.map((spec) => buildExtraPortItem(spec))
  if (!q) return [...baseLocalized, ...extraLocalized].sort((a, b) => a.port - b.port)
  return [
    ...baseLocalized.filter(
      (item, idx) =>
        matchesPort(item, q) ||
        matchesPort(buildPortItem(COMMON_PORT_SPECS[idx], 'zh-CN'), q) ||
        matchesPort(buildPortItem(COMMON_PORT_SPECS[idx], 'en-US'), q)
    ),
    ...extraLocalized.filter(
      (item, idx) =>
        matchesPort(item, q) ||
        matchesPort(buildExtraPortItem(EXTRA_PORT_SPECS[idx], 'zh-CN'), q) ||
        matchesPort(buildExtraPortItem(EXTRA_PORT_SPECS[idx], 'en-US'), q)
    ),
  ].sort((a, b) => a.port - b.port)
}

/** 各系统查看本机端口占用的命令：Linux 用 ss，macOS 没有 ss、改用 lsof，Windows 用 netstat。 */
export function portCheckCommands(item: PortItem): { linux: string; macos: string; windows: string } {
  const port = item.port
  return {
    linux: `ss -tulpn | grep :${port}`,
    macos: item.protocol === 'TCP' ? `sudo lsof -nP -iTCP:${port} -sTCP:LISTEN` : `sudo lsof -nP -i :${port}`,
    windows: `netstat -ano | findstr :${port}`
  }
}
