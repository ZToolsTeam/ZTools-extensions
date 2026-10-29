import assert from 'node:assert/strict'
import test from 'node:test'
import { getDeclarativeBridge } from '@ztools/declarative-ui/api'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Snippets, { commands } from '../dist/index.js'

const key = 'ztools.snippets.items.v1'
const fixture = (id, category = 'general') => ({ id, title: id, category, categoryLabel: category, content: '日期 {date} / {clipboard} / {cursor}结束', previewText: '测试短语', useCount: 0, updatedAt: 0 })
const seed = (host, items) => host.storage.set(key, JSON.stringify(JSON.stringify(items)))
const saved = (host) => JSON.parse(JSON.parse(host.storage.get(key)))

test('新建入口先读取已有数据，只推入一次表单，保存后保留已有短语', async () => {
  const host = createHost()
  seed(host, [fixture('已有')])
  const view = await mount(commands['snippets-new'])
  const form = await mountPushed(host)
  try {
    assert.equal(host.pushed.length, 1)
    view.tree(); await tick()
    assert.equal(host.pushed.length, 1)
    await form.fill('title', '新增')
    await form.fill('content', '真正的模板')
    await form.run(null, '保存短语')
    assert.equal(host.pushed.length, 0)
    assert.deepEqual(saved(host).map((item) => item.title), ['新增', '已有'])
    view.tree(); await tick()
    assert.equal(host.pushed.length, 0, '保存后不重复弹出表单')
  } finally { form.unmount(); view.unmount() }
})

test('读取失败和损坏数据阻止新建；保存失败保留表单、输入和旧数据', async () => {
  for (const mode of ['read', 'corrupt', 'write']) {
    const host = createHost()
    seed(host, [fixture('保留')])
    if (mode === 'read') host.faults.storageRead = new Error('读取被拒绝')
    if (mode === 'corrupt') host.storage.set(key, JSON.stringify('{broken'))
    const before = host.storage.get(key)
    const view = await mount(commands['snippets-new'])
    try {
      if (mode !== 'write') {
        assert.equal(host.pushed.length, 0)
        assert.match(view.text(), /无法读取短语/)
      } else {
        const form = await mountPushed(host)
        try {
          await form.fill('title', '不应写入'); await form.fill('content', '不丢失')
          host.faults.storageWrite = new Error('磁盘写入失败')
          await assert.rejects(form.run(null, '保存短语'), /磁盘写入失败/)
          assert.equal(form.field('content').props.value, '不丢失')
          assert.equal(host.pushed.length, 1)
        } finally { form.unmount() }
      }
      assert.equal(host.storage.get(key), before)
      assert.ok(!host.toasts.some((toast) => toast.style === 'success'))
    } finally { view.unmount() }
  }
})

test('复制与粘贴都在执行时读取剪贴板宏；主动作进入真实SDK粘贴通道', async () => {
  const host = createHost()
  seed(host, [fixture('宏')])
  const view = await mount(Snippets)
  try {
    host.clipboard.text = '第一次剪贴板'
    await view.run(view.item('宏'), '复制解析后的文本')
    assert.match(host.clipboard.text, /第一次剪贴板/)
    assert.doesNotMatch(host.clipboard.text, /\{date\}|\{cursor\}/)
    host.clipboard.text = '第二次剪贴板'
    await view.run(view.item('宏'), '直接上屏粘贴')
    assert.equal(host.clipboard.pasted.length, 1)
    assert.match(host.clipboard.pasted[0], /第二次剪贴板/)
    assert.equal(saved(host)[0].useCount, 2)
    assert.equal(host.lastToast().title, '已发送粘贴请求')
  } finally { view.unmount() }
})

test('空字符串和非字符串损坏值不当成空数据，不能进入新建写入', async () => {
  for (const corrupt of ['', null, false, 0, {}, []]) {
    const host = createHost()
    host.storage.set(key, JSON.stringify(corrupt))
    const before = host.storage.get(key)
    const view = await mount(commands['snippets-new'])
    try {
      assert.equal(host.pushed.length, 0)
      assert.match(view.text(), /无法读取短语/)
      assert.equal(view.tree().props.filterBar, undefined)
      assert.equal(host.storage.get(key), before)
    } finally { view.unmount() }
  }
})

test('粘贴被宿主拒绝时不累计次数、不提示成功，仍保留可手动粘贴的文本', async () => {
  const host = createHost()
  seed(host, [fixture('拒绝')])
  const bridge = getDeclarativeBridge()
  bridge.pasteToActive = async (text) => {
    await bridge.copyToClipboard(text)
    throw new Error('辅助功能权限未授权')
  }
  const view = await mount(Snippets)
  try {
    await view.run(view.item('拒绝'), '直接上屏粘贴')
    assert.equal(saved(host)[0].useCount, 0)
    assert.equal(host.lastToast().title, '粘贴失败')
    assert.match(host.lastToast().message, /辅助功能/)
    assert.ok(host.clipboard.text.length > 0)
    assert.equal(host.clipboard.pasted.length, 0)
  } finally { view.unmount() }
})

