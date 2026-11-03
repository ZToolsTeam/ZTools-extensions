import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { parseAndExplainCron } from '../dist/regex-cron-service.js'

const base = new Date(2026, 9, 25, 0, 0, 0)

test('完整字段校验拒绝空列表项、科学计数、重复分隔符和非法问号', () => {
  for (const expression of ['0, * * * *', ',0 * * * *', '1e1 * * * *', '+1 * * * *', '0xA * * * *', '*/2/3 * * * *', '1-2-3 * * * *', '/5 * * * *', '*/0 * * * *', '? * * * *', '0 0 ? * *', '0 0 0 ?/2 * MON', '0 0 0 L * ?']) {
    const result = parseAndExplainCron(expression, base)
    assert.equal(result.isValid, false, expression)
    assert.deepEqual(result.nextRuns, [], expression)
  }
  assert.equal(parseAndExplainCron('0 0 0 ? * MON', base).isValid, true)
  assert.equal(parseAndExplainCron('*/60 * * * *', base).nextRuns[0].formattedTime, '2026-10-25 01:00:00')
})

test('五位日期与星期用OR，六位Spring同时匹配，通配步长不可错误放宽', () => {
  assert.equal(parseAndExplainCron('0 0 1 * MON', base).nextRuns[0].formattedTime, '2026-10-26 00:00:00')
  const spring = parseAndExplainCron('0 0 0 1 * MON', base)
  assert.equal(spring.nextRuns[0].formattedTime, '2027-02-01 00:00:00')
  assert.ok(spring.nextRuns.every(run => new Date(run.timestamp).getDate() === 1 && new Date(run.timestamp).getDay() === 1))
  assert.match(spring.chineseSummary, /且/)
  const or = parseAndExplainCron('0 0 31 2 MON', new Date(2026, 0, 31))
  assert.equal(or.isValid, true)
  assert.equal(or.nextRuns[0].formattedTime, '2026-02-02 00:00:00')
  assert.match(or.chineseSummary, /或/)
  assert.equal(parseAndExplainCron('0 0 */2 * MON', base).nextRuns[0].formattedTime, '2026-11-09 00:00:00')
})

test('月份星期别名、范围列表、闰年和非法月日均按真实日历推算', () => {
  const named = parseAndExplainCron('0,30 9-10 * JAN MON-FRI', new Date(2026, 11, 31))
  assert.deepEqual(named.nextRuns.slice(0, 4).map(r => r.formattedTime), ['2027-01-01 09:00:00', '2027-01-01 09:30:00', '2027-01-01 10:00:00', '2027-01-01 10:30:00'])
  assert.equal(parseAndExplainCron('0 0 29 2 *', base).nextRuns[0].formattedTime, '2028-02-29 00:00:00')
  assert.equal(parseAndExplainCron('0 0 30 2 *', base).isValid, false)
  assert.equal(parseAndExplainCron('0 0 0 31 2 MON', base).isValid, false)
  const complex = parseAndExplainCron('0,30 9 * * *', base)
  assert.equal(complex.chineseSummary, '9 点的第 0,30 分执行')
  assert.doesNotMatch(complex.chineseSummary, /09:00:00/)
})

test('Linux混合通配列表按首字符决定日周关系，列表顺序不被抹平', () => {
  assert.equal(parseAndExplainCron('0 0 1,*/2 * MON', base).nextRuns[0].formattedTime, '2026-10-26 00:00:00')
  assert.equal(parseAndExplainCron('0 0 */2,1 * MON', base).nextRuns[0].formattedTime, '2026-11-09 00:00:00')
  assert.equal(parseAndExplainCron('5/10 * * * *', base).isValid, false)
  assert.equal(parseAndExplainCron('0 5/10 * * * *', base).nextRuns[0].formattedTime, '2026-10-25 00:05:00')
})

test('Linux与Spring周日范围和步长起点按各自方言处理', () => {
  for (const range of ['MON-SUN', 'SUN-SAT']) {
    assert.equal(parseAndExplainCron(`0 0 * * ${range}`, base).nextRuns[0].formattedTime, '2026-10-26 00:00:00')
    assert.equal(parseAndExplainCron(`0 0 0 * * ${range}`, base).nextRuns[0].formattedTime, '2026-10-26 00:00:00')
  }
  assert.equal(parseAndExplainCron('0 0 * * 5-0', base).nextRuns[0].formattedTime, '2026-10-30 00:00:00')
  assert.equal(parseAndExplainCron('0 0 0 * * 5-0', base).isValid, false)
  assert.equal(parseAndExplainCron('0 0 * * */2', base).nextRuns[0].formattedTime, '2026-10-27 00:00:00')
  assert.equal(parseAndExplainCron('0 0 0 * * */2', base).nextRuns[0].formattedTime, '2026-10-26 00:00:00')
  assert.equal(parseAndExplainCron('0 0 * * 7-6', base).isValid, false)
  assert.equal(parseAndExplainCron('0 0 0 * * 7-6', base).nextRuns[0].formattedTime, '2026-10-26 00:00:00')
})

