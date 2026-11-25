import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import QuickFoldersCommand from '../dist/index.js'
import { buildTerminalCdCommand, CUSTOM_FOLDERS_STORAGE_KEY } from '../dist/logic.js'

const host = createHost()

const WIN_FOLDERS = [
  { id: 'home', path: 'D:\\Users\\alice', exists: true },
  { id: 'desktop', path: 'D:\\Users\\alice\\Desktop', exists: true },
  { id: 'downloads', path: 'D:\\Users\\alice\\Downloads', exists: true }
]

test.beforeEach(() => {
  host.reset()
  host.ipc.system_list_common_folders = async () => ({ success: true, data: { folders: WIN_FOLDERS } })
})

test('自定义收藏文件夹：选目录添加、置顶、持久化恢复与移除闭环', async () => {
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'E:\\Work\\Alpha' })
  const view = await mount(QuickFoldersCommand)
  try {
    await tick(10)
    const addBtn = view.tree().props.filterBar.actions.find(a => a.id === 'add-folder')
    await addBtn.onAction()
    await tick()
    assert.equal(host.lastToast().style, Toast.Style.Success)
    assert.equal(host.lastToast().title, '已添加到收藏目录')
    const addedItem = view.items().find(i => i.props.subtitle === 'E:\\Work\\Alpha')
    assert.ok(addedItem)
    assert.equal(addedItem.props.title, 'Alpha')

    // 添加第二个目录并置顶第二个，验证置顶排在最前
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'E:\\Work\\Beta' })
    await addBtn.onAction()
    await tick()
    const betaItem = view.items().find(i => i.props.subtitle === 'E:\\Work\\Beta')
    await view.run(betaItem, '置顶此目录')
    assert.equal(host.lastToast().title, '已置顶目录')
    assert.equal(view.items()[0].props.subtitle, 'E:\\Work\\Beta')
    assert.ok(JSON.stringify(view.items()[0].props.accessories).includes('已置顶'))

    // 验证持久化：卸载重挂载后自定义收藏与置顶顺序仍在
    view.unmount()
    const view2 = await mount(QuickFoldersCommand)
    try {
      await tick(10)
      assert.equal(view2.items()[0].props.subtitle, 'E:\\Work\\Beta')
      await view2.run(view2.items()[0], '移除收藏')
      assert.equal(host.lastToast().title, '已移除收藏目录')
      assert.ok(!view2.items().some(i => i.props.subtitle === 'E:\\Work\\Beta'))
    } finally {
      view2.unmount()
    }
  } finally {
    view.unmount()
  }
})

test('自定义收藏：对话框不支持时降级到手动添加表单，并拦截重复路径与空路径', async () => {
  const view = await mount(QuickFoldersCommand)
  try {
    await tick(10)
    // 测试宿主未实现 window_show_select_folder_dialog -> 自动打开手动添加表单
    const addBtn = view.tree().props.filterBar.actions.find(a => a.id === 'add-folder')
    await addBtn.onAction()
    await tick()
    assert.equal(host.pushed.length, 1)

    const form = await mountPushed(host)
    try {
      // 空路径提交失败
      await form.run(undefined, '保存到收藏')
      assert.equal(host.lastToast().style, Toast.Style.Failure)
      assert.match(host.lastToast().message, /请输入文件夹路径/)

      await form.fill('path', 'E:\\Projects\\ZTools')
      await form.fill('name', '主工程')
      await form.run(undefined, '保存到收藏')
      assert.equal(host.lastToast().style, Toast.Style.Success)
      assert.equal(host.pushed.length, 0)
    } finally {
      form.unmount()
    }

    await tick()
    const saved = view.items().find(i => i.props.subtitle === 'E:\\Projects\\ZTools')
    assert.ok(saved)
    assert.equal(saved.props.title, '主工程')

    // 重复添加同一路径被拒绝
    const manualBtn = view.tree().props.filterBar.actions.find(a => a.id === 'manual-add-folder')
    await manualBtn.onAction()
    await tick()
    const dupForm = await mountPushed(host)
    try {
      await dupForm.fill('path', 'E:\\Projects\\ZTools\\')
      await dupForm.run(undefined, '保存到收藏')
      assert.equal(host.lastToast().style, Toast.Style.Failure)
      assert.match(host.lastToast().message, /已在收藏列表/)
    } finally {
      dupForm.unmount()
    }
  } finally {
    view.unmount()
  }
})

test('自定义收藏：存储写入失败时不篡改状态并提示失败', async () => {
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'E:\\FailSave' })
  host.faults.storageWrite = new Error('磁盘已满')
  const view = await mount(QuickFoldersCommand)
  try {
    await tick(10)
    const addBtn = view.tree().props.filterBar.actions.find(a => a.id === 'add-folder')
    await addBtn.onAction()
    await tick()
    assert.equal(host.lastToast().style, Toast.Style.Failure)
    assert.equal(host.lastToast().title, '保存收藏失败')
    assert.ok(!view.items().some(i => i.props.subtitle === 'E:\\FailSave'))
    assert.equal(host.storage.has(CUSTOM_FOLDERS_STORAGE_KEY), false)
  } finally {
    view.unmount()
  }
})

test('复制终端进入命令：Windows 与 POSIX 路径生成准确并写入剪贴板', async () => {
  assert.equal(buildTerminalCdCommand('D:\\Users\\alice\\Desktop'), 'cd /d "D:\\Users\\alice\\Desktop"')
  assert.equal(buildTerminalCdCommand("/Users/bob/My 'Work'"), "cd '/Users/bob/My '\\''Work'\\'''")

  const view = await mount(QuickFoldersCommand)
  try {
    await tick(10)
    await view.run(view.item('desktop'), '复制终端进入命令')
    assert.equal(host.clipboard.text, 'cd /d "D:\\Users\\alice\\Desktop"')
    assert.equal(host.lastToast().style, Toast.Style.Success)
    assert.equal(host.lastToast().title, '已复制终端进入命令')
  } finally {
    view.unmount()
  }
})
