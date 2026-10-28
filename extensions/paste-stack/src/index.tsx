import React, { List, ActionPanel, Action, Icon, Clipboard, LocalStorage, showToast, Toast, useState, useEffect, useMemo, useCallback, useRef } from '@ztools/declarative-ui'
import type { StackItem, StackPopMode } from './types.js'
import { STACK_STORAGE_KEY, cleanRichTextToPlain, parseStackState, stackItem, subscribeStackClipboard } from './stack-manager.js'
import type { StackState } from './stack-manager.js'
export * from './types.js'
export * from './stack-manager.js'

export async function CleanClipboardCommand() {
  const text = cleanRichTextToPlain(await Clipboard.readText() || '')
  if (!text.length) throw new Error('剪贴板无可用文本')
  await Clipboard.copy(text)
  return '已移除富文本格式，文本内容保持不变'
}

export function PasteStack({ featureCode = 'paste-stack-queue' }: { featureCode?: string } = {}) {
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
    if (!ready.current || !alive.current) throw new Error('请先重新读取粘贴栈')
    const raw = JSON.stringify(next)
    if (next.items.length + (next.sent?.length || 0) > 500 || new TextEncoder().encode(raw).length > 8 * 1024 * 1024) throw new Error('待发送与已发送记录已达到 500 项或 8 MiB 上限，请先处理已有条目')
    const saved = await LocalStorage.compareAndSet(STACK_STORAGE_KEY, expected.current, raw)
    if (!saved) {
      ready.current = false
      if (alive.current) setLoadError('粘贴栈已在另一窗口变化，请重新读取；原数据未覆盖')
      throw new Error('粘贴栈已变化，原数据未覆盖')
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
        if (dispose) void dispose().catch(error => { void fail('监听停止失败', error) })
      })
    }).then(release => {
      dispose = release
      if (!active || !alive.current) return release()
      setListening(true)
    }).catch(error => { if (active && alive.current) setListenError(error instanceof Error ? error.message : String(error)) })
    return () => {
      active = false
      if (dispose) void dispose().catch(error => { void fail('监听停止失败', error) })
    }
  }, [loading, loadError, state.isListening, reload, enqueue, save, fail])

  const mutate = useCallback((update: (value: StackState) => StackState) => enqueue(async () => {
    await save(update(current.current))
  }).catch(error => fail('未保存，原数据保留', error)), [enqueue, save, fail])

  const pasteItem = useCallback(async (id: string) => {
    if (pasting.current) return
    pasting.current = true
    let dispatched = false
    try {
      await enqueue(async () => {
        if (!ready.current || !alive.current) throw new Error('请先重新读取粘贴栈')
        const item = current.current.items.find(value => value.id === id)
        if (!item) throw new Error('此条目已不在粘贴栈中')
        pastedEcho.current = { text: item.text, until: Date.now() + 5000 }
        try { await Clipboard.paste(item.text) } catch (error) { pastedEcho.current = null; throw error }
        dispatched = true
        await save({ ...current.current, items: current.current.items.filter(value => value.id !== id),
          sent: [...(current.current.sent || []), { item, index: current.current.items.findIndex(value => value.id === id) }] })
      })
      if (alive.current) await showToast({ style: Toast.Style.Success, title: '已发送粘贴请求，可在已发送记录中恢复' })
    } catch (error) { await fail(dispatched ? '已发送请求，但队列未保存；请检查目标后再操作' : '粘贴失败，条目保留', error) }
    finally { pasting.current = false }
  }, [enqueue, save, fail])

  const showingSent = mode === 'sent'
  const restore = (id: string) => mutate(value => {
    const entry = value.sent?.find(entry => entry.item.id === id)
    if (!entry) throw new Error('已发送记录已变化，请重新读取')
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
  const clean = async () => { try { await showToast({ style: Toast.Style.Success, title: await CleanClipboardCommand() }) } catch (error) { await fail('清除格式失败', error) } }
  return <List isLoading={loading} searchText={search} onSearchTextChange={setSearch} searchBarPlaceholder="搜索粘贴栈文本..." isShowingDetail={false}
    searchBarAccessory={<List.Dropdown value={mode} onChange={(value: string) => setMode(value as StackPopMode | 'sent')} tooltip="队列与发送记录">
      <List.Dropdown.Item title="先进先出" value="fifo" /><List.Dropdown.Item title="后进先出" value="lifo" /><List.Dropdown.Item title="已发送（可恢复）" value="sent" />
    </List.Dropdown>}
    filterBar={{ summaryText: loadError || listenError || `${listening ? '当前页面监听中' : state.isListening ? '正在连接监听' : '监听已暂停'} · 待发送 ${state.items.length} 项 · 已发送 ${state.sent?.length || 0} 项`,
      actions: loadError || listenError ? [{ id: 'retry', title: '重新读取', onAction: retry }] : [
        { id: 'listen', title: state.isListening ? '暂停监听' : '开启监听', onAction: () => mutate(value => ({ ...value, isListening: !value.isListening })) },
        { id: 'clear', title: showingSent ? '清空发送记录' : '清空队列', onAction: () => mutate(value => showingSent ? { ...value, sent: [] } : { ...value, items: [] }) }
      ] }}
    actions={<ActionPanel><Action title="清除剪贴板格式" icon={Icon.Text} onAction={clean} /></ActionPanel>}>
    {items.map((item: StackItem, index: number) => <List.Item key={item.id} id={item.id} title={item.textPreview} subtitle={`${item.charCount} 字符`} icon={Icon.Text} accessories={[{ tag: showingSent ? '已发送，可恢复' : `#${index + 1} 待发送` }]}
      actions={<ActionPanel>
        <Action title={showingSent ? "恢复到待发送队列" : "发送到原输入位置"} icon={Icon.ArrowUp} onAction={() => showingSent ? restore(item.id) : pasteItem(item.id)} />
        <Action.CopyToClipboard title="复制该项到剪贴板" content={item.text} />
        {!showingSent && <Action title="上移一位" icon={Icon.ArrowUp} onAction={() => move(item.id, items[index - 1]?.id)} />}
        {!showingSent && <Action title="下移一位" icon={Icon.ArrowDown} onAction={() => move(item.id, items[index + 1]?.id)} />}
        <Action title={showingSent ? "移除发送记录" : "从栈中移除"} icon={Icon.Trash} style={Action.Style.Destructive} onAction={() => mutate(value => showingSent ? { ...value, sent: value.sent?.filter(entry => entry.item.id !== item.id) } : { ...value, items: value.items.filter(current => current.id !== item.id) })} />
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
