import test from 'node:test'
import assert from 'node:assert/strict'
import * as archiveManager from '../dist/index.js'

async function withRealElectronWindow(handlers, fn) {
  const prevWindow = globalThis.window
  const calls = []
  const transportMethods = {}

  for (const [channel, impl] of Object.entries(handlers)) {
    transportMethods[channel] = async (envelope) => {
      const actualParams =
        envelope && typeof envelope === 'object' && 'params' in envelope && 'messageId' in envelope
          ? envelope.params
          : envelope
      calls.push({ channel, payload: actualParams })
      return impl(actualParams)
    }
  }

  globalThis.window = {
    __ztoolsElectron: {
      transport: {
        methods: transportMethods
      }
    }
  }

  try {
    return await fn(calls)
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = prevWindow
    }
  }
}

test('archive-manager host integration: 压缩包目录树透视、分类识别、按需提取与单根目录防套娃', async () => {
  await withRealElectronWindow(
    {
      system_get_path: ({ name }) => `D:\\ArchiveWorkspace\\${name}`,
      system_search_files: ({ query }) => {
        if (String(query).includes('downloads')) {
          return {
            files: [
              {
                name: '2026Q3_标书全套.zip',
                path: 'D:\\ArchiveWorkspace\\downloads\\2026Q3_标书全套.zip',
                is_dir: false,
                size: 10485760,
                mtime: 1720000000
              },
              {
                name: 'not_an_archive.pdf',
                path: 'D:\\ArchiveWorkspace\\downloads\\not_an_archive.pdf',
                is_dir: false,
                size: 512000,
                mtime: 1720000000
              }
            ]
          }
        }
        return { files: [] }
      },
      dllplugin_call: ({ plugin, func, params }) => {
        if (func === 'ListArchiveEntries') {
          return {
            ok: true,
            plugin,
            archivePath: params.archivePath,
            archiveName: '2026Q3_标书全套.zip',
            archiveSizeBytes: 10485760,
            totalEntries: 2,
            fileCount: 2,
            totalUncompressedBytes: 16777216,
            totalCompressedBytes: 10485760,
            compressionRatio: 38,
            encryptedCount: 0,
            isEncrypted: false,
            traversalRiskCount: 0,
            hasSingleRootFolder: true,
            singleRootFolderName: '2026Q3_标书',
            entries: [
              {
                entryName: '2026Q3_标书/商务报价明细.xlsx',
                name: '商务报价明细.xlsx',
                uncompressedSize: 12582912,
                compressedSize: 8388608,
                compressionRatio: 33,
                crc32: 'A1B2C3D4',
                isDirectory: false,
                isEncrypted: false,
                hasPathTraversalRisk: false
              },
              {
                entryName: '2026Q3_标书/架构图.png',
                name: '架构图.png',
                uncompressedSize: 4194304,
                compressedSize: 2097152,
                compressionRatio: 50,
                crc32: 'E5F60718',
                isDirectory: false,
                isEncrypted: false,
                hasPathTraversalRisk: false
              }
            ]
          }
        }
        if (func === 'ExtractArchiveEntries') {
          return {
            ok: true,
            targetDir: 'D:\\ArchiveWorkspace\\downloads\\2026Q3_标书',
            extractedCount: Array.isArray(params.entryNames) ? params.entryNames.length : 2,
            extractedFiles: ['D:\\ArchiveWorkspace\\downloads\\2026Q3_标书\\商务报价明细.xlsx'],
            blockedEntries: []
          }
        }
        return { ok: true }
      }
    },
    async () => {
      const candidates = await archiveManager.fetchRealArchiveCandidates()
      assert.equal(candidates.length, 1)
      assert.equal(candidates[0].name, '2026Q3_标书全套.zip')

      const inspected = await archiveManager.inspectArchiveEntries(candidates[0].path)
      assert.equal(inspected.ok, true)
      assert.equal(inspected.fileCount, 2)
      assert.equal(inspected.entries[0].category, '办公文档')
      assert.equal(inspected.entries[1].category, '图片与媒体')

      const extracted = await archiveManager.extractArchiveEntries(candidates[0].path, {
        entryNames: ['2026Q3_标书/商务报价明细.xlsx']
      })
      assert.equal(extracted.ok, true)
      assert.equal(extracted.extractedCount, 1)
    }
  )
})

test('archive-manager beyond happy path: Zip Slip 恶意路径穿越拦截、损坏归档、加密流拦截与空路径校验', async () => {
  // 1. Zip Slip 恶意路径预检识别
  assert.equal(archiveManager.isUnsafeEntryPath('../../Windows/System32/cmd.exe'), true)
  assert.equal(archiveManager.isUnsafeEntryPath('..\\..\\evil.dll'), true)
  assert.equal(archiveManager.isUnsafeEntryPath('/etc/passwd'), true)
  assert.equal(archiveManager.isUnsafeEntryPath('C:\\Windows\\win.ini'), true)
  assert.equal(archiveManager.isUnsafeEntryPath('docs/2026/report.pdf'), false)

  // 2. 提取包含 Zip Slip 条目时直接拦截，不向底层发送写盘指令
  const blockedRes = await archiveManager.extractArchiveEntries('D:\\test.zip', {
    entryNames: ['../../Windows/System32/evil.dll']
  })
  assert.equal(blockedRes.ok, false)
  assert.match(String(blockedRes.error), /ZIP_SLIP_BLOCKED/)
  assert.equal(blockedRes.blockedEntries.length, 1)

  // 3. 空压缩包路径报错
  const emptyInspect = await archiveManager.inspectArchiveEntries('   ')
  assert.equal(emptyInspect.ok, false)
  assert.match(String(emptyInspect.error), /不能为空/)

  // 4. 目标目录指向受保护系统路径时抛错拦截
  await assert.rejects(
    () =>
      archiveManager.invokeNativeCapability('ExtractArchiveEntries', {
        archivePath: 'D:\\a.zip',
        targetDir: 'C:\\Windows\\System32\\drivers'
      }),
    /SECURITY_INTERCEPTED/
  )

  // 5. 宿主返回加密归档或损坏归档报错时如实向上传递
  await withRealElectronWindow(
    {
      dllplugin_call: () => ({
        ok: false,
        error: 'ENCRYPTED_ARCHIVE: 该压缩包包含加密条目，当前暂不支持无密码提取'
      })
    },
    async () => {
      const encRes = await archiveManager.extractArchiveEntries('D:\\encrypted.zip')
      assert.equal(encRes.ok, false)
      assert.match(String(encRes.error), /ENCRYPTED_ARCHIVE/)
    }
  )
})
