import test from 'node:test'
import assert from 'node:assert/strict'
import {createHost} from '../../shared/test-harness.mjs'
import {scanDownloadsDirectory, togglePinEntry, addCustomDownloadDirectory, cleanRedundantInstallers, validateCustomDownloadDirPath} from '../dist/downloads-service.js'
const source='/tmp/ztools-download-fixture'
const file=(name,size=1)=>({name,path:`${source}/${name}`,size,mtime:1700000000000,is_dir:false})
const hostForScan=(files,extra={})=>({transport:{call:async(method)=>{
 if(method==='system_search_files')return{success:true,files,total_matches:files.length,...extra}
 if(method==='filesystem_get_directory_contents')throw new Error('读取被拒绝')
 throw new Error('不支持'+method)
}}})
const installer={id:`dl-${source}/a.dmg`,name:'a.dmg',path:`${source}/a.dmg`,dirPath:source,ext:'.dmg',category:'installer',sizeBytes:10,sizeFormatted:'10 B',modifiedAt:'2026-01-01',mtimeMs:1700000000000,ageDays:300,isPinned:false,channel:'browser',sourceId:'one',sourceLabel:'测试目录',appName:'测试'}

test('扫描失败不能显示为成功的空目录，截断结果有明确状态',async()=>{
 createHost()
 const failed=await scanDownloadsDirectory(source,{transport:{call:async()=>{throw new Error('读取被拒绝')}}})
 assert.equal(failed.scanIssues.length,1)
 assert.match(failed.scanIssues[0].message,/拒绝/)
 const partial=await scanDownloadsDirectory(source,hostForScan([file('a.txt')],{total_matches:1000,truncated:true}))
 assert.equal(partial.partial,true)
})

test('零字节文件保留，越界文件不能出现在操作列表',async()=>{
 createHost()
 const result=await scanDownloadsDirectory(source,hostForScan([file('empty.txt',0),file(' a.txt '),{...file('escape.dmg'),path:'/tmp/outside/escape.dmg'}]))
 assert.equal(result.entries.find(e=>e.name==='empty.txt').sizeBytes,0)
 assert.equal(result.entries.find(e=>e.name===' a.txt ').path,`${source}/ a.txt `)
 assert.equal(result.entries.some(e=>e.path==='/tmp/outside/escape.dmg'),false)
})

test('置顶持久化失败不能改变保护状态或假报保存成功',async()=>{
 const host=createHost();host.faults.storageWrite=new Error('磁盘写入失败')
 await assert.rejects(async()=>togglePinEntry([installer],installer.id),/失败/)
 assert.equal(installer.isPinned,false)
})

test('自定义目录持久化失败必须报告失败',async()=>{
 const host=createHost();host.faults.storageWrite=new Error('保存失败')
 const result=await addCustomDownloadDirectory(source,{downloads_manager:async()=>({ok:true,path:source})})
 assert.equal(result.ok,false)
 assert.match(result.error,/失败/)
})

test('Windows 驱动器根与 POSIX 根保持绝对路径',()=>{
 assert.equal(validateCustomDownloadDirPath('C:\\').normalizedPath,'C:\\')
 assert.equal(validateCustomDownloadDirPath('/').normalizedPath,'/')
})

test('读取保护设置失败时禁止自动清理，保留全部文件',async()=>{
 const host=createHost();host.faults.storageRead=new Error('保护设置读取失败')
 const requests=[]
 await assert.rejects(cleanRedundantInstallers([installer],{shell_trash_item:async({fullPath})=>{requests.push(fullPath);return{success:true}}}),/读取失败/)
 assert.deepEqual(requests,[])
})

test('页面退出后停止后续回收，保留已经确认的结果',async()=>{
 createHost()
 let active=true
 const second={...installer,id:`dl-${source}/b.dmg`,path:`${source}/b.dmg`,name:'b.dmg'}
 const requests=[]
 const result=await cleanRedundantInstallers([installer,second],{shell_trash_item:async({fullPath})=>{requests.push(fullPath);active=false;return{success:true}}},()=>active)
 assert.deepEqual(requests,[installer.path])
 assert.equal(result.cleanedCount,1)
 assert.deepEqual(result.remainingEntries,[second])
 assert.equal(result.cancelled,true)
})

