import type { RegexMatchResult } from './types.js'

/** 纯匹配算法；生产入口只能在可终止的 Worker 中执行，不能直接放进界面渲染。 */
export function runRegexMatch(rawInput: string, testText: string, defaultFlags = 'g'): RegexMatchResult {
  const started = performance.now()
  const result: RegexMatchResult = { isValidRegex: false, totalMatches: 0, elapsedMs: 0, matches: [] }
  try {
    const input = String(rawInput ?? '').trim()
    const text = String(testText ?? '')
    if (!input) throw new Error('请输入待测试的正则表达式')
    if (input.length > 2000) throw new Error('正则表达式不能超过 2000 个字符')
    if (text.length > 50_000) throw new Error('待测文本不能超过 50000 个字符，请缩小测试范围')
    const slash = input.lastIndexOf('/')
    const literal = input.startsWith('/') && slash > 0
    const pattern = literal ? input.slice(1, slash) : input
    const flags = literal ? input.slice(slash + 1) : defaultFlags
    // 先按用户修饰符编译，重复或非法修饰符必须报错，不能悄悄删除。
    const parsed = new RegExp(pattern, flags)
    const regex = new RegExp(parsed.source, parsed.flags + (parsed.hasIndices ? '' : 'd') + (parsed.global ? '' : 'g'))
    result.pattern = parsed.source
    result.flags = parsed.flags
    // 同时约束文本及对象开销，避免许多嵌套捕获组重复输出同一大段文本。
    let outputSize = 0
    const reserve = (value: string) => {
      outputSize += value.length + 64
      if (outputSize > 256_000) throw new Error('匹配结果过大，请减少捕获组或缩小待测文本')
    }
    // 标准迭代器自动处理 Unicode 和空匹配前进，无 g 时仍只保留第一次命中。
    for (const match of text.matchAll(regex)) {
      if (result.matches.length === 200) { result.truncated = true; break }
      reserve(match[0])
      const groups = []
      for (let i = 1; i < match.length; i++) {
        reserve(match[i] ?? '')
        const range = match.indices?.[i]
        groups.push({ groupIndex: i, value: match[i] ?? '', start: range?.[0] ?? -1, end: range?.[1] ?? -1 })
      }
      result.matches.push({ index: result.matches.length, text: match[0], start: match.index, end: match.index + match[0].length, groups })
      if (!parsed.global) break
    }
    result.isValidRegex = true
    result.totalMatches = result.matches.length
  } catch (error) {
    result.matches = []
    result.totalMatches = 0
    result.errorMessage = error instanceof Error ? error.message : String(error)
  }
  result.elapsedMs = Number((performance.now() - started).toFixed(2))
  return result
}
