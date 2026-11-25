import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { validatePluginManifest } from '../../../packages/ztools-plugins-spec/src/validator.js'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import HostsCommand from '../dist/index.js'
import { getDefaultHostsProfiles } from '../dist/hosts-service.js'
import { t } from '../dist/i18n.js'

let host

test.beforeEach(() => {
  host = createHost()
  setRuntimeLocale('zh-CN')
})

test('plugin.json: 具备 defaultLocale、categoryId 与完整的 en-US 元数据及 features 映射', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'))
  const validation = validatePluginManifest(manifest)
  assert.equal(validation.valid, true, `清单校验失败: ${validation.errors.join('; ')}`)
  assert.equal(manifest.defaultLocale, 'zh-CN')
  assert.equal(manifest.categoryId, 'network')

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
  assert.equal(t('macNavTitle'), '域名映射')
  assert.equal(t('winSummaryText', { total: 4, active: 1 }), '共 4 个方案（已激活 1 个）')
  assert.equal(t('errRuleInvalidLine', { line: 2 }), '第 2 行规则无效，请使用 IP 域名格式')

  setRuntimeLocale('en-US')
  assert.equal(t('macNavTitle'), 'Hosts Switcher')
  assert.equal(t('winSummaryText', { total: 4, active: 1 }), '4 profiles (1 active)')
  assert.equal(t('errRuleInvalidLine', { line: 2 }), 'Invalid rule on line 2; use "IP domain" format')
  assert.doesNotMatch(t('macSummaryText', { localCount: 2, activeCount: 1 }), /[\u4e00-\u9fa5]|\{localCount\}|\{activeCount\}/)
})

test('默认预置 Hosts 方案按当前语言动态生成，英文态首次默认名称与注释均为纯英文', () => {
  setRuntimeLocale('en-US')
  const enProfiles = getDefaultHostsProfiles()
  assert.equal(enProfiles.length, 4)
  for (const profile of enProfiles) {
    assert.ok(profile.name.trim().length > 0 && !/[\u4e00-\u9fa5]/.test(profile.name), `英文预设方案名含中文: ${profile.name}`)
    assert.ok(!/[\u4e00-\u9fa5]/.test(profile.rawContent), `英文预设方案注释含中文: ${profile.rawContent}`)
  }
  assert.match(enProfiles.find((p) => p.id === 'hosts-local-dev').rawContent, /^# Local frontend & gateway mappings/)
  assert.match(enProfiles.find((p) => p.id === 'hosts-staging').rawContent, /^# Example: map staging domains/)

  // 切回中文态应动态输出中文默认方案，而非静态冻结
  setRuntimeLocale('zh-CN')
  const zhProfiles = getDefaultHostsProfiles()
  assert.equal(zhProfiles.find((p) => p.id === 'hosts-system')?.name, '系统基础默认 Hosts')
  assert.match(zhProfiles.find((p) => p.id === 'hosts-local-dev').rawContent, /^# 本地前端与网关调试映射/)
})

test('i18n 运行时热切换 (Windows 视图): zh-CN -> en-US -> zh-CN 同步默认方案名称与注释，不覆盖用户修改', async () => {
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'windows' })
  host.ipc.dllplugin_call = async (p) => {
    if (p.func === 'readSystemHosts') return { ok: true, success: true, content: '127.0.0.1 localhost\n' }
    return { ok: true, success: true }
  }

  const view = await mount(HostsCommand, host)
  try {
    await tick(3)
    assert.equal(view.item('hosts-system').props.title, '系统基础默认 Hosts')
    assert.match(String(view.tree().props.filterBar?.summaryText), /共 4 个方案/)

    // 热切换至 en-US
    setRuntimeLocale('en-US')
    await tick(3)
    assert.equal(view.item('hosts-system').props.title, 'System Default Hosts')
    assert.equal(view.item('hosts-local-dev').props.title, 'Local Microservices Dev (Local Dev)')
    assert.match(String(view.item('hosts-local-dev').props.detail?.props?.markdown), /# Local frontend & gateway mappings/)
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US Windows 视图不应包含中文: ${view.text()}`)

    // 用户编辑其中一个方案后，切换语言不应覆盖用户修改的自定义名称与内容
    await view.run(view.item('hosts-staging'), 'Edit Profile')
    const form = await mountPushed(host)
    try {
      await form.fill('name', 'My Custom Staging')
      await form.fill('rawContent', '# Custom note\n10.0.0.8 custom.local')
      await form.run(null, 'Save Profile')
    } finally {
      form.unmount()
    }
    await tick(2)

    // 热切换回 zh-CN
    setRuntimeLocale('zh-CN')
    await tick(3)
    assert.equal(view.item('hosts-system').props.title, '系统基础默认 Hosts')
    assert.equal(view.item('hosts-staging').props.title, 'My Custom Staging')
    assert.match(String(view.item('hosts-staging').props.detail?.props?.markdown), /# Custom note/)
  } finally {
    view.unmount()
    await tick()
  }
})

test('i18n 运行时热切换 (macOS 视图): zh-CN -> en-US -> zh-CN 实时更新且英文态无中文残留', async () => {
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'macos' })
  host.ipc.hosts_manager = async (p) => {
    if (p.action === 'read') {
      return {
        success: true,
        sessionId: '11111111-1111-4111-8111-111111111111',
        content: '127.0.0.1 localhost\n::1 localhost',
        path: '/private/etc/hosts',
        backups: []
      }
    }
    if (p.action === 'cancel') return { success: true }
    throw new Error(`unexpected action: ${p.action}`)
  }

  const view = await mount(HostsCommand, host)
  try {
    await tick(3)
    assert.equal(view.tree().props.navigationTitle, '域名映射')
    assert.equal(view.item('system').props.title, '当前系统 Hosts')

    setRuntimeLocale('en-US')
    await tick(3)
    assert.equal(view.tree().props.navigationTitle, 'Hosts Switcher')
    assert.equal(view.item('system').props.title, 'Current System Hosts')
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US macOS 视图不应包含中文: ${view.text()}`)

    setRuntimeLocale('zh-CN')
    await tick(3)
    assert.equal(view.tree().props.navigationTitle, '域名映射')
    assert.equal(view.item('system').props.title, '当前系统 Hosts')
  } finally {
    view.unmount()
    await tick()
  }
})
