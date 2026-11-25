import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { validatePluginManifest } from '../../../packages/ztools-plugins-spec/src/validator.js'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import ClipboardHistoryCommand from '../dist/index.js'
import { t } from '../dist/i18n.js'

const host = createHost()

function installMockClipboardHost() {
  host.ipc.clipboard_read_text = async () => ({ text: '' })
  host.ipc.clipboard_history_query = async () => [
    {
      id: 'clip-i18n-1',
      content: 'https://example.com/docs',
      format_type: 'text',
      created_at: Date.now() - 120_000,
      updated_at: Date.now() - 120_000,
      is_pinned: 1
    },
    {
      id: 'clip-i18n-2',
      content: '{"ok":true}',
      format_type: 'text',
      created_at: Date.now() - 60_000,
      updated_at: Date.now() - 60_000,
      is_pinned: 0
    }
  ]
}

test.beforeEach(() => {
  host.reset()
  setRuntimeLocale('zh-CN')
  installMockClipboardHost()
})

test('plugin.json: 具备 defaultLocale、categoryId 与完整的 en-US 元数据', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'))
  const validation = validatePluginManifest(manifest)
  assert.equal(validation.valid, true, `清单校验失败: ${validation.errors.join('; ')}`)
  assert.equal(manifest.defaultLocale, 'zh-CN')
  assert.equal(manifest.categoryId, 'system')

  const en = manifest.i18n?.['en-US']
  assert.ok(en && typeof en === 'object')
  assert.ok(en.name.trim().length > 0 && !/[\u4e00-\u9fa5]/.test(en.name))
  assert.ok(en.description.trim().length > 0 && !/[\u4e00-\u9fa5]/.test(en.description))

  if (Array.isArray(manifest.features) && manifest.features.length > 0) {
    const topCodes = manifest.features.map((f) => f.code).sort()
    const enCodes = Object.keys(en.features ?? {}).sort()
    assert.deepEqual(enCodes, topCodes)
  }
})

test('i18n 词典: zh-CN 与 en-US 翻译及插值输出正确，无空串与键名回退', () => {
  setRuntimeLocale('zh-CN')
  assert.equal(t('summaryNormal', { total: 5, pinned: 1 }), '历史共 5 条 · 置顶 1 条')
  assert.equal(t('timeMinutesAgo', { n: 3 }), '3 分钟前')
  assert.equal(t('actionRevealFile', { manager: t('fmExplorer') }), '在资源管理器中显示文件')

  setRuntimeLocale('en-US')
  assert.equal(t('summaryNormal', { total: 5, pinned: 1 }), '5 items · 1 pinned')
  assert.equal(t('timeMinutesAgo', { n: 3 }), '3m ago')
  assert.equal(t('actionRevealFile', { manager: t('fmExplorer') }), 'Reveal in Explorer')
  assert.doesNotMatch(t('toastSeqPasteTitle', { offset: 2 }), /[\u4e00-\u9fa5]|\{offset\}/)
})

test('i18n 运行时热切换: zh-CN -> en-US -> zh-CN 实时更新剪贴板历史列表与编辑表单，英文态无中文残留', async () => {
  const view = await mount(ClipboardHistoryCommand)
  try {
    await tick(3)
    assert.match(String(view.tree().props.searchBarPlaceholder), /搜索剪贴板历史/)
    assert.match(String(view.tree().props.filterBar?.summaryText), /历史共 2 条/)

    // 热切换至 en-US
    setRuntimeLocale('en-US')
    await tick(3)
    assert.match(String(view.tree().props.searchBarPlaceholder), /Search clipboard history/)
    assert.match(String(view.tree().props.filterBar?.summaryText), /2 items · 1 pinned/)
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 剪贴板视图不应包含中文: ${view.text()}`)

    // 通过 Action.Push 目标挂载新建剪贴板记录表单并检查英文文案
    const newAction = view.actions(null).find((a) => a.props.title === 'New Clipboard Item...')
    assert.ok(newAction?.props?.target, '应提供英文新建剪贴板 Action.Push 目标')
    host.pushed.push(newAction.props.target)
    const form = await mountPushed(host)
    try {
      assert.equal(form.tree().props.navigationTitle, 'New Clipboard Item')
      assert.ok(!/[\u4e00-\u9fa5]/.test(form.text()), `en-US 表单视图不应包含中文: ${form.text()}`)
    } finally {
      form.unmount()
    }

    // 热切换回 zh-CN
    setRuntimeLocale('zh-CN')
    await tick(3)
    assert.match(String(view.tree().props.searchBarPlaceholder), /搜索剪贴板历史/)
    assert.match(String(view.tree().props.filterBar?.summaryText), /历史共 2 条/)
  } finally {
    view.unmount()
  }
})
