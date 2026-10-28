import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import SoftwareManagerCommand from '../dist/index.js'

const ROAMING = 'C:\\Users\\Tester\\AppData\\Roaming'

function installHost(host, { uninstallError, listError } = {}) {
  const uninstallCalls = []
  host.ipc.applications_list = async () => {
    if (listError) throw new Error(listError)
    return [
      {
        id: 'app-0-x',
        name: 'Google Chrome',
        version: '124.0.1',
        publisher: 'Google LLC',
        installLocation: 'C:\\Program Files\\Google\\Chrome\\Application',
        uninstallString: '"C:\\Program Files\\Google\\Chrome\\Application\\setup.exe" --uninstall',
        isSystemComponent: false,
        estimatedSize: 300 * 1024 * 1024
      },
      { id: 'app-1-y', name: 'NoVersionTool', version: '', publisher: '', installLocation: '', uninstallString: 'MsiExec.exe /X{0000}', isSystemComponent: false }
    ]
  }
  host.ipc.applications_uninstall = async (params) => {
    uninstallCalls.push(params)
    if (uninstallError) throw new Error(uninstallError)
    return { success: true, message: 'ok' }
  }
  host.ipc.system_get_path = async ({ name }) => (name === 'appData' ? ROAMING : name === 'home' ? 'C:\\Users\\Tester' : '')
  host.ipc.system_search_files = async ({ query }) => {
    if (query === `dir:${ROAMING}`) {
      return { files: [], subdirs: [{ name: 'OldTool', path: `${ROAMING}\\OldTool`, file_count: 1, total_bytes: 500000 }], total_matches: 1 }
    }
    if (query === `dir:${ROAMING}\\OldTool`) {
      return { files: [{ name: 'a.bin', path: `${ROAMING}\\OldTool\\a.bin`, is_dir: false, size: 500000, mtime: 1 }], total_matches: 1, total_bytes: 500000 }
    }
    return { files: [], total_matches: 0 }
  }
  host.ipc.shell_trash_item = async () => {
    throw new Error('不应移入回收站')
  }
  return uninstallCalls
}

test('software-manager UI: 显示登记的真实软件，缺失字段显示未知，没有无用的勾选框', async () => {
  const host = createHost()
  installHost(host)
  const view = await mount(SoftwareManagerCommand, host)

  const chrome = view.item('app-0-x')
  const bare = view.item('app-1-y')
  assert.match(chrome.props.subtitle, /Google LLC · v124\.0\.1 · C:/)
  assert.equal(bare.props.subtitle, '未知发布商 · 未知版本 · 安装位置未知')
  assert.equal(bare.props.accessories[2].text, '体积未知')
  assert.equal(chrome.props.checkable, undefined)
  assert.equal(view.tree().props.subList.checkable, undefined)
  assert.ok(!view.actions(bare).some((a) => a.props.title === '在资源管理器中定位安装目录'), '没有登记安装目录时不提供定位')
  assert.ok(!view.actions(chrome).some((a) => /静默/.test(a.props.title)), '客户端不支持静默卸载，不提供该动作')
  assert.match(view.tree().props.filterBar.summaryText, /1 款未登记体积/)
  view.unmount()
})

test('software-manager UI: 卸载前确认并显示卸载命令，取消不执行，失败如实提示', async () => {
  const host = createHost()
  const uninstallCalls = installHost(host)
  const view = await mount(SoftwareManagerCommand, host)

  host.setConfirm(false)
  await view.run(view.item('app-0-x'), '卸载')
  assert.equal(host.confirms.length, 1)
  assert.match(host.confirms[0].message, /setup\.exe" --uninstall/)
  assert.equal(host.confirms[0].primaryAction.style, 'destructive')
  assert.equal(uninstallCalls.length, 0)

  host.setConfirm(true)
  await view.run(view.item('app-0-x'), '卸载')
  assert.deepEqual(uninstallCalls, [{ command: 'Google Chrome' }])
  assert.equal(host.lastToast().title, '卸载程序已启动')
  view.unmount()

  const failHost = createHost()
  installHost(failHost, { uninstallError: '启动卸载程序失败: Google Chrome' })
  const failView = await mount(SoftwareManagerCommand, failHost)
  await failView.run(failView.item('app-0-x'), '卸载')
  assert.equal(failHost.lastToast().style, 'FAILURE')
  assert.match(failHost.lastToast().message, /启动卸载程序失败/)
  failView.unmount()
})

test('software-manager UI: AppData 目录只读，不默认勾选也不能删除', async () => {
  const host = createHost()
  installHost(host)
  const view = await mount(SoftwareManagerCommand, host)
  view.item('sw-nav-appdata').props.onSelect()
  await new Promise((r) => setTimeout(r, 0))

  const dir = view.item('appdata-AppData\\Roaming-OldTool')
  assert.equal(dir.props.checkable, undefined)
  assert.equal(dir.props.accessories[1].tag.value, '未匹配到已安装软件')
  assert.deepEqual(view.actions(dir).map((a) => a.props.title), ['在资源管理器中定位', '复制目录路径'])
  assert.match(view.tree().props.filterBar.summaryText, /只读列出/)
  assert.ok(!host.ipcCalls.some(([m]) => m === 'shell_trash_item'))
  view.unmount()
})

test('software-manager UI: 读不到软件清单时显示原因，不显示推测的软件', async () => {
  const host = createHost()
  installHost(host, { listError: 'PowerShell 被策略禁用' })
  const view = await mount(SoftwareManagerCommand, host)
  assert.equal(view.items().filter((it) => String(it.props.id).startsWith('app-')).length, 0)
  assert.match(view.tree().props.filterBar.summaryText, /读取已安装软件失败：PowerShell 被策略禁用/)
  assert.match(view.tree().props.subList.emptyText, /PowerShell 被策略禁用/)
  view.unmount()
})
