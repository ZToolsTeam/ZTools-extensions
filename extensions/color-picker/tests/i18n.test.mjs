import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { validatePluginManifest } from '../../../packages/ztools-plugins-spec/src/validator.js'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ColorPickerCommand, { ContrastCheckCommand } from '../dist/index.js'
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
  assert.equal(manifest.categoryId, 'media')

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
  assert.equal(t('navTitle'), '调色板与色彩转换')
  assert.equal(t('sectionPaletteCount', { count: 4 }), '调色板（4）')
  assert.equal(t('pairTitle', { fg: '#111111', bg: '#FFFFFF' }), '#111111 在 #FFFFFF 上')

  setRuntimeLocale('en-US')
  assert.equal(t('navTitle'), 'Color Converter & Palette')
  assert.equal(t('sectionPaletteCount', { count: 4 }), 'Palette (4)')
  assert.equal(t('pairTitle', { fg: '#111111', bg: '#FFFFFF' }), '#111111 on #FFFFFF')
  assert.doesNotMatch(
    t('detailWhiteContrast', { ratio: '4.5', rating: 'AA Pass' }),
    /[\u4e00-\u9fa5]|\{ratio\}|\{rating\}/
  )
})

test('i18n 运行时热切换: zh-CN -> en-US -> zh-CN 实时更新取色与对比度视图，英文态无中文残留', async () => {
  const view = await mount(ColorPickerCommand)
  try {
    assert.equal(view.tree().props.navigationTitle, '调色板与色彩转换')

    // 热切换至 en-US
    setRuntimeLocale('en-US')
    await tick()
    assert.equal(view.tree().props.navigationTitle, 'Color Converter & Palette')
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 默认视图不应包含中文: ${view.text()}`)

    // 输入色值检查全部格式与详情无中文残留
    await view.search('#0A84FF')
    assert.ok(view.item('fmt-oklch'))
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 色值结果视图不应包含中文: ${view.text()}`)

    // 热切换回 zh-CN
    setRuntimeLocale('zh-CN')
    await tick()
    assert.equal(view.tree().props.navigationTitle, '调色板与色彩转换')
  } finally {
    view.unmount()
  }

  if (typeof ContrastCheckCommand === 'function') {
    setRuntimeLocale('en-US')
    const ccView = await mount(ContrastCheckCommand)
    try {
      assert.equal(ccView.tree().props.navigationTitle, 'Contrast Checker')
      await ccView.search('#111111 #FFFFFF')
      assert.ok(!/[\u4e00-\u9fa5]/.test(ccView.text()), `en-US 对比度视图不应包含中文: ${ccView.text()}`)
    } finally {
      ccView.unmount()
    }
  }
})
