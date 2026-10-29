// 宿主降级标记透传：Windows 全盘索引（ztools-indexer）不可用或无结果时宿主只扫描下载 / 桌面 / 文稿，
// macOS Spotlight 失败或超时时结果不完整；插件必须把这些真实范围写进摘要条，不能当作完整的全盘搜索结果
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import * as mod from '../dist/index.js'
import { describeSearchScope, searchLocalFilesDetailed, searchLocalFiles } from '../dist/search-service.js'

const Command = mod.default
const host = createHost()
const file = (name, dir = 'C:\\Users\\me\\Downloads') => ({ name, path: `${dir}\\${name}`, size: 10, mtime: 1700000000 })

const waitSearch = async (ms = mod.SEARCH_DEBOUNCE_MS + 30) => {
  await new Promise((r) => setTimeout(r, ms))
  await tick(10)
}
const summary = (view) => view.tree().props.filterBar.summaryText

test.beforeEach(() => host.reset())

test('describeSearchScope：按宿主 degraded / source 给出真实搜索范围', () => {
  // Windows：索引组件未运行
  assert.equal(describeSearchScope({ files: [], degraded: true, source: 'local-fs' }, 'abc'), '全盘索引不可用，仅搜索了下载、桌面、文稿')
  assert.equal(describeSearchScope({ files: [], degraded: true, source: 'local-fs' }, ''), '全盘索引不可用，仅搜索了下载、桌面、文稿')
  // Windows：索引组件在运行但查询为空，宿主同样只扫了三个目录
  assert.match(describeSearchScope({ files: [], degraded: false, source: 'local-fs' }, 'abc'), /全盘索引没有返回结果.*仅搜索了下载、桌面、文稿/)
  // 空关键词本来就是「最近文件」，索引正常时不提示
  assert.equal(describeSearchScope({ files: [], degraded: false, source: 'local-fs' }, '  '), '')
  // macOS：Spotlight 失败 / 超时
  assert.match(describeSearchScope({ files: [], degraded: true, source: 'macos-fs' }, 'abc'), /Spotlight 搜索失败或超时/)
  assert.match(describeSearchScope({ files: [], degraded: true, source: 'macos-spotlight' }, 'abc'), /Spotlight 搜索失败或超时/)
  assert.equal(describeSearchScope({ files: [], degraded: false, source: 'macos-spotlight' }, 'abc'), '')
  // 全盘索引正常结果、未知来源的降级、异常载荷
  assert.equal(describeSearchScope({ files: [], total_indexed: 9 }, 'abc'), '')
  assert.equal(describeSearchScope({ files: [], degraded: true, source: 'something-new' }, 'abc'), '文件搜索处于降级模式，结果可能不完整')
  assert.equal(describeSearchScope({ files: [], degraded: 'true', source: 'macos-fs' }, 'abc'), '')
  assert.equal(describeSearchScope([], 'abc'), '')
  assert.equal(describeSearchScope(null, 'abc'), '')
  assert.equal(describeSearchScope(undefined, 'abc'), '')
})

test('searchLocalFilesDetailed：透传 filesearch_query 的降级标记；回退到 system_search_files 时同样透传', async () => {
  host.ipc.filesearch_query = async () => ({ files: [file('a.txt')], degraded: true, source: 'local-fs' })
  const out = await searchLocalFilesDetailed('a', 50)
  assert.equal(out.files.length, 1)
  assert.equal(out.scopeNotice, '全盘索引不可用，仅搜索了下载、桌面、文稿')
  // 只要文件列表的旧接口保持不变
  assert.deepEqual((await searchLocalFiles('a', 50)).map((f) => f.name), ['a.txt'])

  host.ipc.filesearch_query = async () => ({ files: [file('b.txt')], total_indexed: 120000 })
  assert.equal((await searchLocalFilesDetailed('b', 50)).scopeNotice, '')

  host.ipc.filesearch_query = async () => { throw new Error('filesearch 服务不可用') }
  host.ipc.system_search_files = async () => ({ files: [file('c.txt')], degraded: true, source: 'local-fs' })
  const viaSystem = await searchLocalFilesDetailed('c', 50)
  assert.equal(viaSystem.files[0].name, 'c.txt')
  assert.equal(viaSystem.scopeNotice, '全盘索引不可用，仅搜索了下载、桌面、文稿')

  // 两条通道都失败：如实报错，不返回空结果冒充「没有匹配」
  host.ipc.system_search_files = async () => { throw new Error('索引服务崩溃') }
  await assert.rejects(searchLocalFilesDetailed('d', 50), /文件搜索不可用：.*filesearch 服务不可用.*索引服务崩溃/)
})

