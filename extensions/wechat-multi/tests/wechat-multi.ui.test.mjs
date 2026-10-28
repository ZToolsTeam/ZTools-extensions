// 界面集成测试：真实声明式运行时 + 模拟客户端（preload IPC 可注入结果或故障）
// 覆盖：不显示 CPU 与互斥锁说法；读取失败显示原因；启动成功提示限制、失败提示原因；没有结束进程的入口
import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import WechatMultiCommand from '../dist/index.js'

const host = createHost()
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
})

function installWechatHost({ status, launch }) {
  host.ipc.dllplugin_call = async ({ func }) => {
    if (func === 'getStatus') {
      if (status instanceof Error) throw status
      return status
    }
    if (func === 'launchInstance') {
      if (launch instanceof Error) throw launch
      return launch
    }
    throw new Error(`未模拟 ${func}`)
  }
}

const RUNNING = {
  ok: true,
  success: true,
  installed: true,
  installPath: 'C:\\Program Files\\Tencent\\WeChat\\WeChat.exe',
  instances: [{ pid: 4321, name: 'WeChat', memoryBytes: 314572800, workingSetBytes: 314572800, startTime: '09:15:02' }]
}

test('列出客户端返回的微信进程，不显示 CPU、互斥锁或结束进程入口', async () => {
  installWechatHost({ status: RUNNING })
  const view = await mount(WechatMultiCommand)
  await tick(20)
  const text = view.text()
  assert.equal(/CPU|互斥|突破|破解|解锁/.test(text), false)
  assert.equal(/结束/.test(text), false)
  const row = view.item('wx-proc-4321')
  assert.equal(row.props.subtitle, 'PID 4321 · 启动于 09:15:02')
  assert.deepEqual(view.actions(row).map((a) => a.props.title), ['复制 PID'])
  assert.match(view.tree().props.filterBar.summaryText, /运行中的 WeChat \/ Weixin 进程 1 个/)
  view.unmount()
})

test('[故障] 读取进程失败：显示失败原因，不显示示例进程', async () => {
  installWechatHost({ status: { ok: false, success: false, error: 'DETECT_FAILED: 读取微信进程失败，不能判断运行实例数' } })
  const view = await mount(WechatMultiCommand)
  await tick(20)
  const status = view.item('wx-status')
  assert.match(status.props.subtitle, /不能判断运行实例数/)
  assert.equal(view.items().some((i) => String(i.props.id).startsWith('wx-proc-')), false)
  assert.equal(view.items().some((i) => i.props.id === 'wx-launch'), false)
  view.unmount()
})

test('再运行一次微信：成功提示限制说明并刷新列表', async () => {
  installWechatHost({ status: RUNNING, launch: { ok: true, success: true, launchedCount: 1, pids: [5555] } })
  const view = await mount(WechatMultiCommand)
  await tick(20)
  await view.run(view.item('wx-launch'), '再运行一次微信')
  await tick(20)
  const toast = host.toasts.find((t) => t.title === '已再次运行微信程序')
  assert.ok(toast, '应提示已再次运行')
  assert.match(toast.message, /通常只会切换到已有窗口/)
  assert.equal(host.ipcCalls.filter(([m, p]) => m === 'dllplugin_call' && p.func === 'getStatus').length, 2)
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('[故障] 再运行一次微信：客户端未找到微信时提示原因，不提示成功', async () => {
  installWechatHost({ status: RUNNING, launch: { ok: false, success: false, error: '未检测到本地微信安装路径 (WeChat.exe)' } })
  const view = await mount(WechatMultiCommand)
  await tick(20)
  await view.run(view.item('wx-launch'), '再运行一次微信')
  await tick(10)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '启动微信失败')
  assert.match(host.lastToast().message, /未检测到本地微信安装路径/)
  assert.equal(host.toasts.some((t) => t.style === Toast.Style.Success), false)
  view.unmount()
})
