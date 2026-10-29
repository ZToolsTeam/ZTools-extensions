import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import ChmodCidrCalcCommand from '../dist/index.js'

test('常用八进制和 ls 格式能自动切换权限模式并通过 SDK 复制', async () => {
  const host=createHost(), view=await mount(ChmodCidrCalcCommand,host)
  try {
    for(const [input,mode] of [['0755','755'],['chmod -R 4755','4755'],['drwxr-xr-x','755'],['rwxrwxrwt','1777']]) {
      await view.search(input)
      await view.run(view.item('chmod-main'),'复制八进制权限值')
      assert.equal(host.clipboard.text,mode)
    }
    await view.search('10.0.0.1/31')
    await view.run(view.item('cidr-main'),'复制可用 IP 范围')
    assert.equal(host.clipboard.text,'10.0.0.0 - 10.0.0.1')
    assert.match(view.text(),/无独立广播/)
    await view.search('1.2.3.4/24/anything')
    assert.equal(view.item('cidr-error').props.actions,undefined)
  } finally { view.unmount() }
})

test('配色：输入错误与预设列表保持灰阶，只有全局可写的计算结果用红色警示', async () => {
  const { Color } = await import('@ztools/declarative-ui')
  const host = createHost(), view = await mount(ChmodCidrCalcCommand, host)
  try {
    await view.search('300.1.1.1/24')
    assert.equal(view.item('cidr-error').props.accessories[0].tag, '输入错误')
    await view.search('chmod 999')
    assert.equal(view.item('chmod-error').props.accessories[0].tag, '格式错误')
    await view.search('777')
    assert.equal(view.item('chmod-main').props.accessories[0].tag.color, Color.Red)
    await view.search('755')
    assert.equal(view.item('preset-chmod-777').props.accessories[0].tag, '全局可写')
    assert.doesNotMatch(JSON.stringify(view.items().map((i) => i.props.accessories)), new RegExp(`"color":"${Color.Red}"`))
  } finally { view.unmount() }
})

test('粘贴 macOS ls -l 权限（带 @）自动切到权限模式；地址加掩码自动按网段计算', async () => {
  const host = createHost(), view = await mount(ChmodCidrCalcCommand, host)
  try {
    await view.search('drwxr-xr-x@')
    await view.run(view.item('chmod-main'), '复制八进制权限值')
    assert.equal(host.clipboard.text, '755')
    await view.search('192.168.1.5 0xffffff00')
    await view.run(view.item('cidr-main'), '复制网络地址/CIDR')
    assert.equal(host.clipboard.text, '192.168.1.0/24')
  } finally { view.unmount() }
})

test('[macOS 审查] 网段结果：列表只放网段与可用主机数，掩码与范围只在详情出现一次；预设不挂噪音标签', async () => {
  const host = createHost(), view = await mount(ChmodCidrCalcCommand, host)
  try {
    await view.search('192.168.1.0/24')
    const main = view.item('cidr-main')
    assert.equal(main.props.subtitle, '可用 254 台主机')
    assert.equal(main.props.accessories, undefined, '掩码已在详情里，列表行不再重复')
    const detail = JSON.stringify(main.props.detail)
    assert.equal(detail.split('255.255.255.0').length - 1, 1, '子网掩码只出现一次')
    assert.equal(detail.split('192.168.1.1 ~ 192.168.1.254').length - 1, 1, '可用范围只出现一次')
    assert.doesNotMatch(detail, /\((Network|Netmask|Wildcard|Broadcast)\)/)
    // 说明文字完整（不再被挤到截断）
    assert.match(main.props.detail.props.markdown, /也不代表公网可达。/)
    const preset = view.item('preset-cidr-10.244.0.0/16')
    assert.equal(preset.props.subtitle, '常用网段 · 按回车载入')
    assert.equal(preset.props.accessories, undefined)
    await view.run(preset, '计算 10.244.0.0/16')
    assert.equal(view.item('cidr-main').props.title, '10.244.0.0/16')
    await view.search('755')
    assert.deepEqual(view.item('preset-chmod-644').props.accessories, [])
    assert.doesNotMatch(view.text(), /\((Octal|Symbolic)\)/)
  } finally { view.unmount() }
})

test('[异常] 错误提示不暴露内部错误码', async () => {
  const host = createHost(), view = await mount(ChmodCidrCalcCommand, host)
  try {
    await view.search('10.0.0.0/40')
    assert.doesNotMatch(view.item('cidr-error').props.subtitle, /[A-Z_]{6,}:/)
    assert.match(view.item('cidr-error').props.subtitle, /前缀必须是 0～32|\/0 ~ \/32/)
  } finally { view.unmount() }
})

test('常用网段与常用权限不重复第一行的当前结果', async () => {
  const { presetCidrsExcluding, presetChmodsExcluding } = await import('../dist/index.js')
  const host=createHost(), view=await mount(ChmodCidrCalcCommand,host)
  try {
    // 默认输入 192.168.1.0/24：第一行就是它，常用网段里不再列出
    const ids = () => view.items().map(i => i.props.id)
    assert.ok(ids().includes('cidr-main'))
    assert.equal(ids().includes('preset-cidr-192.168.1.0/24'), false)
    assert.ok(ids().includes('preset-cidr-10.244.0.0/16'))
    // 同一网段的不同写法（主机位不同）也算重复
    await view.search('10.0.0.0/31')
    assert.equal(ids().includes('preset-cidr-10.0.0.1/31'), false)
    await view.search('10.244.5.6/16')
    assert.equal(ids().includes('preset-cidr-10.244.0.0/16'), false)
    assert.ok(ids().includes('preset-cidr-192.168.1.0/24'))
    // 换成不在预设里的网段时预设全部保留
    await view.search('8.8.8.0/24')
    assert.equal(ids().filter(id => id.startsWith('preset-cidr-')).length, presetCidrsExcluding().length)
    await view.search('755')
    assert.equal(ids().includes('preset-chmod-755'), false)
    assert.ok(ids().includes('preset-chmod-644'))
    await view.search('rwxr-xr-x')
    assert.equal(ids().includes('preset-chmod-755'), false)
  } finally { view.unmount() }
  assert.equal(presetChmodsExcluding('').length, 5)
  assert.equal(presetCidrsExcluding(undefined, undefined).length, 6)
})
