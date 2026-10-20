// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  encodeQrCodeMatrix,
  generateQrCodeSvgDataUri,
  fetchLanShareSnapshot,
  addRealFileToShareQueue,
  toggleLanShareServer,
  toggleFileShare,
  invokeNativeCapability as invokeLanShareCapability
} from '../dist/logic.js'

async function withSimulatedRealElectronWindow(methodsMap, fn) {
  const prevWindow = globalThis.window
  globalThis.window = {
    __ztoolsElectron: {
      transport: {
        methods: Object.keys(methodsMap),
        call: async (method, payload) => {
          const handler = methodsMap[method]
          if (!handler) {
            throw new Error(`IPC method not registered: ${method}`)
          }
          return await handler(payload)
        }
      }
    }
  }
  try {
    return await fn()
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = prevWindow
    }
  }
}

test('P01 lan-share: encodeQrCodeMatrix 生成符合 ISO/IEC 18004 标准的 QR 矩阵 (Finder/Separator/Timing/DarkModule)', () => {
  const url = 'http://192.168.1.108:18580/dl/1/ZTools.zip'
  const matrix = encodeQrCodeMatrix(url)
  const size = matrix.length

  // Version 3 (29x29) 或更高版本，尺寸满足 17 + 4*V
  assert.ok(size >= 21 && (size - 17) % 4 === 0, `非法 QR 矩阵边长: ${size}`)

  // 校验左上、右上、左下三个 7x7 Finder Pattern 外框与中心 3x3 实心块
  const verifyFinder = (r0, c0) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6
        const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4
        const expected = isBorder || isCenter
        assert.equal(matrix[r0 + r][c0 + c], expected, `Finder (${r0 + r}, ${c0 + c}) 不匹配`)
      }
    }
  }
  verifyFinder(0, 0)
  verifyFinder(0, size - 7)
  verifyFinder(size - 7, 0)

  // 校验 Finder 外侧白边 Separator 必为 false
  for (let i = 0; i < 8; i++) {
    assert.equal(matrix[7][i], false)
    assert.equal(matrix[i][7], false)
  }

  // 校验第 6 行与第 6 列的 Timing Pattern 交替深浅模块
  assert.equal(matrix[6][8], true)
  assert.equal(matrix[6][9], false)
  assert.equal(matrix[6][10], true)
  assert.equal(matrix[8][6], true)
  assert.equal(matrix[9][6], false)

  // 校验 Dark Module (4*V + 9, 8) 必为 true
  const version = (size - 17) / 4
  assert.equal(matrix[4 * version + 9][8], true)

  // 校验生成的 SVG Data URI 格式合法且对不同输入产生不同矩阵
  const svgUri1 = generateQrCodeSvgDataUri('http://192.168.1.108:18580/a')
  const svgUri2 = generateQrCodeSvgDataUri('http://192.168.1.108:18580/b')
  assert.ok(svgUri1.startsWith('data:image/svg+xml;utf8,'))
  assert.notEqual(svgUri1, svgUri2)
})

test('P01 lan-share: 真实宿主 HTTP 共享同步与异常/敏感文件拦截测试', async () => {
  const calls = []
  const hostBridge = {
    dllplugin_call: async (payload) => {
      calls.push(payload)
      if (payload.func === 'getLanShareStatus') {
        return {
          ok: true,
          lanIp: '10.0.0.88',
          port: 19580,
          running: true,
          downloadCounts: { portal: 12, 'D:\\Share\\report.pdf': 5 },
          files: [
            {
              id: 'file-real-1',
              name: 'report.pdf',
              path: 'D:\\Share\\report.pdf',
              size: 1048576,
              downloadCount: 5,
              isShared: true
            }
          ]
        }
      }
      if (payload.func === 'syncShareFiles') {
        return { ok: true, lanIp: '10.0.0.88', port: 19580, sizeBytes: 4096, downloadCount: 0 }
      }
      if (payload.func === 'startShareServer') {
        return { ok: true, running: true, lanIp: '10.0.0.88', port: payload.params.port }
      }
      return { ok: false, error: '服务拒绝访问' }
    },
    clipboard_read_text: async () => 'Real Clipboard Content'
  }

  const snap = await fetchLanShareSnapshot(hostBridge)
  assert.equal(snap.lanIp, '10.0.0.88')
  assert.equal(snap.port, 19580)
  assert.equal(snap.serverRunning, true)
  const fileItem = snap.items.find((i) => i.category === 'files')
  assert.ok(fileItem)
  assert.equal(fileItem.title, 'report.pdf')
  assert.equal(fileItem.downloadCount, 5)
  // 严禁混入虚构的 ZTools_Setup_1.1.7_x64.exe
  assert.equal(snap.items.some((i) => i.title.includes('ZTools_Setup_1.1.7')), false)

  // 添加真实文件到共享队列
  const addRes = await addRealFileToShareQueue('D:\\Share\\notes.txt', hostBridge)
  assert.equal(addRes.ok, true)
  assert.equal(addRes.item?.title, 'notes.txt')

  // 异常场景 1：空文件路径拦截
  const emptyRes = await addRealFileToShareQueue('   ', hostBridge)
  assert.equal(emptyRes.ok, false)

  // 异常场景 2：系统敏感文件 (SAM / SSH 私钥) 安全拦截
  const samRes = await addRealFileToShareQueue('C:\\Windows\\System32\\config\\SAM', hostBridge)
  assert.equal(samRes.ok, false)
  assert.match(samRes.message, /严禁/)

  // 异常场景 3：切换共享状态时宿主报错，必须如实返回 ok: false
  const failToggle = await toggleFileShare('file-real-1', false, {
    dllplugin_call: async () => ({ ok: false, error: 'HTTP 端口未监听' }),
    lan_share_toggle: async () => ({ ok: false, error: 'HTTP 端口未监听' })
  })
  assert.equal(failToggle.ok, false)
  assert.match(failToggle.message, /HTTP 端口未监听/)
})
