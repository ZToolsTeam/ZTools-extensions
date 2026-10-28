// 本插件的宿主集成测试（导入本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import { setDeclarativeBridge } from '@ztools/declarative-ui'
import BoostCommand from '../dist/index.js'
import * as boost from '../dist/logic.js'

const MB = 1024 * 1024
const APPDATA = 'C:\\Users\\tester\\AppData\\Roaming'
const TEMP = 'C:\\Users\\tester\\AppData\\Local\\Temp'
const USER_STARTUP = `${APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup`
const COMMON_STARTUP = 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp'

function withBridge(bridge, fn) {
  setDeclarativeBridge(bridge)
  return Promise.resolve()
    .then(fn)
    .finally(() => setDeclarativeBridge(null))
}

function hostError(code, message) {
  return Object.assign(new Error(message), { name: 'ZToolsHostError', code })
}

function dirListing(files) {
  return { success: true, data: { files, subdirs: [], total_matches: files.length } }
}

// 测试替身：客户端返回的进程、内存、路径与目录扫描结果
function createHost(overrides = {}) {
  const calls = []
  const handlers = {
    dllplugin_call: async (p) => {
      if (p.func !== 'GetProcessList') throw new Error(`unexpected ${p.func}`)
      return {
        success: true,
        data: {
          processes: [
            { pid: 4, name: 'System', path: '', workingSetBytes: 2 * MB, isSystem: true },
            { pid: 1200, name: 'chrome.exe', path: 'C:\\Program Files\\Google\\chrome.exe', workingSetBytes: 900 * MB, isSystem: false },
            { pid: 1300, name: 'MsMpEng.exe', path: 'C:\\ProgramData\\Microsoft\\Windows Defender\\MsMpEng.exe', workingSetBytes: 400 * MB, isSystem: true },
            { pid: 1400, name: 'audiodg.exe', path: 'C:\\Windows\\System32\\audiodg.exe', workingSetBytes: 350 * MB, isSystem: false },
            { pid: 1500, name: 'OneDrive.exe', path: 'C:\\Users\\tester\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe', workingSetBytes: 160 * MB, isSystem: false },
            { pid: 1600, name: 'notepad.exe', path: 'C:\\Windows\\notepad.exe', workingSetBytes: 20 * MB, isSystem: false }
          ]
        }
      }
    },
    system_get_memory_usage: async () => ({ success: true, data: { total: 16 * 1024 * MB, used: 8 * 1024 * MB, available: 8 * 1024 * MB, percent: 50 } }),
    system_get_path: async ({ name }) => {
      if (name === 'appData') return { success: true, data: APPDATA }
      if (name === 'temp') return { success: true, data: TEMP }
      if (name === 'home') return { success: true, data: 'C:\\Users\\tester' }
      return { success: false, error: { message: 'unknown' } }
    },
    system_search_files: async ({ query }) => {
      const dir = query.replace(/^dir:/, '')
      if (dir === USER_STARTUP) {
        return dirListing([
          { name: 'Steam.lnk', path: `${USER_STARTUP}\\Steam.lnk`, size: 2048 },
          { name: 'desktop.ini', path: `${USER_STARTUP}\\desktop.ini`, size: 100 }
        ])
      }
      if (dir === COMMON_STARTUP) return dirListing([{ name: 'Vendor.lnk', path: `${COMMON_STARTUP}\\Vendor.lnk`, size: 1024 }])
      if (dir === TEMP) {
        return dirListing([
          { name: 'a.dmp', path: `${TEMP}\\a.dmp`, size: 50 * MB },
          { name: 'b.log', path: `${TEMP}\\b.log`, size: 5 * MB }
        ])
      }
      return dirListing([])
    },
    shell_trash_item: async ({ fullPath }) => ({ success: true, data: { fullPath } }),
    ...overrides
  }
  const host = {}
  for (const [method, handler] of Object.entries(handlers)) {
    host[method] = async (params) => {
      calls.push({ method, params })
      return handler(params)
    }
  }
  host.calls = calls
  return host
}

test('不在客户端里运行时显示空状态，不显示示例数据', async () => {
  const snap = await boost.fetchBoostSnapshot()
  assert.deepEqual(snap.candidates, [])
  assert.deepEqual(snap.errors, [boost.NOT_IN_CLIENT_MESSAGE])
  assert.equal(snap.totalMemoryBytes, 0, '读不到内存时不写 16 GB 之类的默认值')

  const view = BoostCommand()
  assert.equal(view.type, 'List')
  assert.match(view.props.filterBar.summaryText, new RegExp(boost.NOT_IN_CLIENT_MESSAGE))
  assert.equal(view.props.subList.items.length, 0)
  assert.equal(view.props.subList.emptyText, boost.NOT_IN_CLIENT_MESSAGE)
})

