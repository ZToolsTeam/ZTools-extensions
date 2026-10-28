// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout3-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Command, * as record from '../dist/index.js'

const host = createHost()
const views = []
const open = async () => {
  const view = await mount(Command)
  views.push(view)
  await tick(10)
  return view
}

test.beforeEach(() => {
  host.reset()
})

test.afterEach(() => {
  while (views.length) views.pop().unmount()
})

const VIDEOS = 'D:\\Videos'
const SAVE_DIR = 'D:\\Videos\\ZTools_Recordings'
const hostError = (message, code = 'INTERNAL_ERROR') => Object.assign(new Error(message), { code })

/**
 * 按客户端真实行为模拟录制相关接口：
 * - dllplugin_call RecordPlugin：status / startRecording / stopRecording，返回结构与客户端一致（结果外再包一层 data）
 * - system_get_path('videos')、filesystem_get_directory_contents（只授权视频文件夹本身）、system_search_files（dir: 扫描）
 */
function installRecordHost({
  folderExists = true,
  files = [],
  totalMatches,
  startError = null,
  stopError = null,
  statusError = null,
  scanError = null,
  sessions: initialSessions = []
} = {}) {
  const sessions = new Map(initialSessions.map(s => [s.id, s]))
  const calls = []
  let seq = 0
  const reply = r => ({ ...r, data: { ...r } })

  host.ipc.system_get_path = ({ name }) => {
    if (name !== 'videos') throw hostError(`未模拟 ${name}`)
    return { path: VIDEOS }
  }
  host.ipc.filesystem_get_directory_contents = ({ path }) => {
    if (path !== VIDEOS) throw hostError('路径未由当前窗口授权', 'PERMISSION_DENIED')
    return {
      success: true,
      writeAuthorized: false,
      files: [
        ...(folderExists ? [{ name: 'ZTools_Recordings', size: 0, isDirectory: true }] : []),
        { name: 'holiday.mp4', size: 999, isDirectory: false }
      ]
    }
  }
  host.ipc.system_search_files = ({ query }) => {
    if (scanError) throw hostError(scanError)
    if (query !== `dir:${SAVE_DIR}` || !folderExists) throw hostError('宿主内部错误')
    return { files, total_matches: totalMatches ?? files.length }
  }
  host.ipc.dllplugin_call = ({ plugin, func, params }) => {
    calls.push({ plugin, func, params })
    assert.equal(plugin, 'RecordPlugin')
    if (func === 'status') {
      if (statusError) throw hostError(statusError)
      return reply({ ok: true, success: true, recording: sessions.size > 0, sessions: [...sessions.values()] })
    }
    if (func === 'startRecording') {
      if (startError) return reply({ ok: false, success: false, recording: false, error: startError })
      const id = `rec-${++seq}`
      const outputPath = `${params.saveDir}\\record-170000000000${seq}.${params.format === 'gif' ? 'gif' : 'mp4'}`
      sessions.set(id, { id, type: params.type, outputPath, startedAt: 1700000000000, fps: params.fps })
      return reply({ ok: true, success: true, recording: true, sessionId: id, outputPath, startedAt: new Date(1700000000000).toISOString() })
    }
    if (func === 'stopRecording') {
      const active = params.sessionId ? sessions.get(params.sessionId) : [...sessions.values()][0]
      if (!active) {
        return reply({
          ok: false,
          success: false,
          recording: false,
          error: params.sessionId ? `录制会话不存在或已结束：${params.sessionId}` : '当前没有正在进行的录制'
        })
      }
      sessions.delete(active.id)
      if (stopError) {
        return reply({ ok: false, success: false, recording: false, sessionId: active.id, outputPath: active.outputPath, error: stopError })
      }
      return reply({ ok: true, success: true, recording: false, sessionId: active.id, outputPath: active.outputPath, durationMs: 5000, sizeBytes: 2048 })
    }
    throw hostError(`未模拟 ${func}`)
  }
  return { calls, sessions }
}

const file = (name, size, mtime, dir = SAVE_DIR) => ({ name, path: `${dir}\\${name}`, is_dir: false, size, mtime })

