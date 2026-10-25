import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import BatchImageCommand from '../dist/index.js'

test('batch-image UI integration: 布局三 workbenchPanel + subList 渲染、零彩色 Emoji、并发锁与异常反馈', async () => {
  const host = createHost()
  host.ipc.system_get_path = async ({ name }) => `D:\\TestMedia\\${name}`
  host.ipc.system_search_files = async ({ query }) => {
    if (String(query).includes('pictures')) {
      return {
        files: [
          {
            name: 'design_poster_4k.png',
            path: 'D:\\TestMedia\\pictures\\design_poster_4k.png',
            is_dir: false,
            size: 3145728,
            mtime: 1710000000
          },
          {
            name: 'receipt_scan.jpg',
            path: 'D:\\TestMedia\\pictures\\receipt_scan.jpg',
            is_dir: false,
            size: 1048576,
            mtime: 1710000000
          }
        ]
      }
    }
    return { files: [] }
  }

  let dllCallCount = 0
  host.ipc.dllplugin_call = async ({ plugin, func, params }) => {
    dllCallCount += 1
    await new Promise((r) => setTimeout(r, 20))
    return {
      ok: true,
      plugin,
      func,
      processedCount: params.files.length,
      savedText: '1.8 MB',
      savePercent: 64,
      results: params.files.map((p) => ({
        inputPath: p,
        outputPath: p.replace(/(\.[^.]+)$/, '_min$1'),
        originalBytes: 1048576,
        compressedBytes: 380000,
        zeroRegressionTriggered: false
      }))
    }
  }

  const view = await mount(BatchImageCommand, host)
  await tick(10)

  const tree = view.tree()
  assert.equal(tree.type, 'List')
  assert.equal(tree.props.isShowingDetail, false, '布局三必须关闭右侧 Detail 以留出参数工作台与队列')
  assert.ok(tree.props.workbenchPanel, '必须包含左侧 workbenchPanel 参数工作台')
  assert.ok(tree.props.subList, '必须包含右侧 subList 待处理图片队列')

  // 零彩色 Emoji 污染校验
  const serialized = view.text()
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(serialized), false, 'UI 文本严禁包含彩色 Emoji')

  const firstItem = view.item((it) => it.props.title === 'design_poster_4k.png')
  assert.ok(firstItem)

  // 执行批量处理主动作并验证成功 Toast
  await view.run(firstItem, '开始批量处理 (2项)')
  assert.equal(dllCallCount, 1)
  assert.match(String(host.lastToast()?.title), /已完成 2 张图片压缩与转换/)

  // 异常故障注入：当宿主返回失败时，UI 必须提示 Failure Toast
  host.ipc.dllplugin_call = async () => ({
    ok: false,
    error: 'DECODE_FAILED: 图片文件头损坏'
  })
  const updatedItem = view.item((it) => it.props.title === 'design_poster_4k.png')
  await view.run(updatedItem, '开始批量处理 (2项)')
  assert.equal(String(host.lastToast()?.style).toLowerCase(), 'failure')
  assert.match(String(host.lastToast()?.message), /图片文件头损坏/)

  view.unmount()
})
