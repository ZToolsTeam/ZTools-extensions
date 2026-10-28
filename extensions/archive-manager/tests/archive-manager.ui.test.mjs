import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ArchiveManagerCommand from '../dist/index.js'

const host = createHost()
const ARCHIVE = 'D:\\TestArchives\\downloads\\bid_package.zip'
const SHA = 'ab'.repeat(32)

function entry(entryName, extra = {}) {
  return {
    entryName,
    name: entryName.split('/').pop(),
    uncompressedSize: 6291456,
    compressedSize: 4194304,
    compressionRatio: 33,
    crc32: '11223344',
    isDirectory: false,
    isEncrypted: false,
    hasPathTraversalRisk: false,
    ...extra
  }
}

/**
 * 按客户端真实返回结构模拟：system_get_path、目录扫描、dllplugin_call（ListArchiveEntries / ExtractArchiveEntries / VerifyArchive）
 */
function installArchiveHost({ archives = [ARCHIVE], listing = {}, listError = null, extract = null, verify = null } = {}) {
  const calls = { extract: [], verify: 0, trash: [] }
  host.ipc.system_get_path = async ({ name }) => `D:\\TestArchives\\${name}`
  host.ipc.system_search_files = async ({ query }) => {
    if (!String(query).includes('downloads')) return { files: [] }
    return { files: archives.map((p) => ({ name: p.split('\\').pop(), path: p, is_dir: false, size: 5242880, mtime: 1725000000 })) }
  }
  host.ipc.dllplugin_call = async ({ func, params }) => {
    if (func === 'ListArchiveEntries') {
      if (listError) return { ok: false, error: listError }
      return {
        ok: true,
        archivePath: params.archivePath,
        archiveName: 'bid_package.zip',
        archiveSizeBytes: 5242880,
        totalEntries: 2,
        fileCount: 2,
        totalUncompressedBytes: 8388608,
        totalCompressedBytes: 5242880,
        compressionRatio: 37,
        encryptedCount: 0,
        isEncrypted: false,
        traversalRiskCount: 1,
        hasSingleRootFolder: false,
        singleRootFolderName: null,
        entries: [
          entry('标书正本.pdf', { category: '办公文档' }),
          entry('../../evil_autorun.exe', { name: 'evil_autorun.exe', category: '可执行程序', uncompressedSize: 2097152, hasPathTraversalRisk: true })
        ],
        ...listing
      }
    }
    if (func === 'ExtractArchiveEntries') {
      calls.extract.push(params)
      if (extract) return extract(params)
      return {
        ok: true,
        targetDir: 'D:\\TestArchives\\downloads\\bid_package',
        extractedCount: Array.isArray(params.entryNames) ? params.entryNames.length : 1,
        extractedFiles: ['D:\\TestArchives\\downloads\\bid_package\\标书正本.pdf'],
        blockedEntries: Array.isArray(params.entryNames) ? [] : ['../../evil_autorun.exe']
      }
    }
    if (func === 'VerifyArchive') {
      calls.verify++
      if (verify) return verify(params)
      return { ok: true, sha256: SHA, totalEntries: 2, fileCount: 2, traversalRiskCount: 0, isEncrypted: false, verified: true }
    }
    return { ok: false, error: `未模拟 ${func}` }
  }
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    calls.trash.push(fullPath)
    return { success: true }
  }
  return calls
}

const pdfItem = (view) => view.item((it) => it.props.title === '标书正本.pdf')

test.beforeEach(() => {
  host.reset()
  delete globalThis.__ztoolsLaunchContext
})

test('布局二：左侧分类 + 右侧包内文件，越界条目标红且不可勾选；没有示例数据', async () => {
  installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)

  const tree = view.tree()
  assert.equal(tree.type, 'List')
  assert.equal(tree.props.isShowingDetail, false)
  assert.ok(tree.props.subList)
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(view.text()), false)
  assert.equal(view.text().includes('华东区'), false, '不再出现内置的示例压缩包')

  const evil = view.item((it) => it.props.title === 'evil_autorun.exe')
  assert.equal(evil.props.checkable, false)
  assert.ok(view.text().includes('越界路径，不提取'))
  assert.match(view.item('diag-security').props.subtitle, /1 个条目含 \.\.\/ 或绝对路径，不会被提取/)
  view.unmount()
})

