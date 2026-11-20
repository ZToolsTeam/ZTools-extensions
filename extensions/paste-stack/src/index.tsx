import React, { List, ActionPanel, Action, Icon, Clipboard, LocalStorage, showToast, Toast, useLocale, useState, useEffect, useMemo, useCallback, useRef } from '@ztools/declarative-ui'
import type { StackItem, StackPopMode } from './types.js'
import { STACK_STORAGE_KEY, cleanRichTextToPlain, parseStackState, stackItem, subscribeStackClipboard } from './stack-manager.js'
import type { StackState } from './stack-manager.js'
import { callHostTransport } from './native-ipc.js'
import { t } from './i18n.js'
export * from './types.js'
export * from './stack-manager.js'

/**
 * 剪贴板里是否是文件：在访达 / 资源管理器里复制文件时，系统同时放一份文件名文本，
 * 若照常“洗成纯文本”会把复制的文件替换成文件名。宿主不支持查询时按没有文件处理。
 */
async function clipboardHoldsFiles(): Promise<boolean> {
  const res = await callHostTransport<{ files?: unknown }>('clipboard_read_files')
  return res.ok && Array.isArray(res.data?.files) && res.data.files.length > 0
}

export async function CleanClipboardCommand() {
  if (await clipboardHoldsFiles()) throw new Error(t('errClipboardHoldsFiles'))
  const text = cleanRichTextToPlain(await Clipboard.readText() || '')
  if (!text.length) throw new Error(t('errNoTextInClipboard'))
  await Clipboard.copy(text)
  return t('msgRichTextCleaned')
}

