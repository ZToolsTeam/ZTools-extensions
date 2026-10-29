import test from 'node:test'
import assert from 'node:assert/strict'
import {createHost,mount} from '../../shared/test-harness.mjs'
import Command from '../dist/index.js'
import {scanDownloadsDirectory,isInsideMacPackage,isDownloadTemporaryOrHiddenFile} from '../dist/downloads-service.js'
const root='/Users/u/Downloads'
const f=(rel,size,mtime)=>({name:rel.split('/').pop(),path:`${root}/${rel}`,size,mtime,is_dir:false})
const hostWith=(files,extra={})=>{const calls=[];return{calls,transport:{call:async(method,params)=>{
 calls.push([method,params])
 if(method==='system_search_files')return{success:true,files,total_matches:files.length,...extra}
 throw new Error('不支持'+method)
}}}}

test('macOS 包（.app、.download 等）内部文件、隐藏文件不当作下载文件列出',async()=>{
 createHost()
 const host=hostWith([
  f('Foo.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',200e6,1700000000000),
  f('Foo.app/Contents/MacOS/Foo',50e6,1700000000000),
  f('movie.mp4.download/movie.mp4',80e6,1700000000000),
  f('.localized',0,1700000000000),
  f('._report.pdf',4096,1700000000000),
  f('report.pdf',1000,1700000000000),
  f('unzipped/inner.txt',10,1700000000000)
 ])
 const result=await scanDownloadsDirectory(root,host)
 assert.deepEqual(result.entries.map(e=>e.name).sort(),['inner.txt','report.pdf'])
 assert.equal(isInsideMacPackage(root,`${root}/A.APP/x`),true)
 assert.equal(isInsideMacPackage(root,`${root}/my.app.zip`),false)
 assert.equal(isInsideMacPackage('C:\\Users\\u\\Downloads','C:\\Users\\u\\Downloads\\a.app\\x'),false)
 assert.equal(isDownloadTemporaryOrHiddenFile('Icon\r'),true)
})

test('宿主按体积返回时仍按修改时间取最近的文件，超出上限标注仅部分结果',async()=>{
 createHost()
 const files=[]
 for(let i=0;i<150;i++)files.push(f(`big-${i}.bin`,1e9-i,1600000000000+i))
 files.push(f('today-small.txt',3,Date.now()))
 const host=hostWith(files)
 const result=await scanDownloadsDirectory({customDirs:[],maxFilesPerSource:100},{...host,transport:{call:async(method,params)=>{
  if(method==='downloads_manager')return{ok:true,sources:[{id:'d',label:'系统下载',channel:'browser',appName:'系统下载',path:root}]}
  return host.transport.call(method,params)
 }}})
 assert.equal(host.calls.find(([m])=>m==='system_search_files')[1].limit,200)
 assert.equal(result.entries.length,100)
 assert.ok(result.entries.some(e=>e.name==='today-small.txt'))
 assert.equal(result.partial,true)
})

test('macOS 上回收动作与提示使用“废纸篓”，Windows 仍为“回收站”',async()=>{
 for(const [platform,word] of [['macos','废纸篓'],['windows','回收站']]){
  const host=createHost()
  host.ipc.system_get_platform=()=>({success:true,platform})
  host.ipc.downloads_manager=()=>({ok:true,sources:[{id:'one',label:'测试下载',channel:'browser',appName:'测试',path:root}]})
  host.ipc.system_search_files=()=>({success:true,files:[f('a.dmg',4096,1700000000000)],total_matches:1})
  host.ipc.shell_trash_item=()=>({success:true})
  const view=await mount(Command,host)
  try{
   const titles=view.actions(view.item(`dl-${root}/a.dmg`)).map(a=>a.props.title)
   assert.ok(titles.includes(`移入${word}`),titles.join('|'))
   await view.run(view.item(`dl-${root}/a.dmg`),`移入${word}`)
   assert.match(host.lastToast().title,new RegExp(`已移入${word}`))
  }finally{view.unmount()}
 }
})
