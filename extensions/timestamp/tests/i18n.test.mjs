import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { validatePluginManifest } from '../../../packages/ztools-plugins-spec/src/validator.js'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import TimestampCommand, { tzWorld } from '../dist/index.js'
import { t } from '../dist/i18n.js'

const host = createHost()
test.beforeEach(() => {
  host.reset()
  setRuntimeLocale('zh-CN')
})

test('plugin.json: 具备 defaultLocale、categoryId 与完整的 en-US 元数据及 features 映射', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'))
  const validation = validatePluginManifest(manifest)
  assert.equal(validation.valid, true, `清单校验失败: ${validation.errors.join('; ')}`)
  assert.equal(manifest.defaultLocale, 'zh-CN')
  assert.equal(manifest.categoryId, 'developer')

  const en = manifest.i18n?.['en-US']
  assert.ok(en && typeof en === 'object')
  assert.ok(en.name.trim().length > 0 && !/[\u4e00-\u9fa5]/.test(en.name))
  assert.ok(en.description.trim().length > 0 && !/[\u4e00-\u9fa5]/.test(en.description))

  const topCodes = manifest.features.map((f) => f.code).sort()
  const enCodes = Object.keys(en.features ?? {}).sort()
  assert.deepEqual(enCodes, topCodes)
  for (const code of topCodes) {
    const feat = en.features[code]
    assert.ok(typeof feat.explain === 'string' && feat.explain.trim().length > 0)
    assert.ok(!/[\u4e00-\u9fa5]/.test(feat.explain), `en-US feature explain 不应含中文: ${code}`)
    assert.ok(Array.isArray(feat.cmds) && feat.cmds.length > 0)
  }
})

test('i18n 词典: zh-CN 与 en-US 翻译及插值输出正确，无空串与键名回退', () => {
  setRuntimeLocale('zh-CN')
  assert.equal(t('navTitle'), '时间戳转换助手')
  assert.equal(t('copiedToast', { label: '秒级时间戳', val: '1700000000' }), '已复制 秒级时间戳: 1700000000')
  assert.equal(t('wcOffsetAcc', { offset: '+8h' }), '时差 +8h')

  setRuntimeLocale('en-US')
  assert.equal(t('navTitle'), 'Timestamp Converter')
  assert.equal(t('copiedToast', { label: 'Unix Seconds', val: '1700000000' }), 'Copied Unix Seconds: 1700000000')
  assert.equal(t('wcOffsetAcc', { offset: '+8h' }), 'Offset +8h')
  assert.doesNotMatch(t('wcSectionLive', { ref: 'UTC' }), /[\u4e00-\u9fa5]|\{ref\}/)
})

test('i18n 运行时热切换: zh-CN -> en-US -> zh-CN 实时更新时间戳与世界时钟视图，英文态无中文残留', async () => {
  const view = await mount(TimestampCommand)
  try {
    assert.equal(view.tree().props.navigationTitle, '时间戳转换助手')
    await view.search('1700000000')

    // 热切换至 en-US
    setRuntimeLocale('en-US')
    await tick()
    assert.equal(view.tree().props.navigationTitle, 'Timestamp Converter')
    assert.match(String(view.tree().props.searchBarPlaceholder), /Enter 10\/13-digit timestamp/)
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 时间戳视图不应包含中文: ${view.text()}`)

    // 热切换回 zh-CN
    setRuntimeLocale('zh-CN')
    await tick()
    assert.equal(view.tree().props.navigationTitle, '时间戳转换助手')
    assert.match(String(view.tree().props.searchBarPlaceholder), /输入10\/13位时间戳/)
  } finally {
    view.unmount()
  }

  setRuntimeLocale('en-US')
  const wcView = await mount(tzWorld)
  try {
    assert.equal(wcView.tree().props.navigationTitle, 'World Clock')
    assert.ok(!/[\u4e00-\u9fa5]/.test(wcView.text()), `en-US 世界时钟视图不应包含中文: ${wcView.text()}`)
  } finally {
    wcView.unmount()
  }
})
