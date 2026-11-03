export type CodeTargetLang = 'fetch' | 'axios' | 'python' | 'go'

export interface ParsedCurlRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  cookies?: string
  rawCommand: string
  /** 命令里本插件没有生效的选项（如 -x 代理、-k 跳过证书校验），界面上如实列出 */
  ignoredOptions?: string[]
}

export interface HttpResponseSnapshot {
  ok: boolean
  status: number
  statusText: string
  elapsedMs: number
  sizeBytes: number
  truncated: boolean
  /** 正文是合法 JSON，已格式化 */
  isJson: boolean
  responseHeaders: Record<string, string>
  /** 发送前去掉的连接类请求头（由客户端网络层自动处理） */
  ignoredHeaders: string[]
  bodyText: string
}
