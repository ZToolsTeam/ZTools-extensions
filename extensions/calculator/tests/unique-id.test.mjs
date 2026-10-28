import test from 'node:test'
import assert from 'node:assert/strict'
import {addCalculatorHistory} from '../dist/calculator-engine.js'
import {createHost} from '../../shared/test-harness.mjs'
test('同一毫秒内创建的不同记录保留完整唯一标识',async t=>{
 t.mock.method(Date,'now',()=>1700000000000)
 let sequence=0
 t.mock.method(globalThis.crypto,'randomUUID',()=>`12345678-0000-4000-8000-${String(++sequence).padStart(12,'0')}`)
 createHost();const first=await addCalculatorHistory('1+1','2','math');const second=await addCalculatorHistory('2+2','4','math');assert.equal(new Set(second.map(row=>row.id)).size,2);assert.equal(second[1].id,first[0].id)
})
test('随机标识能力不可用时拒绝新增，不使用固定后缀',async t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'crypto')
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}})
 t.after(()=>Object.defineProperty(globalThis,'crypto',original))
 const host=createHost();await assert.rejects(addCalculatorHistory('1+1','2','math'),/唯一标识/);assert.equal(host.storage.size,0)
})
