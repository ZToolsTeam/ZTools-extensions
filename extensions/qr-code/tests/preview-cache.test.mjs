// 预览缓存：历史较多时逐字输入不再为全部匹配项重新编码（qr-code-v1）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import QrCodeCommand, { previewMarkdown, getPreviewCacheStats, resetPreviewCache } from '../dist/index.js'
import { generateQrSvg } from '../dist/qr-generator.js'

const host = createHost()
test.beforeEach(() => {
  host.reset()
  resetPreviewCache()
})

const url = (n) => `https://example.com/docs/page-${n}?ref=${'q'.repeat(150)}&n=${n}`
const seed = (count) => {
  const items = Array.from({ length: count }, (_, n) => ({ id: `qr_${n}`, title: url(n).slice(0, 40), content: url(n), level: 'M', createdAt: '2026/10/22 10:00:00' }))
  host.storage.set('ztools_qr_history', JSON.stringify(items))
  return items
}
const markdownOf = (item) => item.props.detail.props.markdown

test('[集成] 100 条历史逐字输入：每个历史项只编码一次，每次按键只为新输入编码', async () => {
  seed(100)
  const view = await mount(QrCodeCommand)
  await tick(10)
  // 首屏：100 条历史各编码一次
  assert.equal(getPreviewCacheStats().entries, 100)
  let s = ''
  for (const ch of 'https') {
    s += ch
    await view.search(s)
    // 视图里 100 条历史都匹配并带预览
    assert.equal(view.items().filter((it) => it.props.id.startsWith('qr_')).length, 100)
  }
  // 5 次按键（期间多次重新渲染）只新增 5 个当前输入的预览，历史项全部命中缓存
  assert.equal(getPreviewCacheStats().entries, 105)
  // 缓存内容与直接生成完全一致（缓存不能改变显示结果）
  const hist = view.item('qr_42')
  assert.ok(markdownOf(hist).includes(generateQrSvg(url(42), 'M').dataUrl))
  assert.match(markdownOf(hist), /网址 · \d+ 字节 · 版本 \d+/)
  view.unmount()
})

test('[集成] 有缓存时逐字输入明显快于每次重新编码', async () => {
  seed(100)
  const view = await mount(QrCodeCommand)
  await tick(10)
  const measure = async (text, reset) => {
    if (reset) resetPreviewCache()
    const t = performance.now()
    await view.search(text)
    return performance.now() - t
  }
  // 预热一次 JIT
  await measure('h', false)
  const cold = []
  const warm = []
  for (const text of ['ht', 'htt', 'http']) cold.push(await measure(text, true))
  for (const text of ['https', 'https:', 'https:/']) warm.push(await measure(text, false))
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length
  assert.ok(avg(warm) * 3 < avg(cold), `有缓存 ${avg(warm).toFixed(1)}ms，无缓存 ${avg(cold).toFixed(1)}ms`)
  view.unmount()
})

test('纠错等级是缓存键的一部分：切换等级重新编码，历史项保持各自等级', async () => {
  seed(3)
  const view = await mount(QrCodeCommand)
  await tick(10)
  await view.search('https://ztools.cn')
  const m = markdownOf(view.item('live'))
  assert.match(m, /纠错 中（15%）/)
  await view.dropdown('H')
  const h = markdownOf(view.item('live'))
  assert.match(h, /纠错 高（30%）/)
  assert.notEqual(h, m)
  // 历史项按自己保存的等级显示，不随下拉框变化
  await view.search('')
  assert.match(markdownOf(view.item('qr_0')), /纠错 中（15%）/)
  // 3 条历史 + 当前输入的 M / H 两份
  assert.equal(getPreviewCacheStats().entries, 5)
  view.unmount()
})

test('[异常] 超出容量的内容：错误结果同样缓存，反复渲染仍显示出错提示且不抛异常', async () => {
  const view = await mount(QrCodeCommand)
  const big = 'x'.repeat(3000)
  await view.dropdown('H')
  await view.search(big)
  const err = view.item('live-error')
  assert.match(err.props.title, /超出二维码最大容量/)
  const before = getPreviewCacheStats().entries
  await view.search(big + 'y')
  await view.search(big)
  assert.match(view.item('live-error').props.title, /超出二维码最大容量/)
  // big 命中缓存，只新增 big + 'y' 一条（输入会先去掉首尾空白）
  assert.equal(getPreviewCacheStats().entries, before + 1)
  // 改成低纠错后容量够用，能正常生成
  await view.search('x'.repeat(2900))
  await view.dropdown('L')
  assert.ok(view.item('live').props.detail.props.markdown.includes('data:image/svg+xml'))
  view.unmount()
})

test('[边界] 缓存条数有上限，淘汰最久未用的条目；淘汰后再次访问能重新生成正确结果', () => {
  for (let i = 0; i < 400; i++) previewMarkdown(`item-${i}`, 'M')
  const { entries } = getPreviewCacheStats()
  assert.equal(entries, 160)
  // 最近用过的条目保留：访问 item-250 使其变为最新，再写入 159 条新内容后它仍在
  previewMarkdown('item-250', 'M')
  for (let i = 0; i < 159; i++) previewMarkdown(`fresh-${i}`, 'M')
  const statsBefore = getPreviewCacheStats().entries
  previewMarkdown('item-250', 'M')
  assert.equal(getPreviewCacheStats().entries, statsBefore, 'item-250 应命中缓存')
  // 早已被淘汰的 item-0 重新生成，结果与直接编码一致
  const p = previewMarkdown('item-0', 'M')
  assert.equal(p.ok, true)
  assert.ok(p.markdown.includes(generateQrSvg('item-0', 'M').dataUrl))
})

test('[边界] 大尺寸二维码受字符预算限制，不会无限占用内存', () => {
  // 第 40 版二维码单条预览约 26 万字符，100 条约 2600 万字符，超过 1600 万的预算
  for (let i = 0; i < 100; i++) {
    const r = previewMarkdown(`${String(i).padStart(3, '0')}${'x'.repeat(2890)}`, 'L')
    assert.equal(r.ok, true)
  }
  const { entries, chars } = getPreviewCacheStats()
  assert.ok(chars <= 16 * 1024 * 1024, `缓存 ${chars} 字符超出预算`)
  assert.ok(entries < 100 && entries > 0, `条目数 ${entries}`)
  // 单条超过预算时至少保留它自己，调用方仍拿到结果
  resetPreviewCache()
  const r = previewMarkdown('y'.repeat(2900), 'L')
  assert.equal(r.ok, true)
  assert.equal(getPreviewCacheStats().entries, 1)
})

test('[故障注入] 历史存储读取失败：提示失败，界面仍可实时生成且缓存正常', async () => {
  host.faults.storageRead = new Error('磁盘错误')
  const view = await mount(QrCodeCommand)
  await tick(10)
  assert.match(String(host.lastToast()?.title), /读取历史失败/)
  await view.search('hello')
  assert.ok(view.item('live').props.detail.props.markdown.includes('data:image/svg+xml'))
  assert.equal(getPreviewCacheStats().entries, 1)
  view.unmount()
})
