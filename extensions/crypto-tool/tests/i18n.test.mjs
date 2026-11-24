import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { validatePluginManifest } from '../../../packages/ztools-plugins-spec/src/validator.js'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import CryptoToolCommand from '../dist/index.js'
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
  assert.equal(t('navTitle'), '加解密与散列助手')
  assert.equal(t('sectionResultsCount', { count: 5 }), '计算结果（输入 5 字符）')
  assert.equal(t('uuidGeneratedTitle', { count: 10 }), '已生成 10 个 UUID')

  setRuntimeLocale('en-US')
  assert.equal(t('navTitle'), 'Encode & Crypto Toolkit')
  assert.equal(t('sectionResultsCount', { count: 5 }), 'Results (5 chars)')
  assert.equal(t('uuidGeneratedTitle', { count: 10 }), 'Generated 10 UUID(s)')
  assert.doesNotMatch(t('aesResultHint', { action: 'Encrypt' }), /[\u4e00-\u9fa5]|\{action\}/)
})

test('i18n 运行时热切换: zh-CN -> en-US -> zh-CN 实时更新散列列表与 AES 表单，英文态无中文残留', async () => {
  const view = await mount(CryptoToolCommand)
  try {
    assert.equal(view.tree().props.navigationTitle, '加解密与散列助手')

    // 热切换至 en-US
    setRuntimeLocale('en-US')
    await tick()
    assert.equal(view.tree().props.navigationTitle, 'Encode & Crypto Toolkit')
    assert.match(String(view.tree().props.searchBarPlaceholder), /Enter text to hash/)
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 默认视图不应包含中文: ${view.text()}`)

    // 输入文本计算哈希并检查无中文残留
    await view.search('hello-ztools')
    assert.ok(view.item('sha256'))
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 哈希结果视图不应包含中文: ${view.text()}`)

    // 打开 AES 表单检查英文文案
    await view.run(null, 'AES Encrypt / Decrypt…')
    const aesForm = await mountPushed(host)
    try {
      assert.equal(aesForm.tree().props.navigationTitle, 'AES-256-CBC Cipher')
      assert.ok(!/[\u4e00-\u9fa5]/.test(aesForm.text()), `en-US AES 表单不应包含中文: ${aesForm.text()}`)
    } finally {
      aesForm.unmount()
    }

    // 热切换回 zh-CN
    setRuntimeLocale('zh-CN')
    await tick()
    assert.equal(view.tree().props.navigationTitle, '加解密与散列助手')
    assert.match(String(view.tree().props.searchBarPlaceholder), /输入要计算散列或编码的文字/)
  } finally {
    view.unmount()
  }
})
