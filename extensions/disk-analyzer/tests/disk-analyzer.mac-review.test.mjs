// macOS 真机审查回归：分类标题、平台示例、计数不重复、分区分组不混入查看范围、详情不用 [!TIP] 写法
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyFileExtension, groupDescriptionFor, searchPlaceholderFor, OFFICIAL_FILE_TYPE_GROUPS } from '../dist/logic.js'
import { readFileSync } from 'node:fs'

test('按平台给搜索示例与分类说明：macOS 不出现 .dll / .exe', () => {
  assert.ok(!searchPlaceholderFor(true).includes('.dll'))
  assert.ok(searchPlaceholderFor(false).includes('.dll'))
  for (const g of OFFICIAL_FILE_TYPE_GROUPS) {
    const mac = groupDescriptionFor(g.groupId, true)
    assert.ok(!/\.dll|\.exe|Windows/.test(mac), `${g.name}: ${mac}`)
    assert.equal(groupDescriptionFor(g.groupId, false), g.description)
  }
})

test('macOS 安装包与动态库归入对应分类', () => {
  assert.equal(classifyFileExtension('/Users/a/Downloads/x.pkg').groupId, 6)
  assert.equal(classifyFileExtension('/usr/local/lib/libbig.dylib').groupId, 8)
  assert.equal(classifyFileExtension('/Users/a/x.dmg').groupId, 5, 'dmg 仍是镜像')
  assert.equal(classifyFileExtension('C:\\a\\b.dll').groupId, 8)
})

test('界面源码：分类标题不再写「10 大」，分区分组与查看范围分开，详情不用 [!TIP]', () => {
  const src = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8')
  assert.ok(!src.includes('10 大文件分类'))
  assert.ok(!src.includes('[!TIP]') && !src.includes('[!CAUTION]') && !src.includes('[!WARNING]'))
  assert.ok(!src.includes('Group #'))
  assert.ok(!src.includes('物理挂载分区'))
})

test('版本号结尾不当作扩展名：同一程序的多个版本与无后缀的哈希名文件归到同一类', () => {
  const versions = ['/Users/a/.local/share/tool/versions/2.1.301', '/Users/a/.local/share/tool/versions/2.1.312']
  const hashed = '/Users/a/Library/Application Support/Updater/crx_cache/e97c9f1e5d5605c272f48bb91ac1d4e8708ab4ec7077384e709da99519c63a70'
  for (const p of [...versions, hashed]) {
    const c = classifyFileExtension(p)
    assert.equal(c.extension, '(无扩展名)', p)
    assert.equal(c.groupId, 99, p)
  }
  assert.equal(classifyFileExtension('/usr/lib/libfoo.so.1').extension, '(无扩展名)')
  // 正常扩展名不受影响，含数字的扩展名仍识别
  assert.equal(classifyFileExtension('/a/b.mp4').groupId, 1)
  assert.equal(classifyFileExtension('/a/b.7z').groupId, 5)
  assert.equal(classifyFileExtension('/a/b.mp3').groupId, 2)
  assert.equal(classifyFileExtension('/a/.hidden').extension, '(无扩展名)')
})

test('macOS 常见大文件按内容归类：Docker.raw 是虚拟磁盘、rootfs.img 是镜像、.ipa 是安装包、相机原图是图片', () => {
  assert.equal(classifyFileExtension('/Users/a/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw').groupId, 9)
  assert.equal(classifyFileExtension('/Users/a/vm/rootfs.img').groupId, 5)
  assert.equal(classifyFileExtension('/Users/a/vm/rootfs.img.zst').groupId, 5)
  assert.equal(classifyFileExtension('/Users/a/x.ipa').groupId, 6)
  assert.equal(classifyFileExtension('/Users/a/DSC_0001.NEF').groupId, 3)
  assert.equal(classifyFileExtension('/Users/a/IMG_0001.dng').groupId, 3)
})

test('容量显示：macOS 按 1000 进制（与访达、硬件信息一致），Windows 按 1024 进制', async () => {
  const { formatBytes } = await import('../dist/logic.js')
  const disk = 494_384_795_648
  assert.equal(formatBytes(disk, 1, true), '494 GB')
  assert.equal(formatBytes(disk, 1, false), '460 GB')
  assert.equal(formatBytes(1500, 1, true), '1.5 KB')
  assert.equal(formatBytes(999, 1, true), '999 B')
  assert.equal(formatBytes(0, 1, true), '0 B')
  assert.equal(formatBytes(Number.NaN, 1, true), '0 B')
  assert.equal(formatBytes(-5, 1, false), '0 B')
  assert.equal(formatBytes(1024, 1, false), '1.0 KB')
})