test('勾选后提取：先确认目标文件夹并提示会覆盖同名文件，确认后才调用；取消则不解压', async () => {
  const calls = installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)

  assert.equal(view.actions(pdfItem(view))[0].props.title, '解压全部')
  pdfItem(view).props.onCheckChange(true)
  await tick(5)
  assert.equal(view.actions(pdfItem(view))[0].props.title, '提取已勾选的 1 个文件')

  host.setConfirm(false)
  await view.run(pdfItem(view), '提取已勾选的 1 个文件')
  assert.equal(calls.extract.length, 0, '取消确认不解压')
  const confirm = host.confirms.at(-1)
  assert.equal(confirm.title, '提取 1 个文件？')
  assert.match(confirm.message, /解压到：D:\\TestArchives\\downloads\\bid_package/)
  assert.match(confirm.message, /同名文件会被覆盖/)

  host.setConfirm(true)
  await view.run(pdfItem(view), '提取已勾选的 1 个文件')
  assert.equal(calls.extract.length, 1)
  assert.deepEqual(calls.extract[0].entryNames, ['标书正本.pdf'])
  assert.equal(calls.extract[0].smartUnwrap, false)
  assert.equal(host.lastToast().title, '已解压 1 个文件')
  view.unmount()
})

test('整包解压：单个顶层文件夹时确认框写明实际落点；越界条目未提取时如实写出', async () => {
  const calls = installArchiveHost({ listing: { hasSingleRootFolder: true, singleRootFolderName: '标书', traversalRiskCount: 0 } })
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)
  await view.run(pdfItem(view), '解压全部')
  assert.match(host.confirms.at(-1).message, /解压到：D:\\TestArchives\\downloads\\标书\n/)
  assert.equal(calls.extract[0].smartUnwrap, true)
  assert.equal(calls.extract[0].entryNames, undefined)
  assert.equal(host.lastToast().title, '已解压 1 个文件 · 1 个越界条目未提取')
  view.unmount()
})

test('[故障注入] 客户端报告解压 0 个文件或失败时提示失败，不用勾选数量冒充结果', async () => {
  installArchiveHost({ extract: () => ({ ok: true, targetDir: 'D:\\x', extractedCount: 0, extractedFiles: [], blockedEntries: [] }) })
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)
  await view.run(pdfItem(view), '只提取这个文件（标书正本.pdf）')
  assert.equal(host.lastToast().title, '没有解压出任何文件')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  view.unmount()

  host.reset()
  installArchiveHost({ extract: () => ({ ok: false, error: 'EPERM: operation not permitted' }) })
  const view2 = await mount(ArchiveManagerCommand, host)
  await tick(10)
  await view2.run(pdfItem(view2), '解压全部')
  assert.equal(host.lastToast().title, '解压失败')
  assert.match(host.lastToast().message, /EPERM/)
  view2.unmount()
})

test('[边界] 含加密条目的压缩包：直接提示不支持解压，不弹确认、不调用解压', async () => {
  const calls = installArchiveHost({ listing: { isEncrypted: true, encryptedCount: 1, traversalRiskCount: 0, entries: [entry('a.pdf', { isEncrypted: true })] } })
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)
  assert.match(view.item('diag-security').props.subtitle, /含加密条目，暂不支持解压/)
  await view.run(view.item((it) => it.props.title === 'a.pdf'), '解压全部')
  assert.equal(host.confirms.length, 0)
  assert.equal(calls.extract.length, 0)
  assert.equal(host.lastToast().title, '暂不支持解压加密的压缩包')
  view.unmount()
})

test('校验：如实说明只读目录、查越界与算 SHA-256，不再声称 CRC32 校验通过', async () => {
  installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)
  const verifyBtn = view.tree().props.filterBar.props.actions.find((a) => a.id === 'verify-archive-btn')
  await verifyBtn.onAction()
  await tick(5)
  const t = host.lastToast()
  assert.equal(t.style, Toast.Style.Success)
  assert.equal(t.title, '已读取压缩包目录，没有越界路径')
  assert.match(t.message, /SHA-256：abababababababab…/)
  assert.match(t.message, /未逐个校验文件 CRC32/)
  assert.equal(host.toasts.some((x) => /CRC32 与安全校验通过/.test(x.title)), false)
  view.unmount()
})

