import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { runNetworkDiagnostics, executeNetworkRepair } from '../dist/logic.js'
import { NetworkRescueCommand } from '../dist/index.js'
import { createHost, mount } from '../../shared/test-harness.mjs'

test('两个诊断接口失败保持未知状态，界面没有健康分或假延迟', async () => {
  const h=createHost()
  for(const method of ['dllplugin_call','network_run_diagnostics']) h.ipc[method]=async()=>{throw new Error('IPC_FAILED')}
  const result=await runNetworkDiagnostics()
  assert.equal(result.ok,false)
  assert.equal(result.unknownCount,8)
  assert.equal(result.items.every(i=>i.status==='unknown'),true)
  assert.equal(result.latencyMs,null)
  assert.equal(result.overallHealthScore,undefined)
  const ui=await mount(NetworkRescueCommand,h)
  const output=JSON.stringify(ui.tree())
  assert.doesNotMatch(output,/IPC_FAILED/)
  assert.match(output,/客户端未返回诊断结果/)
  assert.doesNotMatch(output,/96 分|14 ms|健康度/)
  ui.unmount()
})

test('部分与畸形诊断不会把未检测项补成健康', async () => {
  const partial=await runNetworkDiagnostics({dllplugin_call:async()=>({checks:[{id:'flush-dns',status:'healthy',detail:'DNS resolved'},{id:'restart-nla',status:'unexpected'}]})})
  assert.equal(partial.ok,true)
  assert.equal(partial.unknownCount,7)
  assert.equal(partial.items.find(i=>i.id==='restart-nla').status,'unknown')
  const malformed=await runNetworkDiagnostics({dllplugin_call:async()=>({unexpected:true})})
  assert.equal(malformed.ok,false)
  const offline=await executeNetworkRepair('flush-dns',{dllplugin_call:async()=>({ok:false,error:'denied'}),shell_exec:async()=>({ok:false,error:'denied'})})
  assert.equal(offline.ok,false)
})

test('i18n 热切换回归：列表标题与状态随语言实时切换，不固化初始语言', async () => {
  const h = createHost()
  for (const method of ['dllplugin_call', 'network_run_diagnostics']) h.ipc[method] = async () => ({ checks: [] })
  try {
    setRuntimeLocale('zh-CN')
    const ui = await mount(NetworkRescueCommand, h)
    assert.match(ui.text(), /刷新 DNS 解析缓存/)

    setRuntimeLocale('en-US')
    await new Promise((r) => setTimeout(r, 20))
    assert.match(ui.text(), /Flush DNS Resolver Cache/)
    assert.doesNotMatch(ui.text(), /刷新 DNS 解析缓存/)
    ui.unmount()
  } finally {
    setRuntimeLocale('zh-CN')
  }
})

test('安全红线：高危修复项执行前必须二次确认，用户取消绝不执行（含中英文）', async () => {
  const h = createHost()
  const repairCalls = []
  h.ipc.dllplugin_call = async ({ func, params }) => {
    if (func === 'diagnose') {
      return {
        ok: true,
        items: [
          { id: 'reset-winsock', status: 'warning', statusText: 'LSP 异常' },
          { id: 'reset-firewall', status: 'warning', statusText: '策略异常' },
          { id: 'renew-dhcp', status: 'warning', statusText: '租约过期' },
          { id: 'flush-dns', status: 'warning', statusText: '缓存过期' }
        ]
      }
    }
    if (func === 'repair') {
      repairCalls.push(params.itemId)
      return { ok: true, message: `已修复 ${params.itemId}` }
    }
    return { ok: false }
  }

  try {
    setRuntimeLocale('zh-CN')
    const ui = await mount(NetworkRescueCommand, h)
    await new Promise((r) => setTimeout(r, 20))

    // 1. 高危项取消确认时不调用修复
    h.setConfirm(false)
    for (const [id, pattern] of [
      ['reset-winsock', /重启/],
      ['reset-firewall', /自定义.*防火墙规则/],
      ['renew-dhcp', /断开/],
      ['restart-nla', /管理员权限/]
    ]) {
      const before = h.confirms.length
      const item = ui.item(id)
      await ui.actions(item)[0].props.onAction()
      assert.equal(h.confirms.length, before + 1, `${id} 必须弹出确认框`)
      assert.match(h.confirms.at(-1).message, pattern, `${id} 确认框必须包含风险提示`)
    }
    assert.deepEqual(repairCalls, [], '用户取消高危修复时绝不能调用宿主修复')

    // 2. 批量修复含高危项时也必须弹出二次确认，取消时不执行
    const beforeBatch = h.confirms.length
    const anyItem = ui.item('reset-winsock')
    const batchAct = ui.actions(anyItem).find((a) => a.props.title.startsWith('批量修复'))
    assert.ok(batchAct)
    await batchAct.props.onAction()
    assert.equal(h.confirms.length, beforeBatch + 1)
    assert.deepEqual(repairCalls, [])

    // 3. 确认后正常执行；非高危项不额外弹确认
    h.setConfirm(true)
    await ui.actions(ui.item('reset-firewall'))[0].props.onAction()
    assert.deepEqual(repairCalls, ['reset-firewall'])

    const beforeDns = h.confirms.length
    await ui.actions(ui.item('flush-dns'))[0].props.onAction()
    assert.equal(h.confirms.length, beforeDns, '轻量级刷新 DNS 不需要阻断确认')
    assert.deepEqual(repairCalls, ['reset-firewall', 'flush-dns'])

    // 4. 英文 i18n 下高危确认文案无中文与未替换占位符
    setRuntimeLocale('en-US')
    await new Promise((r) => setTimeout(r, 20))
    h.setConfirm(false)
    await ui.actions(ui.item('reset-winsock'))[0].props.onAction()
    const enConfirm = h.confirms.at(-1)
    assert.match(enConfirm.title, /Reset Winsock/)
    assert.match(enConfirm.message, /restart/i)
    assert.ok(!/[\u4e00-\u9fa5]|\{[a-z]+\}/i.test(`${enConfirm.title} ${enConfirm.message}`))

    ui.unmount()
  } finally {
    setRuntimeLocale('zh-CN')
  }
})
