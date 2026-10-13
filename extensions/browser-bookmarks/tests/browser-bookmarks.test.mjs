import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseChromiumBookmarks,
  getStandardBookmarkPaths,
  getFallbackBookmarks
} from '../dist/logic.js'

test('BrowserBookmarks 集成解析测试 - 递归树展平为列表', () => {
  const sampleJson = JSON.stringify({
    roots: {
      bookmark_bar: {
        children: [
          {
            id: '1',
            name: 'GitHub',
            type: 'url',
            url: 'https://github.com'
          },
          {
            id: '2',
            name: 'Dev Tools',
            type: 'folder',
            children: [
              {
                id: '3',
                name: 'MDN Web Docs',
                type: 'url',
                url: 'https://developer.mozilla.org'
              }
            ]
          }
        ]
      }
    }
  })

  const bookmarks = parseChromiumBookmarks(sampleJson, 'Chrome')
  assert.equal(bookmarks.length, 2, '应递归解析出2条书签')

  const gh = bookmarks.find(b => b.title === 'GitHub')
  assert.ok(gh)
  assert.equal(gh.url, 'https://github.com')
  assert.equal(gh.browser, 'Chrome')

  const mdn = bookmarks.find(b => b.title === 'MDN Web Docs')
  assert.ok(mdn)
  assert.equal(mdn.folder, 'Dev Tools')
})

test('BrowserBookmarks 破坏性与边界异常测试', () => {
  // 1. 空内容与非 JSON 字符串
  assert.deepEqual(parseChromiumBookmarks(''), [])
  assert.deepEqual(parseChromiumBookmarks('invalid-json-text'), [])

  // 2. 缺少 roots 的空对象
  assert.deepEqual(parseChromiumBookmarks('{}'), [])
  assert.deepEqual(parseChromiumBookmarks('{"roots": null}'), [])

  // 3. 空路径生成
  assert.deepEqual(getStandardBookmarkPaths(''), [])

  // 4. 兜底列表有效性
  const fallback = getFallbackBookmarks()
  assert.ok(fallback.length > 0)
  assert.ok(fallback.every(b => b.url.startsWith('https://')))
})