test('分类快捷入口筛选正确，分类切换清掉旧查询，取消新建不写数据', async () => {
  for (const category of ['invoice', 'address']) {
    const host = createHost()
    seed(host, [fixture('发票', 'invoice'), fixture('地址', 'address')])
    const view = await mount(commands[`snippets-${category}`])
    try {
      assert.equal(view.tree().props.searchBarAccessory.props.value, category)
      assert.equal(view.items().length, 1)
      await view.search('无结果'); await view.dropdown('all')
      assert.equal(view.tree().props.searchText, '')
      assert.equal(view.items().length, 2)
    } finally { view.unmount() }
  }
  const host = createHost()
  const view = await mount(commands['snippets-new'])
  const form = await mountPushed(host)
  try {
    await form.fill('title', '取消后不能保存')
    // 表单不再提供与 Esc 重复的“取消返回”，Esc 由宿主出栈
    assert.deepEqual(form.actions(null).map((a) => a.props.title), ['保存短语'])
    host.pushed.pop()
    assert.equal(host.pushed.length, 0)
    assert.equal(host.storage.has(key), false)
  } finally { form.unmount(); view.unmount() }
})

test('旧窗口复制或粘贴只原子增加次数，不覆盖另一窗口新增和编辑的短语', async () => {
  for (const action of ['复制解析后的文本', '直接上屏粘贴']) {
    const host = createHost()
    seed(host, [fixture('原短语')])
    const view = await mount(Snippets)
    try {
      const edited = { ...fixture('原短语'), content: '另一窗口的新内容', useCount: 8, updatedAt: 10 }
      seed(host, [fixture('另一窗口新增'), edited])
      await view.run(view.item('原短语'), action)
      assert.deepEqual(saved(host), [fixture('另一窗口新增'), { ...edited, useCount: 9 }])
    } finally { view.unmount() }
  }
})

test('新建从最新存储合并，保存过程中遇到并发写入也保留新数据', async () => {
  const host = createHost()
  seed(host, [fixture('原短语')])
  const view = await mount(commands['snippets-new']), form = await mountPushed(host)
  const bridge = getDeclarativeBridge(), compare = bridge.storageCompareAndSet
  let raced = false
  bridge.storageCompareAndSet = async (...args) => {
    if (!raced) { raced = true; seed(host, [fixture('并发新增'), fixture('原短语')]) }
    return compare(...args)
  }
  try {
    await form.fill('title', '本窗口新增'); await form.fill('content', '新内容')
    await form.run(null, '保存短语')
    assert.equal(raced, true)
    assert.deepEqual(saved(host).map(item => item.title), ['本窗口新增', '并发新增', '原短语'])
    assert.equal(new Set(saved(host).map(item => item.id)).size, 3)
  } finally { form.unmount(); view.unmount() }
})

test('另一窗口修改或删除条目后，旧编辑表单和删除动作拒绝覆盖且保留输入', async () => {
  for (const operation of ['edit', 'delete']) {
    for (const change of ['edit', 'delete']) {
      const host = createHost(), original = fixture('待操作')
      seed(host, [original])
      const view = await mount(Snippets)
      let form
      try {
        if (operation === 'edit') {
          await view.run(view.item('待操作'), '编辑短语'); form = await mountPushed(host)
          await form.fill('content', '旧表单未保存的文字')
        }
        const next = change === 'edit' ? [{ ...original, content: '另一窗口修改', updatedAt: 100 }] : []
        seed(host, next)
        if (form) {
          await assert.rejects(form.run(null, '保存短语'), /其他窗口修改或删除/)
          assert.equal(form.field('content').props.value, '旧表单未保存的文字')
          assert.equal(host.pushed.length, 1)
        } else await assert.rejects(view.run(view.item('待操作'), '删除短语'), /其他窗口修改或删除/)
        assert.deepEqual(saved(host), next)
        assert.ok(!host.toasts.some(toast => toast.style === 'SUCCESS'))
      } finally { form?.unmount(); view.unmount() }
    }
  }
})

test('另一窗口仅增加使用次数不阻断编辑，编辑后保留最新次数及无关条目', async () => {
  const host = createHost()
  seed(host, [fixture('可编辑')])
  const view = await mount(Snippets)
  await view.run(view.item('可编辑'), '编辑短语')
  const form = await mountPushed(host)
  try {
    seed(host, [fixture('无关新增'), { ...fixture('可编辑'), useCount: 5 }])
    await form.fill('content', '新的正文'); await form.run(null, '保存短语')
    assert.equal(saved(host)[0].id, '无关新增')
    assert.equal(saved(host)[1].content, '新的正文')
    assert.equal(saved(host)[1].useCount, 5)
  } finally { form.unmount(); view.unmount() }
})

