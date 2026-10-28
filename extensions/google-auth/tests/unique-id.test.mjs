import test from 'node:test'
import assert from 'node:assert/strict'
import {createAccount} from '../dist/logic.js'
test('同一毫秒内创建的不同记录保留完整唯一标识',async t=>{
 t.mock.method(Date,'now',()=>1700000000000)
 let sequence=0
 t.mock.method(globalThis.crypto,'randomUUID',()=>`12345678-0000-4000-8000-${String(++sequence).padStart(12,'0')}`)
 const make=name=>createAccount({name,secret:'JBSWY3DPEHPK3PXP'});assert.notEqual(make('甲').id,make('乙').id)
})
test('随机标识能力不可用时拒绝新增，不使用固定后缀',async t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'crypto')
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}})
 t.after(()=>Object.defineProperty(globalThis,'crypto',original))
 assert.throws(()=>createAccount({name:'甲',secret:'JBSWY3DPEHPK3PXP'}),/唯一标识/)
})
