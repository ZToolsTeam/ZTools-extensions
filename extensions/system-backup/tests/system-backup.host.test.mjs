import test from 'node:test'
import assert from 'node:assert/strict'
import * as backup from '../dist/logic.js'

const item = (id, extra = {}) => ({ id, name: id, path: `C:\\Users\\tester\\${id}`, category: 'dev_terminal', categoryName: '终端', sizeBytes: 12, lastModified: '', statusTag: '', ...extra })
const vault = 'C:\\Users\\tester\\Documents\\ZToolsBackups'
function host(action, other = {}) {
  return { transport: { call: async (method, params) => {
    if (method === 'dllplugin_call') return action(params.func, params.params)
    if (method in other) return other[method](params)
    throw new Error(`UNEXPECTED_CHANNEL: ${method}`)
  } } }
}

test('创建快照用真实成功数和逐项失败列表，部分完成仍保留归档路径', async () => {
  const failedSources = [{ path: item('denied').path, error: 'PERMISSION_DENIED' }]
  const bridge = host((func, params) => {
    assert.equal(func, 'createSnapshotArchive')
    assert.deepEqual(params.sourcePaths, [item('good').path, item('denied').path])
    return { success: true, data: { ok: true, success: true, archivePath: `${vault}\\actual.zip`, backedUpCount: 1, sizeBytes: 130, failedSources } }
  })
  const result = await backup.createBackupArchive([item('good'), item('denied'), item('old.zip', { category: 'snapshot_archives' })], vault, bridge)
  assert.equal(result.ok, false)
  assert.equal(result.partial, true)
  assert.equal(result.backedUpCount, 1)
  assert.equal(result.archivePath, `${vault}\\actual.zip`)
  assert.deepEqual(result.failedSources, failedSources)
  assert.match(result.message, /部分完成.*已备份 1 项.*1 项失败.*denied.*PERMISSION_DENIED/)
})

test('全部源失败保留每个失败，不丢弃业务错误载荷', async () => {
  const failures = [{ path: 'one', error: 'ENOENT' }, { path: 'two', error: 'PERMISSION_DENIED' }]
  const result = await backup.createBackupArchive([item('one'), item('two')], vault, host(() => ({
    success: false, data: { ok: false, success: false, backedUpCount: 0, failedSources: failures, error: 'failed' }
  })))
  assert.equal(result.ok, false)
  assert.equal(result.backedUpCount, 0)
  assert.deepEqual(result.failedSources, failures)
  assert.match(result.message, /one.*ENOENT.*two.*PERMISSION_DENIED/)
})

test('拒绝缺少真实计数或真实归档路径的旧宿主成功回执', async () => {
  for (const reply of [{ success: true, ok: true }, { success: true, ok: true, backedUpCount: 1, archivePath: 'a.zip' }]) {
    const result = await backup.createBackupArchive([item('one')], vault, host(() => reply))
    assert.equal(result.ok, false)
    assert.equal(result.backedUpCount, 0)
    assert.match(result.message, /完整的备份结果/)
  }
})

test('解压显示真实输出目录，失败时保留可检查的输出目录', async () => {
  const output = `${vault}\\actual_extracted-unique`
  const result = await backup.extractBackupSnapshot(`${vault}\\actual.zip`, host((func, params) => {
    assert.equal(func, 'extractSnapshotArchive')
    assert.equal(params.archivePath, `${vault}\\actual.zip`)
    return { ok: true, success: true, targetDir: output }
  }))
  assert.equal(result.outputDir, output)
  assert.match(result.message, /快照已解压到/)
  assert.doesNotMatch(result.message, /原子|还原/)
  const failed = await backup.extractBackupSnapshot(`${vault}\\actual.zip`, host(() => ({ ok: false, success: false, targetDir: output, error: 'duplicate entry' })))
  assert.equal(failed.ok, false)
  assert.equal(failed.outputDir, output)
  assert.equal(failed.message, 'duplicate entry')
})

test('最新快照按真实时间选择，忽略配置项和未知时间，不依赖文件名或列表顺序', () => {
  const newest = item('arbitrary.zip', { category: 'snapshot_archives', modifiedAtMs: 300 })
  const older = item('ztools-backup-2099.zip', { category: 'snapshot_archives', modifiedAtMs: 100 })
  const unknown = item('unknown.zip', { category: 'snapshot_archives' })
  assert.equal(backup.latestBackupArchive([older, item('config', { modifiedAtMs: 999 }), newest, unknown]), newest)
  assert.equal(backup.latestBackupArchive([unknown, item('config')]), undefined)
})

test('读取真实快照时间，保留零字节配置，不生成演示快照', async () => {
  const bridge = host(func => {
    assert.equal(func, 'scanSnapshots')
    return { success: true, backups: [{ name: 'mine.zip', path: `${vault}\\mine.zip`, sizeBytes: 100, createdAt: '2026-11-02T00:00:00.000Z' }] }
  }, {
    system_get_path: p => p.name === 'home' ? 'C:\\Users\\tester' : `C:\\Users\\tester\\${p.name}`,
    filesystem_get_file_size: () => 0
  })
  const snapshot = await backup.fetchSystemBackupSnapshot(bridge)
  assert.equal(snapshot.error, undefined)
  assert.equal(snapshot.items.filter(entry => entry.category !== 'snapshot_archives').length, 7)
  assert.equal(backup.latestBackupArchive(snapshot.items).modifiedAtMs, Date.parse('2026-11-02T00:00:00.000Z'))
  assert.equal(snapshot.items.some(entry => entry.path.includes('20261018')), false)
})

test('配置读取被拒绝时返回错误，不能冒充扫描成功且没有配置', async () => {
  const bridge = host(() => ({ success: true, backups: [] }), {
    system_get_path: () => 'C:\\Users\\tester',
    filesystem_get_file_size: () => { throw new Error('PERMISSION_DENIED') }
  })
  const result = await backup.fetchSystemBackupSnapshot(bridge)
  assert.match(result.error, /PERMISSION_DENIED/)
  assert.deepEqual(result.items, [])
})

test('未勾选配置不会自动把可见项目全部备份，打开目录使用宿主真实路径', async () => {
  const noCall = host(() => { throw new Error('不应调用归档服务') })
  assert.equal((await backup.createBackupArchive([], vault, noCall)).ok, false)
  assert.equal((await backup.createBackupArchive([item('old.zip', { category: 'snapshot_archives' })], vault, noCall)).ok, false)
  const directory = `${vault}\\extracted`
  const bridge = host(() => { throw new Error('不应调用归档服务') }, { shell_open_path: params => {
    assert.equal(params.fullPath, directory)
    return { success: true }
  } })
  assert.equal(await backup.openExtractedDirectory(directory, bridge), true)
})
