import { runRegexMatch } from './regex-engine.js'
import type { RegexMatchResult } from './types.js'

interface MatchWorker {
  onmessage: ((event: MessageEvent<RegexMatchResult>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(data: string[]): void
  terminate(): void
}
export interface RegexWorkerOptions {
  signal?: AbortSignal
  timeoutMs?: number
  createWorker?: (source: string) => { worker: MatchWorker; dispose: () => void }
}

function browserWorker(source: string) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  try {
    const worker = new Worker(url)
    return { worker, dispose: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

/** 仅序列化本地固定算法，用户输入通过结构化消息传递，不作为代码拼接。 */
export function runRegexInWorker(pattern: string, text: string, options: RegexWorkerOptions = {}): Promise<RegexMatchResult> {
  return new Promise(resolve => {
    let handle: ReturnType<NonNullable<RegexWorkerOptions['createWorker']>> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const failure = (errorMessage: string): RegexMatchResult => ({ isValidRegex: false, errorMessage, totalMatches: 0, elapsedMs: 0, matches: [] })
    const finish = (result: RegexMatchResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', cancel)
      if (handle) {
        handle.worker.onmessage = null
        handle.worker.onerror = null
        handle.worker.terminate()
        handle.dispose()
      }
      resolve(result)
    }
    const cancel = () => finish(failure('匹配已取消'))
    if (options.signal?.aborted) { cancel(); return }
    if (pattern.length > 2000 || text.length > 50_000) {
      finish(failure('正则不能超过 2000 个字符，待测文本不能超过 50000 个字符'))
      return
    }
    // 编译后的函数没有外部依赖，浏览器与测试环境执行同一份算法。
    const source = `self.onmessage = ({ data }) => self.postMessage((${runRegexMatch.toString()})(...data));`
    try {
      handle = (options.createWorker ?? browserWorker)(source)
      handle.worker.onmessage = event => finish(event.data)
      handle.worker.onerror = event => finish(failure(`匹配线程失败：${event.message}`))
      options.signal?.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => finish(failure('匹配超过 1 秒，已停止。请简化正则或缩短待测文本')), options.timeoutMs ?? 1000)
      handle.worker.postMessage([pattern, text])
    } catch (error) {
      finish(failure(`无法启动正则匹配：${error instanceof Error ? error.message : String(error)}`))
    }
  })
}
