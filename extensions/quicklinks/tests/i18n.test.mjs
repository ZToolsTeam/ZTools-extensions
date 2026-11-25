import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { validatePluginManifest } from '../../../packages/ztools-plugins-spec/src/validator.js'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import QuicklinksCommand, { getDefaultQuicklinks, getQuicklinks, saveQuicklinks } from '../dist/index.js'
import { t } from '../dist/i18n.js'

const STORAGE_KEY = 'ztools:quicklinks:data'
let host
let store

function installLocalStorage() {
  store = new Map()
  globalThis.localStorage = {
    getItem(key) {
      return store.get(key) ?? null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    }
  }
}

test.beforeEach(() => {
  host = createHost()
  installLocalStorage()
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
  assert.equal(t('navTitle'), '网页快开')
  assert.equal(t('summaryText', { count: 7 }), '共 7 个快开项 · 支持在搜索框输入别名快速带参检索')
  assert.equal(t('errAliasConflict', { alias: 'gh', title: 'GitHub' }), '别名「gh」已被「GitHub」使用')

  setRuntimeLocale('en-US')
  assert.equal(t('navTitle'), 'Quicklinks')
  assert.equal(t('summaryText', { count: 7 }), '7 quicklink(s) · Type alias + query in search bar')
  assert.equal(t('errAliasConflict', { alias: 'gh', title: 'GitHub' }), 'Alias "gh" is already used by "GitHub"')
  assert.doesNotMatch(t('groupCountText', { count: 3 }), /[\u4e00-\u9fa5]|\{count\}/)
})

test('默认预置书签按当前语言动态初始化，英文态首次默认数据为纯英文且已有用户数据不被改写', async () => {
  // 英文态首次初始化默认预置书签（无本地存储）
  setRuntimeLocale('en-US')
  const enDefaults = await getQuicklinks()
  assert.ok(enDefaults.length > 0)
  for (const item of enDefaults) {
    assert.ok(item.title.trim().length > 0 && !/[\u4e00-\u9fa5]/.test(item.title), `英文预设标题含中文: ${item.title}`)
    if (item.description) {
      assert.ok(!/[\u4e00-\u9fa5]/.test(item.description), `英文预设描述含中文: ${item.description}`)
    }
  }
  const enDocsGroup = enDefaults.find((item) => item.id === 'ql-5')
  assert.equal(enDocsGroup?.link, 'https://developer.mozilla.org/en-US/')
  assert.equal(enDocsGroup?.urls?.[0], 'https://developer.mozilla.org/en-US/')

  // 切回中文态再次生成默认预置书签，验证动态响应而非静态冻结
  setRuntimeLocale('zh-CN')
  const zhDefaults = getDefaultQuicklinks()
  assert.equal(zhDefaults.find((item) => item.id === 'ql-1')?.title, 'GitHub 代码与仓库搜索')
  assert.equal(zhDefaults.find((item) => item.id === 'ql-5')?.link, 'https://developer.mozilla.org/zh-CN/')

  // 已有用户存储数据在切换语言时绝不被改写
  await saveQuicklinks([{ id: 'user-1', title: '我的私有书签', link: 'https://example.org/' }])
  setRuntimeLocale('en-US')
  const preserved = await getQuicklinks()
  assert.equal(preserved.length, 1)
  assert.equal(preserved[0].title, '我的私有书签')
  assert.ok(store.has(STORAGE_KEY))
})

test('i18n 运行时热切换: zh-CN -> en-US -> zh-CN 实时更新界面与未持久化默认书签，英文态无中文残留', async () => {
  const view = await mount(QuicklinksCommand)
  try {
    await tick(2)
    assert.equal(view.tree().props.navigationTitle, '网页快开')
    assert.equal(view.item('ql-1').props.title, 'GitHub 代码与仓库搜索')

    // 热切换至 en-US
    setRuntimeLocale('en-US')
    await tick(2)
    assert.equal(view.tree().props.navigationTitle, 'Quicklinks')
    assert.equal(view.item('ql-1').props.title, 'GitHub Code & Repo Search')
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 视图不应包含中文: ${view.text()}`)

    // 热切换回 zh-CN
    setRuntimeLocale('zh-CN')
    await tick(2)
    assert.equal(view.tree().props.navigationTitle, '网页快开')
    assert.equal(view.item('ql-1').props.title, 'GitHub 代码与仓库搜索')
  } finally {
    view.unmount()
  }
})
