// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as softwareManager from '../dist/logic.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
function createRealHostStub(handlers = {}) {
  const calls = []
  const dispatch = async (method, params) => {
    calls.push({ channel: method, payload: params })
    if (typeof handlers[method] === 'function') {
      return await handlers[method](params)
    }
    if (method in handlers) {
      return handlers[method]
    }
    throw new Error(`CHANNEL_NOT_IMPLEMENTED: ${method}`)
  }

  const stub = {
    __isRealHost: true,
    calls,
    transport: {
      call: dispatch
    }
  }

  for (const key of Object.keys(handlers)) {
    stub[key] = (params) => dispatch(key, params)
  }

  return stub
}

const APP_RECORDS = [
  {
    id: 'app-0-R29vZ2xl',
    name: 'Google Chrome',
    version: '124.0.1',
    publisher: 'Google LLC',
    installDate: '20260115',
    installLocation: 'C:\\Program Files\\Google\\Chrome\\Application',
    uninstallString: '"C:\\Program Files\\Google\\Chrome\\Application\\setup.exe" --uninstall',
    isSystemComponent: false,
    estimatedSizeKb: 2048,
    estimatedSize: 2048 * 1024
  },
  {
    id: 'app-1-Tm9WZXJz',
    name: 'NoVersionTool',
    version: '',
    publisher: '',
    installDate: '',
    installLocation: '',
    uninstallString: 'MsiExec.exe /X{0000}',
    isSystemComponent: false
  }
]

test('software-manager: 不在客户端里运行时不返回示例软件，也不提供假成功的卸载', async () => {
  const list = await softwareManager.fetchSoftwareList()
  assert.equal(list.ok, false)
  assert.equal(list.items.length, 0)
  assert.equal(list.error, softwareManager.NOT_IN_CLIENT_MESSAGE)
  assert.equal(typeof softwareManager.getMockSoftwareList, 'undefined')
  assert.equal(typeof softwareManager.invokeNativeCapability, 'undefined')
  const un = await softwareManager.uninstallSoftware(softwareManager.mapRecordToSoftwareItem(APP_RECORDS[0], 0))
  assert.equal(un.ok, false)
  assert.equal(un.error, softwareManager.NOT_IN_CLIENT_MESSAGE)
})

test('software-manager: 读不到软件清单时如实报错，不按 Program Files 目录名推测软件', async () => {
  const host = createRealHostStub({
    applications_list: () => {
      throw new Error('PowerShell 被策略禁用')
    },
    system_get_path: () => 'C:\\Users\\RealUser',
    system_search_files: () => {
      throw new Error('不应扫描 Program Files')
    }
  })
  const list = await softwareManager.fetchSoftwareList(host, true)
  assert.equal(list.ok, false)
  assert.equal(list.items.length, 0)
  assert.match(list.error, /读取已安装软件失败：PowerShell 被策略禁用/)
  assert.equal(host.calls.some((c) => c.channel === 'system_search_files'), false)
  assert.deepEqual(host.calls[0].payload, { forceRefresh: true, includeSystemComponents: true })
})

test('software-manager: 缺失的版本、发布商、日期与盘符保持为空，不填默认值', async () => {
  const host = createRealHostStub({ applications_list: () => APP_RECORDS })
  const list = await softwareManager.fetchSoftwareList(host)
  assert.equal(list.ok, true)
  const [chrome, bare] = list.items
  assert.equal(chrome.version, '124.0.1')
  assert.equal(chrome.installDrive, 'C:')
  assert.equal(chrome.estimatedSize, 2048 * 1024)
  assert.equal(chrome.smartCategory, 'browser_net')
  assert.equal(typeof chrome.daysSinceInstall, 'number')
  assert.equal(bare.version, '')
  assert.equal(bare.publisher, '')
  assert.equal(bare.installDrive, '')
  assert.equal(bare.daysSinceInstall, undefined)
  assert.equal(bare.estimatedSize, 0)
  assert.equal(bare.smartCategory, 'other')
  assert.doesNotMatch(JSON.stringify(list.items), /"Installed"|x64 Application|未知开发商/)
  assert.equal(softwareManager.summarizeSoftware(list.items).unknownSizeCount, 1)
})

test('software-manager: 卸载按软件名称请求客户端启动卸载程序，失败如实返回', async () => {
  const item = softwareManager.mapRecordToSoftwareItem(APP_RECORDS[0], 0)
  const okHost = createRealHostStub({
    applications_uninstall: (payload) => {
      assert.deepEqual(payload, { command: 'Google Chrome' })
      return { success: true, message: '已启动 [Google Chrome] 卸载程序' }
    }
  })
  assert.deepEqual(await softwareManager.uninstallSoftware(item, okHost), { ok: true })

  const failHost = createRealHostStub({
    applications_uninstall: () => {
      throw new Error('未找到应用程序: Google Chrome')
    },
    dllplugin_call: () => {
      throw new Error('不能改用其他通道执行卸载')
    }
  })
  const fail = await softwareManager.uninstallSoftware(item, failHost)
  assert.equal(fail.ok, false)
  assert.match(fail.error, /未找到应用程序/)
  assert.equal(failHost.calls.some((c) => c.channel === 'dllplugin_call'), false)

  const forbidden = await softwareManager.uninstallSoftware({ ...item, name: 'Microsoft Windows 11' }, okHost)
  assert.equal(forbidden.ok, false)
  const noCmd = await softwareManager.uninstallSoftware({ ...item, uninstallString: '' }, okHost)
  assert.equal(noCmd.ok, false)
  assert.equal(okHost.calls.length, 1)
})

test('software-manager: AppData 目录只读列出，名称相近只作提示，读取失败如实返回', async () => {
  const roaming = 'C:\\Users\\RealUser\\AppData\\Roaming'
  const host = createRealHostStub({
    system_get_path: ({ name }) => (name === 'appData' ? roaming : name === 'home' ? 'C:\\Users\\RealUser' : ''),
    system_search_files: ({ query }) => {
      if (query === `dir:${roaming}`) {
        return {
          files: [],
          subdirs: [
            { name: 'Google', path: `${roaming}\\Google`, file_count: 3, total_bytes: 900000 },
            { name: 'OldTool', path: `${roaming}\\OldTool`, file_count: 2, total_bytes: 300000 },
            { name: 'Microsoft', path: `${roaming}\\Microsoft`, file_count: 9, total_bytes: 9000000 }
          ],
          total_matches: 14
        }
      }
      const sub = { [`dir:${roaming}\\Google`]: 900000, [`dir:${roaming}\\OldTool`]: 300000 }[query]
      if (sub) return { files: [{ name: 'a.bin', path: `${query.slice(4)}\\a.bin`, is_dir: false, size: sub, mtime: 1 }], total_matches: 1, total_bytes: sub }
      return { files: [], total_matches: 0 }
    }
  })
  const list = softwareManager.mapRecordToSoftwareItem(APP_RECORDS[0], 0)
  const res = await softwareManager.probeAppDataDirs([list], host)
  assert.equal(res.ok, true)
  assert.deepEqual(res.items.map((d) => [d.folderName, d.similarSoftwareName]), [['Google', 'Google Chrome'], ['OldTool', undefined]])
  assert.equal(typeof softwareManager.cleanAppDataResiduals, 'undefined', '客户端不能把扫描到的目录移入回收站，不提供清理')

  const noPath = await softwareManager.probeAppDataDirs([], createRealHostStub({ system_get_path: () => '' }))
  assert.equal(noPath.ok, false)
  assert.match(noPath.error, /无法获取 AppData 路径/)
})
