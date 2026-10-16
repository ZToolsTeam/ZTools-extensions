import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Command = require('../dist/index.js').default
const logic = require('../dist/logic.js')

test('super-markdown 声明式视图渲染与大纲提取/TOC生成集成测试', () => {
  const view = Command()
  assert.ok(view && view.type === 'List')
  const md = '# 标题一\n\n正文内容\n\n## 子标题二'
  const outline = logic.extractOutline(md)
  assert.equal(outline.length, 2)
  const toc = logic.generateTocMarkdown(outline)
  assert.ok(toc.includes('标题一') && toc.includes('子标题二'))
})

test('super-markdown 空文档与代码块伪标题过滤边界测试 (Beyond Happy Path)', () => {
  assert.deepEqual(logic.extractOutline(''), [])
  assert.equal(logic.generateTocMarkdown([]), '暂无标题大纲')
  assert.throws(() => logic.createNote('   ', '正文'), /笔记标题不能为空/)
  const codeBlockMd = '```bash\n# 这不是标题而是注释\n```\n# 真正的标题'
  const outline = logic.extractOutline(codeBlockMd)
  assert.equal(outline.length, 1)
  assert.equal(outline[0].text, '真正的标题')
})