test('record: 只列出保存目录里的 MP4 / GIF，不编造时长、分辨率与帧率，按时间倒序', async () => {
  installRecordHost({
    files: [
      file('record-1.mp4', 30 * 1024 * 1024, 1700000000000),
      file('record-2.gif', 2 * 1024 * 1024, 1700000600000),
      file('no-time.mp4', 1024, undefined),
      file('notes.txt', 10, 1700000000000),
      file('deep.mp4', 5000, 1700000900000, `${SAVE_DIR}\\old`),
      file('movie.mp4', 5000, 1700000900000, 'D:\\Other')
    ],
    totalMatches: 6
  })
  const ws = await record.fetchRecordWorkspace()
  assert.equal(ws.saveDir, SAVE_DIR)
  assert.deepEqual(ws.recordings.map(r => r.name), ['record-2.gif', 'record-1.mp4', 'no-time.mp4'])
  assert.equal(ws.recordings[2].modifiedMs, null)
  assert.equal(ws.recordings[1].sizeBytes, 30 * 1024 * 1024)
  for (const r of ws.recordings) {
    assert.equal('durationText' in r, false)
    assert.equal('resolutionText' in r, false)
    assert.equal('fps' in r, false)
  }
  assert.equal(ws.partial, false)
  assert.equal(ws.missing, false)
  assert.equal(ws.listError, undefined)
  assert.equal(ws.isRecording, false)
  // 视频文件夹里别的视频不算录制文件
  assert.ok(!ws.recordings.some(r => r.name === 'holiday.mp4'))
})

test('record: 目录条目没有全部取回时标记为部分结果', async () => {
  installRecordHost({ files: [file('record-1.mp4', 100, 1700000000000)], totalMatches: 500 })
  const ws = await record.fetchRecordWorkspace()
  assert.equal(ws.recordings.length, 1)
  assert.equal(ws.partial, true)
})

test('record: 保存目录还没创建时显示为空，不报错也不扫描', async () => {
  installRecordHost({ folderExists: false })
  const ws = await record.fetchRecordWorkspace()
  assert.equal(ws.missing, true)
  assert.equal(ws.listError, undefined)
  assert.deepEqual(ws.recordings, [])
  assert.ok(!host.ipcCalls.some(([m]) => m === 'system_search_files'))
})

test('record: 目录扫描失败如实返回错误，不用空列表冒充', async () => {
  installRecordHost({ scanError: '索引服务不可用' })
  const ws = await record.fetchRecordWorkspace()
  assert.deepEqual(ws.recordings, [])
  assert.match(ws.listError, /索引服务不可用/)
})

test('record: 录制状态查询失败时状态为未知，而不是假定没有在录制', async () => {
  installRecordHost({ statusError: '录制服务未响应' })
  const ws = await record.fetchRecordWorkspace()
  assert.equal(ws.isRecording, null)
  assert.match(ws.statusError, /录制服务未响应/)
})

test('record: 没有宿主接口时开始录制如实失败，工作台不返回示例数据', async () => {
  const start = await record.startScreenRecording({ fps: '30', format: 'mp4', saveDir: SAVE_DIR })
  assert.equal(start.ok, false)
  assert.equal(start.sessionId, '')
  assert.match(start.error, /dllplugin_call/)
  const stop = await record.stopScreenRecording()
  assert.equal(stop.ok, false)
  const ws = await record.fetchRecordWorkspace()
  assert.deepEqual(ws.recordings, [])
  assert.equal(ws.isRecording, null)
  assert.ok(ws.listError)
  assert.equal(record.INITIAL_RECORDED_VIDEOS, undefined)
  assert.equal(record.RECORD_SOURCE_MODES, undefined)
})

test('record: 开始录制只发送客户端支持的参数，停止时按会话 id 停止并返回真实输出文件', async () => {
  const { calls } = installRecordHost()
  const start = await record.startScreenRecording({ fps: '15', format: 'gif', saveDir: SAVE_DIR })
  assert.equal(start.ok, true)
  assert.equal(start.sessionId, 'rec-1')
  assert.equal(start.outputPath, `${SAVE_DIR}\\record-1700000000001.gif`)
  const startCall = calls.find(c => c.func === 'startRecording')
  assert.deepEqual(startCall.params, { type: 'gif', format: 'gif', fps: 15, saveDir: SAVE_DIR })
  // 录制前先确认没有正在进行的录制
  assert.deepEqual(calls.map(c => c.func), ['status', 'startRecording'])
  // 不再调用参数不合规、一直失败的录制控制条接口，也不再尝试不存在的通道
  assert.ok(!host.ipcCalls.some(([m]) => m === 'window_show_record_bar' || m === 'screen_record_start'))

  const stop = await record.stopScreenRecording()
  assert.equal(stop.ok, true)
  assert.equal(stop.outputPath, `${SAVE_DIR}\\record-1700000000001.gif`)
  assert.equal(stop.sizeBytes, 2048)
  assert.deepEqual(calls.find(c => c.func === 'stopRecording').params, { sessionId: 'rec-1' })
})

test('record: 已有录制在进行时不再启动第二个', async () => {
  const { calls } = installRecordHost({ sessions: [{ id: 'rec-old', outputPath: `${SAVE_DIR}\\record-1.mp4`, startedAt: 1700000000000 }] })
  const res = await record.startScreenRecording({ fps: '30', format: 'mp4', saveDir: SAVE_DIR })
  assert.equal(res.ok, false)
  assert.equal(res.error, 'RECORD_ALREADY_RUNNING')
  assert.equal(res.sessionId, 'rec-old')
  assert.ok(!calls.some(c => c.func === 'startRecording'))
  // 插件重新打开后，停止的是客户端报告的那个会话
  const stop = await record.stopScreenRecording()
  assert.equal(stop.ok, true)
  assert.deepEqual(calls.find(c => c.func === 'stopRecording').params, { sessionId: 'rec-old' })
})

