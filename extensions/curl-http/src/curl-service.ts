import type { CodeTargetLang, HttpResponseSnapshot, ParsedCurlRequest } from './types'

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

type HostNetworkMethod = (request: {
  messageId: string
  timeoutMs: number
  params: { method: string; url: string; headers: Record<string, string>; body?: string; timeout: number }
}) => Promise<{ success: boolean; data?: unknown; error?: { code?: string; message?: string } }>

let networkSequence = 0
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 使用宿主网络通道，接口调试不受页面的 CORS 与 CSP 限制。 */
async function requestViaHost(parsed: ParsedCurlRequest, timeoutMs: number): Promise<Pick<Response, 'ok' | 'status' | 'statusText' | 'headers' | 'text'>> {
  const root = globalThis as unknown as {
    window?: { __ztoolsElectron?: { transport?: { methods?: { network_http_request?: HostNetworkMethod } } } }
  }
  const request = root.window?.__ztoolsElectron?.transport?.methods?.network_http_request
  if (typeof request !== 'function') throw new Error('当前客户端不支持网络请求，请升级客户端')
  if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(parsed.method)) {
    throw new Error(`当前客户端不支持 ${parsed.method} 请求，可复制生成的代码执行`)
  }
  if (parsed.method === 'DELETE' && parsed.body) {
    throw new Error('当前客户端不支持带请求体的 DELETE 请求，可复制生成的代码执行')
  }
  const envelope = await request({
    messageId: `curl_http_${Date.now()}_${++networkSequence}`,
    timeoutMs: timeoutMs + 250,
    params: {
      method: parsed.method, url: parsed.url, headers: parsed.headers, timeout: timeoutMs,
      ...(['POST', 'PUT'].includes(parsed.method) && parsed.body !== undefined ? { body: parsed.body } : {})
    }
  })
  if (!envelope.success) {
    if (envelope.error?.code === 'REQUEST_TIMEOUT') throw new DOMException('网络请求超时', 'AbortError')
    throw new Error(envelope.error?.message || '宿主网络请求失败')
  }
  const response = envelope.data
  if (!isRecord(response) || response.success !== true || !isRecord(response.data)) {
    throw new Error('宿主网络响应格式无效')
  }
  const data = response.data
  if (typeof data.statusCode !== 'number' || !Number.isInteger(data.statusCode) || data.statusCode < 200 || data.statusCode > 599 || typeof data.body !== 'string' || typeof data.statusText !== 'string') {
    throw new Error('宿主网络响应缺少状态码或正文')
  }
  const body = data.body
  return {
    ok: data.statusCode >= 200 && data.statusCode < 300,
    status: data.statusCode,
    statusText: data.statusText,
    // 当前宿主只返回状态与正文；不能用 Response 构造器自动补出的头冒充服务器响应头。
    headers: new Headers(),
    text: async () => body
  }
}

const unclosedQuote = (quote: string): Error =>
  new Error(`UNCLOSED_QUOTE_IN_CURL: cURL 命令存在未闭合引号 (${quote})`)