test('并发删除后旧窗口复制不会重建短语；存储损坏和缺少原子宿主均停止写入', async () => {
  for (const mode of ['deleted', 'corrupt', 'unsupported']) {
    const host = createHost()
    seed(host, [fixture('原短语')])
    const view = await mount(Snippets)
    try {
      if (mode === 'deleted') seed(host, [fixture('保留新增')])
      if (mode === 'corrupt') host.storage.set(key, JSON.stringify('{broken'))
      if (mode === 'unsupported') getDeclarativeBridge().storageCompareAndSet = undefined
      const before = host.storage.get(key)
      await view.run(view.item('原短语'), '复制解析后的文本')
      assert.equal(host.storage.get(key), before)
      if (mode !== 'deleted') assert.equal(host.lastToast().title, '已复制，但使用次数保存失败')
    } finally { view.unmount() }
  }
})

test('删除前确认：取消时不删除、不提示成功；确认后才删除', async () => {
  const host = createHost()
  seed(host, [fixture('要删的')])
  const view = await mount(Snippets)
  try {
    host.setConfirm(false)
    await view.run(view.item('要删的'), '删除短语')
    assert.equal(host.confirms.length, 1)
    assert.equal(host.confirms[0].primaryAction.style, 'destructive')
    assert.deepEqual(saved(host).map(item => item.title), ['要删的'])
    assert.ok(!host.toasts.some(toast => toast.style === 'SUCCESS'))
    host.setConfirm(true)
    await view.run(view.item('要删的'), '删除短语')
    assert.deepEqual(saved(host), [])
  } finally { view.unmount() }
})

test('[边界] 内容按原样保存：代码首行缩进与结尾换行不被裁掉；只有空白时拒绝保存', async () => {
  const host = createHost()
  seed(host, [])
  const view = await mount(commands['snippets-new'])
  const form = await mountPushed(host)
  try {
    await form.fill('title', '缩进代码')
    await form.fill('content', '   ')
    await form.run(null, '保存短语')
    assert.deepEqual(saved(host), [])
    await form.fill('content', '    if (ok) {\n      run()\n    }\n')
    await form.run(null, '保存短语')
    assert.equal(saved(host)[0].content, '    if (ok) {\n      run()\n    }\n')
    assert.equal(saved(host)[0].previewText, 'if (ok) { run() }')
  } finally { form.unmount(); view.unmount() }
})

test('没有短语时显示新建引导条目，回车打开新建表单；筛选无结果给出无匹配提示', async () => {
  const host = createHost()
  seed(host, [])
  const view = await mount(Snippets)
  try {
    assert.deepEqual(view.items().map((i) => i.props.id), ['empty-state'])
    assert.match(view.item('empty-state').props.title, /还没有短语/)
    assert.doesNotMatch(view.tree().props.filterBar.summaryText, /cursor/)
    await view.run(view.item('empty-state'), '新建短语')
    assert.equal(host.pushed.length, 1)
    const form = await mountPushed(host)
    try {
      await form.fill('title', '首条'); await form.fill('content', '内容')
      await form.run(null, '保存短语')
    } finally { form.unmount() }
    await tick()
    assert.deepEqual(saved(host).map((i) => i.title), ['首条'])
    await view.search('不存在')
    assert.equal(view.item('empty-state').props.title, '没有匹配的短语')
  } finally { view.unmount() }
})

test('新建表单只列出已实现的宏变量：不提 {cursor}，列出的变量都能真正展开', async () => {
  const { resolveMacroTemplate } = await import('../dist/macro-engine.js')
  const host = createHost()
  seed(host, [])
  const view = await mount(commands['snippets-new'])
  const form = await mountPushed(host)
  try {
    const text = form.text()
    assert.doesNotMatch(text, /cursor|暂不移动光标/)
    const listed = [...new Set(text.match(/\{[a-z]+\}/g))]
    assert.deepEqual([...listed].sort(), ['{clipboard}', '{date}', '{datetime}', '{time}'].sort())
    const out = resolveMacroTemplate(['{clipboard}', '{date}', '{datetime}', '{time}'].join('|'), '剪贴', { fixedDate: '2026-01-02', fixedTime: '03:04:05' }).text
    assert.equal(out, '剪贴|2026-01-02|2026-01-02 03:04:05|03:04:05')
    assert.equal(resolveMacroTemplate('旧{cursor}短语', '').text, '旧短语', '旧数据里的 {cursor} 仍被移除，不残留标记')
  } finally { form.unmount(); view.unmount() }
})
