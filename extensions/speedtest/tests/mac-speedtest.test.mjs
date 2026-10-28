import test,{beforeEach,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {createHost,mount,tick} from '../../shared/test-harness.mjs'
import Command,{commands} from '../dist/index.js'
import {diagnoseNetwork,measureBandwidth,networkReport} from '../dist/mac-service.js'
let host,views
const sample=()=>({host:'example.com',port:443,name:'测试节点',group:'global',protocol:'TCP',samplesMs:[1,2,3],latencyMs:2,jitterMs:1,error:null})
const diagnosis=()=>({success:true,action:'diagnose',nodes:[sample()],network:{interfaceName:'utun6',localAddresses:['192.0.2.2'],gateway:null,warning:'当前隧道未提供网关'},checkedAt:new Date().toISOString()})
const bandwidth=()=>({success:true,action:'bandwidth',downloadMbps:125,uploadMbps:40,baseRttMs:12.25,responsivenessRpm:500,downloadedBytes:128000,uploadedBytes:64000,interfaceName:'utun6',durationMs:15000,checkedAt:new Date().toISOString()})
beforeEach(()=>{host=createHost();views=[];host.ipc.system_get_platform=async()=>({success:true,platform:'macos'});host.ipc.network_speedtest=async p=>p.action==='diagnose'?diagnosis():p.action==='bandwidth'?bandwidth():{success:true,cancelled:true}})
afterEach(async()=>{for(const v of views)v.unmount();await tick()})
const calls=action=>host.ipcCalls.filter(([m,p])=>m==='network_speedtest'&&p.action===action)
async function open(c=Command){const v=await mount(c,host);views.push(v);await tick();return v}
test('真实SDK主入口：布局一，首次不自动消耗带宽；Enter真实请求后显示结果和可复制报告',async()=>{
 const v=await open();assert.equal(v.tree().props.isShowingDetail,false);assert.equal(calls('bandwidth').length,0);assert.equal(calls('diagnose').length,0)
 assert.match(v.text(),/GB 级流量/);await v.run(v.item('bandwidth'),'开始测量带宽');await tick()
 assert.equal(calls('bandwidth').length,1);assert.match(v.text(),/下载 125.0 Mbps/);assert.match(v.text(),/12.25 ms/)
 await v.tree().props.filterBar.actions[1].onAction();assert.match(host.clipboard.text,/下载 125.00 Mbps/);assert.match(host.clipboard.text,/utun6/)
 assert.ok(!host.ipcCalls.some(([m])=>m==='dllplugin_call'))
})
test('诊断快捷入口只检测节点；搜索自定义地址和单节点重测均只请求当前目标',async()=>{
 const v=await open(commands['speedtest-ping-check']);assert.equal(calls('diagnose').length,1);assert.equal(calls('bandwidth').length,0);assert.equal(v.tree().props.selectedItemId,'node-example.com:443')
 assert.match(v.text(),/TCP 3\/3/);await v.run(v.item('node-example.com:443'),'重新检测此节点');assert.equal(calls('diagnose').at(-1)[1].target,'example.com:443')
 await v.search('127.0.0.1:8080');await v.run(v.item('custom'),'检测此地址');assert.equal(calls('diagnose').at(-1)[1].target,'127.0.0.1:8080')
})
test('失败重测清除旧结果，保留真正错误，不转换成断网或伪造带宽',async()=>{
 const v=await open();await v.run(v.item('bandwidth'),'开始测量带宽');host.ipc.network_speedtest=async()=>{throw Error('Apple测试服务不可达')}
 await v.run(v.item('bandwidth'),'重新测量带宽');assert.match(v.text(),/不可达/);assert.doesNotMatch(v.text(),/125.0|下载 0/)
 host.ipc.network_speedtest=async()=>({...diagnosis(),nodes:[{...sample(),samplesMs:[],latencyMs:null,jitterMs:null,error:'ECONNREFUSED'}]})
 await v.tree().props.filterBar.actions[0].onAction();assert.match(v.text(),/ECONNREFUSED/);assert.doesNotMatch(v.text(),/网络已断开/)
})
test('畸形回执与不一致样本拒绝，不把缺失指标写成零',async()=>{
 for(const patch of [{downloadMbps:undefined},{downloadMbps:0},{baseRttMs:'1'},{interfaceName:[]},{durationMs:0},{checkedAt:'bad'}]){host.ipc.network_speedtest=async()=>({...bandwidth(),...patch});await assert.rejects(measureBandwidth('a'),/真实数据/)}
 for(const patch of [{protocol:['TCP']},{latencyMs:10},{jitterMs:100},{samplesMs:[]},{port:70000},{error:42}]){host.ipc.network_speedtest=async()=>({...diagnosis(),nodes:[{...sample(),...patch}]});await assert.rejects(diagnoseNetwork('a'),/回执|样本/)}
 const text=networkReport({...bandwidth(),baseRttMs:null,responsivenessRpm:null},null);assert.match(text,/未提供/);assert.doesNotMatch(text,/空闲延迟 0/)
})
test('重复操作互斥，停止等宿主确认且丢弃迟到成功，失败停止可重试',async()=>{
 const v=await open();let finish,stops=0
 host.ipc.network_speedtest=async p=>{if(p.action==='bandwidth')return new Promise(r=>{finish=r});if(++stops===1)throw Error('停止通道暂不可达');return{success:true,cancelled:true}}
 const first=v.run(v.item('bandwidth'),'开始测量带宽');await tick();await v.run(v.item('bandwidth'),'开始测量带宽');assert.equal(calls('bandwidth').length,1)
 await v.tree().props.filterBar.actions[0].onAction();assert.match(v.text(),/停止未确认/)
 await v.tree().props.filterBar.actions[0].onAction();assert.match(v.text(),/已停止/);finish(bandwidth());await first;await tick();assert.doesNotMatch(v.text(),/125.0/)
})
test('卸载会停止实际任务，迟到的失败不触发Toast或界面更新',async()=>{
 const v=await open();let fail
 host.ipc.network_speedtest=async p=>p.action==='bandwidth'?new Promise((_,reject)=>{fail=reject}):{success:true,cancelled:true}
 const run=v.run(v.item('bandwidth'),'开始测量带宽');await tick();const before=host.toasts.length;v.unmount();views=[];fail(Error('迟到错误'));await run;await tick()
 assert.equal(calls('cancel').length,1);assert.equal(host.toasts.length,before)
})
test('旧操作停止回执晚于新操作时，不覆盖新操作状态',async()=>{
 const v=await open();let finishOld,finishCancel
 host.ipc.network_speedtest=async p=>p.action==='bandwidth'?new Promise(r=>{finishOld=r}):p.action==='cancel'?new Promise(r=>{finishCancel=r}):diagnosis()
 const first=v.run(v.item('bandwidth'),'开始测量带宽');await tick();const cancelling=v.tree().props.filterBar.actions[0].onAction();await tick();finishOld(bandwidth());await first;await tick()
 await v.tree().props.filterBar.actions[0].onAction();assert.match(v.text(),/节点检测完成/);finishCancel({success:true,cancelled:true});await cancelling;assert.match(v.text(),/节点检测完成/)
})

test('预设节点单项重测保留名称和分类，中文搜索不会隐藏更新后的结果',async()=>{
 const v=await open(commands['speedtest-ping-check']);await v.dropdown('global');await v.search('测试节点')
 host.ipc.network_speedtest=async()=>({...diagnosis(),nodes:[{...sample(),name:'example.com:443',group:'custom'}]})
 await v.run(v.item('node-example.com:443'),'重新检测此节点');assert.match(v.text(),/测试节点/);assert.equal(v.item('node-example.com:443').props.title,'测试节点')
})

test('Windows：明确提示暂不可用，不调用旧测速接口、不显示估算带宽或网关', async () => {
 host.ipc.system_get_platform=async()=>({success:true,platform:'windows'})
 // 故障注入：即使旧接口仍回出“成功”的估算结果，界面也不能去调用或展示它
 host.ipc.dllplugin_call=async()=>({ok:true,success:true,downloadMbps:500,uploadMbps:150,gatewayIp:'192.168.1.1',localIp:'192.168.1.101'})
 for(const c of [Command,commands['speedtest-ping-check']]){
  const v=await open(c);assert.match(v.item('unsupported').props.title,/Windows 版网络测速暂不可用/)
  assert.doesNotMatch(v.text(),/Mbps|192\.168\.1\./)
 }
 assert.ok(!host.ipcCalls.some(([m])=>m==='dllplugin_call'||m==='network_speedtest'))
 // 平台确认失败仍报真实错误，不落到任何测速界面
 host.ipc.system_get_platform=async()=>{throw Error('平台查询失败')}
 const failed=await open();assert.match(failed.text(),/平台查询失败/)
})
