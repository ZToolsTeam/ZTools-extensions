import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDeclarativeBridge, setDeclarativeBridge, Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import SystemBackupCommand from '../dist/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin.json'), 'utf8'))
const host = createHost()

const VAULT = 'C:\\Users\\tester\\Documents\\ZToolsBackups'

function setupBackupHost(initialArchives = [{ name: 'snap-1.zip', path: `${VAULT}\\snap-1.zip`, sizeBytes: 512, createdAt: '2026-11-10T10:00:00.000Z' }]) {
  let archives = [...initialArchives]
  const trashed = []
  let createCount = 0

  setDeclarativeBridge({
    ...getDeclarativeBridge(),
    hostTransport: {
      async call(method, params) {
        const handler = host.ipc[method]
        if (!handler) throw new Error(`UNEXPECTED_CHANNEL: ${method}`)
        return await handler(params)
      }
    }
  })

  host.ipc.system_get_path = async ({ name }) => {
    if (name === 'home') return 'C:\\Users\\tester'
    if (name === 'appData') return 'C:\\Users\\tester\\AppData\\Roaming'
    if (name === 'documents') return 'C:\\Users\\tester\\Documents'
    return ''
  }
  host.ipc.filesystem_get_file_size = async ({ path: target }) => {
    if (target.endsWith('.gitconfig') || target.endsWith('settings.json')) return 256
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  }
  host.ipc.dllplugin_call = async ({ func, params }) => {
    if (func === 'scanSnapshots') return { success: true, backups: archives }
    if (func === 'createSnapshotArchive') {
      createCount++
      const archivePath = `${VAULT}\\snap-new-${createCount}.zip`
      archives = [...archives, { name: `snap-new-${createCount}.zip`, path: archivePath, sizeBytes: 1024, createdAt: '2026-11-11T10:00:00.000Z' }]
      return { ok: true, success: true, archivePath, backedUpCount: params.sourcePaths.length, sizeBytes: 1024, failedSources: [] }
    }
    if (func === 'extractSnapshotArchive') {
      return { ok: true, success: true, targetDir: `${VAULT}\\extracted-1` }
    }
    throw new Error(`Unexpected dll func: ${func}`)
  }
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    trashed.push(fullPath)
    archives = archives.filter(a => a.path !== fullPath)
    return { success: true }
  }
  return { getCreateCount: () => createCount, trashed }
}

test.beforeEach(() => host.reset())

test('标题与清单更正为「配置快照备份」，右侧配置项 Enter 主动作切换勾选，不再误触全量打包', async () => {
  assert.equal(manifest.id, 'system-backup')
  assert.equal(manifest.name, '配置快照备份')
  assert.equal(manifest.i18n['en-US'].name, 'Config Snapshot Backup')

  const { getCreateCount } = setupBackupHost()
  const view = await mount(SystemBackupCommand)
  try {
    await tick(10)
    assert.equal(view.tree().props.navigationTitle, '配置快照备份')
    const subItems = view.tree().props.subList.items
    const gitItem = subItems.find(i => i.props.id === 'item-bak_gitconfig')
    assert.ok(gitItem)
    const actions = view.actions(gitItem)
    assert.equal(actions[0].props.title, '取消勾选', 'Enter 主动作应为切换勾选，而非直接打包')
    assert.equal(actions[1].props.title, '在资源管理器中显示')
    assert.match(actions[2].props.title, /^创建快照/)

    // 触发主动作只切换勾选，不调用打包
    await view.run(gitItem, '取消勾选')
    assert.equal(getCreateCount(), 0)
    const updatedGitItem = view.tree().props.subList.items.find(i => i.props.id === 'item-bak_gitconfig')
    assert.equal(updatedGitItem.props.checked, false)
    assert.equal(view.actions(updatedGitItem)[0].props.title, '勾选此配置')

    // 顶栏主按钮触发全量打包并弹成功 Toast
    const backupBtn = view.tree().props.filterBar.actions.find(a => a.id === 'create-backup')
    assert.ok(backupBtn)
    await backupBtn.onAction()
    await tick(10)
    assert.equal(getCreateCount(), 1)
    assert.equal(host.lastToast().style, Toast.Style.Success)
    assert.equal(host.lastToast().title, '配置快照已创建')
  } finally {
    view.unmount()
  }
})

test('解压与删除历史快照：带 confirmAlert 二次确认，取消不删，确认后移入回收站并弹 Toast', async () => {
  const { trashed } = setupBackupHost()
  const view = await mount(SystemBackupCommand)
  try {
    await tick(10)
    const archiveItem = view.tree().props.subList.items.find(i => i.props.id.startsWith('item-archive:'))
    assert.ok(archiveItem)

    // 解压成功弹 Success Toast
    await view.run(archiveItem, '解压此快照')
    assert.equal(host.lastToast().style, Toast.Style.Success)
    assert.equal(host.lastToast().title, '快照解压完成')

    // 删除取消时不调用 shell_trash_item
    host.setConfirm(false)
    await view.run(archiveItem, '删除此快照')
    assert.equal(host.confirms.length, 1)
    assert.equal(trashed.length, 0)

    // 删除确认后调用 shell_trash_item、刷新列表并弹 Success Toast
    host.setConfirm(true)
    await view.run(archiveItem, '删除此快照')
    await tick(10)
    assert.equal(host.confirms.length, 2)
    assert.deepEqual(trashed, [`${VAULT}\\snap-1.zip`])
    assert.equal(host.lastToast().style, Toast.Style.Success)
    assert.equal(host.lastToast().title, '快照已移入回收站')
    assert.ok(!view.tree().props.subList.items.some(i => i.props.id.startsWith('item-archive:')))
  } finally {
    view.unmount()
  }
})