/** 读取 bash 的 $'...' 字符串（浏览器「Copy as cURL (bash)」在内容含单引号、换行或控制字符时使用），返回解码后的内容与结束位置。 */
function readAnsiCString(src: string, start: number): { value: string; end: number } {
  let value = ''
  let i = start
  const simple: Record<string, string> = {
    a: String.fromCharCode(7), b: '\b', e: String.fromCharCode(27), E: String.fromCharCode(27), f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
    '\\': '\\', "'": "'", '"': '"', '?': '?'
  }
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'") return { value, end: i + 1 }
    if (ch !== '\\') {
      value += ch
      i++
      continue
    }
    const esc = src[i + 1]
    if (esc === undefined) break
    if (esc in simple) {
      value += simple[esc]
      i += 2
      continue
    }
    const readDigits = (pattern: RegExp, max: number, from: number): string => {
      let digits = ''
      while (digits.length < max && from + digits.length < src.length && pattern.test(src[from + digits.length])) {
        digits += src[from + digits.length]
      }
      return digits
    }
    if (esc === 'x' || esc === 'u' || esc === 'U') {
      const digits = readDigits(/[0-9a-fA-F]/, esc === 'x' ? 2 : esc === 'u' ? 4 : 8, i + 2)
      if (!digits) {
        value += `\\${esc}`
        i += 2
        continue
      }
      const code = parseInt(digits, 16)
      if (esc === 'x') {
        value += String.fromCharCode(code)
      } else if (code > 0x10ffff) {
        throw new Error(`INVALID_CURL_ESCAPE: $'...' 中的 \\${esc}${digits} 超出 Unicode 范围`)
      } else {
        value += String.fromCodePoint(code)
      }
      i += 2 + digits.length
      continue
    }
    if (/[0-7]/.test(esc)) {
      const digits = readDigits(/[0-7]/, 3, i + 1)
      value += String.fromCharCode(parseInt(digits, 8) & 0xff)
      i += 1 + digits.length
      continue
    }
    if (esc === 'c' && i + 2 < src.length) {
      value += String.fromCharCode(src.charCodeAt(i + 2) & 0x1f)
      i += 3
      continue
    }
    // 未知转义按 bash 规则原样保留反斜杠
    value += `\\${esc}`
    i += 2
  }
  throw unclosedQuote("$'")
}

/**
 * 按 bash 规则拆分命令：单引号内全部按字面；双引号内反斜杠只转义 $ ` " \ 和换行；
 * 引号外反斜杠转义下一个字符，行尾反斜杠为续行；支持 $'...'；空字符串参数（'' 或 ""）保留为空参数。
 */
export function tokenizeShellCommand(raw: string): string[] {
  const src = String(raw || '').replace(/`\r?\n/g, ' ').trim()
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  const flush = (): void => {
    if (hasToken) tokens.push(current)
    current = ''
    hasToken = false
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      flush()
      i++
      continue
    }
    if (ch === '\\') {
      const next = src[i + 1]
      if (next === '\n') { i += 2; continue }
      if (next === '\r' && src[i + 2] === '\n') { i += 3; continue }
      if (next === undefined) { i++; continue }
      current += next
      hasToken = true
      i += 2
      continue
    }
    if (ch === "'") {
      const end = src.indexOf("'", i + 1)
      if (end < 0) throw unclosedQuote("'")
      current += src.slice(i + 1, end)
      hasToken = true
      i = end + 1
      continue
    }
    if (ch === '$' && src[i + 1] === "'") {
      const result = readAnsiCString(src, i + 2)
      current += result.value
      hasToken = true
      i = result.end
      continue
    }
    if (ch === '"') {
      hasToken = true
      i++
      let closed = false
      while (i < src.length) {
        const c = src[i]
        if (c === '"') { closed = true; i++; break }
        if (c === '\\' && i + 1 < src.length) {
          const n = src[i + 1]
          if (n === '\n') { i += 2; continue }
          if (n === '\r' && src[i + 2] === '\n') { i += 3; continue }
          if (n === '$' || n === '`' || n === '"' || n === '\\') { current += n; i += 2; continue }
        }
        current += c
        i++
      }
      if (!closed) throw unclosedQuote('"')
      continue
    }
    current += ch
    hasToken = true
    i++
  }
  flush()
  return tokens
}

/**
 * 是否是 Windows cmd 写法的 cURL（例如浏览器开发者工具「Copy as cURL (cmd)」）：
 * 用 ^" 包住参数，或用行尾 ^ 续行。
 */
export function isCmdStyleCurl(raw: string): boolean {
  return /\^"/.test(raw) || /\^\r?\n/.test(raw)
}

/**
 * 第一步：按 cmd.exe 的规则去掉转义符 ^。
 * 引号外的 ^X 表示字面 X（^" 是字面引号，不会让 cmd 进入引号状态）；行尾 ^ 是续行，换行去掉、紧跟的下一个字符按字面保留；
 * 引号内的 ^ 原样保留。得到的就是 curl.exe 实际收到的命令行。
 */
