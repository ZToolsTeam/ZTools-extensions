import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { Clipboard } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { JwtUrlCodecCommand, decodeJwtToken } from '../dist/index.js'

async function setup() {
  const host = createHost(), view = await mount(JwtUrlCodecCommand, host)
  const action = view.tree().props.filterBar?.actions.find(action => action.id === 'sign-jwt')
  if (!action) view.unmount()
  assert.ok(action, 'JWT模式必须提供实际可用的签发入口')
  await action.onAction(); await tick()
  const form = await mountPushed(host)
  return { host, view, form }
}

test('签发入口经过真实表单生成HS256并复制，密钥不落盘', async () => {
  const { host, view, form } = await setup()
  try {
    await form.fill('payload', '{"sub":"中文用户","exp":2000000000}')
    await form.fill('secret', '  fixture secret  ')
    assert.equal(form.field('secret').type, 'Form.PasswordField')
    await form.run(null, '签发并复制 JWT')
    const generated = host.clipboard.text, parts = generated.split('.')
    assert.equal(parts[2], createHmac('sha256', '  fixture secret  ').update(parts.slice(0, 2).join('.')).digest('base64url'))
    assert.equal(decodeJwtToken(generated).payload.sub, '中文用户')
    assert.equal(host.pushed.length, 0)
    assert.equal(host.storage.size, 0)
    assert.equal(host.lastToast().title, 'JWT 已签发并复制')
    assert.doesNotMatch(JSON.stringify(host.toasts), /fixture secret/)
  } finally { form.unmount(); view.unmount() }
})

test('无效JSON或不支持的算法不覆盖剪贴板；复制失败保留表单供重试', async () => {
  const { host, view, form } = await setup()
  const originalCopy = Clipboard.copy
  try {
    host.clipboard.text = 'untouched'
    await form.fill('secret', 'fixture secret')
    for (const [field, value] of [['payload', 'not json'], ['payload', '[]'], ['header', '{"alg":"none"}']]) {
      await form.fill('payload', '{}'); await form.fill('header', '{"alg":"HS256"}')
      await form.fill(field, value)
      await form.run(null, '签发并复制 JWT')
      assert.equal(host.clipboard.text, 'untouched')
      assert.equal(host.lastToast().style, 'FAILURE')
      assert.equal(host.pushed.length, 1)
    }
    await form.fill('header', '{"alg":"HS256"}')
    Clipboard.copy = async () => { throw new Error('复制失败') }
    await form.run(null, '签发并复制 JWT')
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.equal(host.pushed.length, 1)
    assert.equal(form.field('secret').props.value, 'fixture secret')
  } finally { Clipboard.copy = originalCopy; form.unmount(); view.unmount() }
})

test('签发中退出表单不在迟到完成时写剪贴板或提示成功', async () => {
  const { host, view, form } = await setup()
  try {
    host.clipboard.text = 'untouched'
    await form.fill('secret', 'fixture secret')
    const pending = form.run(null, '签发并复制 JWT')
    form.unmount()
    await pending; await tick(20)
    assert.equal(host.clipboard.text, 'untouched')
    assert.equal(host.toasts.length, 0)
  } finally { view.unmount() }
})
