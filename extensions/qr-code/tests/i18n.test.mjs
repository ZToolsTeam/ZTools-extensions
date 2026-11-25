import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { validatePluginManifest } from '../../../packages/ztools-plugins-spec/src/validator.js'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import QrCodeCommand from '../dist/index.js'
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
  assert.equal(manifest.categoryId, 'productivity')

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
  assert.equal(t('navTitle'), '二维码生成')
  assert.equal(t('sectionHistory', { count: 3 }), '历史（3）')
  assert.equal(t('ecOption', { level: 'M' }), '纠错 M')

  setRuntimeLocale('en-US')
  assert.equal(t('navTitle'), 'QR Code Generator')
  assert.equal(t('sectionHistory', { count: 3 }), 'History (3)')
  assert.equal(t('ecOption', { level: 'M' }), 'ECC M')
  assert.doesNotMatch(
    t('previewMeta', { type: 'URL', bytes: 18, version: 2, size: 25, level: 'Medium (15%)' }),
    /[\u4e00-\u9fa5]|\{[a-z]+\}/i
  )
})

test('i18n 运行时热切换: zh-CN -> en-US -> zh-CN 实时更新主界面与 Wi-Fi 表单，英文态无中文残留', async () => {
  const view = await mount(QrCodeCommand)
  try {
    assert.equal(view.tree().props.navigationTitle, '二维码生成')
    assert.match(String(view.tree().props.searchBarPlaceholder), /输入网址或文字/)

    // 热切换至 en-US
    setRuntimeLocale('en-US')
    await tick()
    assert.equal(view.tree().props.navigationTitle, 'QR Code Generator')
    assert.match(String(view.tree().props.searchBarPlaceholder), /Enter a URL or text/)
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 空态视图不应包含中文: ${view.text()}`)

    // 输入网址生成实时预览并检查无中文残留
    await view.search('https://example.com')
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 二维码预览视图不应包含中文: ${view.text()}`)

    // 打开 Wi-Fi 表单检查英文文案
    await view.run(null, 'Create Wi-Fi QR Code…')
    const form = await mountPushed(host)
    try {
      assert.equal(form.tree().props.navigationTitle, 'Wi-Fi QR Code')
      assert.ok(!/[\u4e00-\u9fa5]/.test(form.text()), `en-US Wi-Fi 表单不应包含中文: ${form.text()}`)
    } finally {
      form.unmount()
    }

    // 热切换回 zh-CN
    setRuntimeLocale('zh-CN')
    await tick()
    assert.equal(view.tree().props.navigationTitle, '二维码生成')
    assert.match(String(view.tree().props.searchBarPlaceholder), /输入网址或文字/)
  } finally {
    view.unmount()
  }
})