function removeCmdCarets(raw: string): string {
  let out = ''
  let inQuote = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"') {
      inQuote = !inQuote
      out += ch
      continue
    }
    if (ch !== '^' || inQuote) {
      out += ch
      continue
    }
    let next = i + 1
    if (raw[next] === '\r' && raw[next + 1] === '\n') next += 2
    else if (raw[next] === '\n') next += 1
    if (next < raw.length) out += raw[next]
    i = next
  }
  return out
}

/**
 * 第二步：按 Windows 程序（MSVCRT）的规则拆分参数：空白分隔，"..." 内的空白保留；
 * 引号前的 2n 个反斜杠变成 n 个并切换引号状态，2n+1 个变成 n 个加一个字面引号；不在引号前的反斜杠按字面保留；
 * 引号内连续两个引号表示一个字面引号。
 */
function splitWindowsCommandLine(commandLine: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuote = false
  let hasToken = false
  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i]
    if (ch === '\\') {
      let count = 0
      while (commandLine[i + count] === '\\') count++
      hasToken = true
      if (commandLine[i + count] === '"') {
        current += '\\'.repeat(Math.floor(count / 2))
        if (count % 2 === 1) {
          current += '"'
          i += count
        } else {
          i += count - 1
        }
      } else {
        current += '\\'.repeat(count)
        i += count - 1
      }
      continue
    }
    if (ch === '"') {
      hasToken = true
      if (inQuote && commandLine[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuote = !inQuote
      }
      continue
    }
    if (/\s/.test(ch) && !inQuote) {
      if (hasToken) {
        args.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    current += ch
    hasToken = true
  }
  if (inQuote) {
    throw new Error('UNCLOSED_QUOTE_IN_CURL: cURL 命令存在未闭合引号 (")')
  }
  if (hasToken) args.push(current)
  return args
}

/** 拆分 Windows cmd 写法的 cURL 命令（含 ^" 转义与 ^ 续行） */
export function tokenizeCmdCommand(raw: string): string[] {
  return splitWindowsCommandLine(removeCmdCarets(String(raw || '')).trim())
}

/** 不影响请求内容、可以安全忽略的开关 */
const HARMLESS_FLAGS = new Set([
  '--compressed', '-s', '--silent', '-S', '--show-error', '-v', '--verbose', '-i', '--include',
  '-g', '--globoff', '-L', '--location', '--http1.1', '--http2', '--http2-prior-knowledge',
  '-N', '--no-buffer', '-#', '--progress-bar', '-f', '--fail', '--fail-with-body', '--path-as-is'
])

/** 需要跟一个参数、但本插件不处理的选项：跳过它的参数，避免把参数（如 -e 的来源网址、-x 的代理地址）误当成目标网址 */
const IGNORED_VALUE_OPTIONS = new Set([
  '-o', '--output', '-x', '--proxy', '-U', '--proxy-user', '-m', '--max-time', '--connect-timeout',
  '-c', '--cookie-jar', '-w', '--write-out', '-r', '--range', '-E', '--cert', '--cert-type', '--key',
  '--key-type', '--cacert', '--capath', '--resolve', '--connect-to', '--retry', '--retry-delay',
  '--retry-max-time', '-y', '--speed-time', '-Y', '--speed-limit', '--limit-rate', '--interface',
  '--dns-servers', '--max-redirs', '-z', '--time-cond', '--proxy-header', '-D', '--dump-header',
  '--trace', '--trace-ascii', '--stderr', '-C', '--continue-at', '--ciphers', '--tls-max', '--noproxy',
  '--pinnedpubkey', '--expect100-timeout', '-Q', '--quote', '--local-port', '--max-filesize',
  '--variable', '--happy-eyeballs-timeout-ms', '--proto', '--proto-redir'
])

/** 本插件无法如实发出的选项：直接报错，避免发出和原命令不一样的请求 */
const UNSUPPORTED_OPTIONS: Record<string, string> = {
  '-F': '表单上传（-F）', '--form': '表单上传（--form）', '--form-string': '表单上传（--form-string）',
  '-T': '上传文件（-T）', '--upload-file': '上传文件（--upload-file）',
  '-K': '读取配置文件（-K）', '--config': '读取配置文件（--config）',
  '--unix-socket': 'Unix 套接字（--unix-socket）', '--abstract-unix-socket': 'Unix 套接字（--abstract-unix-socket）'
}

const SHORT_VALUE_OPTIONS = new Set(['X', 'H', 'd', 'b', 'u', 'A', 'e', 'F', 'T', 'o', 'x', 'U', 'm', 'c', 'w', 'r', 'E', 'K', 'y', 'Y', 'z', 'D', 'C', 'Q'])
const SHORT_FLAGS = new Set(['s', 'S', 'v', 'i', 'g', 'L', 'N', '#', 'f', 'k', 'G', 'I'])

/** curl --data-urlencode 的编码：只保留字母、数字与 -._~ */
function curlUrlEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encodeDataUrlencode(arg: string): string {
  const eq = arg.indexOf('=')
  if (eq >= 0) {
    const name = arg.slice(0, eq)
    return name ? `${name}=${curlUrlEncode(arg.slice(eq + 1))}` : curlUrlEncode(arg.slice(eq + 1))
  }
  if (arg.includes('@')) {
    throw new Error('UNSUPPORTED_CURL_FILE: --data-urlencode 的 @文件 写法需要读取本地文件，请把文件内容直接写进命令')
  }
  return curlUrlEncode(arg)
}

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key]
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase())
}