test('界面：降级时摘要条写明只搜了下载、桌面、文稿；恢复全盘索引后提示消失；搜索失败时显示失败原因', async () => {
  let reply = { files: [file('report.docx')], degraded: true, source: 'local-fs' }
  host.ipc.filesearch_query = async () => {
    if (reply instanceof Error) throw reply
    return reply
  }
  const view = await mount(Command, host)
  await waitSearch(20)
  assert.match(summary(view), /^全盘索引不可用，仅搜索了下载、桌面、文稿 · 当前匹配 1 个文件\/目录/)

  await view.search('report')
  await waitSearch()
  assert.match(summary(view), /^全盘索引不可用，仅搜索了下载、桌面、文稿 · 当前匹配 1 个/)
  assert.match(summary(view), /检索词 "report"/)

  // 索引组件在运行但查询为空：同样只扫了三个目录
  reply = { files: [], degraded: false, source: 'local-fs' }
  await view.search('reportx')
  await waitSearch()
  assert.match(summary(view), /^全盘索引没有返回结果（可能尚未建立），仅搜索了下载、桌面、文稿 · 当前匹配 0 个/)

  // 全盘索引恢复
  reply = { files: [file('report.docx', 'D:\\Work')], total_indexed: 300000 }
  await view.search('report')
  await waitSearch()
  assert.match(summary(view), /^当前匹配 1 个文件\/目录/)
  assert.ok(!summary(view).includes('全盘索引'))

  // 降级后又搜索失败：只显示失败原因，不残留旧的范围提示
  reply = { files: [], degraded: true, source: 'local-fs' }
  await view.search('x')
  await waitSearch()
  assert.match(summary(view), /^全盘索引不可用/)
  host.ipc.system_search_files = async () => { throw new Error('索引服务崩溃') }
  reply = new Error('filesearch 服务不可用')
  await view.search('y')
  await waitSearch()
  assert.match(summary(view), /^搜索失败：文件搜索不可用/)
  assert.ok(!summary(view).includes('仅搜索了'))
  view.unmount()
})

test('界面：慢的旧请求带着降级标记晚返回时，不能覆盖新结果的范围提示', async () => {
  let release
  host.ipc.filesearch_query = async ({ query }) => {
    if (query === 'old') {
      await new Promise((r) => { release = r })
      return { files: [file('old.txt')], degraded: true, source: 'local-fs' }
    }
    return { files: [file('new.txt', 'E:\\Data')], total_indexed: 5000 }
  }
  const view = await mount(Command, host)
  await waitSearch(20)
  await view.search('old')
  await waitSearch()
  await view.search('new')
  await waitSearch()
  release()
  await tick(10)
  assert.match(summary(view), /^当前匹配 1 个文件\/目录/)
  assert.ok(!summary(view).includes('全盘索引'))
  assert.deepEqual(view.items().map((i) => i.props.title), ['new.txt'])
  view.unmount()
})

test('界面：macOS Spotlight 超时的降级同样提示', async () => {
  host.ipc.filesearch_query = async () => ({ files: [file('a.md', '/Users/me/Documents')], degraded: true, source: 'macos-fs' })
  const view = await mount(Command, host)
  await waitSearch(20)
  await view.search('a')
  await waitSearch()
  assert.match(summary(view), /^Spotlight 搜索失败或超时，结果可能不完整/)
  view.unmount()
})
