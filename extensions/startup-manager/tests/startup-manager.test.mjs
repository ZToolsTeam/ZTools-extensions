import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pluginModule = require('../dist/windows-command.js')

const { default: StartupManagerCommand } = pluginModule

test('1. [Plugin Bundle] startup-manager 构建产物导出声明式主视图且符合布局一规范与深链映射', () => {
  assert.equal(typeof StartupManagerCommand, 'function')

  const defaultView = StartupManagerCommand({ featureCode: 'startup-all' })
  assert.equal(defaultView.type, 'List')
  assert.equal(defaultView.props.isShowingDetail, false)
  assert.equal(defaultView.props.navigationTitle, '启动管理')
  assert.equal(defaultView.props.searchBarAccessory.type, 'List.Dropdown')
  assert.equal(defaultView.props.searchBarAccessory.props.value, 'all')
  assert.equal(defaultView.props.filterBar.actions.length, 2)

  const servicesView = StartupManagerCommand({ featureCode: 'startup-services' })
  assert.equal(servicesView.props.searchBarAccessory.props.value, 'service')

  const tasksView = StartupManagerCommand({ featureCode: 'startup-tasks' })
  assert.equal(tasksView.props.searchBarAccessory.props.value, 'task')
})