function normalizeTargetUrl(raw: string): string {
  // 与 curl 一致：没写协议时按 http 处理
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(`INVALID_TARGET_URL: 无法识别网址 ${raw}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`UNSUPPORTED_PROTOCOL: 只支持 http / https 网址，当前为 ${parsed.protocol.replace(/:$/, '')}`)
  }
  return candidate
}

export function parseCurlCommand(rawInput: string): ParsedCurlRequest {
  const trimmed = String(rawInput || '').trim()
  if (!trimmed) {
    throw new Error('EMPTY_CURL_INPUT: cURL 命令或 URL 不能为空')
  }

  if (/^https?:\/\//i.test(trimmed) && !/\s/.test(trimmed)) {
    return {
      method: 'GET',
      url: normalizeTargetUrl(trimmed),
      headers: {},
      rawCommand: `curl -X GET "${trimmed}"`,
      ignoredOptions: [],
    }
  }

  const tokens = isCmdStyleCurl(trimmed) ? tokenizeCmdCommand(trimmed) : tokenizeShellCommand(trimmed)
  if (tokens.length === 0) {
    throw new Error('EMPTY_CURL_TOKENS: 无法从输入提取命令参数')
  }

  const firstLower = tokens[0].toLowerCase()
  const startIdx = firstLower === 'curl' || firstLower === 'curl.exe' ? 1 : 0

  let method = ''
  let url = ''
  let useGet = false
  let useHead = false
  const headers: Record<string, string> = {}
  const bodyParts: string[] = []
  const ignoredOptions: string[] = []
  let cookies: string | undefined
  let jsonBody = false

  const applyOption = (option: string, value: string | undefined): void => {
    const requireValue = (): string => {
      if (typeof value !== 'string') throw new Error(`MISSING_CURL_VALUE: ${option} 参数后缺少内容`)
      return value
    }
    if (UNSUPPORTED_OPTIONS[option]) {
      throw new Error(`UNSUPPORTED_CURL_OPTION: 不支持${UNSUPPORTED_OPTIONS[option]}，请改用其他工具发送`)
    }
    switch (option) {
      case '-X': case '--request': {
        const next = requireValue()
        if (!next) throw new Error('MISSING_CURL_METHOD: -X 参数后缺少 HTTP 方法')
        method = next.toUpperCase()
        return
      }
      case '-H': case '--header': {
        const next = requireValue()
        if (next.startsWith('@')) {
          throw new Error('UNSUPPORTED_CURL_FILE: -H @文件 写法需要读取本地文件，请把请求头直接写进命令')
        }
        const colonIdx = next.indexOf(':')
        if (colonIdx > 0) {
          const key = next.slice(0, colonIdx).trim()
          const val = next.slice(colonIdx + 1).trim()
          deleteHeader(headers, key)
          // curl 中 "Name:" 表示去掉该请求头，"Name;" 表示发送空值请求头
          if (val) headers[key] = val
        } else if (/^[^:;\s]+;\s*$/.test(next)) {
          const key = next.slice(0, next.indexOf(';')).trim()
          deleteHeader(headers, key)
          headers[key] = ''
        } else {
          throw new Error(`INVALID_CURL_HEADER: 无法识别请求头 ${next}`)
        }
        return
      }
      case '-d': case '--data': case '--data-ascii': case '--data-binary': case '--json': {
        const next = requireValue()
        if (next.startsWith('@')) {
          throw new Error(`UNSUPPORTED_CURL_FILE: ${option} @文件 写法需要读取本地文件，请把文件内容直接写进命令`)
        }
        bodyParts.push(next)
        if (option === '--json') jsonBody = true
        return
      }
      case '--data-raw':
        bodyParts.push(requireValue())
        return
      case '--data-urlencode':
        bodyParts.push(encodeDataUrlencode(requireValue()))
        return
      case '-b': case '--cookie': {
        const next = requireValue()
        if (!next.includes('=')) {
          throw new Error('UNSUPPORTED_CURL_FILE: -b 后面是 Cookie 文件名，需要读取本地文件，请改成 "name=value" 写法')
        }
        cookies = next
        headers['Cookie'] = next
        return
      }
      case '-u': case '--user': {
        const next = requireValue()
        if (!next) throw new Error('MISSING_CURL_USER: -u 参数后缺少认证信息')
        headers['Authorization'] = `Basic ${utf8Base64(next.includes(':') ? next : `${next}:`)}`
        return
      }
      case '--oauth2-bearer':
        headers['Authorization'] = `Bearer ${requireValue()}`
        return
      case '-A': case '--user-agent':
        deleteHeader(headers, 'User-Agent')
        headers['User-Agent'] = requireValue()
        return
      case '-e': case '--referer':
        deleteHeader(headers, 'Referer')
        headers['Referer'] = requireValue()
        return
      case '--url': {
        const next = requireValue()
        if (!next) throw new Error('MISSING_CURL_URL: --url 参数后缺少目标地址')
        if (url) ignoredOptions.push(`额外网址 ${next}`)
        else url = next
        return
      }
      case '-G': case '--get':
        useGet = true
        return
      case '-I': case '--head':
        useHead = true
        return
      case '-k': case '--insecure':
        ignoredOptions.push(`${option}（客户端仍会校验 HTTPS 证书）`)
        return
      default:
        if (HARMLESS_FLAGS.has(option)) return
        if (IGNORED_VALUE_OPTIONS.has(option)) {
          requireValue()
          ignoredOptions.push(option)
          return
        }
        ignoredOptions.push(option)
    }
  }

  const takesValue = (option: string): boolean =>
    IGNORED_VALUE_OPTIONS.has(option) ||
    ['-X', '--request', '-H', '--header', '-d', '--data', '--data-ascii', '--data-binary', '--data-raw',
      '--data-urlencode', '--json', '-b', '--cookie', '-u', '--user', '--oauth2-bearer', '-A', '--user-agent',
      '-e', '--referer', '--url'].includes(option) ||
    option in UNSUPPORTED_OPTIONS

  for (let i = startIdx; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.startsWith('--') && token.length > 2) {
      applyOption(token, takesValue(token) ? tokens[++i] : undefined)
      continue
    }
    if (token.startsWith('-') && token.length > 1) {
      // 短选项可以合写（如 -sSL、-XPOST、-sX POST）：遇到要参数的选项时，剩余部分或下一个参数就是它的值
      const cluster = token.slice(1)
      for (let j = 0; j < cluster.length; j++) {
        const letter = cluster[j]
        if (SHORT_VALUE_OPTIONS.has(letter)) {
          const rest = cluster.slice(j + 1)
          applyOption(`-${letter}`, rest ? rest : tokens[++i])
          break
        }
        if (!SHORT_FLAGS.has(letter) && cluster.length > 1) {
          ignoredOptions.push(`-${letter}`)
          continue
        }
        applyOption(`-${letter}`, undefined)
      }
      continue
    }
    if (url) ignoredOptions.push(`额外网址 ${token}`)
    else url = token
  }

  if (!url) {
    throw new Error('MISSING_TARGET_URL: 未能在 cURL 命令中识别出合法的 http/https URL')
  }
  url = normalizeTargetUrl(url)

  let body = bodyParts.length > 0 ? bodyParts.join('&') : undefined
  if (jsonBody) {
    if (!hasHeader(headers, 'Content-Type')) headers['Content-Type'] = 'application/json'
    if (!hasHeader(headers, 'Accept')) headers['Accept'] = 'application/json'
  }
  if (useGet) {
    // -G：把 -d 的内容拼到网址查询串里，按 GET 发送
    if (body !== undefined) {
      const hashIdx = url.indexOf('#')
      const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url
      url = `${base}${base.includes('?') ? '&' : '?'}${body}`
    }
    body = undefined
  }
  if (!method) {
    method = useHead ? 'HEAD' : useGet ? 'GET' : body !== undefined ? 'POST' : 'GET'
  }

  return {
    method,
    url,
    headers,
    body,
    cookies,
    rawCommand: trimmed,
    ignoredOptions,
  }
}

export function generateCodeFromCurl(parsed: ParsedCurlRequest, lang: CodeTargetLang): string {
  const hasHeaders = Object.keys(parsed.headers).length > 0

  if (lang === 'fetch') {
    const options: Record<string, unknown> = {
      method: parsed.method,
    }
    if (hasHeaders) {
      options.headers = parsed.headers
    }
    if (parsed.body !== undefined) {
      options.body = parsed.body
    }
    return `const response = await fetch(${JSON.stringify(parsed.url)}, ${JSON.stringify(
      options,
      null,
      2,
    )});\nconst data = await response.text();\nconsole.log(response.status, data);`
  }

  if (lang === 'axios') {
    const config: Record<string, unknown> = {
      method: parsed.method.toLowerCase(),
      url: parsed.url,
    }
    if (hasHeaders) {
      config.headers = parsed.headers
    }
    if (parsed.body !== undefined) {
      try {
        config.data = JSON.parse(parsed.body)
      } catch {
        config.data = parsed.body
      }
    }
    return `import axios from 'axios';\n\nconst response = await axios(${JSON.stringify(
      config,
      null,
      2,
    )});\nconsole.log(response.status, response.data);`
  }

  if (lang === 'python') {
    const lines: string[] = ['import requests', '']
    lines.push(`url = ${JSON.stringify(parsed.url)}`)
    if (hasHeaders) {
      lines.push(`headers = ${JSON.stringify(parsed.headers, null, 2)}`)
    }
    if (parsed.body !== undefined) {
      lines.push(`payload = ${JSON.stringify(parsed.body)}`)
    }
    const args: string[] = [`${ JSON.stringify(parsed.method) }`, 'url']
    if (hasHeaders) args.push('headers=headers')
    if (parsed.body !== undefined) args.push('data=payload')
    lines.push(`response = requests.request(${args.join(', ')})`)
    lines.push('print(response.status_code, response.text)')
    return lines.join('\n')
  }

  const goLines: string[] = [
    'package main',
    '',
    'import (',
    '  "fmt"',
    '  "io"',
    '  "net/http"',
    ...(parsed.body !== undefined ? ['  "strings"'] : []),
    ')',
    '',
    'func main() {',
  ]
  if (parsed.body !== undefined) {
    goLines.push(`  bodyReader := strings.NewReader(${JSON.stringify(parsed.body)})`)
    goLines.push(
      `  req, err := http.NewRequest(${JSON.stringify(parsed.method)}, ${JSON.stringify(
        parsed.url,
      )}, bodyReader)`,
    )
  } else {
    goLines.push(
      `  req, err := http.NewRequest(${JSON.stringify(parsed.method)}, ${JSON.stringify(
        parsed.url,
      )}, nil)`,
    )
  }
  goLines.push('  if err != nil { panic(err) }')
  for (const [k, v] of Object.entries(parsed.headers)) {
    goLines.push(`  req.Header.Set(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
  }
  goLines.push('  resp, err := http.DefaultClient.Do(req)')
  goLines.push('  if err != nil { panic(err) }')
  goLines.push('  defer resp.Body.Close()')
  goLines.push('  raw, _ := io.ReadAll(resp.Body)')
  goLines.push('  fmt.Println(resp.StatusCode, string(raw))')
  goLines.push('}')
  return goLines.join('\n')
}

/** 由客户端网络层自动生成的连接类请求头：浏览器（如 Firefox）复制的 cURL 常带这些头，发送时去掉并告知用户 */
const AUTO_MANAGED_HEADERS = new Set(['connection', 'content-length', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding'])
/** 客户端不允许插件自定义、去掉后会改变请求含义的请求头 */
const CLIENT_FORBIDDEN_HEADERS = new Set(['host', 'proxy-authorization', 'upgrade'])
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/
const MAX_REQUEST_BODY_CHARS = 768 * 1024

/** 发送前整理请求头：去掉连接类请求头，客户端无法发送的请求头明确报错，不发出和原命令含义不同的请求。 */
export function prepareRequestHeaders(headers: Record<string, string>): { headers: Record<string, string>; ignoredHeaders: string[] } {
  const result: Record<string, string> = {}
  const ignoredHeaders: string[] = []
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (AUTO_MANAGED_HEADERS.has(lower)) {
      ignoredHeaders.push(name)
      continue
    }
    if (CLIENT_FORBIDDEN_HEADERS.has(lower)) {
      throw new Error(`客户端不能自定义 ${name} 请求头，可复制生成的代码执行`)
    }
    if (!HEADER_NAME_PATTERN.test(name)) {
      throw new Error(`请求头名称无效：${name}`)
    }
    if (/[\r\n\0]/.test(value)) {
      throw new Error(`请求头 ${name} 的值含有换行或空字符`)
    }
    result[name] = value
  }
  return { headers: result, ignoredHeaders }
}

export async function executeCurlRequest(
  parsed: ParsedCurlRequest,
  options?: {
    timeoutMs?: number
    fetchImpl?: typeof fetch
  },
): Promise<HttpResponseSnapshot> {
  const timeoutMs = options?.timeoutMs ?? 10000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) {
    throw new Error('请求超时必须为 1–300000 毫秒')
  }
  if (parsed.body !== undefined && parsed.body.length > MAX_REQUEST_BODY_CHARS) {
    throw new Error(`请求体超过 ${MAX_REQUEST_BODY_CHARS / 1024} KB 上限，可复制生成的代码执行`)
  }
  const prepared = prepareRequestHeaders(parsed.headers)
  const request: ParsedCurlRequest = { ...parsed, headers: prepared.headers }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const resp = options?.fetchImpl ? await options.fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      signal: controller.signal,
    }) : await requestViaHost(request, timeoutMs)

    const rawText = await resp.text()
    const elapsedMs = Math.max(1, Date.now() - startedAt)
    const sizeBytes = new TextEncoder().encode(rawText).byteLength

    let bodyText = rawText
    let truncated = false
    let isJson = false
    if (sizeBytes > MAX_RESPONSE_BYTES) {
      truncated = true
      bodyText = `${rawText.slice(0, 65536)}\n\n... [响应体超过 5MB 上限 (${sizeBytes} bytes)，只显示前 65536 个字符]`
    } else {
      try {
        const parsedJson = JSON.parse(rawText)
        bodyText = JSON.stringify(parsedJson, null, 2)
        isJson = true
      } catch {
        bodyText = rawText
      }
    }

    const responseHeaders: Record<string, string> = {}
    resp.headers.forEach((val, key) => {
      responseHeaders[key] = val
    })

    return {
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText || (resp.ok ? 'OK' : 'Error'),
      elapsedMs,
      sizeBytes,
      truncated,
      isJson,
      responseHeaders,
      ignoredHeaders: prepared.ignoredHeaders,
      bodyText,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`HTTP_TIMEOUT: 请求在 ${timeoutMs}ms 内未响应已超时中断`)
    }
    throw new Error(`HTTP_REQUEST_FAILED: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
}
