import test from 'node:test'
import assert from 'node:assert/strict'
import {createHost} from '../../shared/test-harness.mjs'
import {fetchHardwareTelemetrySnapshot} from '../dist/logic.js'
import {probeRealDiskDrives} from '../dist/volume-ipc.js'
const volume=(path,capacityGroup)=>({path,capacityGroup,label:path,fileSystem:'APFS',totalBytes:100,usedBytes:60,availableBytes:40})

test('显示所有挂载卷，APFS容量按容器去重，Windows Z盘不遗漏',async()=>{
 const host=createHost();host.ipc.system_list_volumes=()=>({volumes:[volume('/','disk1'),volume('/System/Volumes/Data','disk1'),volume('/Volumes/外置','disk2'),volume('Z:\\','diskZ')],partial:false})
 const drives=await probeRealDiskDrives();assert.equal(drives.length,4);assert.equal(drives.at(-1).drive,'Z:')
 const snapshot=await fetchHardwareTelemetrySnapshot()
 assert.equal(snapshot.totalDiskBytes,300)
})
test('枚举失败如实标注磁盘模块失败；部分卷失败保留读到的卷并标注「部分磁盘卷」与原因',async()=>{
 const host=createHost();let snapshot=await fetchHardwareTelemetrySnapshot();assert.ok(snapshot.failures.includes('磁盘容量'))
 assert.ok(snapshot.warnings.some(w=>w.startsWith('磁盘容量：')),'枚举失败的原因不能被吞掉')
 host.ipc.system_list_volumes=()=>({volumes:[volume('/','disk1')],partial:true,errors:['外置盘拒绝访问']})
 snapshot=await fetchHardwareTelemetrySnapshot()
 assert.ok(!snapshot.failures.includes('磁盘容量'));assert.ok(snapshot.failures.includes('部分磁盘卷'))
 assert.equal(snapshot.diskPartial,true);assert.equal(snapshot.driveCount,1);assert.equal(snapshot.totalDiskBytes,100)
 assert.deepEqual(snapshot.warnings.filter(w=>w.startsWith('磁盘容量')),['磁盘容量：外置盘拒绝访问'])
})
