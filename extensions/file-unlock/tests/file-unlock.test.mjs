import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pluginModule = require('../dist/index.js')

const { default: FileUnlockCommand } = pluginModule

test('1. [Plugin Bundle] file-unlock 构建产物导出声明式主视图且符合布局一规范', () => {
  assert.equal(typeof FileUnlockCommand, 'function')
  const view = FileUnlockCommand({
    initialPath: 'D:\\Projects\\locked-report.docx'
  })
  assert.ok(view)
  assert.equal(view.type, 'List')
  assert.equal(view.props.isShowingDetail, false)
  assert.equal(view.props.navigationTitle, '文件解锁')
  assert.ok(view.props.searchBarAccessory)
  assert.equal(view.props.searchBarAccessory.type, 'List.Dropdown')
  assert.ok(view.props.filterBar)
  assert.equal(Array.isArray(view.props.filterBar.actions), true)
  assert.equal(view.props.filterBar.actions.length, 2)
})
