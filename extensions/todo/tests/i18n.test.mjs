import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { validatePluginManifest } from '../../../packages/ztools-plugins-spec/src/validator.js'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import TodoCommand from '../dist/index.js'
import { t } from '../dist/i18n.js'

const host = createHost()
test.beforeEach(() => {
  host.reset()
  setRuntimeLocale('zh-CN')
})

test('plugin.json: 具备 defaultLocale、categoryId 与完整的 en-US 元数据', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'))
  const validation = validatePluginManifest(manifest)
  assert.equal(validation.valid, true, `清单校验失败: ${validation.errors.join('; ')}`)
  assert.equal(manifest.defaultLocale, 'zh-CN')
  assert.equal(manifest.categoryId, 'productivity')

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
  assert.equal(t('navTitle'), '极简待办清单')
  assert.equal(t('clearedCompleted', { count: 2 }), '已清空 2 条已完成待办')
  assert.equal(t('quickAddTitle', { title: '写单测' }), '添加待办「写单测」')

  setRuntimeLocale('en-US')
  assert.equal(t('navTitle'), 'To-Do List')
  assert.equal(t('clearedCompleted', { count: 2 }), 'Cleared 2 completed task(s)')
  assert.equal(t('quickAddTitle', { title: 'Write tests' }), 'Add Task "Write tests"')
  assert.doesNotMatch(t('sectionActive', { count: 3 }), /[\u4e00-\u9fa5]|\{count\}/)
})

test('i18n 运行时热切换: zh-CN -> en-US -> zh-CN 实时更新空态、快速添加与新建表单，英文态无中文残留', async () => {
  const view = await mount(TodoCommand)
  try {
    assert.equal(view.tree().props.navigationTitle, '极简待办清单')
    assert.equal(view.emptyView().props.title, '还没有待办')

    // 热切换至 en-US
    setRuntimeLocale('en-US')
    await tick()
    assert.equal(view.tree().props.navigationTitle, 'To-Do List')
    assert.equal(view.emptyView().props.title, 'No tasks yet')
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 空态视图不应包含中文: ${view.text()}`)

    // 快速添加任务并检查列表无中文残留
    await view.search('Ship i18n')
    await view.run(view.item('quick-add'), 'Add Task')
    await tick()
    assert.equal(host.lastToast().title, 'Task added')
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 任务列表不应包含中文: ${view.text()}`)

    // 打开新建待办表单验证英文文案
    await view.run(null, 'New To-Do')
    const form = await mountPushed(host)
    try {
      assert.equal(form.tree().props.navigationTitle, 'New To-Do')
      assert.ok(!/[\u4e00-\u9fa5]/.test(form.text()), `en-US 表单视图不应包含中文: ${form.text()}`)
    } finally {
      form.unmount()
    }

    // 热切换回 zh-CN
    setRuntimeLocale('zh-CN')
    await tick()
    assert.equal(view.tree().props.navigationTitle, '极简待办清单')
  } finally {
    view.unmount()
  }
})
