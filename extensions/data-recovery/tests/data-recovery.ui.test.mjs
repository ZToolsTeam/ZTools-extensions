import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import DataRecoveryCommand from '../dist/index.js'

const DESKTOP = 'C:\\Users\\Tester\\Desktop'
const BIN = 'C:\\$Recycle.Bin\\S-1-5-21-1000'

function installHost(host) {
  const restoreCalls = []
  host.ipc.system_get_path = async ({ name }) => (name === 'desktop' ? DESKTOP : '')
  host.ipc.dllplugin_call = async ({ plugin, func, params }) => {
    assert.equal(plugin, 'DataRecoveryPlugin')
    if (func === 'scanDeletedFiles') {
      return {
        ok: true,
        success: true,
        items: [
          { id: 'a', name: '$RAAA111.docx', cachePath: `${BIN}\\$RAAA111.docx`, sizeBytes: 2048 },
          { id: 'b', name: '$RBBB222.png', cachePath: `${BIN}\\$RBBB222.png`, sizeBytes: 4096 }
        ]
      }
    }
    if (func === 'restoreFile') {
      restoreCalls.push(params)
      return { ok: true, success: true, targetPath: params.targetPath }
    }
    throw new Error(`unexpected ${func}`)
  }
  return restoreCalls
}

function fileRows(view) {
  return view.items().filter((it) => String(it.props.id).startsWith('rec-item-'))
}

test('data-recovery UI: 不默认勾选，没有勾选时不恢复任何文件，也没有客户端做不到的扫描模式', async () => {
  const host = createHost()
  const restoreCalls = installHost(host)
  const view = await mount(DataRecoveryCommand, host)

  const rows = fileRows(view)
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.props.checked === false))
  assert.equal(view.tree().props.searchBarAccessory, undefined)
  assert.doesNotMatch(view.text(), /完整度|深度扇区|MFT/)

  await view.run(rows[0], '复制已勾选文件到恢复文件夹 (0 项)')
  assert.equal(restoreCalls.length, 0)
  assert.equal(host.lastToast().title, '请先勾选要恢复的文件')
  view.unmount()
})

test('data-recovery UI: 只复制已勾选的文件到新的子文件夹，并提示结果', async () => {
  const host = createHost()
  const restoreCalls = installHost(host)
  const view = await mount(DataRecoveryCommand, host)

  await view.run(fileRows(view)[1], '勾选此文件')
  await view.run(fileRows(view)[0], '复制已勾选文件到恢复文件夹 (1 项)')
  assert.equal(restoreCalls.length, 1)
  assert.equal(restoreCalls[0].sourcePath, `${BIN}\\$RBBB222.png`)
  assert.match(restoreCalls[0].targetPath, /^C:\\Users\\Tester\\Desktop\\ZToolsRecovered\\\d{8}-\d{6}-\d{3}\\\$RBBB222\.png$/)
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.match(host.lastToast().message, /已将 1 个文件/)
  view.unmount()
})

test('data-recovery UI: 读取回收站失败时显示原因，不显示任何文件', async () => {
  const host = createHost()
  installHost(host)
  host.ipc.dllplugin_call = async () => ({ ok: false, success: false, error: '拒绝访问' })
  const view = await mount(DataRecoveryCommand, host)
  assert.equal(fileRows(view).length, 0)
  assert.match(view.tree().props.filterBar.summaryText, /读取回收站失败：拒绝访问/)
  assert.match(view.tree().props.subList.emptyText, /拒绝访问/)
  view.unmount()
})
