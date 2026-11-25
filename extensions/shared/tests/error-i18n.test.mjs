import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { resolveErrorMessage, extractErrorCode, extractHostCode, isDisplayableInCurrentLocale } from '../error-i18n.ts'
import { isHostMethodMissing } from '../host-compat.ts'

beforeEach(() => {
  setRuntimeLocale('zh-CN')
})

test('resolveErrorMessage 优先按 hostCode / errorCode 查自定义 codeMap 与标准词典', () => {
  assert.equal(
    resolveErrorMessage(
      { errorCode: 'PERMISSION_DENIED', errorDetails: { hostCode: 'CUSTOM_DENY' }, error: '原始错误' },
      '兜底提示',
      { CUSTOM_DENY: '自定义拒绝提示', PERMISSION_DENIED: '通用拒绝' }
    ),
    '自定义拒绝提示'
  )

  setRuntimeLocale('en-US')
  assert.equal(
    resolveErrorMessage(
      { errorCode: 'PERMISSION_DENIED', error: '权限不足，拒绝访问' },
      'Fallback error'
    ),
    'Permission denied'
  )
  assert.equal(
    resolveErrorMessage(
      { error: { code: 'REQUEST_TIMEOUT', message: '请求超时' } },
      'Fallback error'
    ),
    'Request timed out. Please try again later.'
  )
})

test('isDisplayableInCurrentLocale 与 resolveErrorMessage 遵循对称语种规则', () => {
  setRuntimeLocale('zh-CN')
  assert.equal(isDisplayableInCurrentLocale(''), false)
  assert.equal(isDisplayableInCurrentLocale('读取目录权限不足'), true)
  assert.equal(isDisplayableInCurrentLocale('Permission denied'), false)
  assert.equal(isDisplayableInCurrentLocale('database is locked'), false)

  // 中文模式：带标准错误码但原文为纯英文时，使用标准中文译文
  assert.equal(
    resolveErrorMessage({ errorCode: 'PERMISSION_DENIED', error: 'Permission denied' }, '操作失败'),
    '权限不足，无法执行该操作'
  )
  assert.equal(
    resolveErrorMessage({ errorCode: 'INTERNAL_ERROR', error: 'database is locked' }, '操作失败'),
    '宿主内部错误'
  )
  // 中文模式：带标准错误码且原文已本地化（含中文）时，保留精确消息
  assert.equal(
    resolveErrorMessage({ errorCode: 'FILE_ERROR', error: '无法读取指定文件 /tmp/a.txt' }, '操作失败'),
    '无法读取指定文件 /tmp/a.txt'
  )
  // 中文模式：无标准错误码的纯英文技术错误回退中文 fallback，不裸露英文
  assert.equal(
    resolveErrorMessage({ error: 'ENOENT: no such file or directory' }, '操作失败'),
    '操作失败'
  )

  setRuntimeLocale('en-US')
  assert.equal(isDisplayableInCurrentLocale(''), false)
  assert.equal(isDisplayableInCurrentLocale('Disk I/O timeout on volume D:'), true)
  assert.equal(isDisplayableInCurrentLocale('读取目录权限不足'), false)

  // 英文模式：带标准错误码且原文含中文时，使用标准英文译文
  assert.equal(
    resolveErrorMessage({ errorCode: 'PERMISSION_DENIED', error: '权限不足' }, 'Operation failed'),
    'Permission denied'
  )
  // 英文模式：带标准错误码且原文为纯英文时，保留精确英文消息
  assert.equal(
    resolveErrorMessage({ errorCode: 'FILE_ERROR', error: 'Failed to read /tmp/a.txt' }, 'Operation failed'),
    'Failed to read /tmp/a.txt'
  )
  // 英文模式：无标准错误码的中文原文回退英文 fallback
  assert.equal(resolveErrorMessage({ error: '老版本宿主返回的中文报错' }, 'Operation failed'), 'Operation failed')
  assert.equal(resolveErrorMessage({ error: 'Disk I/O timeout on volume D:' }, 'Operation failed'), 'Disk I/O timeout on volume D:')
  assert.equal(resolveErrorMessage({ error: '' }, 'Operation failed'), 'Operation failed')

  setRuntimeLocale('zh-CN')
  assert.equal(resolveErrorMessage({ error: '读取目录权限不足' }, '操作失败'), '读取目录权限不足')
  assert.equal(resolveErrorMessage({ error: '' }, '操作失败'), '操作失败')
  // 成功响应且无 error 时直接回退 fallback，不误读顶层 message/code
  assert.equal(resolveErrorMessage({ ok: true, code: 0, message: 'OK', error: undefined }, '已移动文件'), '已移动文件')
  assert.equal(resolveErrorMessage({ items: [], error: undefined }, '无匹配条目'), '无匹配条目')
})

test('extractErrorCode / extractHostCode 兼容多层信封与 Error 对象', () => {
  assert.equal(extractErrorCode({ errorCode: 'FILE_ERROR' }), 'FILE_ERROR')
  assert.equal(extractErrorCode({ error: { code: 'DISK_FULL' } }), 'DISK_FULL')
  assert.equal(extractHostCode({ errorDetails: { hostCode: 'PATH_NOT_AUTHORIZED' } }), 'PATH_NOT_AUTHORIZED')
  assert.equal(extractHostCode({ error: { details: { hostCode: 'CAPABILITY_LIMIT_EXCEEDED' } } }), 'CAPABILITY_LIMIT_EXCEEDED')
})

test('isHostMethodMissing 优先按结构化错误码判定并兼容老宿主中文文案', () => {
  assert.equal(isHostMethodMissing({ code: 'METHOD_NOT_FOUND', message: 'not found' }), true)
  assert.equal(isHostMethodMissing({ errorCode: 'METHOD_NOT_AVAILABLE', error: 'oops' }), true)
  assert.equal(isHostMethodMissing({ details: { hostCode: 'METHOD_NOT_FOUND' }, message: 'oops' }), true)
  assert.equal(isHostMethodMissing(new Error('未知方法: foo')), true)
  assert.equal(isHostMethodMissing({ code: 'PERMISSION_DENIED', message: '未知方法' }), false)
  assert.equal(isHostMethodMissing(new Error('permission denied')), false)
})
