import test from 'node:test'
import assert from 'node:assert/strict'
import { runRegexMatch } from '../dist/regex-engine.js'
import { runRegexInWorker } from '../dist/regex-worker.js'
import { parseAndExplainCron, REGEX_PRESETS } from '../dist/regex-cron-service.js'
import { BrowserWorker, activeWorkers, waitUntil } from './worker-harness.mjs'

globalThis.Worker = BrowserWorker

test('捕获组位置来自索引，重复子串、前瞻、未匹配组不靠字符串猜测', () => {
  const repeated = runRegexMatch('(a)(a)', 'xaa')
  assert.deepEqual(repeated.matches[0].groups.map(g => [g.start, g.end]), [[1, 2], [2, 3]])
  const ahead = runRegexMatch('(?=(中))', '中文')
  assert.deepEqual(ahead.matches[0].groups[0], { groupIndex: 1, value: '中', start: 0, end: 1 })
  assert.deepEqual(runRegexMatch('(a)?b', 'b').matches[0].groups[0], { groupIndex: 1, value: '', start: -1, end: -1 })
})

test('保留用户修饰符语义，无g只匹配一次，非法或重复flag明确报错', () => {
  assert.equal(runRegexMatch('/a/i', 'A a').totalMatches, 1)
  assert.equal(runRegexMatch('/a/gi', 'A a').totalMatches, 2)
  assert.equal(runRegexMatch('/a/y', 'ba').totalMatches, 0)
  for (const raw of ['/a/z', '/a/gg', '(']) assert.equal(runRegexMatch(raw, 'a').isValidRegex, false)
  assert.equal(runRegexMatch('/[a&&a]/v', 'a').totalMatches, 1)
})

test('空匹配不提前停止，Unicode按码点前进，结果超限显式标记且文本不偷偷截断', () => {
  assert.deepEqual(runRegexMatch('/(?=)/gu', '中😀').matches.map(m => m.start), [0, 1, 3])
  assert.equal(runRegexMatch('a', 'a'.repeat(200)).truncated, undefined)
  const overflow = runRegexMatch('a', 'a'.repeat(201))
  assert.equal(overflow.totalMatches, 200)
  assert.equal(overflow.truncated, true)
  assert.match(runRegexMatch('a', 'a'.repeat(50001)).errorMessage, /50000/)
})

test('真实线程正常计算后销毁；灾难性回溯超时终止，后续匹配仍能成功', async () => {
  const normal = await runRegexInWorker('(a)(a)', 'aa')
  assert.equal(normal.matches[0].groups[1].start, 1)
  const blocked = await runRegexInWorker('^(a|aa)+$', 'a'.repeat(10000) + '!')
  assert.match(blocked.errorMessage, /超过 1 秒/)
  assert.equal(blocked.matches.length, 0)
  const recovered = await runRegexInWorker('中文', '中文')
  assert.equal(recovered.totalMatches, 1)
  await waitUntil(() => activeWorkers.size === 0)
})

test('中止耗时匹配及线程启动失败均释放资源并返回明确错误', async () => {
  const controller = new AbortController()
  const pending = runRegexInWorker('^(a|aa)+$', 'a'.repeat(10000) + '!', { signal: controller.signal })
  controller.abort()
  assert.match((await pending).errorMessage, /已取消/)
  const failed = await runRegexInWorker('a', 'a', { createWorker() { throw new Error('worker unavailable') } })
  assert.match(failed.errorMessage, /worker unavailable/)
  await waitUntil(() => activeWorkers.size === 0)
})

test('Cron固定日期下计算15分钟间隔及非法分钟，不混用正则表达式', () => {
  const base = new Date(2026, 9, 25, 16, 31, 40)
  assert.deepEqual(parseAndExplainCron('*/15 * * * *', base).nextRuns.map(r => r.formattedTime), ['2026-10-25 16:45:00','2026-10-25 17:00:00','2026-10-25 17:15:00','2026-10-25 17:30:00','2026-10-25 17:45:00'])
  const invalid = parseAndExplainCron('60 * * * *', base)
  assert.equal(invalid.isValid, false)
  assert.equal(invalid.nextRuns.length, 0)
})

 test('限制嵌套捕获组累计结果，避免海量重复文本传回界面', async () => {
  const pattern = '(?=' + '('.repeat(20) + 'a+' + ')'.repeat(20) + ')'
  const result = await runRegexInWorker(pattern, 'a'.repeat(50000))
  assert.equal(result.isValidRegex, false)
  assert.match(result.errorMessage, /结果过大/)
  assert.equal(result.matches.length, 0)
  await waitUntil(() => activeWorkers.size === 0)
})

test('所有字典的通过和拒绝样例与实际正则一致', () => {
  for (const preset of REGEX_PRESETS) {
    const pattern = `/${preset.pattern}/${preset.recommendedFlags || ''}`
    for (const value of preset.validExamples) assert.equal(runRegexMatch(pattern, value).totalMatches, 1, preset.id)
    for (const value of preset.invalidExamples) assert.equal(runRegexMatch(pattern, value).totalMatches, 0, preset.id)
  }
})
