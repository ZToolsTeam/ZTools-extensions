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
    assert.equal(view.item('preset-chmod-777').props.accessories[0].tag, '全局可写')
    await view.search('755')
    assert.doesNotMatch(JSON.stringify(view.items().map((i) => i.props.accessories)), new RegExp(`"color":"${Color.Red}"`))
  } finally { view.unmount() }
})
