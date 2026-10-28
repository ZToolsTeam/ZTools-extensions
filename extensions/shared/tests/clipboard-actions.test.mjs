import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Action, ActionPanel, List, getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost, mount } from '../test-harness.mjs'

async function actionView(action, host) {
  return mount(() => List({}, [List.Item({ id: 'entry', title: '测试记录', actions: ActionPanel({}, [action]) })]), host)
}

test('粘贴动作经 SDK 完整复制粘贴，成功后调用 onPaste 而不触发普通动作', async () => {
  const host = createHost(), callbacks = []
  const view = await actionView(Action.Paste({ title: '粘贴', content: ' 原始文本 ', onPaste: text => callbacks.push(text), onAction: () => callbacks.push('错误动作') }), host)
  try {
    await view.run(view.item('entry'), '粘贴')
    assert.equal(host.clipboard.text, ' 原始文本 ')
    assert.deepEqual(host.clipboard.pasted, [' 原始文本 '])
    assert.deepEqual(callbacks, [' 原始文本 '])
  } finally { view.unmount() }
})

test('宿主拒绝粘贴时保留原内容，不记录成功或调用成功回调', async () => {
  const host = createHost()
  host.clipboard.text = '原剪贴板'
  let callbacks = 0
  const failure = Object.assign(new Error('剪贴板操作正在进行'), { code: 'CLIPBOARD_ERROR' })
  getDeclarativeBridge().pasteToActive = async () => { throw failure }
  const view = await actionView(Action.Paste({ title: '粘贴', content: '不能写入', onPaste: () => { callbacks++ } }), host)
  try {
    await assert.rejects(view.run(view.item('entry'), '粘贴'), error => error === failure)
    assert.equal(host.clipboard.text, '原剪贴板')
    assert.deepEqual(host.clipboard.pasted, [])
    assert.equal(callbacks, 0)
  } finally { view.unmount() }
})

test('复制动作经过宿主校验，空内容失败后不覆盖原内容和调用 onCopy', async () => {
  const host = createHost()
  host.clipboard.text = '原剪贴板'
  let callbacks = 0
  const view = await actionView(Action.CopyToClipboard({ title: '复制', content: '', onCopy: () => { callbacks++ } }), host)
  try {
    await assert.rejects(view.run(view.item('entry'), '复制'), { code: 'EMPTY_CONTENT' })
    assert.equal(host.clipboard.text, '原剪贴板')
    assert.equal(callbacks, 0)
  } finally { view.unmount() }
})
