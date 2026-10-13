import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMemo,
  updateMemo,
  deleteMemo,
  getSampleMemos
} from '../dist/logic.js'

test('Memo 增删改查基本链路测试', () => {
  let memos = []

  // 1. 创建便签
  memos = createMemo(memos, '设计规范', '禁止插件写任何 CSS', '规范')
  assert.equal(memos.length, 1)
  assert.equal(memos[0].title, '设计规范')
  assert.equal(memos[0].tag, '规范')

  // 2. 更新便签
  const targetId = memos[0].id
  memos = updateMemo(memos, targetId, { title: '全键盘设计规范' })
  assert.equal(memos[0].title, '全键盘设计规范')
  assert.equal(memos[0].content, '禁止插件写任何 CSS')

  // 3. 删除便签
  memos = deleteMemo(memos, targetId)
  assert.equal(memos.length, 0)
})

test('Memo 边界与异常输入测试', () => {
  let memos = getSampleMemos()
  const count = memos.length

  // 1. 空标题自动填充默认值
  memos = createMemo(memos, '', '仅有正文的内容', '')
  assert.equal(memos.length, count + 1)
  assert.equal(memos[0].title, '无标题便签')
  assert.equal(memos[0].tag, '默认')

  // 2. 更新或删除不存在的 ID 无副作用
  memos = updateMemo(memos, 'non-existent', { title: 'Ghost' })
  assert.equal(memos.length, count + 1)
  memos = deleteMemo(memos, 'non-existent')
  assert.equal(memos.length, count + 1)
})
