import test, {beforeEach,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {createHost,mount,tick} from '../../shared/test-harness.mjs'
import Command,{commands,probeMac,hotkeyFingerprint} from '../dist/index.js'
let host,views
const canonical=s=>s.replace(/Cmd/g,'Command').replace(/Ctrl/g,'Control')
beforeEach(()=>{
 host=createHost();views=[];host.ipc.system_get_platform=async()=>({success:true,platform:'macos'})
 host.ipc.hotkey_probe=async p=>({success:true,checkedAt:new Date().toISOString(),results:p.combos.map((combo,i)=>({combo:canonical(combo),status:['owned','occupied','registered'][i%3]}))})
})
afterEach(async()=>{for(const v of views)v.unmount();await tick()})
async function open(command=Command){const v=await mount(command,host);views.push(v);await tick();return v}
const calls=()=>host.ipcCalls.filter(([m])=>m==='hotkey_probe')
test('真实SDK入口初始化Mac实测，不调用DLL，分清三种状态，无占用进程猜测',async()=>{
 const v=await open();assert.equal(calls().length,1);assert.match(v.text(),/可独占注册/);assert.match(v.text(),/存在独占占用/);assert.match(v.text(),/ZTools 已注册/)
 assert.doesNotMatch(v.text(),/微信|NVIDIA|Windows|空闲可用/);assert.ok(!host.ipcCalls.some(([m])=>m==='dllplugin_call'))
 assert.equal(v.tree().props.isShowingDetail,false);assert.deepEqual(v.tree().props.filterBar.actions.map(x=>x.id),['rescan'])
 const row=v.items().find(i=>i.props.id.startsWith('probe-'));assert.deepEqual(v.actions(row).map(a=>a.props.title),['重新检测此组合','复制组合键','检测范围与排查方法'])
})
test('自定义Enter探测返回结果可见，Cmd与Ctrl原样请求，次动作复制Mac键',async()=>{
 const v=await open();await v.search('Cmd+Shift+P');host.ipc.hotkey_probe=async()=>({success:true,checkedAt:new Date().toISOString(),results:[{combo:'Shift+Command+P',status:'registered'}]})
 await v.run(v.item('custom'),'检测输入的快捷键');assert.deepEqual(calls().at(-1)[1].combos,['Cmd+Shift+P']);const row=v.item('probe-Shift+Command+P')
 await v.run(row,'复制组合键');assert.equal(host.clipboard.text,'Shift+Command+P');assert.equal(hotkeyFingerprint('Ctrl+P')===hotkeyFingerprint('Cmd+P'),false)
})
test('扫描失败清掉旧结果；损坏、漏项、错组合回执不补空闲',async()=>{
 const v=await open();host.ipc.hotkey_probe=async()=>{throw new Error('系统探测不可用')};await v.tree().props.filterBar.actions[0].onAction();await tick();assert.match(v.text(),/系统探测不可用/)
 assert.ok(!v.items().some(i=>i.props.id.startsWith('probe-')));assert.equal(host.lastToast().title,'检测未完成')
 for(const results of [[],[{combo:'Command+K',status:'registered'}],[{combo:'Command+P',status:'free'}],[{combo:'Command+P',status:['registered']}]]){host.ipc.hotkey_probe=async()=>({success:true,checkedAt:new Date().toISOString(),results});await assert.rejects(probeMac(['Cmd+P']),/回执|不一致/)}
 host.ipc.hotkey_probe=async()=>({success:true,checkedAt:new Date().toISOString(),results:[{combo:'Command+P',status:'registered'}]});await assert.rejects(probeMac(['Cmd+P','Ctrl+P']),/不一致/)
})
test('速查入口不扫描，搜索/复制Mac键，原先错误系统对照已移除',async()=>{
 const v=await open(commands['hotkey-cheatsheet']);assert.equal(calls().length,0);await v.search('调度中心');assert.equal(v.items().length,1)
 await v.run(v.item('mission'),'复制 Mac 快捷键');assert.equal(host.clipboard.text,'Ctrl+Up');assert.doesNotMatch(v.text(),/新建虚拟桌面/)
 await v.search('公式');assert.ok(v.items().some(i=>i.props.id==='xls-sum'));await v.search('不存在的功能');assert.equal(v.item('sheet-empty').props.title,'没有匹配的快捷键')
})
test('重复Enter互斥；卸载迟到回执不写视图/弹Toast',async()=>{
 const v=await open();let resolve;host.ipc.hotkey_probe=()=>new Promise(r=>{resolve=r});await v.search('Cmd+P')
 const action=v.actions(v.item('custom'))[0],before=calls().length,pending=action.props.onAction();await action.props.onAction();assert.equal(calls().length,before+1)
 v.unmount();views=[];const count=host.toasts.length;resolve({success:false});await pending;await tick();assert.equal(host.toasts.length,count)
})
test('平台失败不猜Mac；缺少新IPC给出升级提示',async()=>{
 host.ipc.system_get_platform=async()=>{throw new Error('平台查询失败')};const v=await open();assert.match(v.text(),/平台查询失败/);assert.equal(calls().length,0)
 const old=globalThis.__ztoolsElectron;globalThis.__ztoolsElectron={transport:{methods:{}}};try{await assert.rejects(probeMac(['Cmd+P']),/升级/)}finally{globalThis.__ztoolsElectron=old}
})
