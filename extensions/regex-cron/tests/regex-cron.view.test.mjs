import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { RegexCronCommand, commands } from '../dist/index.js'
import { BrowserWorker, activeWorkers, waitUntil } from './worker-harness.mjs'

const host = createHost()
globalThis.Worker = BrowserWorker
test.beforeEach(() => host.reset())
const settled = view => waitUntil(() => !view.tree().props.isLoading)

test('字典加载单条有效示例，用户可通过表单编辑多行待测文本并复制真实命中', async () => {
  const view = await mount(RegexCronCommand)
  let form
  try {
    await view.run(view.item('ipv4-strict'), '载入到实时正则测试器')
    await settled(view)
    assert.match(view.text(), /共命中 1/)
    await view.run(view.item('tester-summary'), '编辑待测文本…')
    form = await mountPushed(host)
    await form.fill('sample', 'foo 中文1\nfoo 中文2')
    await form.run(null, '开始匹配')
    form.unmount(); form = null
    assert.equal(host.pushed.length, 0)
    await view.search('/中文(\\d)/g')
    await settled(view)
    assert.match(view.text(), /共命中 2/)
    await view.run(view.item('tester-summary'), '复制全部命中结果')
    assert.equal(host.clipboard.text, '中文1\n中文2')
  } finally { form?.unmount(); view.unmount() }
})

test('模式查询分别保留，输入修改后立即隐藏旧命中，非法输入不能复制过期结果', async () => {
  const view = await mount(() => RegexCronCommand({ initialMode: 'tester', initialSearchText: '/a/g', initialTestSample: 'aaa' }))
  try {
    await settled(view)
    assert.match(view.text(), /共命中 3/)
    await view.dropdown('cron')
    assert.equal(view.tree().props.searchText, '*/15 * * * *')
    await view.search('60 * * * *')
    assert.ok(!view.actions(view.item('cron-live-result')).some(a => a.props.title.includes('未来')))
    await view.dropdown('tester')
    assert.equal(view.tree().props.searchText, '/a/g')
    await view.search('(')
    assert.doesNotMatch(view.text(), /共命中 3/)
    await settled(view)
    assert.match(view.text(), /Unterminated|Invalid regular/)
    assert.ok(!view.actions(view.item('tester-summary')).some(a => a.props.title === '复制全部命中结果'))
  } finally { view.unmount() }
})

test('取消编辑不修改样本；离开界面中止真实Worker，迟到结果不回写', async () => {
  const view = await mount(() => RegexCronCommand({ initialMode: 'tester', initialSearchText: '中', initialTestSample: '中文' }))
  await settled(view)
  await view.run(view.item('tester-summary'), '编辑待测文本…')
  const form = await mountPushed(host)
  await form.fill('sample', '取消内容')
  form.unmount(); host.pushed.pop()
  assert.doesNotMatch(view.text(), /取消内容/)
  await view.search('^(a|aa)+$')
  view.unmount()
  await tick()
  await waitUntil(() => activeWorkers.size === 0)
})

 test('清单功能码入口进入对应模式，不依赖宿主传入组件属性', async () => {
  for (const [code, mode] of [['regex-dict', 'dict'], ['regex-tester', 'tester'], ['cron-explainer', 'cron']]) {
    const view = await mount(commands[code])
    try { assert.equal(view.tree().props.searchBarAccessory.props.value, mode) }
    finally { view.unmount() }
  }
})

test('Cron返回页面和手动刷新以当前时刻重算，复制结果含时区偏移', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 25, 16, 31, 0).getTime() })
  const view = await mount(commands['cron-explainer'])
  try {
    assert.match(view.text(), /2026-10-25 16:45:00/)
    await view.dropdown('dict')
    t.mock.timers.setTime(new Date(2026, 9, 25, 18, 31, 0).getTime())
    await view.dropdown('cron')
    assert.match(view.text(), /2026-10-25 18:45:00/)
    assert.doesNotMatch(view.text(), /2026-10-25 16:45:00/)
    t.mock.timers.setTime(new Date(2026, 9, 25, 19, 31, 0).getTime())
    view.tree().props.filterBar.actions[0].onAction()
    await tick()
    assert.match(view.text(), /计算起点 2026-10-25 19:31:00/)
    await view.run(view.item('cron-live-result'), '复制未来 5 次执行时间')
    assert.match(host.clipboard.text, /^2026-10-25 19:45:00 UTC[+-]\d{2}:\d{2}/)
  } finally { view.unmount() }
})