test('record: 开始失败（如本机没有 ffmpeg）如实返回客户端原因，只调用一次', async () => {
  const { calls } = installRecordHost({ startError: '本机未检测到 ffmpeg，无法启动屏幕视频或音频录制' })
  const res = await record.startScreenRecording({ fps: '30', format: 'mp4', saveDir: SAVE_DIR })
  assert.equal(res.ok, false)
  assert.equal(res.sessionId, '')
  assert.match(res.error, /ffmpeg/)
  assert.equal(calls.filter(c => c.func === 'startRecording').length, 1)
})

test('record: 无法确认录制状态时不盲目启动', async () => {
  const { calls } = installRecordHost({ statusError: '录制服务未响应' })
  const res = await record.startScreenRecording({ fps: '30', format: 'mp4', saveDir: SAVE_DIR })
  assert.equal(res.ok, false)
  assert.match(res.message, /无法确认当前录制状态/)
  assert.ok(!calls.some(c => c.func === 'startRecording'))
})

test('record: 停止失败时保留客户端的真实原因，不被重试结果覆盖', async () => {
  const { calls } = installRecordHost({ stopError: '屏幕录制失败：ffmpeg 录制异常退出（退出码 1）' })
  assert.equal((await record.startScreenRecording({ fps: '30', format: 'mp4', saveDir: SAVE_DIR })).ok, true)
  const stop = await record.stopScreenRecording()
  assert.equal(stop.ok, false)
  assert.match(stop.error, /ffmpeg 录制异常退出/)
  assert.equal(calls.filter(c => c.func === 'stopRecording').length, 1)
})

test('record: 连按两次开始只启动一次录制', async () => {
  const { calls } = installRecordHost()
  const [a, b] = await Promise.all([
    record.startScreenRecording({ fps: '30', format: 'mp4', saveDir: SAVE_DIR }),
    record.startScreenRecording({ fps: '30', format: 'mp4', saveDir: SAVE_DIR })
  ])
  assert.deepEqual([a.ok, b.ok].sort(), [false, true])
  assert.equal([a, b].find(r => !r.ok).error, 'RECORD_BUSY')
  assert.equal(calls.filter(c => c.func === 'startRecording').length, 1)
  await record.stopScreenRecording()
})

test('record: 客户端做不到的参数（HEVC、区域 / 窗口模式、音频）直接拒绝', async () => {
  const { calls } = installRecordHost()
  for (const config of [
    { fps: '30', format: 'mp4_hevc' },
    { fps: '120', format: 'mp4' },
    { sourceModeId: 'rec-custom-region', fps: '30', codecContainer: 'mp4_h264' },
    null
  ]) {
    const res = await record.startScreenRecording(config)
    assert.equal(res.ok, false)
    assert.equal(res.error, 'INVALID_RECORD_CONFIG')
  }
  assert.equal(calls.length, 0)
})

test('record 界面：只提供真实支持的选项，不出现录音、区域、窗口、HEVC 等做不到的设置', async () => {
  installRecordHost({ files: [file('record-1.mp4', 100, 1700000000000)] })
  const view = await open()
  const tree = view.tree()
  assert.equal(tree.props.searchBarAccessory, undefined)
  const fields = tree.props.workbenchPanel.fields
  assert.deepEqual(fields.map(f => f.id), ['wb-rec-fps', 'wb-rec-format', 'wb-rec-scope', 'wb-rec-audio'])
  assert.ok(!fields.some(f => f.type === 'toggle'))
  assert.deepEqual(fields[1].options.map(o => o.value), ['mp4', 'gif'])
  const text = view.text()
  for (const word of ['WASAPI', '麦克风', 'HEVC', 'H.265', '硬件编码', '区域', '窗口', '鼠标', 'MB/分钟', 'DXGI']) {
    assert.ok(!text.includes(word), `界面不应出现「${word}」`)
  }
  assert.match(tree.props.filterBar.props.summaryText, /^未在录制 · 1 个录制文件$/)
  assert.deepEqual(view.actions(view.items()[0]).map(a => a.props.title), ['打开录制文件', '在文件夹中显示', '开始录制', '复制文件路径'])
})

