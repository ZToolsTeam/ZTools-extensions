// 界面集成测试：真实声明式运行时 + 模拟客户端共享服务（可注入失败）
// 覆盖：启动 / 停止服务；选择文件后加入共享（含部分文件读不到、取消选择）；暂停、恢复、移出列表；
// 启动失败如实提示；没有剪贴板投送、上传等客户端做不到的入口
import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { installLanHost } from './lan-host-fake.mjs'
import LanShareCommand from '../dist/index.js'

const host = createHost()
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
})

const dllCalls = (func) => host.ipcCalls.filter(([m, p]) => m === 'dllplugin_call' && p.func === func)

async function clickFilterBar(view, id) {
  const action = view.tree().props.filterBar.actions.find((a) => a.id === id)
  assert.ok(action, `顶栏缺少按钮 ${id}`)
  action.onAction()
  await tick(30)
}

test('打开时只读取状态，不自动启动服务；没有剪贴板投送与上传入口', async () => {
  installLanHost(host)
  const view = await mount(LanShareCommand)
  await tick(20)
  assert.equal(dllCalls('startShareServer').length, 0)
  assert.equal(view.item('lan-service').props.title, '共享服务未运行')
  const text = view.text()
  assert.equal(/剪贴板投送|上传照片|双向/.test(text), false)
  assert.equal(/"color"/.test(text), false)
  view.unmount()
})

test('启动服务：成功后显示访问地址与二维码，提示无需密码', async () => {
  installLanHost(host)
  const view = await mount(LanShareCommand)
  await tick(20)
  await view.run(view.item('lan-service'), '启动共享服务')
  await tick(20)
  assert.equal(dllCalls('startShareServer').length, 1)
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '共享服务已启动')
  const service = view.item('lan-service')
  assert.equal(service.props.title, '共享服务运行中：http://192.168.1.20:8765')
  const md = service.props.detail.props.markdown
  assert.match(md, /data:image\/svg\+xml/)
  assert.match(md, /不需要密码/)
  assert.match(md, /172\.20\.0\.1:8765/, '应列出本机的其他地址')
  view.unmount()
})

test('[故障] 启动服务失败：提示原因，仍显示未运行', async () => {
  const state = installLanHost(host)
  state.startError = Object.assign(new Error('listen EACCES: permission denied 0.0.0.0:8765'), { code: 'EACCES' })
  const view = await mount(LanShareCommand)
  await tick(20)
  await view.run(view.item('lan-service'), '启动共享服务')
  await tick(20)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '启动共享服务失败')
  assert.match(host.lastToast().message, /EACCES/)
  assert.equal(view.item('lan-service').props.title, '共享服务未运行')
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('选择文件并共享：读不到的文件如实提示跳过，列表只显示客户端确认加入的文件', async () => {
  const state = installLanHost(host, { existing: ['D:\\Share\\a.txt'] })
  state.dialog = { canceled: false, filePaths: [{ path: 'D:\\Share\\a.txt' }, { path: 'D:\\Share\\gone.txt' }] }
  const view = await mount(LanShareCommand)
  await tick(20)
  await clickFilterBar(view, 'add-files')
  assert.deepEqual(dllCalls('addFiles')[0][1].params, { paths: ['D:\\Share\\a.txt', 'D:\\Share\\gone.txt'] })
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '已共享 1 个文件，1 个文件无法读取已跳过')
  assert.match(host.lastToast().message, /不需要密码/)
  const fileRows = view.items().filter((i) => String(i.props.id).startsWith('lan-file-'))
  assert.deepEqual(fileRows.map((i) => i.props.title), ['a.txt'])
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('[边界] 取消选择文件：不调用客户端加文件，也不提示', async () => {
  installLanHost(host)
  const view = await mount(LanShareCommand)
  await tick(20)
  host.toasts.length = 0
  await clickFilterBar(view, 'add-files')
  assert.equal(dllCalls('addFiles').length, 0)
  assert.equal(host.toasts.length, 0)
  view.unmount()
})

test('[故障] 选中的文件都读不到：提示失败，不报成功', async () => {
  const state = installLanHost(host)
  state.dialog = { canceled: false, filePath: 'D:\\Share\\gone.txt' }
  const view = await mount(LanShareCommand)
  await tick(20)
  await clickFilterBar(view, 'add-files')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '共享文件失败')
  assert.equal(host.toasts.some((t) => t.style === Toast.Style.Success), false)
  view.unmount()
})

test('暂停、恢复、移出共享列表：用 id 调用客户端，界面以客户端状态为准', async () => {
  const state = installLanHost(host)
  state.running = true
  state.files.set('id1', { id: 'id1', name: 'a.txt', path: 'D:\\Share\\a.txt', size: 10, sizeBytes: 10, shared: true, isDirectory: false })
  const view = await mount(LanShareCommand)
  await tick(20)

  await view.run(view.item('lan-file-id1'), '暂停共享该文件')
  await tick(20)
  assert.deepEqual(dllCalls('toggleFileShare')[0][1].params, { id: 'id1', shared: false })
  let row = view.item('lan-file-id1')
  assert.deepEqual(row.props.accessories[0], { tag: { value: '已暂停' } })
  assert.equal(view.actions(row).some((a) => a.props.title === '复制下载地址'), false)

  await view.run(row, '恢复共享该文件')
  await tick(20)
  row = view.item('lan-file-id1')
  assert.deepEqual(row.props.accessories[0], { tag: { value: '共享中' } })

  await view.run(row, '从共享列表移除（不删除文件）')
  await tick(20)
  assert.equal(view.items().some((i) => i.props.id === 'lan-file-id1'), false)
  assert.match(host.lastToast().title, /文件本身没有删除/)
  view.unmount()
})

test('停止服务：成功后显示未运行', async () => {
  const state = installLanHost(host)
  state.running = true
  const view = await mount(LanShareCommand)
  await tick(20)
  await view.run(view.item('lan-service'), '停止共享服务')
  await tick(20)
  assert.equal(host.lastToast().title, '共享服务已停止')
  assert.equal(view.item('lan-service').props.title, '共享服务未运行')
  view.unmount()
})
