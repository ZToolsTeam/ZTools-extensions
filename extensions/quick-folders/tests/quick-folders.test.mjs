import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getDefaultFolders,
  expandEnvironmentVariables,
  buildFolders
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

test('QuickFolders 按宿主真实目录生成：Windows 用户目录与被重定向的桌面', () => {
  const folders = buildFolders({
    home: 'D:\\Users\\alice',
    desktop: 'D:\\Users\\alice\\OneDrive\\桌面',
    downloads: '', documents: '', pictures: '', videos: '', music: '', appData: ''
  })
  const byId = Object.fromEntries(folders.map(f => [f.id, f]))
  assert.equal(byId.desktop.path, 'D:\\Users\\alice\\OneDrive\\桌面', '宿主给出的真实路径优先')
  assert.equal(byId.downloads.path, 'D:\\Users\\alice\\Downloads', '没读到的目录按主目录推断')
  assert.equal(byId['system-drive'].path, 'D:\\', '系统盘跟随主目录所在盘符')
  assert.equal(byId['appdata-roaming'].path, 'D:\\Users\\alice\\AppData\\Roaming')
  assert.ok(!folders.some(f => f.path.includes('Default')), '不能再出现 C:\\Users\\Default')
})

test('QuickFolders 按宿主真实目录生成：macOS 使用 POSIX 路径与 macOS 目录约定', () => {
  const folders = buildFolders({
    home: '/Users/bob', desktop: '/Users/bob/Desktop', downloads: '', documents: '', pictures: '',
    videos: '', music: '', appData: '/Users/bob/Library/Application Support'
  })
  const byId = Object.fromEntries(folders.map(f => [f.id, f]))
  assert.equal(byId.videos.path, '/Users/bob/Movies', 'macOS 的视频目录叫 Movies')
  assert.equal(byId.applications.path, '/Applications')
  assert.equal(byId.temp.path, '/tmp')
  assert.ok(folders.every(f => !f.path.includes('\\')), 'macOS 路径里不能混入反斜杠')
  assert.ok(!byId['system32'] && !byId['appdata-roaming'], 'macOS 上不出现 Windows 专属目录')
})

test('QuickFolders 宿主读不到主目录或返回脏数据时不编造路径', () => {
  assert.deepEqual(buildFolders({ home: '' }), [])
  assert.deepEqual(buildFolders(null), [])
  assert.deepEqual(buildFolders({ home: '   ' }), [])
})