test('读取保护设置期间退出，不能再发起回收',async()=>{
 createHost()
 const requests=[]
 const result=await cleanRedundantInstallers([installer],{shell_trash_item:async({fullPath})=>{requests.push(fullPath);return{success:true}}},()=>false)
 assert.deepEqual(requests,[])
 assert.deepEqual(result.remainingEntries,[installer])
})

test('定位失败不能改成打开文件并声称定位成功，复制失败不得自动重试',async()=>{
 const {revealDownloadItem,copyDownloadFilePath}=await import('../dist/downloads-service.js')
 const requests=[]
 const bridge={transport:{call:async(method)=>{requests.push(method);return method==='shell_open_path'?{success:true}:{success:false,error:'失败'}}}}
 assert.equal(await revealDownloadItem(installer.path,bridge),false)
 assert.deepEqual(requests,['shell_show_item_in_folder'])
 requests.length=0
 assert.equal(await copyDownloadFilePath(installer.path,bridge),false)
 assert.deepEqual(requests,['clipboard_copy_text'])
})

test('部分回收失败与不明确回执保留对应文件，不自动重试',async()=>{
 createHost()
 const entries=['a','b','c'].map(name=>({...installer,id:`dl-${source}/${name}.dmg`,name:`${name}.dmg`,path:`${source}/${name}.dmg`}))
 const calls=[]
 const result=await cleanRedundantInstallers(entries,{shell_trash_item:async({fullPath})=>{calls.push(fullPath);return fullPath.endsWith('/a.dmg')?{success:true}:fullPath.endsWith('/b.dmg')?{success:false,error:'占用'}:{}}})
 assert.equal(result.cleanedCount,1)
 assert.deepEqual(result.remainingEntries,entries.slice(1))
 assert.equal(result.failedPaths.length,2)
 assert.equal(calls.length,3)
})

test('清理前重读持久化保护设置；未知时间不进入过期清理',async()=>{
 const {cleanExpiredDownloads}=await import('../dist/downloads-service.js')
 const host=createHost(),calls=[]
 host.storage.set('ztools_downloads_preferences_v2',JSON.stringify({pins:[installer.id],directories:[]}))
 const bridge={shell_trash_item:async({fullPath})=>{calls.push(fullPath);return{success:true}}}
 assert.equal((await cleanRedundantInstallers([installer],bridge)).cleanedCount,0)
 host.storage.clear()
 assert.equal((await cleanExpiredDownloads([{...installer,ageDays:null}],30,0,bridge)).cleanedCount,0)
 assert.deepEqual(calls,[])
})

test('旧保护设置迁移不删除原记录，损坏设置不覆盖',async()=>{
 const {readDownloadPreferences}=await import('../dist/downloads-preferences.js')
 const host=createHost(),legacy=new Map([['ztools_downloads_pinned_v1',JSON.stringify([installer.id])],['ztools_downloads_custom_dirs_v1',JSON.stringify([source])]])
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>legacy.get(key)??null}})
 try{
  assert.deepEqual(await readDownloadPreferences(),{pins:[installer.id],directories:[source]})
  assert.equal(legacy.size,2)
  assert.equal(host.storage.size,1)
  host.storage.clear();legacy.set('ztools_downloads_pinned_v1','bad-json')
  await assert.rejects(readDownloadPreferences())
  assert.equal(host.storage.size,0)
  host.storage.set('ztools_downloads_preferences_v2','{"pins":null,"directories":[]}')
  await assert.rejects(readDownloadPreferences(),/损坏/)
  assert.equal(host.storage.get('ztools_downloads_preferences_v2'),'{"pins":null,"directories":[]}')
 }finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage}
})

test('同时保存保护项与自定义目录不会互相覆盖',async()=>{
 const {readDownloadPreferences}=await import('../dist/downloads-preferences.js')
 createHost()
 await Promise.all([togglePinEntry([installer],installer.id),addCustomDownloadDirectory(source,{downloads_manager:async()=>({ok:true,path:source})})])
 assert.deepEqual(await readDownloadPreferences(),{pins:[installer.id],directories:[source]})
})