test('扫描：系统进程、Windows 目录下的进程与公共启动文件夹受保护，内存按客户端返回', async () => {
  const snap = await boost.fetchBoostSnapshot(createHost())
  assert.deepEqual(snap.errors, [])
  assert.equal(snap.memoryUsagePercent, 50)
  const byId = Object.fromEntries(snap.candidates.map(c => [c.id, c]))

  assert.equal(byId['boost-proc-4'].isProtected, true)
  assert.equal(byId['boost-proc-1300'].isProtected, true, '客户端标记的系统进程受保护')
  assert.equal(byId['boost-proc-1400'].isProtected, true, 'Windows 目录下的进程受保护')
  assert.equal(byId['boost-proc-1600'].isProtected, true)
  assert.equal(byId['boost-proc-1200'].isProtected, false)
  assert.equal(byId['boost-proc-1200'].isHighMemory, true)
  assert.equal(byId['boost-proc-1500'].isHighMemory, false)

  const resident = byId['boost-startup-proc-1500']
  assert.equal(resident.startupScope, '常驻进程（按名称判断）')
  assert.equal(resident.isHighMemory, true)

  const userItem = snap.candidates.find(c => c.path === `${USER_STARTUP}\\Steam.lnk`)
  assert.equal(userItem.isProtected, false)
  assert.equal(userItem.memoryOrSizeBytes, 2048)
  assert.equal(snap.candidates.some(c => c.path.endsWith('desktop.ini')), false)
  const commonItem = snap.candidates.find(c => c.path === `${COMMON_STARTUP}\\Vendor.lnk`)
  assert.equal(commonItem.isProtected, true)
  assert.match(commonItem.lockedReason, /公共启动文件夹/)

  assert.equal(snap.candidates.filter(c => c.type === 'temp_cache').length, 2)
})

test('扫描：内存、进程列表、用户目录读取失败时如实写入 errors，不编造数字', async () => {
  const host = createHost({
    system_get_memory_usage: async () => ({ success: false, error: { message: '读取失败' } }),
    dllplugin_call: async () => { throw new Error('IPC_BROKEN') },
    process_list: async () => ({ success: false, error: { message: 'tasklist 失败' } }),
    system_get_path: async () => ({ success: false, error: { message: '无法读取' } })
  })
  const snap = await boost.fetchBoostSnapshot(host)
  assert.equal(snap.totalMemoryBytes, 0)
  assert.equal(snap.usedMemoryBytes, 0)
  assert.ok(snap.errors.some(e => /读取内存占用失败/.test(e)))
  assert.ok(snap.errors.some(e => /读取进程列表失败：tasklist 失败/.test(e)))
  assert.ok(snap.errors.some(e => /启动”文件夹位置失败/.test(e)))
  assert.ok(snap.errors.some(e => /临时文件夹位置失败/.test(e)))
  assert.equal(
    host.calls.some(c => c.method === 'system_search_files' && c.params.query.includes('C:\\Users\\Default')),
    false,
    '读不到当前用户目录时不能去读其他用户的启动文件夹'
  )
  assert.equal(snap.candidates.filter(c => c.type === 'process').length, 0)
})

test('只处理勾选且未受保护的项目，同一进程只处理一次', async () => {
  const snap = await boost.fetchBoostSnapshot(createHost())
  const items = boost.selectActionableItems(snap.candidates, [
    'boost-proc-1200',
    'boost-proc-4',
    'boost-proc-1500',
    'boost-startup-proc-1500'
  ])
  assert.deepEqual(items.map(i => i.id), ['boost-proc-1200', 'boost-proc-1500'])
  assert.deepEqual(boost.selectActionableItems(snap.candidates, []), [])
})

test('确认框写清会结束几个进程、移走几个文件', async () => {
  const snap = await boost.fetchBoostSnapshot(createHost())
  const temp = snap.candidates.find(c => c.type === 'temp_cache')
  const startup = snap.candidates.find(c => c.path === `${USER_STARTUP}\\Steam.lnk`)
  const text = boost.describeBoostPlan(boost.selectActionableItems(snap.candidates, ['boost-proc-1200', temp.id, startup.id]))
  assert.match(text, /强制结束 1 个进程/)
  assert.match(text, /未保存的内容会丢失/)
  assert.match(text, /1 个“启动”文件夹里的项目移入回收站/)
  assert.match(text, /1 个临时文件移入回收站/)
  assert.match(text, /没有勾选的项目不会处理/)
})

