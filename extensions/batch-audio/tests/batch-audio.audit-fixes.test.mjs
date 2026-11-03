import test from 'node:test'
import assert from 'node:assert/strict'
import { processAudioSelection, fetchRealAudioWorkspace, invokeNativeCapability, getCapabilityItems } from '../dist/logic.js'
import { createHost, mount } from '../../shared/test-harness.mjs'
import { getDeclarativeBridge, setDeclarativeBridge } from '@ztools/declarative-ui'
import { BatchAudioCommand } from '../dist/index.js'
const files = [{ id: 'a', name: 'a.wav', path: 'C:\\a.wav' }, { id: 'b', name: 'b.wav', path: 'C:\\b.wav' }]

test('合并一次提交两输入，独立处理保留部分失败，空回执不算成功', async () => {
  const calls = []
  const host = { dllplugin_call: async ({params}) => {
    calls.push(params)
    return { ok: true, results: [{ outputPath: 'C:\\out.wav', sizeBytes: 1234 }] }
  } }
  const merged = await processAudioSelection('BatchMergeAudio', {format: 'wav'}, files, host)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].files, files.map(f=>f.path))
  assert.equal(merged.completed, 2)
  let n = 0
  const partial = await processAudioSelection('BatchLoudnorm', {}, files, {dllplugin_call: async () => ++n === 1 ? {ok:true,results:[{outputPath:'C:\\out.mp3',sizeBytes:12}]} : {ok:false,error:'failed'}})
  assert.equal(partial.completed, 1)
  assert.equal(partial.failed, 1)
  const empty = await processAudioSelection('BatchLoudnorm', {}, files.slice(0,1), {dllplugin_call: async () => ({ok:true})})
  assert.equal(empty.failed,1)
})

test('音频扫描权限失败保留摘要，不再呈现刷新成功', async () => {
  const h=createHost()
  h.ipc.system_get_path=async({name})=>`C:\\${name}`
  for(const method of ['system_search_files','filesystem_get_directory_contents']) h.ipc[method]=async()=>{throw new Error('EACCES')}
  const scan=await fetchRealAudioWorkspace()
  assert.equal(scan.files.length,0)
  assert.match(scan.error,/EACCES/)
  const ui=await mount(BatchAudioCommand,h)
  assert.match(JSON.stringify(ui.tree()),/EACCES/)
  ui.unmount()
})


test('真实SDK音频调用使用长任务超时，并拒绝没有业务确认的回执', async () => {
  createHost()
  const bridge=getDeclarativeBridge()
  const calls=[]
  setDeclarativeBridge({...bridge,hostTransport:{call:async(method,params,options)=>{
    calls.push({method,params,options})
    return {success:true,data:{ok:true,success:true,results:[{outputPath:'C:\\out.mp3',sizeBytes:100}]}}
  }}})
  const result=await invokeNativeCapability('BatchLoudnorm',{files:['C:\\in.wav']})
  assert.equal(result.ok,true)
  assert.equal(calls[0].options.timeoutMs,300000)
  setDeclarativeBridge({...bridge,hostTransport:{call:async()=>({})}})
  assert.equal((await invokeNativeCapability('BatchLoudnorm',{files:['C:\\in.wav']})).ok,false)
  setDeclarativeBridge(bridge)
})

test('音频方法和文件参数在调用宿主前校验，数组中的无效路径不能被忽略', async () => {
  let called = 0
  const host = { dllplugin_call: async () => { called++; return { ok: true } } }
  for (const params of [
    {}, { files: [] }, { files: 'C:\\in.wav' }, { files: new Array(1) },
    { files: ['C:\\in.wav', 123] }, { files: ['C:\\in.wav', ''] },
    { files: ['relative.wav'] }, { files: ['C:\\music\\..\\in.wav'] },
    { files: ['C:\\in\0.wav'] }, { files: [['C:\\in.wav']] },
    { files: ['C:\\in.wav'], outputDir: false },
    { files: ['C:\\in.wav'], outputPath: 'C:\\Windows\\System32\\out.wav' },
    { files: ['C:\\a.wav', 'C:\\b.wav'], outputPath: 'C:\\out.wav' }
  ]) {
    await assert.rejects(invokeNativeCapability('BatchLoudnorm', params, host), /INVALID_|SECURITY_INTERCEPTED/)
  }
  await assert.rejects(invokeNativeCapability('UnknownMethod', { files: ['C:\\in.wav'] }, host), /INVALID_METHOD/)
  await assert.rejects(invokeNativeCapability('BatchMergeAudio', { files: ['C:\\in.wav'] }, host), /合并需要/)
  assert.equal(called, 0)
  for (const mode of getCapabilityItems()) {
    await invokeNativeCapability(mode.method, { ...mode.params, files: ['C:\\音乐\\a.wav', '\\\\server\\music\\b.wav'] }, host)
  }
  await invokeNativeCapability('BatchLoudnorm', { inputPath: 'D:\\Media\\song.flac' }, host)
  assert.equal(called, 13)
})
