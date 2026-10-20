import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import QrCodeCommand from '../dist/index.js'
import { encodeQr } from '../dist/qr-encoder.js'
import { generateQrPngBase64, buildWifiPayload } from '../dist/qr-generator.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const golden = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/golden.json'), 'utf8'))
const host = createHost()
test.beforeEach(() => host.reset())

const matrixHash = (m) => crypto.createHash('sha256').update(m.map((r) => r.map((b) => (b ? 1 : 0)).join('')).join('\n')).digest('hex')

test('编码结果与基准一致（基准二维码已用 macOS 系统识别验证）', () => {
  for (const g of golden) {
    const q = encodeQr(g.text, g.ecc)
    assert.equal(q.version, g.version, g.text)
    assert.equal(matrixHash(q.modules), g.sha256, g.text)
  }
})

// 在 macOS 上用系统自带的 CoreImage 识别插件生成的 PNG，验证真的能扫出来
const swift = process.platform === 'darwin' ? spawnSync('swiftc', ['--version']).status === 0 : false
test('[macOS] 系统识别插件生成的 PNG：中文、Emoji、Wi-Fi、长文本、各纠错等级', { skip: !swift && '需要 macOS 与 swiftc' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-qr-'))
  try {
    const bin = path.join(dir, 'decode')
    execFileSync('swiftc', ['-O', path.join(here, 'fixtures/decode-macos.swift'), '-o', bin])
    const texts = ['https://ztools.cn/插件?id=1', buildWifiPayload('My;Net', 'p:a"ss', 'WPA'), '中文 😀'.repeat(30), 'z'.repeat(1200)]
    const files = []
    // 基准用例同样交给系统识别，保证 golden.json 里的矩阵是能扫出来的
    golden.forEach((g, i) => {
      const f = path.join(dir, `golden-${i}.png`)
      fs.writeFileSync(f, Buffer.from(generateQrPngBase64(g.text, g.ecc), 'base64'))
      files.push([f, g.text])
    })
    texts.forEach((t, i) => (['L', 'M', 'Q', 'H']).forEach((l) => {
      const f = path.join(dir, `${i}-${l}.png`)
      fs.writeFileSync(f, Buffer.from(generateQrPngBase64(t, l), 'base64'))
      files.push([f, t])
    }))
    const out = execFileSync(bin, files.map(([f]) => f)).toString().trim().split('\n')
    out.forEach((line, i) => {
      const decoded = Buffer.from(line.split('\t')[1], 'base64').toString('utf8')
      assert.equal(decoded, files[i][1], path.basename(files[i][0]))
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[边界] 超出最大容量时报错，而不是生成扫不出的码', () => {
  assert.throws(() => encodeQr('x'.repeat(3000), 'H'), /超出二维码最大容量/)
  assert.doesNotThrow(() => encodeQr('x'.repeat(2900), 'L'))
  assert.throws(() => buildWifiPayload('', 'p', 'WPA'), /名称/)
  assert.throws(() => buildWifiPayload('net', '', 'WPA'), /密码/)
  assert.equal(buildWifiPayload('a;b', '', 'nopass'), String.raw`WIFI:T:nopass;S:a\;b;;`)
})

test('界面：输入后实时预览，回车复制 PNG 图片并记入历史；历史持久化', async () => {
  let copied = null
  host.ipc.clipboard_copy_image = async (p) => { copied = p.image; return { success: true } }
  const view = await mount(QrCodeCommand)
  await view.search('https://ztools.cn')
  const live = view.item('live')
  assert.ok(JSON.stringify(live.props.detail).includes('data:image/svg+xml'))
  await view.run(live, '复制二维码图片')
  assert.ok(copied.startsWith('data:image/png;base64,iVBOR'))
  await tick()
  const hist = JSON.parse(host.storage.get('ztools_qr_history'))
  assert.equal(hist[0].content, 'https://ztools.cn')
  view.unmount()
  const again = await mount(QrCodeCommand)
  assert.ok(again.items().some((i) => i.props.title === 'https://ztools.cn'))
})

test('[故障注入] 复制图片失败时提示，不写入历史', async () => {
  host.ipc.clipboard_copy_image = async () => { throw Object.assign(new Error('剪贴板图片解码失败'), { code: 'INVALID_REQUEST' }) }
  const view = await mount(QrCodeCommand)
  await view.search('abc')
  await view.run(view.item('live'), '复制二维码图片')
  assert.match(String(host.lastToast().title), /复制图片失败/)
  assert.equal(host.storage.has('ztools_qr_history'), false)
})

test('Wi-Fi 表单生成正确内容；界面无彩色 Emoji', async () => {
  const view = await mount(QrCodeCommand)
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(view.text()))
  await view.run(view.item('wifi'), '生成 Wi-Fi 二维码…')
  const form = await mountPushed(host)
  await form.fill('ssid', '家里')
  await form.fill('password', '12345678')
  await form.run(null, '生成并保存')
  await tick()
  assert.equal(JSON.parse(host.storage.get('ztools_qr_history'))[0].content, 'WIFI:T:WPA;S:家里;P:12345678;;')
})
