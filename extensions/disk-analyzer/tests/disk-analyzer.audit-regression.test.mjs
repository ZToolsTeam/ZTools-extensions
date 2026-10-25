import test from 'node:test'
import assert from 'node:assert/strict'
import {createHost,mount,tick} from '../../shared/test-harness.mjs'
import Command from '../dist/index.js'
import {fetchDiskAnalysisSnapshot} from '../dist/logic.js'
const volume=(path,capacityGroup)=>({path,capacityGroup,label:path,fileSystem:'APFS',totalBytes:100,usedBytes:60,availableBytes:40})

test('A/B：外置卷正确归属；APFS共享容器汇总只计算一次；空目录合法',async()=>{
 const host=createHost()
 host.ipc.system_list_volumes=()=>({volumes:[volume('/','disk1'),volume('/System/Volumes/Data','disk1'),volume('/Volumes/外置','disk2')],partial:false})
 host.ipc.system_get_path=()=>'/Users/test/Downloads'
 host.ipc.system_search_files=({query})=>({files:query==='dir:/Volumes/外置'?[{name:'data.bin',path:'/Volumes/外置/data.bin',size:50}]:[],subdirs:[]})
 const result=await fetchDiskAnalysisSnapshot()
 assert.equal(result.drives.length,3);assert.equal(result.totalCapacityBytes,200)
 assert.equal(result.files[0].drive,'/Volumes/外置')
})
test('C：卷枚举或扫描失败报失败，不再提示完成',async()=>{
 const host=createHost();const view=await mount(Command,host)
 try {await tick(10);await view.tree().props.filterBar.actions[0].onAction();await tick(10);assert.equal(host.lastToast().style,'FAILURE')}
 finally {view.unmount()}
 host.ipc.system_list_volumes=()=>({volumes:[volume('/','disk1')],partial:false})
 host.ipc.system_get_path=()=>'/Users/test/Downloads'
 await assert.rejects(fetchDiskAnalysisSnapshot(),/目录扫描|未实现/)
})

test('Windows目录挂载卷按最长完整边界归属，尾分隔符与大小写不影响分组',async()=>{
 const host=createHost(), queries=[]
 host.ipc.system_list_volumes=()=>({volumes:[volume('C:\\','root'),volume('C:\\mount\\','mounted'),volume('C:\\mount\\nested\\','nested')],partial:false})
 host.ipc.system_get_path=()=> 'C:\\mount\\data'
 const paths=['c:\\MOUNT\\data\\a.bin','C:\\mount\\nested\\b.bin','C:\\mountain\\c.bin']
 host.ipc.system_search_files=({query})=>{
  queries.push(query)
  return {files:paths.map(path=>({name:path.split('\\').at(-1),path,size:50})),subdirs:[{name:'data',path:'c:\\MOUNT\\data',total_bytes:50,file_count:1}]}
 }
 const result=await fetchDiskAnalysisSnapshot()
 assert.deepEqual(result.files.map(file=>file.drive),['C:\\mount\\','C:\\mount\\nested\\','C:'])
 assert.equal(result.topDirectories[0].drive,'C:\\mount\\')
 for(const root of ['C:\\','C:\\mount\\','C:\\mount\\nested\\']) assert.ok(queries.includes(`dir:${root}`))
 assert.ok(queries.every(query=>!query.includes('\\\\')))
})
