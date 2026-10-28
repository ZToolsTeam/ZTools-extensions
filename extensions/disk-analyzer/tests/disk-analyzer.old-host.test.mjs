// 旧客户端没有 system_list_volumes：提示升级，而不是笼统的“读取失败”
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import { probeRealDiskDrives } from '../dist/volume-ipc.js'

test('旧客户端读卷列表时提示升级', async () => {
  const host = createHost()
  host.reset()
  host.ipc.system_list_volumes = async () => { throw Object.assign(new Error('未知方法: system_list_volumes'), { code: 'METHOD_NOT_FOUND' }) }
  await assert.rejects(probeRealDiskDrives(), /需要新版 ZTools/)
  host.ipc.system_list_volumes = async () => { throw new Error('磁盘忙') }
  await assert.rejects(probeRealDiskDrives(), /磁盘忙/)
})
