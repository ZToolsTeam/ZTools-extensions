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

export function tokenizeShellCommand(raw: string): string[] {
  const normalized = String(raw || '')
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/`\r?\n/g, ' ')
    .trim()

  const tokens: string[] = []
  let current = ''
  let quoteChar: "'" | '"' | null = null
  let escaped = false

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (escaped) {
      current += ch
      escaped = false
      continue
    }
    if (ch === '\\' && quoteChar !== "'") {
      escaped = true
      continue
    }
    if ((ch === "'" || ch === '"') && !quoteChar) {
      quoteChar = ch
      continue
    }
    if (ch === quoteChar) {
      quoteChar = null
      continue
    }
    if (/\s/.test(ch) && !quoteChar) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }

  if (quoteChar) {
    throw new Error(`UNCLOSED_QUOTE_IN_CURL: cURL 命令存在未闭合引号 (${quoteChar})`)
  }
  if (current.length > 0) {
    tokens.push(current)
  }
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

export function parseCurlCommand(rawInput: string): ParsedCurlRequest {
  const trimmed = String(rawInput || '').trim()
  if (!trimmed) {
    throw new Error('EMPTY_CURL_INPUT: cURL 命令或 URL 不能为空')
  }

  if (/^https?:\/\//i.test(trimmed) && !/\s/.test(trimmed)) {
    return {
      method: 'GET',
      url: trimmed,
      headers: {},
      rawCommand: `curl -X GET "${trimmed}"`,
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
  const headers: Record<string, string> = {}
  const bodyParts: string[] = []
  let cookies: string | undefined

  for (let i = startIdx; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '-X' || token === '--request') {
      const next = tokens[++i]
      if (!next) throw new Error('MISSING_CURL_METHOD: -X 参数后缺少 HTTP 方法')
      method = next.toUpperCase()
    } else if (token === '-H' || token === '--header') {
      const next = tokens[++i]
      if (!next) throw new Error('MISSING_CURL_HEADER: -H 参数后缺少 Header 内容')
      const colonIdx = next.indexOf(':')
      if (colonIdx > 0) {
        const key = next.slice(0, colonIdx).trim()
        const val = next.slice(colonIdx + 1).trim()
        headers[key] = val
      }
    } else if (
      token === '-d' ||
      token === '--data' ||
      token === '--data-raw' ||
      token === '--data-binary' ||
      token === '--data-urlencode'
    ) {
      const next = tokens[++i]
      if (typeof next !== 'string') {
        throw new Error(`MISSING_CURL_BODY: ${token} 参数后缺少请求体数据`)
      }
      bodyParts.push(next)
    } else if (token === '-b' || token === '--cookie') {
      const next = tokens[++i]
      if (!next) throw new Error('MISSING_CURL_COOKIE: -b 参数后缺少 Cookie 内容')
      cookies = next
      headers['Cookie'] = next
    } else if (token === '-u' || token === '--user') {
      const next = tokens[++i]
      if (!next) throw new Error('MISSING_CURL_USER: -u 参数后缺少认证信息')
      const encoded =
        typeof Buffer !== 'undefined' ? Buffer.from(next, 'utf8').toString('base64') : btoa(next)
      headers['Authorization'] = `Basic ${encoded}`
    } else if (token === '--url') {
      const next = tokens[++i]
      if (!next) throw new Error('MISSING_CURL_URL: --url 参数后缺少目标地址')
      url = next
    } else if (token.startsWith('http://') || token.startsWith('https://')) {
      url = token
    }
  }

  if (!url) {
    throw new Error('MISSING_TARGET_URL: 未能在 cURL 命令中识别出合法的 http/https URL')
  }

  const body = bodyParts.length > 0 ? bodyParts.join('&') : undefined
  if (!method) {
    method = body !== undefined ? 'POST' : 'GET'
  }

  return {
    method,
    url,
    headers,
    body,
    cookies,
    rawCommand: trimmed,
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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const resp = options?.fetchImpl ? await options.fetchImpl(parsed.url, {
      method: parsed.method,
      headers: parsed.headers,
      body: parsed.method === 'GET' || parsed.method === 'HEAD' ? undefined : parsed.body,
      signal: controller.signal,
    }) : await requestViaHost(parsed, timeoutMs)

    const rawText = await resp.text()
    const elapsedMs = Math.max(1, Date.now() - startedAt)
    const sizeBytes = new TextEncoder().encode(rawText).byteLength

    let bodyText = rawText
    let truncated = false
    if (sizeBytes > MAX_RESPONSE_BYTES) {
      truncated = true
      bodyText = `${rawText.slice(0, 65536)}\n\n... [响应体超过 5MB 上限 (${sizeBytes} bytes)，已安全截断保护渲染性能]`
    } else {
      try {
        const parsedJson = JSON.parse(rawText)
        bodyText = JSON.stringify(parsedJson, null, 2)
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
      responseHeaders,
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