test('[故障注入] 校验发现越界、返回缺少 SHA-256、客户端报错，分别如实提示', async () => {
  const cases = [
    [() => ({ ok: true, sha256: SHA, fileCount: 2, traversalRiskCount: 3 }), '发现 3 个越界条目'],
    [() => ({ ok: true, fileCount: 2, traversalRiskCount: 0 }), '校验结果无法识别'],
    [() => ({ ok: false, error: '压缩包损坏或格式不受支持: invalid central directory' }), '校验失败']
  ]
  for (const [verify, title] of cases) {
    host.reset()
    installArchiveHost({ verify })
    const view = await mount(ArchiveManagerCommand, host)
    await tick(10)
    await view.run(pdfItem(view), '校验压缩包（目录、越界路径与 SHA-256）')
    assert.equal(host.lastToast().title, title)
    assert.equal(host.lastToast().style, Toast.Style.Failure)
    view.unmount()
  }
})

test('[故障注入] 读取压缩包失败：清空包内列表，状态条与空状态写明原因，解压动作提示失败', async () => {
  const calls = installArchiveHost({ listError: '压缩包损坏或格式不受支持: end of central directory record signature not found' })
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)
  const tree = view.tree()
  assert.equal(tree.props.subList.items.length, 0)
  assert.match(tree.props.subList.emptyText, /读取压缩包失败：.*central directory/)
  assert.match(tree.props.filterBar.props.summaryText, /读取失败/)
  assert.equal(host.toasts.some((t) => t.title === '读取压缩包失败'), true)

  await view.run(view.item('nav-cat-ALL'), '解压全部')
  assert.equal(calls.extract.length, 0)
  assert.equal(host.lastToast().title, '没有可解压的压缩包')
  view.unmount()
})

test('[边界] 没有找到压缩包时显示空状态，不显示示例压缩包', async () => {
  installArchiveHost({ archives: [] })
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)
  const tree = view.tree()
  assert.match(tree.props.subList.emptyText, /没有找到 ZIP 压缩包/)
  assert.match(tree.props.filterBar.props.summaryText, /没有找到 ZIP 压缩包/)
  assert.equal(JSON.stringify(tree.props.searchBarAccessory).includes('.zip ('), false, '下拉框里没有压缩包')
  view.unmount()
})

test('移入回收站：必须确认，取消不执行；失败如实提示', async () => {
  const calls = installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)
  host.setConfirm(false)
  await view.run(pdfItem(view), '将原压缩包移入回收站')
  assert.equal(calls.trash.length, 0)
  assert.equal(host.confirms.at(-1).primaryAction.style, 'destructive')

  host.setConfirm(true)
  host.ipc.shell_trash_item = async () => {
    throw Object.assign(new Error('文件正被另一个程序使用'), { code: 'EBUSY' })
  }
  await view.run(pdfItem(view), '将原压缩包移入回收站')
  assert.equal(host.lastToast().title, '移入回收站失败')
  assert.match(host.lastToast().message, /正被另一个程序使用/)
  view.unmount()
})

test('[故障注入] 在资源管理器中定位失败时提示，不静默', async () => {
  installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)
  await view.run(pdfItem(view), '在资源管理器中定位压缩包')
  assert.equal(host.lastToast().title, '无法在资源管理器中定位')
  view.unmount()
})

test('“提取压缩包内办公文档”命令默认筛选办公文档', async () => {
  installArchiveHost()
  globalThis.__ztoolsLaunchContext = { pluginId: 'archive-manager', featureCode: 'archive-docs' }
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)
  const titles = view.tree().props.subList.items.map((i) => i.props.title)
  assert.deepEqual(titles, ['标书正本.pdf'])
  view.unmount()
})

test('不在客户端里运行：只显示“需要在 ZTools 客户端中使用”，不扫描、不显示示例', async () => {
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(ArchiveManagerCommand, host)
    await tick(5)
    const items = view.items()
    assert.equal(items.length, 1)
    assert.equal(items[0].props.title, '需要在 ZTools 客户端中使用')
    view.unmount()
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})
