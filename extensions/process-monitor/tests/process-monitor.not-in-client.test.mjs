// 不在 ZTools 客户端里运行（没有宿主通道）时：不显示示例进程，列表为空并如实提示，读取接口直接报错
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ProcessMonitorCommand, {
  NOT_IN_CLIENT_MESSAGE,
  fetchProcesses,
  fetchSystemInfo,
  fetchProcessDetail,
  fetchServicesByPID
} from '../dist/index.js'
import * as logic from '../dist/logic.js'

test('插件不再导出任何示例进程数据', () => {
  for (const name of ['getMockProcesses', 'getMockSystemInfo', 'getMockProcessDetail', 'getMockServicesByPID']) {
    assert.equal(logic[name], undefined, name)
  }
})

test('没有宿主：读取进程与系统负载报「需要在 ZTools 客户端中使用」，详情与托管服务为空', async () => {
  const host = createHost()
  host.reset()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    await assert.rejects(fetchProcesses(), new RegExp(NOT_IN_CLIENT_MESSAGE))
    await assert.rejects(fetchSystemInfo(), new RegExp(NOT_IN_CLIENT_MESSAGE))
    assert.equal(await fetchProcessDetail(1044), null)
    assert.deepEqual(await fetchServicesByPID(1044), [])
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('没有宿主：界面只显示一条「需要在 ZTools 客户端中使用」，没有示例进程、不发起刷新', async () => {
  const host = createHost()
  host.reset()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(ProcessMonitorCommand, host)
    await tick(10)
    const items = view.items()
    assert.deepEqual(items.map((i) => i.props.id), ['load-error'])
    assert.equal(items[0].props.title, NOT_IN_CLIENT_MESSAGE)
    assert.equal(view.tree().props.filterBar.summaryText, NOT_IN_CLIENT_MESSAGE)
    assert.doesNotMatch(view.text(), /svchost|ntoskrnl|dev-server|Microsoft Corporation/)
    assert.equal(view.tree().props.navigationTitle, '进程监控')
    view.unmount()
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('宿主没给托管服务的状态与启动类型时留空，不填「Running」「Auto」', async () => {
  const host = createHost()
  host.reset()
  host.ipc.dllplugin_call = async () => ({ success: true, data: { services: [{ serviceName: 'Spooler' }] } })
  const list = await fetchServicesByPID(1044)
  assert.equal(list.length, 1)
  assert.equal(list[0].serviceName, 'Spooler')
  assert.equal(list[0].status, '')
  assert.equal(list[0].startType, '')
})
