import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getDefaultFolders,
  expandEnvironmentVariables
} from '../dist/logic.js'

test('QuickFolders 默认目录生成与分类测试', () => {
  const folders = getDefaultFolders({
    USERPROFILE: 'C:\\Users\\TestUser',
    APPDATA: 'C:\\Users\\TestUser\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\TestUser\\AppData\\Local',
    WINDIR: 'C:\\Windows',
    TEMP: 'C:\\Users\\TestUser\\AppData\\Local\\Temp'
  })

  assert.ok(folders.length >= 10, '应包含至少10个常用文件夹')

  const desktop = folders.find(f => f.id === 'desktop')
  assert.ok(desktop)
  assert.equal(desktop.path, 'C:\\Users\\TestUser\\Desktop')
  assert.equal(desktop.category, 'personal')

  const appdata = folders.find(f => f.id === 'appdata-roaming')
  assert.ok(appdata)
  assert.equal(appdata.path, 'C:\\Users\\TestUser\\AppData\\Roaming')
  assert.equal(appdata.category, 'system')

  const temp = folders.find(f => f.id === 'temp')
  assert.ok(temp)
  assert.equal(temp.category, 'temp')
})

test('QuickFolders 环境变量展开与边界测试', () => {
  const env = {
    USERPROFILE: 'C:\\Users\\Alice',
    SYSTEMROOT: 'C:\\Windows'
  }

  const expanded = expandEnvironmentVariables('%USERPROFILE%\\Documents', env)
  assert.equal(expanded, 'C:\\Users\\Alice\\Documents')

  const multiple = expandEnvironmentVariables('%SYSTEMROOT%\\Temp and %USERPROFILE%', env)
  assert.equal(multiple, 'C:\\Windows\\Temp and C:\\Users\\Alice')

  // 边界: 未定义变量置空
  const unknown = expandEnvironmentVariables('%NON_EXISTENT_VAR%\\test', env)
  assert.equal(unknown, '\\test')

  // 边界: 空输入与无百分号
  assert.equal(expandEnvironmentVariables('', env), '')
  assert.equal(expandEnvironmentVariables('D:\\regular\\path', env), 'D:\\regular\\path')
})
