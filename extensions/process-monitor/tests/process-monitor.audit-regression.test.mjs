import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Command, { portLookup } from '../dist/index.js'
import { fetchSystemInfo, fetchProcessPorts, filterProcessesByPort } from '../dist/logic.js'

test('A：端口子命令调用真实端点，并按端口关联PID而非PID文本', async () => {
  const host = createHost()
  host.ipc.dllplugin_call = ({func}) => func === 'GetSystemInfo' ? {totalMemoryBytes:100,availableMemoryBytes:40,cpuUsagePercent:7} : func === 'GetProcessList' ? {processes:[{pid:234,name:'node',memoryBytes:30},{pid:8080,name:'unrelated'}]} : {error:'unavailable'}
  host.ipc.process_list_ports = () => ({ success:true, data:[{pid:234,localPort:8080,protocol:'TCP',localAddress:'127.0.0.1',processName:'node'}],source:'darwin-netstat' })
  const view = await mount(portLookup,host)
  try {
    await view.search('8080'); await tick(20)
    assert.equal(view.tree().props.searchBarAccessory.props.value,'port')
    assert.ok(view.items().some(i=>i.props.id==='234'))
    assert.ok(!view.items().some(i=>i.props.id==='8080'))
    assert.ok(host.ipcCalls.some(([method])=>method==='process_list_ports'))
  } finally { view.unmount() }
})
test('B：没有端口占用是成功空结果，非法端口不匹配其他进程', async () => {
  createHost().ipc.process_list_ports=()=>({data:[]})
  assert.deepEqual(await fetchProcessPorts(),[])
  assert.deepEqual(filterProcessesByPort([{pid:2}], [{pid:2,localPort:80}], '65536'),[])
})
test('C：宿主全部失败不返回演示指标，界面标记不可用且刷新失败', async () => {
  const host = createHost()
  await assert.rejects(fetchSystemInfo(),/无法读取系统负载/)
  const view = await mount(Command,host)
  try {
    await tick(10)
    assert.match(view.tree().props.filterBar.summaryText,/不可用|过期/)
    await view.tree().props.filterBar.actions[0].onAction(); await tick(10)
    assert.equal(host.lastToast().style,'FAILURE')
    assert.doesNotMatch(view.text(),/24\.5%/)
  } finally { view.unmount() }
})
