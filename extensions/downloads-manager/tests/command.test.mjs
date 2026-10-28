import test from 'node:test'
import assert from 'node:assert/strict'
import {createHost,mount,mountPushed,tick} from '../../shared/test-harness.mjs'
import Command,{commands} from '../dist/index.js'
const root='/tmp/ztools-download-fixture'
const row=(name,dir=root)=>({name,path:`${dir}/${name}`,size:4096,mtime:1700000000000,is_dir:false})
function setup(){
 const host=createHost()
 const grants=new Set()
 host.ipc.window_show_select_folder_dialog=()=>{grants.add('/tmp/new-downloads');return{canceled:false,folderPath:'/tmp/new-downloads'}}
 host.ipc.downloads_manager=({action,dirPath})=>action==='validate'?(grants.has(dirPath)?{ok:true,path:dirPath}:{ok:false,error:'未授权'}):{ok:true,sources:[{id:'one',label:'测试下载',channel:'browser',appName:'测试',path:root}]}
 host.ipc.system_search_files=()=>({success:true,files:[row('a.dmg'),row('b.txt')],total_matches:2})
 host.ipc.shell_trash_item=()=>({success:true})
 return host
}
test('Mac 默认入口通过下载目录接口工作，不触发 Windows DLL 通道',async()=>{
 const host=setup()
 host.ipc.dllplugin_call=()=>{throw new Error('PLATFORM_NOT_SUPPORTED: darwin 不支持 DLL')}
 host.ipc.downloads_manager=()=>({ok:true,sources:[{id:'one',label:'测试下载',channel:'browser',appName:'测试',path:root}]})
 const view=await mount(Command,host)
 try{
  assert.ok(view.item(`dl-${root}/a.dmg`))
  assert.equal(host.ipcCalls.some(([method])=>method==='dllplugin_call'),false)
  assert.ok(host.ipcCalls.some(([method,params])=>method==='downloads_manager'&&params.action==='discover'))
 }finally{view.unmount()}
})
test('四个命令入口使用对应筛选，文件主动作为打开',async()=>{
 for(const [code,filter] of Object.entries({'downloads-all':'all','downloads-im':'im','downloads-netdisk':'netdisk','downloads-clean-installers':'type:installer'})){
  const host=setup(),view=await mount(commands[code],host)
  try{
   assert.equal(view.tree().props.searchBarAccessory.props.value,filter)
   if(filter==='all'||filter==='type:installer')assert.equal(view.actions(view.items()[0])[0].props.title,'打开文件')
   if(filter==='type:installer')assert.deepEqual(view.items().map(item=>item.props.title),['a.dmg'])
  }finally{view.unmount()}
 }
})
test('保护保存失败保持未保护状态并显示失败',async()=>{
 const host=setup(),view=await mount(Command,host)
 try{
  host.faults.storageWrite=new Error('磁盘写入失败')
  await view.run(view.item(`dl-${root}/a.dmg`),'置顶并保护（跳过自动清理）')
  assert.equal(host.lastToast().style,'FAILURE')
  assert.match(host.lastToast().message,/写入失败/)
  assert.equal(view.text().includes('已置顶'),false)
 }finally{view.unmount()}
})
test('取消清理不调用回收；确认仅处理筛选内文件',async()=>{
 const host=setup(),view=await mount(Command,host)
 try{
  host.setConfirm(false)
  await view.run(view.item(`dl-${root}/a.dmg`),'清理当前列表的未保护安装包')
  assert.equal(host.ipcCalls.filter(([method])=>method==='shell_trash_item').length,0)
  host.setConfirm(true)
  await view.search('a.dmg')
  await view.run(view.item(`dl-${root}/a.dmg`),'清理当前列表的未保护安装包')
  assert.deepEqual(host.ipcCalls.filter(([method])=>method==='shell_trash_item').map(([,args])=>args.fullPath),[`${root}/a.dmg`])
  await view.search('')
  assert.ok(view.item(`dl-${root}/b.txt`))
  assert.match(host.lastToast().message,/回收站保留/)
 }finally{view.unmount()}
})
test('扫描部分失败保留正常文件首行，异常行可以刷新',async()=>{
 const host=setup()
 host.ipc.downloads_manager=()=>({ok:true,sources:[{id:'one',label:'测试',channel:'browser',appName:'测试',path:root},{id:'two',label:'拒绝',channel:'custom',appName:'测试',path:'/tmp/denied'}]})
 host.ipc.system_search_files=({query})=>{if(query.includes('denied'))throw new Error('读取被拒绝');return{success:true,files:[row('a.dmg')],total_matches:1}}
 const view=await mount(Command,host)
 try{
  assert.equal(view.items()[0].props.id,`dl-${root}/a.dmg`)
  assert.equal(view.actions(view.item('scan-issue-0'))[0].props.title,'刷新下载列表')
  assert.match(view.text(),/拒绝/)
 }finally{view.unmount()}
})
test('系统选目录授权后保存，失败留在表单并保留所选路径',async()=>{
 const host=setup(),view=await mount(Command,host)
 let form
 try{
  const action=view.actions(view.items()[0]).find(a=>a.props.title.includes('自定义'))
  await view.run(view.items()[0],action.props.title)
  form=await mountPushed(host)
  host.faults.storageWrite=new Error('保存失败')
  await form.run(null,'选择并添加目录')
  assert.equal(host.pushed.length,1)
  assert.match(form.text(),/\/tmp\/new-downloads/)
  assert.equal(host.lastToast().style,'FAILURE')
 }finally{form?.unmount();view.unmount()}
})
test('离开页面后不会继续扫描下一个目录',async()=>{
 const host=setup()
 host.ipc.downloads_manager=()=>({ok:true,sources:[{id:'one',label:'测试',channel:'browser',appName:'测试',path:root},{id:'two',label:'测试',channel:'custom',appName:'测试',path:'/tmp/second'}]})
 let finish
 host.ipc.system_search_files=()=>new Promise(resolve=>{finish=resolve})
 const view=await mount(Command,host)
 assert.equal(host.ipcCalls.filter(([method])=>method==='system_search_files').length,1)
 view.unmount();finish({success:true,files:[],total_matches:0});await tick()
 assert.equal(host.ipcCalls.filter(([method])=>method==='system_search_files').length,1)
})

