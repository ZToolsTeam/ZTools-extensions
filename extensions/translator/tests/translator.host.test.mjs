import test from 'node:test'
import assert from 'node:assert/strict'
import * as translator from '../dist/index.js'

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

test('语种方向：含中文译为英语，其余译为中文', () => {
  assert.deepEqual(translator.resolveLanguagePair('请查收附件'), { sourceLanguage: 'zh-CN', targetLanguage: 'en' })
  assert.deepEqual(translator.resolveLanguagePair('Please find attached'), { sourceLanguage: 'en', targetLanguage: 'zh-CN' })
  assert.deepEqual(translator.resolveLanguagePair('こんにちは'), { sourceLanguage: 'ja', targetLanguage: 'zh-CN' })
})

test('变量命名：英文转 camelCase / snake_case / CONSTANT_CASE，没有英文单词时返回空串', () => {
  assert.equal(translator.formatIdentifierCase('Quarterly Financial Report', 'camel'), 'quarterlyFinancialReport')
  assert.equal(translator.formatIdentifierCase('Quarterly Financial Report', 'snake'), 'quarterly_financial_report')
  assert.equal(translator.formatIdentifierCase('Quarterly Financial Report', 'constant'), 'QUARTERLY_FINANCIAL_REPORT')
  assert.equal(translator.formatIdentifierCase('季度报告', 'camel'), '')
  assert.equal(translator.formatIdentifierCase('', 'snake'), '')
})

test('翻译结果来自客户端接口：传中英方向，返回译文与来源', async () => {
  await withRealElectronWindow(
    {
      translator_translate: ({ text, sourceLanguage, targetLanguage }) => ({
        originalText: text,
        translatedText: 'Please find attached',
        sourceLanguage,
        targetLanguage,
        engine: 'offline'
      })
    },
    async (calls) => {
      const res = await translator.translateTextWithHost('  请查收附件 ')
      assert.equal(res.ok, true)
      assert.deepEqual(res.result, {
        originalText: '请查收附件',
        translatedText: 'Please find attached',
        sourceLanguage: 'zh-CN',
        targetLanguage: 'en',
        engineLabel: '客户端离线词库'
      })
      assert.deepEqual(calls[0], {
        channel: 'translator_translate',
        payload: { text: '请查收附件', sourceLanguage: 'zh-CN', targetLanguage: 'en' }
      })
    }
  )
})

test('[故障注入] 客户端翻译失败时如实返回失败，不用插件内置句子或原文冒充译文', async () => {
  await withRealElectronWindow(
    {
      translator_translate: () => {
        throw new Error('503 Service Unavailable')
      }
    },
    async () => {
      const res = await translator.translateTextWithHost('期待您的回复')
      assert.equal(res.ok, false)
      assert.match(res.error, /503/)
      assert.equal('result' in res, false)
    }
  )

  // 客户端离线词库未收录时只返回通用内部错误
  await withRealElectronWindow(
    {
      translator_translate: () => ({ success: false, error: { code: 'INTERNAL_ERROR', message: '宿主内部错误' } })
    },
    async () => {
      const res = await translator.translateTextWithHost('Please find attached the quarterly financial report for your review.')
      assert.equal(res.ok, false)
      assert.equal(res.error, '宿主内部错误')
      assert.match(translator.describeTranslateError(res.error), /客户端返回：宿主内部错误。当前只查客户端内置的少量中英词条/)
    }
  )
})

test('[故障注入] 客户端返回格式不对或译文为空时报格式错误', async () => {
  for (const reply of [{}, { translatedText: '' }, { translatedText: '   ' }, { translatedText: 42 }]) {
    await withRealElectronWindow({ translator_translate: () => reply }, async () => {
      const res = await translator.translateTextWithHost('你好')
      assert.equal(res.ok, false)
      assert.equal(res.error, '客户端返回的翻译结果格式无法识别')
    })
  }
})

test('[边界] 空输入拒绝；不在客户端里运行时直接提示需要客户端，不发请求', async () => {
  const emptyRes = await translator.translateTextWithHost('   ')
  assert.deepEqual(emptyRes, { ok: false, error: '翻译内容不能为空' })

  assert.equal(globalThis.window, undefined)
  const noHost = await translator.translateTextWithHost('你好')
  assert.deepEqual(noHost, { ok: false, error: translator.NOT_IN_CLIENT_MESSAGE })
  assert.equal(translator.describeTranslateError(noHost.error), translator.NOT_IN_CLIENT_MESSAGE)

  const hist = await translator.fetchTranslationHistoryFromHost()
  assert.equal(hist.ok, false)
  assert.deepEqual(hist.items, [])
})

test('翻译记录：读取成功、读取失败、格式不对三种情况分开处理', async () => {
  await withRealElectronWindow(
    {
      translator_get_history: () => ({
        items: [
          { id: 'h1', originalText: 'hello', translatedText: '你好', sourceLanguage: 'en', targetLanguage: 'zh-CN', timestamp: 1728000000000 },
          { id: 'bad', originalText: 1, translatedText: null }
        ]
      })
    },
    async () => {
      const res = await translator.fetchTranslationHistoryFromHost()
      assert.equal(res.ok, true)
      assert.equal(res.items.length, 1)
      assert.equal(res.items[0].translatedText, '你好')
    }
  )
  await withRealElectronWindow(
    {
      translator_get_history: () => {
        throw new Error('database is locked')
      }
    },
    async () => {
      const res = await translator.fetchTranslationHistoryFromHost()
      assert.equal(res.ok, false)
      assert.match(res.error, /database is locked/)
    }
  )
  await withRealElectronWindow({ translator_get_history: () => ({ foo: 1 }) }, async () => {
    const res = await translator.fetchTranslationHistoryFromHost()
    assert.equal(res.ok, false)
    assert.equal(res.error, '客户端返回的翻译记录格式无法识别')
  })
})

test('变量命名：英文原文直接转换，不经过翻译；中文或无英文单词时不生成', () => {
  const direct = translator.buildDirectNamingResult(' user name ')
  assert.equal(direct.translatedText, 'user name')
  assert.equal(direct.sourceLanguage, 'en')
  assert.equal(direct.targetLanguage, 'en')
  assert.equal(translator.englishTextOf(direct), 'user name')
  assert.equal(translator.buildDirectNamingResult('用户名'), null)
  assert.equal(translator.buildDirectNamingResult('!!!'), null)
  assert.equal(translator.buildDirectNamingResult(''), null)

  assert.equal(
    translator.englishTextOf({ originalText: '季度报告', translatedText: 'Quarterly report', sourceLanguage: 'zh-CN', targetLanguage: 'en', engineLabel: '' }),
    'Quarterly report'
  )
  assert.equal(
    translator.englishTextOf({ originalText: 'meeting', translatedText: '会议', sourceLanguage: 'en', targetLanguage: 'zh-CN', engineLabel: '' }),
    'meeting'
  )
  assert.equal(
    translator.englishTextOf({ originalText: 'こんにちは', translatedText: '你好', sourceLanguage: 'ja', targetLanguage: 'zh-CN', engineLabel: '' }),
    ''
  )
})
