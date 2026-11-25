// 旧客户端没有 system_list_volumes：提示升级，而不是笼统的“读取失败”
import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'
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

test('i18n en-US: volume-ipc 全部错误提示与未知文件系统实时切换为英文且无中文残留', async () => {
  const host = createHost()
  host.reset()
  setRuntimeLocale('en-US')
  try {
    // 1. 旧客户端缺少接口
    host.ipc.system_list_volumes = async () => { throw Object.assign(new Error('METHOD_NOT_FOUND'), { code: 'METHOD_NOT_FOUND' }) }
    await assert.rejects(probeRealDiskDrives(), (err) => {
      assert.match(err.message, /Listing disk volumes requires a newer version of ZTools/)
      assert.ok(!/[\u4e00-\u9fa5]/.test(err.message))
      return true
    })

    // 2. 无法读取卷列表
    host.ipc.system_list_volumes = async () => ({ volumes: null })
    await assert.rejects(probeRealDiskDrives(), /Unable to read mounted volumes/)

    // 3. 卷列表不完整（有 / 无 errors 详情）
    host.ipc.system_list_volumes = async () => ({ volumes: [], partial: true, errors: ['E: locked', 'F: offline'] })
    await assert.rejects(probeRealDiskDrives(), /Incomplete volume list: E: locked; F: offline/)
    host.ipc.system_list_volumes = async () => ({ volumes: [], partial: true })
    await assert.rejects(probeRealDiskDrives(), /Incomplete volume list: Failed to read volume capacity/)

    // 4. 挂载卷数据无效 & 空列表
    host.ipc.system_list_volumes = async () => ({ volumes: [{ path: '', totalBytes: 0, usedBytes: 0, availableBytes: 0 }], partial: false })
    await assert.rejects(probeRealDiskDrives(), /Invalid volume data/)
    host.ipc.system_list_volumes = async () => ({ volumes: [], partial: false })
    await assert.rejects(probeRealDiskDrives(), /No mounted volumes found/)

    // 5. 缺少 fileSystem 时回退英文 Unknown
    host.ipc.system_list_volumes = async () => ({
      volumes: [{ path: 'C:\\', label: 'System', fileSystem: '', totalBytes: 1000, usedBytes: 400, availableBytes: 600 }],
      partial: false
    })
    const drives = await probeRealDiskDrives()
    assert.equal(drives[0].fileSystem, 'Unknown')
  } finally {
    setRuntimeLocale('zh-CN')
  }
})