test('没有勾选或用户取消时什么都不做；确认后只处理勾选项，失败不连带处理其他文件', async () => {
  const host = createHost({
    shell_trash_item: async ({ fullPath }) =>
      fullPath.endsWith('a.dmp')
        ? { success: false, error: { code: 'PERMISSION_DENIED', message: '文件正在使用' } }
        : { success: true }
  })
  const snap = await boost.fetchBoostSnapshot(host)
  const tempA = snap.candidates.find(c => c.path.endsWith('a.dmp'))
  let confirmCount = 0
  const terminated = []

  await withBridge({
    confirmAlert: async () => { confirmCount += 1; return false },
    terminateProcess: async (pid) => { terminated.push(pid); return { pid, terminated: [pid] } }
  }, async () => {
    assert.equal(await boost.confirmAndExecuteBoost(snap.candidates, [], host), null)
    assert.equal(confirmCount, 0, '没有勾选时不弹确认框')
    assert.equal(await boost.confirmAndExecuteBoost(snap.candidates, [tempA.id, 'boost-proc-1200'], host), null)
    assert.equal(confirmCount, 1)
  })
  assert.deepEqual(terminated, [])
  assert.equal(host.calls.filter(c => c.method === 'shell_trash_item').length, 0)

  let confirmOptions
  await withBridge({
    confirmAlert: async (options) => { confirmOptions = options; return true },
    terminateProcess: async (pid) => { terminated.push(pid); return { pid, terminated: [pid] } }
  }, async () => {
    const res = await boost.confirmAndExecuteBoost(snap.candidates, [tempA.id, 'boost-proc-1200'], host)
    assert.equal(res.succeeded.length, 1)
    assert.equal(res.failed.length, 1)
    assert.equal(res.failed[0].item.id, tempA.id)
    assert.match(res.failed[0].error, /文件正在使用/)
    assert.equal(res.handledBytes, 900 * MB)
  })
  assert.equal(confirmOptions.primaryAction.style, 'destructive')
  assert.deepEqual(terminated, [1200])
  const trashed = host.calls.filter(c => c.method === 'shell_trash_item').map(c => c.params.fullPath)
  assert.deepEqual(trashed, [tempA.path], '只移走勾选的文件，失败后不会改为处理其他临时文件')
})

test('全部失败时如实返回失败，不报成功', async () => {
  const host = createHost({ shell_trash_item: async () => ({ success: false, error: { message: '没有授权' } }) })
  const snap = await boost.fetchBoostSnapshot(host)
  const temps = snap.candidates.filter(c => c.type === 'temp_cache')
  const res = await boost.executeBoostItems(temps, host)
  assert.equal(res.succeeded.length, 0)
  assert.equal(res.failed.length, temps.length)
  assert.equal(res.handledBytes, 0)
})

test('结束进程：走客户端接口并校验进程名，失败如实报错', async () => {
  const seen = []
  await withBridge({
    terminateProcess: async (pid, options) => { seen.push({ pid, options }); return { pid, terminated: [pid] } }
  }, async () => {
    assert.equal((await boost.terminateBoostProcess(1500, '[自启常驻] OneDrive.exe')).ok, true)
  })
  assert.deepEqual(seen[0], { pid: 1500, options: { mode: 'force', expectedName: 'OneDrive.exe' } })

  await withBridge({ terminateProcess: async () => { throw hostError('PROCESS_ACCESS_DENIED', 'denied') } }, async () => {
    const res = await boost.terminateBoostProcess(1200, 'chrome.exe')
    assert.equal(res.ok, false)
    assert.match(res.error, /管理员/)
  })
  await withBridge({ terminateProcess: async () => { throw hostError('PROCESS_NOT_FOUND', 'gone') } }, async () => {
    const res = await boost.terminateBoostProcess(1200, 'chrome.exe')
    assert.equal(res.ok, true)
    assert.equal(res.alreadyExited, true)
  })

  let called = 0
  await withBridge({ terminateProcess: async () => { called += 1 } }, async () => {
    assert.equal((await boost.terminateBoostProcess(4, 'System')).ok, false)
    assert.equal((await boost.terminateBoostProcess(900, 'explorer.exe')).ok, false)
  })
  assert.equal(called, 0)
})

test('结束进程：旧版客户端接口失败时返回成功外壳也要识别为失败', async () => {
  const legacyFail = { dllplugin_call: async () => ({ success: true, data: { error: 'PROCESS_ACCESS_DENIED: 没有权限' } }) }
  const failed = await boost.terminateBoostProcess(8888, 'chrome.exe', legacyFail)
  assert.equal(failed.ok, false)
  assert.match(failed.error, /没有权限/)

  const legacyOk = { dllplugin_call: async () => ({ success: true, data: { terminated: true, pid: 8888, mode: 'force' } }) }
  assert.equal((await boost.terminateBoostProcess(8888, 'chrome.exe', legacyOk)).ok, true)

  const legacyBare = { dllplugin_call: async () => ({ success: true }) }
  assert.equal((await boost.terminateBoostProcess(8888, 'chrome.exe', legacyBare)).ok, false, '客户端没有确认结束时不能报成功')

  const outside = await boost.terminateBoostProcess(8888, 'chrome.exe')
  assert.equal(outside.ok, false)
  assert.equal(outside.error, boost.NOT_IN_CLIENT_MESSAGE)
})

test('定位：不在客户端里或客户端失败时返回 false', async () => {
  assert.equal(await boost.openBoostItemLocation('C:\\x.lnk'), false)
  const failing = {
    shell_show_item_in_folder: async () => ({ success: false, error: { message: '未授权' } }),
    shell_open_path: async () => ({ success: false, error: { message: '未授权' } })
  }
  assert.equal(await boost.openBoostItemLocation('C:\\x.lnk', failing), false)
})