test('选择目录取消不校验、不写配置；先选择授权再添加成功',async()=>{
 const host=setup(),view=await mount(Command,host)
 let form
 try{
  const action=view.actions(view.items()[0]).find(a=>a.props.title.includes('自定义'))
  await view.run(view.items()[0],action.props.title);form=await mountPushed(host)
  const select=host.ipc.window_show_select_folder_dialog
  host.ipc.window_show_select_folder_dialog=()=>({canceled:true})
  await form.run(null,'选择并添加目录')
  assert.equal(host.storage.size,0)
  assert.equal(host.ipcCalls.filter(([m,p])=>m==='downloads_manager'&&p.action==='validate').length,0)
  host.ipc.window_show_select_folder_dialog=select
  await form.run(null,'选择并添加目录')
  const prefs=JSON.parse(host.storage.get('ztools_downloads_preferences_v2'))
  assert.deepEqual(prefs.directories,['/tmp/new-downloads'])
  assert.equal(host.pushed.length,0)
 }finally{form?.unmount();view.unmount()}
})

test('目录校验期间关闭表单不保存配置',async()=>{
 const host=setup(),view=await mount(Command,host)
 let form,finish
 try{
  const action=view.actions(view.items()[0]).find(a=>a.props.title.includes('自定义'))
  await view.run(view.items()[0],action.props.title);form=await mountPushed(host)
  host.ipc.downloads_manager=()=>new Promise(resolve=>{finish=resolve})
  const pending=form.run(null,'选择并添加目录')
  await tick();assert.equal(typeof finish,'function');form.unmount()
  finish({ok:true,path:'/tmp/new-downloads'});await pending
  assert.equal(host.storage.size,0)
 }finally{form?.unmount();view.unmount()}
})
