import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  useState,
  useEffect,
  useLocale,
  useRef,
  showToast,
  Toast,
  FilterBar
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  TranslationResult,
  TranslationHistoryEntry,
  buildDirectNamingResult,
  describeTranslateError,
  englishTextOf,
  fetchTranslationHistoryFromHost,
  formatIdentifierCase,
  languageName,
  translateTextWithHost
} from './logic.js'
import { isRealElectronHost } from './native-ipc.js'
import { resolveErrorMessage } from './error-i18n.js'

export * from './logic.js'

function readLaunchFeature(): string {
  const scope = ((globalThis as Record<string, unknown>).window || globalThis) as {
    __ztoolsLaunchContext?: { pluginId?: string; featureCode?: string }
  }
  const ctx = scope.__ztoolsLaunchContext
  if (!ctx || (ctx.pluginId && ctx.pluginId !== 'translator')) return ''
  return String(ctx.featureCode || '').trim()
}

function quoteLines(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function buildDetailMarkdown(result: TranslationResult): string {
  return [
    t('detailHeadingTrans'),
    '',
    quoteLines(result.translatedText),
    '',
    '---',
    '',
    t('detailHeadingOrigWithLang', { lang: languageName(result.sourceLanguage) }),
    '',
    quoteLines(result.originalText)
  ].join('\n')
}

async function copyWithToast(text: string, successTitle: string, message?: string): Promise<void> {
  try {
    await Clipboard.copy(text)
  } catch (err) {
    await showToast({
      style: Toast.Style.Failure,
      title: t('toastCopyFailed'),
      message: err instanceof Error ? err.message : String(err)
    })
    return
  }
  await showToast({ style: Toast.Style.Success, title: successTitle, ...(message ? { message } : {}) })
}

function namingActions(english: string) {
  const camel = formatIdentifierCase(english, 'camel')
  const snake = formatIdentifierCase(english, 'snake')
  const constant = formatIdentifierCase(english, 'constant')
  return {
    camel: Action({
      title: t('actionCopyCamel'),
      icon: Icon.Code,
      onAction: () => copyWithToast(camel, t('toastCopiedCamel'), camel)
    }),
    snake: Action({
      title: t('actionCopySnake'),
      icon: Icon.Code,
      onAction: () => copyWithToast(snake, t('toastCopiedSnake'), snake)
    }),
    constant: Action({
      title: t('actionCopyConstant'),
      icon: Icon.Code,
      onAction: () => copyWithToast(constant, t('toastCopiedConstant'), constant)
    })
  }
}

function buildResultItem(result: TranslationResult, namingMode: boolean) {
  const english = englishTextOf(result)
  const hasIdentifier = Boolean(english && formatIdentifierCase(english, 'camel'))
  const isDirect = result.sourceLanguage === result.targetLanguage

  const copyTranslation = Action({
    title: isDirect ? t('actionCopyOriginal') : t('actionCopyTranslation'),
    icon: Icon.CopyClipboard,
    onAction: () => copyWithToast(result.translatedText, isDirect ? t('toastCopiedOriginal') : t('toastCopiedTranslation'), result.translatedText)
  })
  const copyBilingual = Action({
    title: t('actionCopyBilingual'),
    icon: Icon.Clipboard,
    onAction: () => copyWithToast(`${result.originalText}\n${result.translatedText}`, t('toastCopiedBilingual'))
  })

  const children: ReturnType<typeof Action>[] = []
  if (hasIdentifier) {
    const naming = namingActions(english)
    if (namingMode) {
      children.push(naming.camel, naming.snake, naming.constant, copyTranslation)
      if (!isDirect) children.push(copyBilingual)
    } else {
      children.push(copyTranslation)
      if (!isDirect) children.push(copyBilingual)
      children.push(naming.camel, naming.snake)
    }
  } else {
    children.push(copyTranslation)
    if (!isDirect) children.push(copyBilingual)
  }

  const metadata = [
    List.Item.Detail.Metadata.Label({
      title: t('metaDirection'),
      text: isDirect ? languageName(result.sourceLanguage) : `${languageName(result.sourceLanguage)} → ${languageName(result.targetLanguage)}`
    }),
    List.Item.Detail.Metadata.Label({ title: t('metaSource'), text: result.engineLabel })
  ]
  if (hasIdentifier) {
    metadata.push(
      List.Item.Detail.Metadata.Separator(),
      List.Item.Detail.Metadata.Label({ title: 'camelCase', text: formatIdentifierCase(english, 'camel') }),
      List.Item.Detail.Metadata.Label({ title: 'snake_case', text: formatIdentifierCase(english, 'snake') })
    )
  }

  return List.Item({
    id: 'translation-result',
    title: namingMode && hasIdentifier ? formatIdentifierCase(english, 'camel') : result.translatedText,
    subtitle: result.originalText,
    icon: { source: Icon.Text, tintColor: Color.SecondaryText },
    accessories: [{ tag: { value: isDirect ? t('tagDirect') : `${languageName(result.sourceLanguage)}→${languageName(result.targetLanguage)}` } }],
    detail: List.Item.Detail({
      markdown: buildDetailMarkdown(result),
      metadata: List.Item.Detail.Metadata({ children: metadata })
    }),
    actions: ActionPanel({ title: t('panelTranslation'), children })
  })
}

function buildHistoryItems(history: TranslationHistoryEntry[], historyError: string) {
  return historyError
    ? [
        List.Item({
          id: 'history-failed',
          title: t('errReadHistoryFailed'),
          subtitle: historyError,
          icon: { source: Icon.ExclamationMark, tintColor: Color.SecondaryText }
        })
      ]
    : history.map((h) =>
        List.Item({
          id: h.id,
          title: h.translatedText,
          subtitle: h.originalText,
          icon: { source: Icon.Clock, tintColor: Color.SecondaryText },
          accessories: [
            { tag: { value: `${languageName(h.sourceLanguage)}→${languageName(h.targetLanguage)}` } },
            ...(h.timestampText ? [{ text: h.timestampText }] : [])
          ],
          detail: List.Item.Detail({
            markdown: [t('detailHeadingTrans'), '', quoteLines(h.translatedText), '', '---', '', t('detailHeadingOrig'), '', quoteLines(h.originalText)].join('\n')
          }),
          actions: ActionPanel({
            title: t('panelHistory'),
            children: [
              Action({
                title: t('actionCopyTranslation'),
                icon: Icon.CopyClipboard,
                onAction: () => copyWithToast(h.translatedText, t('toastCopiedTranslation'), h.translatedText)
              }),
              Action({
                title: t('actionCopyBilingual'),
                icon: Icon.Clipboard,
                onAction: () => copyWithToast(`${h.originalText}\n${h.translatedText}`, t('toastCopiedBilingual'))
              })
            ]
          })
        })
      )
}

export function TranslatorCommand() {
  useLocale()
  const inClient = isRealElectronHost()
  const namingMode = readLaunchFeature() === 'translate-naming'
  const [searchText, setSearchText] = useState('')
  const [result, setResult] = useState<TranslationResult | null>(null)
  const [errorText, setErrorText] = useState('')
  const [history, setHistory] = useState<TranslationHistoryEntry[]>([])
  const [historyError, setHistoryError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  // 每次输入都会发起翻译；只采用最后一次请求的结果，避免较慢的旧请求覆盖新输入的译文
  const seqRef = useRef(0)

  function rememberHistory(r: TranslationResult) {
    setHistory((prev) => [
      {
        id: `hist-${Date.now()}`,
        originalText: r.originalText,
        translatedText: r.translatedText,
        sourceLanguage: r.sourceLanguage,
        targetLanguage: r.targetLanguage,
        timestampText: t('justNow')
      },
      ...prev.filter((h) => h.originalText !== r.originalText)
    ].slice(0, 15))
  }

  async function runTranslate(inputText: string) {
    const text = inputText.trim()
    const seq = ++seqRef.current
    if (!inClient || !text) {
      setResult(null)
      setErrorText('')
      setIsLoading(false)
      return
    }
    if (namingMode) {
      const direct = buildDirectNamingResult(text)
      if (direct) {
        setResult(direct)
        setErrorText('')
        setIsLoading(false)
        return
      }
    }
    setIsLoading(true)
    const outcome = await translateTextWithHost(text)
    if (seq !== seqRef.current) return
    setIsLoading(false)
    if (outcome.ok) {
      setResult(outcome.result)
      setErrorText('')
      rememberHistory(outcome.result)
    } else {
      setResult(null)
      setErrorText(outcome.error)
    }
  }

  useEffect(() => {
    if (!inClient) return
    ;(async () => {
      const res = await fetchTranslationHistoryFromHost()
      if (res.ok) {
        // 本次打开后新翻译的条目排在前面，客户端已有的记录接在后面，按原文去重
        setHistory((prev) => {
          const seen = new Set(prev.map((h) => h.originalText))
          const merged = [...prev]
          for (const h of res.items) {
            if (seen.has(h.originalText)) continue
            seen.add(h.originalText)
            merged.push(h)
          }
          return merged.slice(0, 15)
        })
        setHistoryError('')
      } else {
        setHistoryError(resolveErrorMessage(res, t('errReadHistoryFailed')))
      }
    })()
  }, [])

  useEffect(() => {
    runTranslate(searchText)
  }, [searchText])

  async function handlePasteAndTranslate() {
    let clip = ''
    try {
      clip = String((await Clipboard.readText()) ?? '').trim()
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastClipboardReadFailed'),
        message: err instanceof Error ? err.message : String(err)
      })
      return
    }
    if (!clip) {
      await showToast({ style: Toast.Style.Failure, title: t('toastClipboardEmpty'), message: t('toastClipboardEmptyMsg') })
      return
    }
    if (clip === searchText.trim()) {
      await runTranslate(clip)
      return
    }
    setSearchText(clip)
  }

  const placeholder = namingMode ? t('placeholderNaming') : t('placeholderDefault')

  if (!inClient) {
    return List({
      searchBarPlaceholder: placeholder,
      children: [
        List.Section({
          title: t('sectionTranslate'),
          children: [
            List.Item({
              id: 'translator-client-required',
              title: t('notInClient'),
              subtitle: t('clientRequiredSub'),
              icon: { source: Icon.Info }
            })
          ]
        })
      ]
    })
  }

  let resultItem
  if (result) {
    resultItem = buildResultItem(result, namingMode)
  } else if (errorText) {
    resultItem = List.Item({
      id: 'translation-failed',
      title: t('failedTitle'),
      subtitle: describeTranslateError(errorText),
      icon: { source: Icon.ExclamationMark, tintColor: Color.SecondaryText },
      detail: List.Item.Detail({ markdown: t('failedMarkdown', { reason: describeTranslateError(errorText) }) })
    })
  } else {
    resultItem = List.Item({
      id: 'translation-empty',
      title: namingMode ? t('emptyTitleNaming') : t('emptyTitleDefault'),
      subtitle: t('emptySubtitle'),
      icon: { source: Icon.Info, tintColor: Color.SecondaryText },
      detail: List.Item.Detail({
        markdown: t('emptyDetailMarkdown')
      })
    })
  }

  const historyChildren = buildHistoryItems(history, historyError)

  return List({
    searchText,
    searchBarPlaceholder: placeholder,
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    filterBar: FilterBar({
      summaryText: result
        ? `${result.sourceLanguage === result.targetLanguage ? t('summaryDirectEn') : `${languageName(result.sourceLanguage)} → ${languageName(result.targetLanguage)}`} · ${result.engineLabel}`
        : t('summaryIdle'),
      actions: [
        {
          id: 'paste-translate-btn',
          label: t('actionTranslateClipboard'),
          style: 'secondary',
          onAction: handlePasteAndTranslate
        }
      ]
    }),
    children: [
      List.Section({ title: namingMode ? t('sectionNaming') : t('sectionResult'), children: [resultItem] }),
      ...(historyChildren.length > 0
        ? [List.Section({ title: historyError ? t('sectionHistory') : t('sectionHistoryCount', { count: history.length }), children: historyChildren })]
        : [])
    ]
  })
}

export default TranslatorCommand
