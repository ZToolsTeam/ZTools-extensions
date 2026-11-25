import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { validatePluginManifest } from '../../../packages/ztools-plugins-spec/src/validator.js'
import { createHost, mountPushed, tick } from '../../shared/test-harness.mjs'
import JsonFormatCommand from '../dist/index.js'
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
  assert.equal(t('navTitleMain'), 'JSON 格式化与类型转换')
  assert.equal(t('copyFormatted', { indent: '2 格' }), '复制格式化 JSON (2 格)')
  assert.equal(t('errorPosition', { line: 3, column: 5, message: 'Unexpected token' }), '[第 3 行, 列 5] Unexpected token')

  setRuntimeLocale('en-US')
  assert.equal(t('navTitleMain'), 'JSON Formatter & Type Generator')
  assert.equal(t('copyFormatted', { indent: '2 spaces' }), 'Copy Formatted JSON (2 spaces)')
  assert.equal(t('errorPosition', { line: 3, column: 5, message: 'Unexpected token' }), '[Line 3, Col 5] Unexpected token')
  assert.doesNotMatch(t('pathIndexHeading', { count: 10 }), /[\u4e00-\u9fa5]|\{count\}/)
})

test('i18n 运行时热切换: zh-CN -> en-US -> zh-CN 实时更新表单与详情视图，英文态无中文残留', async () => {
  host.pushed.push(JsonFormatCommand)
  const view = await mountPushed(host)
  try {
    assert.equal(view.tree().props.navigationTitle, 'JSON 格式化与类型转换')

    // 热切换至 en-US
    setRuntimeLocale('en-US')
    await tick()
    assert.equal(view.tree().props.navigationTitle, 'JSON Formatter & Type Generator')
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 表单视图不应包含中文: ${view.text()}`)

    // 非法 JSON 校验错误状态下热切换语言：验证 useMemo 依赖 locale 实时刷新错误文案
    await view.fill('jsonInput', '{invalid json')
    await tick()
    setRuntimeLocale('zh-CN')
    await tick()
    const zhErr = String(view.field('jsonInput').props.error || '')
    assert.ok(/[\u4e00-\u9fa5]/.test(zhErr), `zh-CN 非法 JSON 错误应为中文: ${zhErr}`)
    setRuntimeLocale('en-US')
    await tick()
    const enErr = String(view.field('jsonInput').props.error || '')
    assert.ok(enErr.length > 0 && !/[\u4e00-\u9fa5]/.test(enErr), `en-US 非法 JSON 错误应实时切换为英文且无中文残留: ${enErr}`)

    // 填入合法 JSON 并进入详情页验证英文输出
    await view.fill('jsonInput', '{"name":"ztools","count":2}')
    await view.run(null, 'Format & Inspect Details')
    const detail = await mountPushed(host)
    try {
      assert.equal(detail.tree().props.navigationTitle, 'JSON Details')
      assert.ok(!/[\u4e00-\u9fa5]/.test(detail.text()), `en-US 详情视图不应包含中文: ${detail.text()}`)
    } finally {
      detail.unmount()
    }

    // 热切换回 zh-CN
    setRuntimeLocale('zh-CN')
    await tick()
    assert.equal(view.tree().props.navigationTitle, 'JSON 格式化与类型转换')
  } finally {
    view.unmount()
  }
})
