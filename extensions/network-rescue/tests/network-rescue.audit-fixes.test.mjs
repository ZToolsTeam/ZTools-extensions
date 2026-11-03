import test from 'node:test'
import assert from 'node:assert/strict'
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
  assert.match(output,/IPC_FAILED/)
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
