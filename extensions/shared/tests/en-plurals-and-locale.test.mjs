import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginsRoot = path.resolve(__dirname, '..', '..')
const repoRoot = path.resolve(pluginsRoot, '..')

const { setRuntimeLocale, getLocale } = await import(
  pathToFileURL(path.join(repoRoot, 'packages/declarative-ui/dist/index.js')).href
)

function listPluralWrappedPlugins() {
  const out = []
  for (const d of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!d.isDirectory() || ['shared', 'scripts', 'node_modules'].includes(d.name) || d.name.startsWith('.')) continue
    const mf = path.join(pluginsRoot, d.name, 'plugin.json')
    const i18nTs = path.join(pluginsRoot, d.name, 'src', 'i18n.ts')
    if (!fs.existsSync(mf) || !fs.existsSync(i18nTs)) continue
    const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'))
    if (manifest.revoked === true) continue
    const src = fs.readFileSync(i18nTs, 'utf8')
    if (src.includes('[[')) {
      out.push({ id: d.name, src })
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

function extractPluralKeys(src) {
  const enIdx = Math.max(src.indexOf("'en-US'"), src.indexOf('"en-US"'))
  const enPart = src.slice(enIdx)
  const keys = []
  for (const line of enPart.split(/\r?\n/)) {
    if (!line.includes('[[')) continue
    const m = line.match(/^\s*(['"]?)([A-Za-z0-9_.-]+)\1\s*:\s*/)
    if (!m) continue
    const key = m[2]
    const vars = new Set()
    for (const vm of line.matchAll(/\[\[([A-Za-z0-9_.-]+):([^|\]]+)\|([^\]]+)\]\]/g)) {
      vars.add(vm[1])
    }
    for (const pm of line.matchAll(/\{([A-Za-z0-9_.-]+)\}/g)) {
      vars.add(pm[1])
    }
    keys.push({ key, vars: [...vars] })
  }
  return keys
}

test('全部 69 个含英文复数规则的活跃插件在 0 / 1 / 2 / 1,000 下渲染准确且无 [[...]] 残留', async () => {
  const prevLocale = getLocale()
  const targets = listPluralWrappedPlugins()
  assert.ok(targets.length >= 69, `预期至少 69 个插件，实际 ${targets.length}`)

  const BAD_SINGULAR_RE = /(?<![+-])\b1\s+(?:items|files|folders|images|videos|entries|processes|matches|conflicts|rules|records|chars|lines|bytes|threads|hosts|volumes|vols|profiles|mappings|combos|shortcuts|hotkeys|invoices|rows|spaces|IPs|blocks|displays|results|digits|seconds|minutes|hours|days|configs|cols|apps|nodes|parameters|placeholders|snippets|projects|actions|browsers|events|meetings|tracks|devices|tokens|locations|extensions|types|styles|stacks|runs)\b/i

  try {
    setRuntimeLocale('en-US')
    let checkedKeys = 0
    for (const { id, src } of targets) {
      const distI18n = path.join(pluginsRoot, id, 'dist', 'i18n.js')
      assert.ok(fs.existsSync(distI18n), `${id} 缺少 dist/i18n.js`)
      const mod = await import(pathToFileURL(distI18n).href)
      assert.equal(typeof mod.t, 'function', `${id}/dist/i18n.js 必须导出 t`)

      const entries = extractPluralKeys(src)
      assert.ok(entries.length > 0, `${id} 应至少包含 1 个复数键`)

      for (const { key, vars } of entries) {
        checkedKeys++
        // 1. count === 1 (number)
        const p1 = Object.fromEntries(vars.map((v) => [v, v === 'plus' ? '' : 1]))
        const out1 = mod.t(key, p1)
        assert.ok(!out1.includes('[['), `[${id}:${key}] n=1 残留原始复数标记: ${out1}`)
        assert.ok(!BAD_SINGULAR_RE.test(out1), `[${id}:${key}] n=1 仍存在复数语法错误: ${out1}`)

        // 2. count === "1" (stringified locale number)
        const p1Str = Object.fromEntries(vars.map((v) => [v, v === 'plus' ? '' : '1']))
        const out1Str = mod.t(key, p1Str)
        assert.equal(out1Str, out1, `[${id}:${key}] 字符串 "1" 应与数字 1 渲染一致`)

        // 3. count === 0 (plural in English)
        const p0 = Object.fromEntries(vars.map((v) => [v, v === 'plus' ? '' : 0]))
        const out0 = mod.t(key, p0)
        assert.ok(!out0.includes('[['), `[${id}:${key}] n=0 残留原始复数标记: ${out0}`)

        // 4. count === 2 & "1,000" (plural)
        const p2 = Object.fromEntries(vars.map((v) => [v, v === 'plus' ? '' : 2]))
        const out2 = mod.t(key, p2)
        assert.ok(!out2.includes('[['), `[${id}:${key}] n=2 残留原始复数标记: ${out2}`)
        assert.notEqual(out1, out2, `[${id}:${key}] n=1 与 n=2 英文单复数渲染结果不应相同: ${out1}`)

        const p1k = Object.fromEntries(vars.map((v) => [v, v === 'plus' ? '' : '1,000']))
        const out1k = mod.t(key, p1k)
        assert.ok(!out1k.includes('[['), `[${id}:${key}] n=1,000 残留原始复数标记: ${out1k}`)

        // 5. Missing params graceful fallback (must not leak [[...]])
        const outMissing = mod.t(key)
        assert.ok(!outMissing.includes('[['), `[${id}:${key}] 缺参时不应泄露原始复数标记: ${outMissing}`)
      }
    }
    assert.ok(checkedKeys >= 230, `预期覆盖至少 230 个复数键，实际 ${checkedKeys}`)

    // Verify zh-CN unaffected
    setRuntimeLocale('zh-CN')
    const aiMod = await import(pathToFileURL(path.join(pluginsRoot, 'ai-image/dist/i18n.js')).href)
    const zhOut = aiMod.t('confirmBatchTitle', { count: 1 })
    assert.ok(/[\u4e00-\u9fa5]/.test(zhOut) && !zhOut.includes('[['), `zh-CN 应输出中文: ${zhOut}`)
  } finally {
    setRuntimeLocale(prevLocale)
  }
})

test('共享模块 file-import 与 qr-encoder 英文单复数准确', async () => {
  const prevLocale = getLocale()
  try {
    setRuntimeLocale('en-US')
    const qrMod = await import(pathToFileURL(path.join(pluginsRoot, 'qr-code/dist/qr-encoder.js')).href)
    assert.throws(
      () => qrMod.encodeQr('x'.repeat(5000), 'H'),
      /bytes\)/
    )
    const fiMod = await import(pathToFileURL(path.join(pluginsRoot, 'ai-image/dist/file-import.js')).href)
    const base = { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false }
    const t1 = fiMod.summarizeImport({ ...base, ignored: 1, failedDirs: [{ path: 'a', error: 'err' }] }, { added: 1, duplicates: 0 })
    assert.equal(t1.title, 'Added 1 file')
    assert.ok(t1.message.includes('ignored 1 unsupported file'), t1.message)
    assert.ok(t1.message.includes('1 subfolder could not be read'), t1.message)

    const t2 = fiMod.summarizeImport({ ...base, ignored: 3, failedDirs: [{ path: 'a', error: 'e1' }, { path: 'b', error: 'e2' }] }, { added: 2, duplicates: 0 })
    assert.equal(t2.title, 'Added 2 files')
    assert.ok(t2.message.includes('ignored 3 unsupported files'), t2.message)
    assert.ok(t2.message.includes('2 subfolders could not be read'), t2.message)
  } finally {
    setRuntimeLocale(prevLocale)
  }
})