function inZone(zone, expression, isoDate, count = 3) {
  const script = `import {parseAndExplainCron} from ${JSON.stringify(new URL('../dist/regex-cron-service.js', import.meta.url).href)}; console.log(JSON.stringify(parseAndExplainCron(${JSON.stringify(expression)}, new Date(${JSON.stringify(isoDate)}), ${count})))`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 5000 })
  assert.equal(child.status, 0, child.stderr)
  return JSON.parse(child.stdout)
}

test('夏令时回拨重复时刻各命中一次，春季不存在的时刻跳过', () => {
  const fall = inZone('America/New_York', '30 1 * * *', '2026-11-01T04:59:59Z')
  assert.equal(fall.timeZone, 'America/New_York')
  assert.deepEqual(fall.nextRuns.map(r => new Date(r.timestamp).toISOString()), ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z', '2026-11-02T06:30:00.000Z'])
  assert.deepEqual(fall.nextRuns.map(r => r.utcOffset), ['UTC-04:00', 'UTC-05:00', 'UTC-05:00'])
  const spring = inZone('America/New_York', '30 2 * * *', '2026-03-08T05:00:00Z', 1)
  assert.equal(new Date(spring.nextRuns[0].timestamp).toISOString(), '2026-03-09T06:30:00.000Z')
})

test('半小时夏令时回拨和非整点时区不漏掉下一次执行', () => {
  const halfHour = inZone('Australia/Lord_Howe', '45 1 * * *', '2026-04-04T14:29:59Z', 2)
  assert.deepEqual(halfHour.nextRuns.map(r => new Date(r.timestamp).toISOString()), ['2026-04-04T14:45:00.000Z', '2026-04-04T15:15:00.000Z'])
  assert.deepEqual(halfHour.nextRuns.map(r => r.utcOffset), ['UTC+11:00', 'UTC+10:30'])
  const quarter = inZone('Asia/Kathmandu', '*/15 * * * *', '2026-10-25T00:00:00Z', 1)
  assert.equal(new Date(quarter.nextRuns[0].timestamp).toISOString(), '2026-10-25T00:15:00.000Z')
  assert.equal(quarter.nextRuns[0].utcOffset, 'UTC+05:45')
})

test('无效起算日期与异常次数不返回成功或部分结果', () => {
  assert.equal(parseAndExplainCron('* * * * *', new Date(NaN)).isValid, false)
  for (const count of [0, -1, 0.5, 51, Infinity]) {
    const result = parseAndExplainCron('* * * * *', base, count)
    assert.equal(result.isValid, false)
    assert.deepEqual(result.nextRuns, [])
  }
})

test('常见写法翻译成自然语句，五位表达式不提秒', () => {
  const cases = [
    ['*/15 * * * *', '每 15 分钟执行'],
    ['* * * * *', '每分钟执行'],
    ['30 * * * *', '每小时第 30 分执行'],
    ['0 */2 * * *', '每 2 小时的第 0 分执行'],
    ['*/10 9 * * *', '9 点内每 10 分钟执行'],
    ['0 9 * * *', '每天 09:00 执行'],
    ['0 0 2 * * ?', '每天 02:00:00 执行'],
    ['*/5 * * * * *', '每 5 秒执行'],
    ['0 */15 * * * *', '每 15 分钟执行'],
    ['10 */15 * * * *', '每 15 分钟的第 10 秒执行'],
    ['0 30 9 ? * MON-FRI', '（星期 MON-FRI） 09:30:00 执行'],
    ['*/15 * 1 * *', '（日期 1），每 15 分钟执行']
  ]
  for (const [expression, expected] of cases) assert.equal(parseAndExplainCron(expression, base).chineseSummary, expected, expression)
  for (const expression of ['*/15 * * * *', '0 9 * * *', '30 * * * *']) assert.doesNotMatch(parseAndExplainCron(expression, base).chineseSummary, /秒/, expression)
})

test('字段错误提示与字段说明不带英文括注', () => {
  const bad = parseAndExplainCron('61 * * * *', base)
  assert.match(bad.errorMessage, /字段 \[分钟\]/)
  assert.doesNotMatch(bad.errorMessage, /Minute/)
  const ok = parseAndExplainCron('*/15 * * * *', base)
  assert.deepEqual(ok.slots.map(s => s.name), ['分钟', '小时', '日期', '月份', '星期'])
  assert.equal(ok.slots[0].meaning, '每隔 15 分钟触发')
})
