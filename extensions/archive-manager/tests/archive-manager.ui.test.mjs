import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ArchiveManagerCommand from '../dist/index.js'

test('archive-manager UI integration: 布局二左分类树+右勾选列表、自适应主动作与 Zip Slip 红色告警渲染', async () => {
  const host = createHost()
  host.ipc.system_get_path = async ({ name }) => `D:\\TestArchives\\${name}`
  host.ipc.system_search_files = async ({ query }) => {
    if (String(query).includes('downloads')) {
      return {
        files: [
          {
            name: 'bid_package.zip',
            path: 'D:\\TestArchives\\downloads\\bid_package.zip',
            is_dir: false,
            size: 5242880,
            mtime: 1725000000
          }
        ]
      }
    }
    return { files: [] }
  }

  let lastExtractPayload = null
  host.ipc.dllplugin_call = async ({ func, params }) => {
    if (func === 'ListArchiveEntries') {
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
        entries: [
          {
            entryName: '标书正本.pdf',
            name: '标书正本.pdf',
            category: '办公文档',
            uncompressedSize: 6291456,
            compressedSize: 4194304,
            compressionRatio: 33,
            crc32: '11223344',
            isDirectory: false,
            isEncrypted: false,
            hasPathTraversalRisk: false
          },
          {
            entryName: '../../evil_autorun.exe',
            name: 'evil_autorun.exe',
            category: '可执行程序',
            uncompressedSize: 2097152,
            compressedSize: 1048576,
            compressionRatio: 50,
            crc32: '99887766',
            isDirectory: false,
            isEncrypted: false,
            hasPathTraversalRisk: true
          }
        ]
      }
    }
    if (func === 'ExtractArchiveEntries') {
      lastExtractPayload = params
      return {
        ok: true,
        targetDir: 'D:\\TestArchives\\downloads\\bid_package',
        extractedCount: Array.isArray(params.entryNames) ? params.entryNames.length : 1,
        extractedFiles: ['D:\\TestArchives\\downloads\\bid_package\\标书正本.pdf'],
        blockedEntries: []
      }
    }
    return { ok: true }
  }

  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)

  const tree = view.tree()
  assert.equal(tree.type, 'List')
  assert.equal(tree.props.isShowingDetail, false)
  assert.ok(tree.props.subList, '布局二必须具备右侧 subList 包内文件明细列表')

  // 零彩色 Emoji 污染校验
  const serialized = view.text()
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(serialized), false, 'UI 严禁出现彩色 Emoji')
  assert.ok(serialized.includes('路径越界拦截'), '包含 ../ 的危险条目必须展示路径越界拦截标签')

  // 1. 未勾选任何项时，主动作应为「智能解压全部 (自动防套娃)」
  const pdfItem = view.item((it) => it.props.title === '标书正本.pdf')
  assert.equal(view.actions(pdfItem)[0].props.title, '智能解压全部 (自动防套娃)')

  // 2. 勾选单个包内文件后，主动作自适应切换为「仅提取已勾选条目 (1项)」
  pdfItem.props.onCheckChange(true)
  await tick(5)
  const updatedPdfItem = view.item((it) => it.props.title === '标书正本.pdf')
  assert.equal(view.actions(updatedPdfItem)[0].props.title, '仅提取已勾选条目 (1项)')

  await view.run(updatedPdfItem, '仅提取已勾选条目 (1项)')
  assert.deepEqual(lastExtractPayload?.entryNames, ['标书正本.pdf'])
  assert.match(String(host.lastToast()?.title), /已精准提取 1 个文件/)

  view.unmount()
})