export function PasteStack({ featureCode = 'paste-stack-queue' }: { featureCode?: string } = {}) {
  useLocale()
  const [state, setState] = useState<StackState>({ version: 1, items: [], isListening: true })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [listenError, setListenError] = useState('')
  const [listening, setListening] = useState(false)
  const [reload, setReload] = useState(0)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<StackPopMode | 'sent'>(featureCode === 'paste-stack-lifo' ? 'lifo' : 'fifo')
  const current = useRef(state), expected = useRef<unknown>(undefined), ready = useRef(false), alive = useRef(true)
  const jobs = useRef<Promise<unknown>>(Promise.resolve()), pasting = useRef(false)
  // 宿主粘贴会把内容写入剪贴板，开启剪贴板历史时这次写入同样会广播；忽略一次自己刚发送的内容，避免出栈后又被加回
  const pastedEcho = useRef<{ text: string; until: number } | null>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false; ready.current = false } }, [])
  const fail = useCallback(async (title: string, error: unknown) => {
    if (alive.current) await showToast({ style: Toast.Style.Failure, title, message: error instanceof Error ? error.message : String(error) })
  }, [])
  const enqueue = useCallback((operation: () => Promise<void>) => {
    const task = jobs.current.then(operation)
    jobs.current = task.catch(() => undefined)
    return task
  }, [])
  useEffect(() => {
    let active = true
    ready.current = false; setLoading(true); setLoadError('')
    void jobs.current.then(async () => {
      try {
        const raw = await LocalStorage.getItem(STACK_STORAGE_KEY), value = parseStackState(raw)
        if (!active || !alive.current) return
        current.current = value; expected.current = raw; ready.current = true; setState(value)
      } catch (error) { if (active && alive.current) setLoadError(error instanceof Error ? error.message : String(error)) }
      finally { if (active && alive.current) setLoading(false) }
    })
    return () => { active = false }
  }, [reload])

  const save = useCallback(async (next: StackState) => {
    if (!ready.current || !alive.current) throw new Error(t('errReloadStackFirst'))
    const raw = JSON.stringify(next)
    if (next.items.length + (next.sent?.length || 0) > 500 || new TextEncoder().encode(raw).length > 8 * 1024 * 1024) throw new Error(t('errStackLimitReached'))
    const saved = await LocalStorage.compareAndSet(STACK_STORAGE_KEY, expected.current, raw)
    if (!saved) {
      ready.current = false
      if (alive.current) setLoadError(t('errStackChangedOtherWin'))
      throw new Error(t('errStackChangedKept'))
    }
    expected.current = raw; current.current = next
    if (alive.current) setState(next)
  }, [])

  useEffect(() => {
    if (loading || loadError || !state.isListening) { setListening(false); return }
    let active = true, dispose: (() => Promise<void>) | undefined
    setListenError(''); setListening(false)
    void subscribeStackClipboard(text => {
      if (!active || !alive.current) return
      const echo = pastedEcho.current
      if (echo && echo.text === text && Date.now() <= echo.until) { pastedEcho.current = null; return }
      void enqueue(async () => {
        if (!active || !alive.current || !current.current.isListening) return
        const items = current.current.items
        if (items.at(-1)?.text === text) return
        await save({ ...current.current, items: [...items, stackItem(text)] })
      }).catch(error => {
        active = false; setListening(false); setListenError(error instanceof Error ? error.message : String(error))
        if (dispose) void dispose().catch(error => { void fail(t('errStopListenFailed'), error) })
      })
    }).then(release => {
      dispose = release
      if (!active || !alive.current) return release()
      setListening(true)
    }).catch(error => { if (active && alive.current) setListenError(error instanceof Error ? error.message : String(error)) })
    return () => {
      active = false
      if (dispose) void dispose().catch(error => { void fail(t('errStopListenFailed'), error) })
    }
  }, [loading, loadError, state.isListening, reload, enqueue, save, fail])

  const mutate = useCallback((update: (value: StackState) => StackState) => enqueue(async () => {
    await save(update(current.current))
  }).catch(error => fail(t('errNotSavedKept'), error)), [enqueue, save, fail])

  const pasteItem = useCallback(async (id: string) => {
    if (pasting.current) return
    pasting.current = true
    let dispatched = false
    try {
      await enqueue(async () => {
        if (!ready.current || !alive.current) throw new Error(t('errReloadStackFirst'))
        const item = current.current.items.find(value => value.id === id)
        if (!item) throw new Error(t('errItemMissing'))
        pastedEcho.current = { text: item.text, until: Date.now() + 5000 }
        try { await Clipboard.paste(item.text) } catch (error) { pastedEcho.current = null; throw error }
        dispatched = true
        await save({ ...current.current, items: current.current.items.filter(value => value.id !== id),
          sent: [...(current.current.sent || []), { item, index: current.current.items.findIndex(value => value.id === id) }] })
      })
      if (alive.current) await showToast({ style: Toast.Style.Success, title: t('toastSentSuccess') })
    } catch (error) { await fail(dispatched ? t('errSentSaveFailed') : t('errPasteFailedKept'), error) }
    finally { pasting.current = false }
  }, [enqueue, save, fail])

  const showingSent = mode === 'sent'
  const restore = (id: string) => mutate(value => {
    const entry = value.sent?.find(entry => entry.item.id === id)
    if (!entry) throw new Error(t('errSentChanged'))
    const items = [...value.items]
    items.splice(Math.min(entry.index, items.length), 0, entry.item)
    return { ...value, items, sent: value.sent?.filter(entry => entry.item.id !== id) }
  })
  const items = useMemo(() => {
    const ordered = mode === 'sent' ? (state.sent || []).map(entry => entry.item).reverse() : mode === 'lifo' ? [...state.items].reverse() : state.items
    const query = search.trim().toLowerCase()
    return ordered.filter(item => !query || item.text.toLowerCase().includes(query))
  }, [state.items, state.sent, mode, search])
  const move = (id: string, otherId?: string) => {
    if (!otherId) return
    return mutate(value => {
      const next = [...value.items], from = next.findIndex(item => item.id === id), to = next.findIndex(item => item.id === otherId)
      if (from >= 0 && to >= 0) [next[from], next[to]] = [next[to], next[from]]
      return { ...value, items: next }
    })
  }
  const retry = () => { setReload(value => value + 1) }
  const toggleListening = () => mutate(value => ({ ...value, isListening: !value.isListening }))
  const clean = async () => { try { await showToast({ style: Toast.Style.Success, title: await CleanClipboardCommand() }) } catch (error) { await fail(t('errCleanFailed'), error) } }
  return <List isLoading={loading} searchText={search} onSearchTextChange={setSearch} searchBarPlaceholder={t('searchPlaceholder')} isShowingDetail={false}
    searchBarAccessory={<List.Dropdown value={mode} onChange={(value: string) => setMode(value as StackPopMode | 'sent')} tooltip={t('modeTooltip')}>
      <List.Dropdown.Item title={t('modeFifo')} value="fifo" /><List.Dropdown.Item title={t('modeLifo')} value="lifo" /><List.Dropdown.Item title={t('modeSent')} value="sent" />
    </List.Dropdown>}
    filterBar={{ summaryText: loadError || listenError || t('summaryStatus', {
      listenStatus: listening ? t('statusListening') : state.isListening ? t('statusConnecting') : t('statusPaused'),
      pending: state.items.length,
      sent: state.sent?.length || 0
    }),
      actions: loadError || listenError ? [{ id: 'retry', title: t('btnRetry'), onAction: retry }] : [
        // 空状态时底栏主动作已是切换监听，工具栏不再重复；有条目时底栏是单条动作，监听开关只在工具栏
        ...(!loading && !items.length ? [] : [{ id: 'listen', title: state.isListening ? t('btnPauseListen') : t('btnStartListen'), onAction: toggleListening }]),
        { id: 'clear', title: showingSent ? t('btnClearSent') : t('btnClearQueue'), onAction: () => mutate(value => showingSent ? { ...value, sent: [] } : { ...value, items: [] }) }
      ] }}
    actions={loadError || listenError ? undefined : <ActionPanel>
      <Action title={state.isListening ? t('btnPauseListen') : t('btnStartListen')} icon={state.isListening ? Icon.Pause : Icon.Play} onAction={toggleListening} />
      <Action title={t('actionCleanClipboard')} icon={Icon.Text} onAction={clean} />
    </ActionPanel>}>
    {!loading && !loadError && !items.length ? <List.Item id="empty-state" icon={Icon.Clipboard}
      title={search.trim() ? t('emptyNoMatch') : showingSent ? t('emptySent') : state.isListening ? t('emptyListening') : t('emptyPaused')}
      subtitle={search.trim() ? t('emptyNoMatchSub') : showingSent ? t('emptySentSub') : ''} /> : null}
    {items.map((item: StackItem, index: number) => <List.Item key={item.id} id={item.id} title={item.textPreview} subtitle={t('charCount', { count: item.charCount })} icon={Icon.Text} accessories={[{ tag: showingSent ? t('tagSentRestorable') : t('tagPendingOrder', { index: index + 1 }) }]}
      actions={<ActionPanel>
        <Action title={showingSent ? t('actionRestore') : t('actionPasteSend')} icon={Icon.ArrowUp} onAction={() => showingSent ? restore(item.id) : pasteItem(item.id)} />
        <Action.CopyToClipboard title={t('actionCopyItem')} content={item.text} />
        {!showingSent && <Action title={t('actionMoveUp')} icon={Icon.ArrowUp} onAction={() => move(item.id, items[index - 1]?.id)} />}
        {!showingSent && <Action title={t('actionMoveDown')} icon={Icon.ArrowDown} onAction={() => move(item.id, items[index + 1]?.id)} />}
        <Action title={showingSent ? t('actionRemoveSent') : t('actionRemoveQueue')} icon={Icon.Trash} style={Action.Style.Destructive} onAction={() => mutate(value => showingSent ? { ...value, sent: value.sent?.filter(entry => entry.item.id !== item.id) } : { ...value, items: value.items.filter(current => current.id !== item.id) })} />
      </ActionPanel>} />)}
  </List>
}
export const PasteStackCommand = PasteStack
export const commands = {
  'paste-stack-queue': PasteStack,
  'paste-stack-fifo': () => PasteStack({ featureCode: 'paste-stack-fifo' }),
  'paste-stack-lifo': () => PasteStack({ featureCode: 'paste-stack-lifo' }),
  'paste-clean-text': CleanClipboardCommand
}
export default PasteStack
