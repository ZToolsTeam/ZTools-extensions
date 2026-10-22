// 独立窗口带状态：当前算式与历史随弹出带到新窗口；历史以插件存储为准，坏数据不进界面
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderDeclarativeRoot } from '@ztools/declarative-ui'
import { createHost, tick } from '../../shared/test-harness.mjs'
import CalculatorCommand from '../dist/index.js'

const HISTORY_KEY = 'ztools-calculator-history-v1'
const host = createHost()
test.beforeEach(() => host.reset())
const seedStorage = (items) => host.storage.set(HISTORY_KEY, JSON.stringify(items))
const stored = () => JSON.parse(host.storage.get(HISTORY_KEY) || '[]')

// ---- 模拟宿主的「弹出独立窗口」交接（与 frontend popoutHandoff 一致：只收纯 JSON，路径另行转交授权）----

function descriptors(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => descriptors(n, out))
  else if (node && typeof node === 'object') {
    if (typeof node.type === 'string') out.push(node)
    for (const v of [node.children, ...Object.values(node.props || {})]) if (v && typeof v === 'object') descriptors(Array.isArray(v) ? v : v.type ? v : v.items, out)
  }
  return out
}

/** 按宿主方式挂载根页面；handoffSeed 是独立窗口交接来的初值 */
async function openWindow(Command, handoffSeed) {
  const root = renderDeclarativeRoot(() => Command(), handoffSeed === undefined ? undefined : { handoffSeed })
  await tick(20)
  const win = {
    tree: () => root.forceRender(),
    all: (type) => descriptors(win.tree()).filter((n) => n.type === type),
    async act(title) {
      const a = descriptors(win.tree()).find((n) => n.type.startsWith('Action') && !n.type.startsWith('ActionPanel') && typeof n.props?.title === 'string' && n.props.title.startsWith(title))
      if (!a) throw new Error(`找不到动作「${title}」`)
      await a.props.onAction?.()
      await a.props.onSubmit?.({})
      await tick(20)
    },
    /** 收集根页面状态并按 JSON 往返，返回新窗口的初值、要转交授权的路径与被拒绝的 key */
    popout() {
      const { entries, rejected } = root.collectPopoutState()
      const values = Object.fromEntries(entries.map((e) => [e.key, e.value]))
      const seed = JSON.parse(JSON.stringify(values))
      assert.deepEqual(seed, values, '交接的值必须是纯 JSON，否则宿主会整项拒绝')
      return { seed, rejected, paths: entries.flatMap((e) => e.paths) }
    },
    unmount: () => root.unmount()
  }
  return win
}

const HISTORY = [
  { id: 'h-pin', expression: '2^16', answer: '65,536', type: 'math', pinned: true, timestamp: 3 },
  { id: 'h-1', expression: '10km to miles', answer: '6.2137 miles', type: 'unit', pinned: false, timestamp: 2 }
]
const ids = (win) => win.all('List.Item').map((i) => i.props.id)

test('弹出闭环：当前算式与历史带到新窗口，结果一致，新窗口首帧就显示历史', async () => {
  seedStorage(HISTORY)
  const old = await openWindow(CalculatorCommand)
  old.tree().props.onSearchTextChange('1024 * 768')
  await tick()
  const answer = old.all('List.Item').find((i) => i.props.id === 'calc-success').props.title
  const { seed, rejected, paths } = old.popout()
  assert.equal(seed.searchText, '1024 * 768')
  assert.deepEqual(seed.history, HISTORY)
  assert.deepEqual(rejected, [])
  assert.deepEqual(paths, [])
  old.unmount()

  // 首帧（存储还没读回来）就用带来的历史渲染
  const firstRoot = renderDeclarativeRoot(() => CalculatorCommand(), { handoffSeed: seed })
  const first = firstRoot.getLatest()
  firstRoot.unmount()
  const firstIds = descriptors(first).filter((n) => n.type === 'List.Item').map((n) => n.props.id)
  assert.ok(firstIds.includes('h-pin') && firstIds.includes('h-1'), firstIds.join(','))

  const win = await openWindow(CalculatorCommand, seed)
  assert.equal(win.tree().props.searchText, '1024 * 768')
  assert.equal(win.all('List.Item').find((i) => i.props.id === 'calc-success').props.title, answer)
  assert.ok(ids(win).includes('h-pin') && ids(win).includes('h-1'))
})

test('历史以插件存储为准：带来的历史比存储旧时，读到存储后改用存储的内容', async () => {
  seedStorage([HISTORY[1]])
  const win = await openWindow(CalculatorCommand, { searchText: '', history: HISTORY })
  assert.ok(!ids(win).includes('h-pin'), '另一个窗口已删掉的历史不能被独立窗口复活')
  assert.ok(ids(win).includes('h-1'))
  await win.act('置顶此算式')
  assert.equal(stored().find((i) => i.id === 'h-1').pinned, true)
})

test('[异常] 带来的历史里有不合法的项（旧版本形状、篡改）：整份不用，不崩溃，以存储为准', async () => {
  seedStorage(HISTORY)
  const badHistories = [
    [{ ...HISTORY[0], type: 'evil' }],
    [{ ...HISTORY[0], id: 1 }],
    [{ ...HISTORY[0], timestamp: '3' }],
    [{ ...HISTORY[0], pinned: 'yes' }],
    [null],
    { 0: HISTORY[0] },
    'h-pin'
  ]
  for (const history of badHistories) {
    // 首帧不能拿坏数据渲染（type 不是字符串会让 toUpperCase 崩溃）
    const firstRoot = renderDeclarativeRoot(() => CalculatorCommand(), { handoffSeed: { searchText: 42, history } })
    const first = firstRoot.getLatest()
    firstRoot.unmount()
    assert.ok(!descriptors(first).some((n) => n.type === 'List.Item' && n.props.id === 'h-pin'), JSON.stringify(history))
    const win = await openWindow(CalculatorCommand, { searchText: 42, history })
    assert.equal(win.tree().props.searchText, '')
    assert.ok(ids(win).includes('h-pin'), '读到存储后历史照常显示')
    win.unmount()
  }
})

test('[故障注入] 存储读取失败：带来的算式照常可算，保存历史如实报错、不假装成功', async () => {
  host.faults.storageRead = new Error('磁盘错误')
  const win = await openWindow(CalculatorCommand, { searchText: '2+2', history: HISTORY })
  assert.equal(win.tree().props.searchText, '2+2')
  await win.act('保存到历史算式')
  assert.match(String(host.lastToast().title), /历史记录保存失败/)
})
