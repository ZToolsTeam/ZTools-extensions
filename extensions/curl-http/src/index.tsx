import React, {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  confirmAlert,
  showToast,
  ToastStyle,
  useState,
  useMemo,
  useRef,
  useEffect,
  useLocale,
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import type { CodeTargetLang, HttpResponseSnapshot } from './types.js'
import {
  parseCurlCommand,
  generateCodeFromCurl,
  executeCurlRequest,
} from './curl-service.js'

export * from './types.js'
export * from './curl-service.js'

/** 是否运行在 macOS：Mac 用户只会从开发者工具复制 bash 写法，说明里不提 cmd / PowerShell */
export function isMacPlatform(): boolean {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator
  return /Mac/i.test(String(nav?.platform || nav?.userAgent || ''))
}

/** 支持的复制格式与续行写法，按平台给 */
export function copyFormatHint(mac: boolean = isMacPlatform()): string {
  return mac
    ? '支持从 Chrome / Edge / Safari 开发者工具复制的 `Copy as cURL`，多行命令可用行尾 `\\` 续行。'
    : '支持从 Chrome / Edge 开发者工具复制的 `Copy as cURL (bash)` 与 `Copy as cURL (cmd)`，多行命令可用 `\\`、`^` 或 PowerShell 反引号续行。'
}

/** 生成不会被内容里的反引号提前截断的 Markdown 代码块 */
function fenced(content: string, lang = ''): string {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${lang}\n${content}\n${fence}`
}

function responseMarkdown(snap: HttpResponseSnapshot | null, ignoredOptions: string[]): string {
  const notes: string[] = []
  if (ignoredOptions.length > 0) notes.push(t('note.ignoredOptions', { list: ignoredOptions.join(', ') }))
  if (snap && snap.ignoredHeaders.length > 0) notes.push(t('note.ignoredHeaders', { list: snap.ignoredHeaders.join(', ') }))
  const noteText = notes.length > 0 ? `\n\n${notes.map((n) => `- ${n}`).join('\n')}` : ''
  if (!snap) return t('response.empty', { notes: noteText })
  return t('response.title', {
    status: snap.status,
    statusText: snap.statusText,
    elapsedMs: snap.elapsedMs,
    notes: noteText,
    body: fenced(snap.bodyText, snap.isJson ? 'json' : 'text')
  })
}

export function CurlHttpCommand() {
  useLocale()
  // 初始为空，不预填示例请求
  const [rawCurl, setRawCurl] = useState<string>('')
  const [targetLang, setTargetLang] = useState<CodeTargetLang>('fetch')
  const [responseSnap, setResponseSnap] = useState<HttpResponseSnapshot | null>(null)
  const [isSending, setIsSending] = useState<boolean>(false)
  const requestRevision = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestRevision.current += 1
    }
  }, [])

  const replaceRequest = (value: string): void => {
    requestRevision.current += 1
    setRawCurl(value)
    setResponseSnap(null)
  }

  const parsedState = useMemo(() => {
    try {
      const parsed = parseCurlCommand(rawCurl)
      const generatedCode = generateCodeFromCurl(parsed, targetLang)
      return { ok: true as const, parsed, generatedCode }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }, [rawCurl, targetLang])

  const handleLoadClipboard = async (): Promise<void> => {
    try {
      const clip = await Clipboard.readText()
      if (!clip || !clip.trim()) {
        await showToast({
          style: ToastStyle.Failure,
          title: t('toast.clipboardEmpty'),
          message: t('toast.clipboardEmptyMsg'),
        })
        return
      }
      replaceRequest(clip.trim())
      await showToast({
        style: ToastStyle.Success,
        title: t('toast.clipboardLoaded'),
      })
    } catch (err) {
      await showToast({
        style: ToastStyle.Failure,
        title: t('toast.clipboardReadFailed'),
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleSendRequest = async (): Promise<void> => {
    if (!parsedState.ok || isSending) return
    const { method, url } = parsedState.parsed
    // DELETE / PUT 会删除或覆盖服务器上的数据，发送前请用户确认；取消或无法确认时不发送
    if (method === 'DELETE' || method === 'PUT') {
      const confirmed = await confirmAlert({
        title: t('confirm.title', { method }),
        message: t('confirm.message', {
          url,
          warning: method === 'DELETE' ? t('confirm.deleteWarning') : t('confirm.putWarning')
        }),
        primaryAction: { title: t('confirm.primary', { method }), style: 'destructive' },
        dismissAction: { title: t('confirm.cancel') }
      })
      if (!confirmed) return
    }
    const revision = requestRevision.current
    setIsSending(true)
    setResponseSnap(null)
    try {
      const snap = await executeCurlRequest(parsedState.parsed)
      if (revision !== requestRevision.current) return
      setResponseSnap(snap)
      await showToast({
        style: snap.ok ? ToastStyle.Success : ToastStyle.Failure,
        title: `HTTP ${snap.status} (${snap.elapsedMs}ms)`,
        message: `${snap.sizeBytes} bytes`,
      })
    } catch (err) {
      if (revision !== requestRevision.current) return
      await showToast({
        style: ToastStyle.Failure,
        title: t('toast.requestFailed'),
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      if (mounted.current) setIsSending(false)
    }
  }

  return (
    <List
      isShowingDetail={true}
      isLoading={isSending}
      searchBarPlaceholder={t('search.placeholder')}
      searchText={rawCurl}
      onSearchTextChange={replaceRequest}
      searchBarAccessory={
        <List.Dropdown
          tooltip={t('dropdown.tooltip')}
          value={targetLang}
          onChange={(val: string) => setTargetLang(val as CodeTargetLang)}
        >
          <List.Dropdown.Item title="JavaScript Fetch" value="fetch" />
          <List.Dropdown.Item title="TypeScript Axios" value="axios" />
          <List.Dropdown.Item title="Python Requests" value="python" />
          <List.Dropdown.Item title="Go net/http" value="go" />
        </List.Dropdown>
      }
    >
      {!parsedState.ok && !rawCurl.trim() && (
        <List.Item
          id="curl-empty"
          title={t('empty.title')}
          subtitle={isMacPlatform() ? t('empty.subtitleMac') : t('empty.subtitle')}
          icon={Icon.Clipboard}
          detail={
            <List.Item.Detail
              markdown={isMacPlatform() ? t('empty.markdownMac') : t('empty.markdown')}
            />
          }
          actions={
            <ActionPanel>
              <Action
                title={t('action.pasteFromClipboard')}
                icon={Icon.Clipboard}
                onAction={() => void handleLoadClipboard()}
              />
            </ActionPanel>
          }
        />
      )}

      {!parsedState.ok && rawCurl.trim() !== '' && (
        <List.Section title={t('section.parseError')}>
          <List.Item
            id="curl-parse-error"
            title={t('error.parseTitle')}
            subtitle={parsedState.error.replace(/^[A-Z_]+:\s*/, '')}
            icon={Icon.ExclamationMark}
            accessories={[{ tag: { value: t('tag.syntaxError'), color: Color.Red } }]}
            detail={
              <List.Item.Detail
                markdown={isMacPlatform() ? t('error.parseMarkdownMac', { code: fenced(parsedState.error, 'text') }) : t('error.parseMarkdown', { code: fenced(parsedState.error, 'text') })}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title={t('action.pasteFromClipboard')}
                  icon={Icon.Clipboard}
                  onAction={() => void handleLoadClipboard()}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      {parsedState.ok && (
        <List.Section title={t('section.overview')}>
          <List.Item
            id="curl-overview"
            title={`${parsedState.parsed.method} ${parsedState.parsed.url}`}
            subtitle={t('overview.subtitle', { count: Object.keys(parsedState.parsed.headers).length, lang: targetLang.toUpperCase() })}
            icon={Icon.Terminal}
            accessories={[
              responseSnap
                ? responseSnap.ok
                  ? { tag: `HTTP ${responseSnap.status} · ${responseSnap.elapsedMs}ms` }
                  : {
                      tag: {
                        value: `HTTP ${responseSnap.status}`,
                        color: Color.Red,
                      },
                    }
                : { tag: parsedState.parsed.method },
            ]}
            detail={
              <List.Item.Detail
                markdown={`${t('detail.codeHeading', { lang: targetLang.toUpperCase() })}\n${fenced(
                  parsedState.generatedCode,
                  targetLang === 'python' ? 'python' : targetLang === 'go' ? 'go' : 'ts',
                )}\n\n${responseMarkdown(responseSnap, parsedState.parsed.ignoredOptions ?? [])}`}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label
                      title={t('meta.method')}
                      text={parsedState.parsed.method}
                    />
                    <List.Item.Detail.Metadata.Label
                      title={t('meta.url')}
                      text={parsedState.parsed.url}
                    />
                    <List.Item.Detail.Metadata.Label
                      title={t('meta.headerCount')}
                      text={t('meta.headerCountValue', { count: Object.keys(parsedState.parsed.headers).length })}
                    />
                    <List.Item.Detail.Metadata.Label
                      title={t('meta.body')}
                      text={
                        parsedState.parsed.body
                          ? t('meta.bodyChars', { count: parsedState.parsed.body.length })
                          : t('meta.noBody')
                      }
                    />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title={t('action.sendRequest')}
                  icon={Icon.Play}
                  onAction={() => void handleSendRequest()}
                />
                <Action.CopyToClipboard
                  title={t('action.copyCode', { lang: targetLang.toUpperCase() })}
                  content={parsedState.generatedCode}
                />
                {responseSnap && (
                  <Action.CopyToClipboard
                    title={t('action.copyResponse')}
                    content={responseSnap.bodyText}
                  />
                )}
                <Action
                  title={t('action.loadClipboard')}
                  icon={Icon.Clipboard}
                  onAction={() => void handleLoadClipboard()}
                />
              </ActionPanel>
            }
          />

          {(Object.entries(parsedState.parsed.headers) as Array<[string, string]>).map(
            ([hKey, hVal]) => (
              <List.Item
                key={hKey}
                id={`header-${hKey}`}
                title={hKey}
                subtitle={String(hVal)}
                icon={Icon.Code}
                accessories={[{ tag: 'Header' }]}
                detail={
                  <List.Item.Detail
                    markdown={`${t('header.heading', { key: hKey })}\n\n${fenced(String(hVal), 'text')}`}
                  />
                }
                actions={
                  <ActionPanel>
                    <Action.CopyToClipboard
                      title={t('action.copyHeader', { key: hKey })}
                      content={`${hKey}: ${String(hVal)}`}
                    />
                  </ActionPanel>
                }
              />
            ),
          )}
        </List.Section>
      )}
    </List>
  )
}

export default CurlHttpCommand
