import test from 'node:test'
import assert from 'node:assert/strict'
import {createHost} from '../../shared/test-harness.mjs'
import {fetchHardwareTelemetrySnapshot} from '../dist/logic.js'
import {probeRealDiskDrives} from '../dist/volume-ipc.js'
const volume=(path,capacityGroup)=>({path,capacityGroup,label:path,fileSystem:'APFS',totalBytes:100,usedBytes:60,availableBytes:40})

test('A/B：显示所有挂载卷，APFS容量按容器去重，Windows Z盘不遗漏',async()=>{
 const host=createHost();host.ipc.system_list_volumes=()=>({volumes:[volume('/','disk1'),volume('/System/Volumes/Data','disk1'),volume('/Volumes/外置','disk2'),volume('Z:\\','diskZ')],partial:false})
 const drives=await probeRealDiskDrives();assert.equal(drives.length,4);assert.equal(drives.at(-1).drive,'Z:')
 const snapshot=await fetchHardwareTelemetrySnapshot()
 assert.equal(snapshot.totalDiskBytes,300)
})
test('C：枚举失败或部分卷失败如实标注磁盘模块失败',async()=>{
 const host=createHost();let snapshot=await fetchHardwareTelemetrySnapshot();assert.ok(snapshot.failures.includes('磁盘容量'))
 host.ipc.system_list_volumes=()=>({volumes:[volume('/','disk1')],partial:true,errors:['外置盘拒绝访问']})
 snapshot=await fetchHardwareTelemetrySnapshot();assert.ok(snapshot.failures.includes('磁盘容量'))
})