test('record 界面：开始、停止录制走真实结果并刷新状态', async () => {
  const { calls } = installRecordHost()
  const view = await open()
  const fields = () => view.tree().props.workbenchPanel.fields
  fields().find(f => f.id === 'wb-rec-format').onChange('mp4_hevc')
  fields().find(f => f.id === 'wb-rec-fps').onChange('60')
  await tick()
  assert.equal(fields().find(f => f.id === 'wb-rec-format').value, 'mp4')

  await view.run(undefined, '开始录制')
  await tick(10)
  assert.deepEqual(calls.find(c => c.func === 'startRecording').params, { type: 'video', format: 'mp4', fps: 60, saveDir: SAVE_DIR })
  assert.equal(host.toasts.find(t => t.title === '已开始录制（60 FPS，MP4）')?.style, Toast.Style.Success)
  const tree = view.tree()
  assert.match(tree.props.filterBar.props.summaryText, /^正在录制/)
  assert.equal(tree.props.filterBar.props.actions[0].title, '停止录制并保存')
  assert.equal(tree.props.workbenchPanel.previewCard.badge, '录制中')
  assert.ok(tree.props.workbenchPanel.previewCard.metrics.some(m => m.value === 'record-1700000000001.mp4'))

  tree.props.filterBar.props.actions[0].onAction()
  await tick(10)
  const saved = host.toasts.find(t => t.title === '录制已保存')
  assert.equal(saved?.style, Toast.Style.Success)
  assert.match(saved.message, /record-1700000000001\.mp4/)
  assert.match(view.tree().props.filterBar.props.summaryText, /^未在录制/)
})

test('record 界面：开始失败显示失败提示，状态不变', async () => {
  installRecordHost({ startError: '本机未检测到 ffmpeg，无法启动屏幕视频或音频录制' })
  const view = await open()
  await view.run(undefined, '开始录制')
  await tick(10)
  const toast = host.lastToast()
  assert.equal(toast.style, Toast.Style.Failure)
  assert.equal(toast.title, '录制启动失败')
  assert.match(toast.message, /ffmpeg/)
  assert.match(view.tree().props.filterBar.props.summaryText, /^未在录制/)
})

test('record 界面：状态未知、目录读取失败都如实显示', async () => {
  installRecordHost({ statusError: '录制服务未响应', scanError: '索引服务不可用' })
  const view = await open()
  const tree = view.tree()
  assert.match(tree.props.filterBar.props.summaryText, /录制状态未知（.*录制服务未响应.*）/)
  assert.match(tree.props.filterBar.props.summaryText, /录制文件读取失败/)
  assert.equal(tree.props.workbenchPanel.previewCard.badge, '状态未知')
  assert.match(tree.props.subList.emptyText, /读取保存目录失败/)
})

test('record 界面：还没有录制文件时提示为空，底部主动作是开始录制', async () => {
  installRecordHost({ folderExists: false })
  const view = await open()
  const tree = view.tree()
  assert.equal(tree.props.subList.emptyText, '还没有录制文件，开始录制后会保存到这里')
  assert.equal(view.actions()[0].props.title, '开始录制')
})

test('record 界面：打开 / 定位失败显示失败提示，复制路径写入剪贴板', async () => {
  installRecordHost({ files: [file('record-1.mp4', 100, 1700000000000)] })
  const view = await open()
  const item = view.items()[0]
  await view.run(item, '打开录制文件')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '无法打开录制文件')
  await view.run(item, '在文件夹中显示')
  assert.equal(host.lastToast().title, '无法在文件夹中显示')

  host.ipc.shell_open_path = () => ({ success: true })
  const before = host.toasts.length
  await view.run(item, '打开录制文件')
  assert.equal(host.toasts.length, before)

  await view.run(item, '复制文件路径')
  assert.equal(host.clipboard.text, `${SAVE_DIR}\\record-1.mp4`)
  assert.equal(host.lastToast().style, Toast.Style.Success)
})

test('record 界面：已有录制时开始给出可读原因；停止失败显示客户端原因并回到真实状态', async () => {
  installRecordHost({
    stopError: '屏幕录制失败：ffmpeg 录制异常退出（退出码 1）',
    sessions: [{ id: 'rec-old', outputPath: `${SAVE_DIR}\\record-1.mp4`, startedAt: 1700000000000 }]
  })
  const view = await open()
  assert.match(view.tree().props.filterBar.props.summaryText, /^正在录制/)
  // 插件重新打开时以客户端状态为准：主动作是停止
  assert.equal(view.actions()[0].props.title, '停止录制并保存')

  const started = await record.startScreenRecording({ fps: '30', format: 'mp4', saveDir: SAVE_DIR })
  assert.equal(started.message, '已有录制正在进行，请先停止')

  await view.run(undefined, '停止录制并保存')
  await tick(10)
  const toast = host.lastToast()
  assert.equal(toast.style, Toast.Style.Failure)
  assert.equal(toast.title, '停止录制失败')
  assert.match(toast.message, /ffmpeg 录制异常退出/)
  assert.match(view.tree().props.filterBar.props.summaryText, /^未在录制/)
})
