import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import ShredderCommand from '../dist/index.js'

const HOME = 'C:\\Users\\Tester'
const TEMP = `${HOME}\\AppData\\Local\\Temp`
const DUMPS = `${HOME}\\AppData\\Local\\CrashDumps`
const FILE_A = `${TEMP}\\session_a.tmp`
const FILE_B = `${TEMP}\\cache\\session_b.log`
const FILE_C = `${DUMPS}\\app.exe.1234.dmp`

function installHost(host, { failPaths = [] } = {}) {
  const wipeCalls = []
  host.ipc.system_list_common_folders = async () => ({ folders: [{ id: 'temp', path: TEMP, exists: true }] })
  host.ipc.system_get_path = async ({ name }) => (name === 'temp' ? `${HOME}\\PluginTemp` : name === 'home' ? HOME : '')
  host.ipc.system_search_files = async ({ query }) => {
    const q = String(query)
    if (q === `dir:${TEMP}`) {
      return {
        files: [
          { name: 'session_a.tmp', path: FILE_A, is_dir: false, size: 4096, mtime: 1 },
          { name: 'session_b.log', path: FILE_B, is_dir: false, size: 2048, mtime: 1 }
        ],
        total_matches: 2
      }
    }
    if (q === `dir:${DUMPS}`) {
      return { files: [{ name: 'app.exe.1234.dmp', path: FILE_C, is_dir: false, size: 8192, mtime: 1 }], total_matches: 1 }
    }
    return { files: [], total_matches: 0 }
  }
  host.ipc.dllplugin_call = async ({ plugin, func, params }) => {
    assert.equal(plugin, 'ShredderPlugin')
    assert.equal(func, 'secureWipeFile')
    wipeCalls.push(params)
    if (failPaths.includes(params.path)) {
      return { ok: false, success: false, error: '文件正被其他程序占用' }
    }
    return { ok: true, success: true, shreddedCount: 1, shredded: [params.path], errors: [] }
  }
  return wipeCalls
}

function fileRows(view) {
  return view.items().filter((it) => String(it.props.id).startsWith('shred-item-'))
}

function rowByPath(view, p) {
  return fileRows(view).find((it) => it.props.subtitle === p)
}

test('shredder UI: 打开后列出真实候选文件且不勾选任何文件，未勾选时不弹确认也不粉碎', async () => {
  const host = createHost()
  const wipeCalls = installHost(host)
  const view = await mount(ShredderCommand, host)

  const rows = fileRows(view)
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.props.checked === false), '打开时不应默认勾选任何文件')
  assert.match(view.tree().props.filterBar.summaryText, /已勾选 0 项/)
  // 崩溃转储按路径归入自己的分类
  assert.equal(rowByPath(view, FILE_C).props.accessories[1].tag.value, '崩溃转储')

  await view.run(rows[0], '粉碎已勾选文件 (0 项 / 0 B)')
  assert.equal(host.confirms.length, 0)
  assert.equal(wipeCalls.length, 0)
  assert.equal(host.lastToast().title, '请先勾选要粉碎的文件')
  view.unmount()
})

test('shredder UI: 确认框逐个列出文件，取消时不粉碎任何文件', async () => {
  const host = createHost()
  const wipeCalls = installHost(host)
  const view = await mount(ShredderCommand, host)

  await view.run(rowByPath(view, FILE_A), '勾选此文件')
  await view.run(rowByPath(view, FILE_C), '勾选此文件')
  host.setConfirm(false)
  await view.run(rowByPath(view, FILE_A), '粉碎已勾选文件 (2 项 / 12.0 KB)')

  assert.equal(host.confirms.length, 1)
  const confirm = host.confirms[0]
  assert.equal(confirm.title, '确认粉碎 2 个文件？')
  assert.match(confirm.message, /session_a\.tmp/)
  assert.match(confirm.message, /app\.exe\.1234\.dmp/)
  assert.doesNotMatch(confirm.message, /session_b\.log/)
  assert.equal(confirm.primaryAction.style, 'destructive')
  assert.equal(wipeCalls.length, 0, '取消确认后不能调用粉碎')
  assert.equal(fileRows(view).length, 3)
  view.unmount()
})

test('shredder UI: 部分失败时如实提示，只处理已勾选文件，不改用普通删除', async () => {
  const host = createHost()
  const wipeCalls = installHost(host, { failPaths: [FILE_C] })
  const view = await mount(ShredderCommand, host)

  await view.run(rowByPath(view, FILE_A), '勾选此文件')
  await view.run(rowByPath(view, FILE_C), '勾选此文件')
  await view.run(rowByPath(view, FILE_A), '粉碎已勾选文件 (2 项 / 12.0 KB)')

  assert.deepEqual(wipeCalls.map((c) => c.path).sort(), [FILE_A, FILE_C].sort())
  assert.ok(!wipeCalls.some((c) => c.path === FILE_B), '未勾选的文件不能被粉碎')
  assert.equal(wipeCalls[0].passes, 3)
  assert.ok(!host.ipcCalls.some(([m]) => m === 'filesystem_delete_file' || m === 'shell_trash_item'))

  const toast = host.lastToast()
  assert.equal(toast.style, 'FAILURE')
  assert.equal(toast.title, '部分文件粉碎失败')
  assert.match(toast.message, /已粉碎 1 个文件/)
  assert.match(toast.message, /1 个失败/)
  assert.match(toast.message, /文件正被其他程序占用/)

  // 粉碎成功的文件从列表移除；失败的保留并保持勾选，未勾选的保持未勾选
  assert.equal(rowByPath(view, FILE_A), undefined)
  assert.equal(rowByPath(view, FILE_C).props.checked, true)
  assert.equal(rowByPath(view, FILE_B).props.checked, false)
  view.unmount()
})

test('shredder UI: 覆写方式下拉框把对应次数传给客户端，定位失败时提示', async () => {
  const host = createHost()
  const wipeCalls = installHost(host)
  const view = await mount(ShredderCommand, host)

  await view.dropdown('seven_pass')
  await view.run(rowByPath(view, FILE_B), '勾选此文件')
  await view.run(rowByPath(view, FILE_B), '粉碎已勾选文件 (1 项 / 2.0 KB)')
  assert.equal(wipeCalls.length, 1)
  assert.equal(wipeCalls[0].passes, 7)
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.match(host.lastToast().message, /已按「7 次覆写/)

  await view.run(rowByPath(view, FILE_A), '在资源管理器中定位此文件')
  assert.equal(host.lastToast().title, '无法在资源管理器中定位此文件')
  view.unmount()
})
