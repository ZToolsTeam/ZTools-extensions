import test, {beforeEach,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {createHost,mount,tick} from '../../shared/test-harness.mjs'
import Command,{commands,scanMacNetwork,saveMac,readSavedMacs,wakeMacDevice} from '../dist/index.js'
const iface={id:'en0|192.0.2.100|255.255.255.0',name:'en0',ip:'192.0.2.100',netmask:'255.255.255.0',subnet:'192.0.2.0/24',broadcast:'192.0.2.255',prefix:24}
const mac='02:11:22:33:44:55'
const report=()=>({success:true,devices:[{ip:'192.0.2.8',mac,openPorts:[80,443],response:'TCP',latencyMs:1.75}],warnings:[],range:'192.0.2.0/24',scanned:254,durationMs:1250,checkedAt:new Date().toISOString()})
let host,views
beforeEach(()=>{host=createHost();views=[];host.ipc.system_get_platform=async()=>({success:true,platform:'macos'});host.ipc.lan_network=async p=>p.action==='interfaces'?{success:true,interfaces:[iface]}:p.action==='scan'?report():p.action==='wake'?{success:true,bytes:102,mac:p.mac,broadcast:iface.broadcast}:{success:true,cancelled:true}})
afterEach(async()=>{for(const v of views)v.unmount();await tick()})
async function open(command=Command){const v=await mount(command,host);views.push(v);await tick();return v}
const calls=action=>host.ipcCalls.filter(([m,p])=>m==='lan_network'&&p.action===action)
function node(v,id){const queue=[v.tree()];while(queue.length){const n=queue.shift();if(!n||typeof n!=='object')continue;if(n.props?.id===id)return n;queue.push(...(Array.isArray(n)?n:Object.values(n)))}throw Error('missing field '+id)}
test('真实 SDK 主入口走 Mac 严格接口，首屏真实结果与范围，主动作复制、次动作详情',async()=>{
 const v=await open();assert.equal(calls('scan').length,1);assert.equal(v.tree().props.isShowingDetail,false);assert.ok(!host.ipcCalls.some(([m])=>m==='dllplugin_call'))
 assert.match(v.text(),/已探测 254/);assert.match(v.text(),/TCP/);assert.doesNotMatch(v.text(),/ARP 在线|WLAN|192.168.1.105/)
 await v.run(v.item('device-192.0.2.8'),'复制 IP 地址');assert.equal(host.clipboard.text,'192.0.2.8')
 assert.equal(v.actions(v.item('device-192.0.2.8'))[1].props.title,'查看服务与探测详情')
 await v.run(v.item('device-192.0.2.8'),'收藏 MAC 地址');assert.deepEqual(await readSavedMacs(),[mac])
})
test('切换网卡重新扫描且清除旧结果；失败/空网卡不补默认网段',async()=>{
 const v=await open(), other={...iface,id:'en1|198.51.100.100|255.255.255.0',name:'en1',ip:'198.51.100.100',subnet:'198.51.100.0/24',broadcast:'198.51.100.255'}
 host.ipc.lan_network=async p=>{if(p.action==='interfaces')return{success:true,interfaces:[iface,other]};if(p.action==='scan')throw new Error('网卡断开');return{success:true}}
 await v.dropdown(other.id);await tick();assert.equal(calls('scan').at(-1)[1].interfaceId,other.id);assert.equal(calls('scan').at(-1)[1].scanAddress,other.ip)
 assert.ok(!v.items().some(n=>n.props.id.startsWith('device-')));assert.match(v.text(),/网卡断开/)
 host.ipc.lan_network=async()=>({success:true,interfaces:[]});await v.tree().props.filterBar.actions[0].onAction();await tick();assert.match(v.text(),/未找到可用 IPv4/)
})
test('畸形回执、越界与错误范围不能展示成功结果',async()=>{
 for(const patch of [{devices:null},{devices:[{...report().devices[0],ip:'198.51.100.1'}]},{devices:[{...report().devices[0],openPorts:[80,80]}]},{range:'198.51.100.0/24'},{scanned:0},{checkedAt:'bad'},{devices:[{...report().devices[0],response:['TCP']}]}]){
  host.ipc.lan_network=async()=>({...report(),...patch});await assert.rejects(scanMacNetwork(iface,iface.ip,'test'),/回执|不一致/)
 }
 host.ipc.system_get_platform=async()=>({success:true,platform:['macos']});const v=await open();assert.match(v.text(),/不支持/)
})
test('重复扫描互斥，取消和卸载丢弃迟到结果',async()=>{
 const v=await open();let finish
 host.ipc.lan_network=async p=>p.action==='interfaces'?{success:true,interfaces:[iface]}:p.action==='scan'?new Promise(r=>{finish=r}):{success:true,cancelled:true}
 const action=v.tree().props.filterBar.actions[0],first=action.onAction();await tick();await action.onAction();assert.equal(calls('scan').length,2)
 await v.tree().props.filterBar.actions[0].onAction();finish(report());await first;await tick();assert.match(v.text(),/已停止/);assert.ok(!v.items().some(n=>n.props.id.startsWith('device-')))
 const pending=v.tree().props.filterBar.actions[0].onAction();await tick();const count=host.toasts.length;v.unmount();views=[];finish(report());await pending;await tick();assert.equal(host.toasts.length,count);assert.ok(calls('cancel').length>=2)
})
test('唤醒独立入口可以输入离线设备 MAC，无需扫描结果，发送后不声称设备开机',async()=>{
 const v=await open(commands['lan-wake-on-lan']);assert.equal(v.tree().type,'Form');assert.equal(calls('scan').length,0)
 node(v,'mac').props.onChange(mac);await tick();await v.actions()[0].props.onSubmit();await tick()
 assert.equal(calls('wake').length,1);assert.match(v.text(),/已发送 102 字节/);assert.match(host.lastToast().title,/设备状态未确认/)
 await v.actions()[1].props.onAction();await tick();assert.deepEqual(await readSavedMacs(),[mac])
 host.ipc.lan_network=async()=>({success:true,bytes:0,mac,broadcast:iface.broadcast});await assert.rejects(wakeMacDevice(iface,mac,'test'),/未确认/)
 await assert.rejects(wakeMacDevice(iface,'ff:ff:ff:ff:ff:ff','test'),/单播/)
})
test('收藏真实存储、重启读取、并发合并，读取失败/损坏/写入失败不覆盖原数据',async()=>{
 await Promise.all([saveMac(mac),saveMac('02:AA:BB:CC:DD:EE')]);assert.equal((await readSavedMacs()).length,2)
 const before=new Map(host.storage);host.faults.storageRead=new Error('读失败');await assert.rejects(saveMac('02:33:44:55:66:77'),/读失败/);assert.deepEqual(host.storage,before)
 host.faults.storageRead=null;host.faults.storageWrite=new Error('写失败');await assert.rejects(saveMac('02:33:44:55:66:77'),/写失败/);assert.deepEqual(host.storage,before)
 host.faults.storageWrite=null;host.storage.set('lan.saved-macs.v1','{"bad":true}');await assert.rejects(saveMac(mac),/损坏/);assert.equal(host.storage.get('lan.saved-macs.v1'),'{"bad":true}')
})

test('有MAC限制提示时首选仍是设备，Enter不会落在无动作的提示行',async()=>{
 host.ipc.lan_network=async p=>p.action==='interfaces'?{success:true,interfaces:[iface]}:{...report(),warnings:['系统未提供邻居 MAC 地址']}
 const v=await open();assert.equal(v.items()[0].props.id,'device-192.0.2.8');assert.equal(v.actions(v.items()[0])[0].props.title,'复制 IP 地址');assert.match(v.text(),/系统未提供邻居 MAC/)
 await v.search('不存在的设备');assert.equal(v.items()[0].props.id,'empty')
})

test('Windows 走同一严格 lan_network 接口：中文网卡名、真实结果，不再调用 dllplugin_call，也不补默认 WLAN 网段',async()=>{
 const win={id:'以太网 2|192.0.2.100|255.255.255.0',name:'以太网 2',ip:'192.0.2.100',netmask:'255.255.255.0',subnet:'192.0.2.0/24',broadcast:'192.0.2.255',prefix:24}
 host.ipc.system_get_platform=async()=>({success:true,platform:'windows'})
 host.ipc.lan_network=async p=>p.action==='interfaces'?{success:true,interfaces:[win]}:p.action==='scan'?report():{success:true,cancelled:true}
 const v=await open();assert.equal(calls('scan').length,1);assert.equal(calls('scan')[0][1].interfaceId,win.id);assert.equal(calls('scan')[0][1].scanAddress,win.ip)
 assert.ok(!host.ipcCalls.some(([m])=>m==='dllplugin_call'));assert.match(v.text(),/已探测 254/);assert.doesNotMatch(v.text(),/WLAN|192\.168\.1\./)
 host.ipc.lan_network=async p=>{if(p.action==='interfaces')return{success:true,interfaces:[win]};throw new Error('此局域网接口目前仅支持 macOS')}
 await v.tree().props.filterBar.actions[0].onAction();await tick();assert.match(v.text(),/仅支持 macOS/);assert.ok(!v.items().some(n=>n.props.id.startsWith('device-')))
 host.ipc.lan_network=async()=>({success:true,interfaces:[]});await v.tree().props.filterBar.actions[0].onAction();await tick();assert.match(v.text(),/未找到可用 IPv4/)
 assert.ok(!host.ipcCalls.some(([m])=>m==='dllplugin_call'))
})
test('Windows 远程开机入口走同一唤醒表单与 lan_network wake，广播地址必须与网卡一致',async()=>{
 const win={id:'Wi-Fi|198.51.100.7|255.255.254.0',name:'Wi-Fi',ip:'198.51.100.7',netmask:'255.255.254.0',subnet:'198.51.100.0/23',broadcast:'198.51.101.255',prefix:23}
 host.ipc.system_get_platform=async()=>({success:true,platform:'windows'})
 host.ipc.lan_network=async p=>p.action==='interfaces'?{success:true,interfaces:[win]}:p.action==='wake'?{success:true,bytes:102,mac:p.mac,broadcast:win.broadcast}:{success:true,cancelled:true}
 const v=await open(commands['lan-wake-on-lan']);assert.equal(v.tree().type,'Form');assert.equal(calls('scan').length,0)
 node(v,'mac').props.onChange(mac);await tick();await v.actions()[0].props.onSubmit();await tick()
 assert.equal(calls('wake').length,1);assert.equal(calls('wake')[0][1].interfaceId,win.id);assert.match(v.text(),/已发送 102 字节/)
 host.ipc.lan_network=async()=>({success:true,bytes:102,mac,broadcast:'198.51.100.255'});await assert.rejects(wakeMacDevice(win,mac,'test'),/未确认/)
 assert.ok(!host.ipcCalls.some(([m])=>m==='dllplugin_call'))
})
test('客户端缺少严格接口时提示升级，不出现 Mac 专属文案',async()=>{
 const saved=globalThis.__ztoolsElectron.transport;globalThis.__ztoolsElectron.transport={methods:{}}
 try{await assert.rejects(scanMacNetwork(iface,iface.ip,'test'),e=>/请升级客户端后使用局域网扫描/.test(e.message)&&!/Mac/.test(e.message))}
 finally{globalThis.__ztoolsElectron.transport=saved}
})
test('宿主如实返回未知延迟与 ping 提示：ICMP 在线但 latencyMs 为 null 照常展示，不编造耗时；ping 全部无回复的提示可见',async()=>{
 const warning='未收到任何 ping 回复：可能被防火墙拦截或系统 ping 失败，结果只包含 TCP 端口有响应的设备'
 host.ipc.system_get_platform=async()=>({success:true,platform:'windows'})
 host.ipc.lan_network=async p=>p.action==='interfaces'?{success:true,interfaces:[iface]}:{...report(),devices:[{ip:'192.0.2.8',mac,openPorts:[],response:'ICMP',latencyMs:null},{ip:'192.0.2.9',mac:null,openPorts:[22],response:'TCP',latencyMs:3.2}],warnings:[warning]}
 const result=await scanMacNetwork(iface,iface.ip,'test');assert.equal(result.devices[0].latencyMs,null);assert.deepEqual(result.warnings,[warning])
 const v=await open();assert.equal(v.items()[0].props.id,'device-192.0.2.8');assert.match(v.text(),/未收到任何 ping 回复/)
 const detail=v.actions(v.item('device-192.0.2.8'))[1].props.target.props.markdown
 assert.match(detail,/响应方式：ICMP；未测得延迟/);assert.doesNotMatch(detail,/null|NaN|响应耗时/)
 // 只有“都没响应”的提示、没有设备时：显示提示而不是静默空列表
 host.ipc.lan_network=async p=>p.action==='interfaces'?{success:true,interfaces:[iface]}:{...report(),devices:[],warnings:['除本机外未收到任何 ping 回复，也没有设备的 TCP 端口响应：可能网段内没有其他在线设备、被防火墙拦截或系统 ping 失败']}
 await v.tree().props.filterBar.actions[0].onAction();await tick();assert.match(v.text(),/也没有设备的 TCP 端口响应/);assert.ok(!v.items().some(n=>n.props.id.startsWith('device-')))
 // 延迟为非数值（宿主编造或损坏）仍拒绝
 host.ipc.lan_network=async()=>({...report(),devices:[{...report().devices[0],latencyMs:'1ms'}]});await assert.rejects(scanMacNetwork(iface,iface.ip,'test'),/回执/)
})
