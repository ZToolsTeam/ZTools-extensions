import test from 'node:test'
import assert from 'node:assert/strict'
import {createHost,mount,tick} from '../../shared/test-harness.mjs'
import ScreenshotsCommand from '../dist/index.js'
import {ScreenshotsManager} from '../dist/screenshots-service.js'

test('A/B：真实截图正常显示；成功空扫描保持空集，不把照片当截图',async()=>{
 const host=createHost();host.ipc.screenshots_scan=()=>[{path:'/tmp/Screenshot.png',filename:'Screenshot.png',width:10,height:20}]
 const manager=new ScreenshotsManager();assert.equal((await manager.loadScreenshots(true)).length,1)
 host.ipc.screenshots_scan=()=>[]
 host.ipc.system_search_files=()=>({files:[{path:'/Users/test/Pictures/photo.jpg',name:'photo.jpg'}]})
 assert.deepEqual(await manager.loadScreenshots(true),[])
 assert.ok(!host.ipcCalls.some(([m])=>m==='system_search_files'))
})
test('C：扫描失败或载荷损坏不能回退普通照片、不能伪装成功空列表',async()=>{
 const host=createHost();const manager=new ScreenshotsManager()
 host.ipc.screenshots_scan=()=>{throw new Error('permission denied')}
 // 报宿主 screenshots_scan 的真实原因，不能被回退调用的错误（如「未实现 screenshots_search」）覆盖
 await assert.rejects(manager.loadScreenshots(true),/permission denied/)
 assert.ok(!host.ipcCalls.some(([m])=>m==='screenshots_search'))
 host.ipc.screenshots_scan=()=>({unexpected:[]})
 await assert.rejects(manager.loadScreenshots(true),/结果无效/)
 assert.ok(!host.ipcCalls.some(([m])=>m==='system_search_files'))
})
test('C：截图列表界面显示扫描失败的真实原因',async()=>{
 const host=createHost();host.ipc.screenshots_scan=()=>{throw new Error('截图目录读取失败: EACCES')}
 const view=await mount(ScreenshotsCommand,host)
 try {
  await tick(20)
  const summary=view.tree().props.filterBar.summaryText
  assert.match(summary,/截图目录读取失败: EACCES/)
  assert.doesNotMatch(summary,/screenshots_search/)
 }finally{view.unmount()}
})
