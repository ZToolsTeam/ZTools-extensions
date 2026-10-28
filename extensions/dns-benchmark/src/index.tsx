import React, {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Toast,
  showToast,
  useEffect,
  useMemo,
  useState
} from '@ztools/declarative-ui'
import {
  PUBLIC_DNS_PRESETS,
  applyAdapterDns,
  flushSystemDnsCache,
  getActiveNetworkAdapters,
  resetAdapterToDhcp,
  runDnsBenchmark,
  sortAndMarkDnsItems
} from './dns-service.js'
import { MacDnsCommand } from './mac-command.js'
import { clientPlatform } from './mac-dns-service.js'
import type { ActiveNetworkAdapter, DnsBenchmarkItem } from './types.js'

export * from './types.js'
export * from './dns-service.js'

export interface DnsBenchmarkCommandProps {
  featureCode?: string
  hostOverride?: unknown
}

function WindowsDnsBenchmarkCommand(props: DnsBenchmarkCommandProps = {}) {
  const [adapters, setAdapters] = useState<ActiveNetworkAdapter[]>([])
  const [selectedAdapter, setSelectedAdapter] = useState<string>('')
  const [loadError, setLoadError] = useState<string>('')
  const [searchText, setSearchText] = useState<string>('')
  const [dnsItems, setDnsItems] = useState<DnsBenchmarkItem[]>([])
  const [isTesting, setIsTesting] = useState<boolean>(true)
  /** 修改失败后重新读取网卡 DNS 也失败：实际 DNS 未知 */
  const [dnsReadError, setDnsReadError] = useState<string>('')

  const currentAdapterObj = useMemo(
    () => adapters.find((a) => a.name === selectedAdapter) ?? adapters[0],
    [adapters, selectedAdapter]
  )

  const currentDnsList = currentAdapterObj?.currentDns ?? []
  const currentDnsText =
    currentDnsList.length > 0 ? currentDnsList.join(', ') : 'DHCP 自动获取'

  const handleRunBenchmark = async (customActiveDns?: string[]) => {
    setIsTesting(true)
    try {
      const loadedAdapters = await getActiveNetworkAdapters(props.hostOverride)
      setAdapters(loadedAdapters)
      const activeAdapter =
        loadedAdapters.find((a) => a.name === selectedAdapter) ?? loadedAdapters[0]
      if (activeAdapter && activeAdapter.name !== selectedAdapter) {
        setSelectedAdapter(activeAdapter.name)
      }
      const dnsToMark = customActiveDns ?? activeAdapter?.currentDns ?? []
      const res = await runDnsBenchmark(dnsToMark, props.hostOverride, PUBLIC_DNS_PRESETS)
      setDnsItems(res.items)
      setLoadError('')
      setDnsReadError('')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      await showToast({ style: Toast.Style.Failure, title: 'DNS 测速未完成', message })
    } finally {
      setIsTesting(false)
    }
  }

  // 修改失败后（例如主 DNS 已改、备用 DNS 失败）重新读取网卡实际 DNS，并按读回结果重新标记“当前生效”，不沿用旧值
  const refreshAdapterDns = async (failureTitle: string) => {
    try {
      const loadedAdapters = await getActiveNetworkAdapters(props.hostOverride)
      setAdapters(loadedAdapters)
      const activeAdapter =
        loadedAdapters.find((a) => a.name === selectedAdapter) ?? loadedAdapters[0]
      if (activeAdapter && activeAdapter.name !== selectedAdapter) {
        setSelectedAdapter(activeAdapter.name)
      }
      const activeDns = activeAdapter?.currentDns ?? []
      setDnsReadError('')
      setDnsItems((prev) =>
        sortAndMarkDnsItems(
          PUBLIC_DNS_PRESETS,
          prev
            .filter((p) => !p.noResult)
            .map((p) => ({
              id: p.id,
              primary: p.primary,
              avgMs: p.avgMs,
              primaryMs: p.primaryMs,
              secondaryMs: p.secondaryMs,
              timeout: p.timeout
            })),
          activeDns
        )
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 读不回实际 DNS：不再把旧值标为“当前生效”，并如实提示
      setDnsItems((prev) => prev.map((item) => ({ ...item, isCurrentActive: false })))
      setDnsReadError(message)
      await showToast({
        style: Toast.Style.Failure,
        title: `${failureTitle}，且重新读取网卡 DNS 失败`,
        message: `当前网卡 DNS 状态未知，请重新测速确认：${message}`
      })
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (props.featureCode === 'dns-flush-cache') {
        const fRes = await flushSystemDnsCache(props.hostOverride)
        if (!cancelled) {
          await showToast(fRes.ok
            ? { style: Toast.Style.Success, title: '已刷新本机 DNS 解析缓存 (ipconfig /flushdns)' }
            : { style: Toast.Style.Failure, title: '刷新 DNS 缓存失败', message: fRes.error })
        }
      }
      if (!cancelled) {
        await handleRunBenchmark()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [props.featureCode])

  const filteredDnsList = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (!q) return dnsItems
    return dnsItems.filter((d) =>
      `${d.name} ${d.primary} ${d.secondary} ${d.categoryLabel} ${d.description}`
        .toLowerCase()
        .includes(q)
    )
  }, [dnsItems, searchText])

  const fastestDns = useMemo(
    () => dnsItems.find((item) => !item.timeout && !item.noResult) ?? null,
    [dnsItems]
  )

  const allTimeout = useMemo(
    () => dnsItems.length > 0 && dnsItems.every((item) => item.timeout),
    [dnsItems]
  )

  const handleApplyDns = async (dns: DnsBenchmarkItem) => {
    if (dns.timeout || dns.noResult) {
      await showToast({
        style: Toast.Style.Failure,
        title: dns.timeout ? `节点 ${dns.name} 当前响应超时，禁止切换至不可达 DNS` : `节点 ${dns.name} 没有测速结果，请先重新测速`
      })
      return
    }
    const targetNic = currentAdapterObj?.name || selectedAdapter
    if (!targetNic) {
      await showToast({ style: Toast.Style.Failure, title: '未找到可修改 DNS 的网卡' })
      return
    }
    const res = await applyAdapterDns(targetNic, dns.primary, dns.secondary, props.hostOverride)
    if (!res.ok) {
      const title = res.error || '切换网卡 DNS 失败'
      await showToast({
        style: Toast.Style.Failure,
        title,
        ...(res.errorCode === 'SECONDARY_DNS_FAILED' ? { message: '主 DNS 可能已修改，已重新读取网卡实际 DNS' } : {})
      })
      // 任何失败都可能已改了一部分（如 SECONDARY_DNS_FAILED 时主 DNS 已生效），以重新读取的结果为准
      await refreshAdapterDns(title)
      return
    }
    // 读不到系统实际 DNS 时重新读取，不假定已生效
    if (!res.currentDns) {
      await handleRunBenchmark()
      await showToast({ style: Toast.Style.Animated, title: `已提交 ${targetNic} 的 DNS 修改，请以重新读取的结果为准` })
      return
    }
    const nextActive = res.currentDns
    setDnsReadError('')
    setAdapters((prev) =>
      prev.map((nic) =>
        nic.name === targetNic ? { ...nic, currentDns: nextActive, isDhcp: false } : nic
      )
    )
    setDnsItems((prev) =>
      sortAndMarkDnsItems(
        PUBLIC_DNS_PRESETS,
        // 没有测速结果的节点不传入，否则会被当成 0 ms 的有效结果
        prev.filter((p) => !p.noResult).map((p) => ({
          id: p.id,
          primary: p.primary,
          avgMs: p.avgMs,
          primaryMs: p.primaryMs,
          secondaryMs: p.secondaryMs,
          timeout: p.timeout
        })),
        nextActive
      )
    )
    await showToast(res.flushError
      ? { style: Toast.Style.Failure, title: `已将 ${targetNic} DNS 切换为 ${dns.name}，但刷新缓存失败`, message: res.flushError }
      : { style: Toast.Style.Success, title: `已将 ${targetNic} DNS 切换为 ${dns.name} (${dns.primary}) 并刷新缓存` })
  }

  const handleResetDhcp = async () => {
    const targetNic = currentAdapterObj?.name || selectedAdapter
    if (!targetNic) {
      await showToast({ style: Toast.Style.Failure, title: '未找到可修改 DNS 的网卡' })
      return
    }
    const res = await resetAdapterToDhcp(targetNic, props.hostOverride)
    if (!res.ok) {
      const title = res.error || '恢复 DHCP 自动获取 DNS 失败'
      await showToast({
        style: Toast.Style.Failure,
        title
      })
      await refreshAdapterDns(title)
      return
    }
    setAdapters((prev) =>
      prev.map((nic) => (nic.name === targetNic ? { ...nic, currentDns: res.currentDns ?? nic.currentDns, isDhcp: res.isDhcp !== false } : nic))
    )
    setDnsItems((prev) => prev.map((item) => ({ ...item, isCurrentActive: false })))
    await showToast(res.flushError
      ? { style: Toast.Style.Failure, title: `已将 ${targetNic} 恢复为自动获取 DNS，但刷新缓存失败`, message: res.flushError }
      : { style: Toast.Style.Success, title: `已将 ${targetNic} 恢复为路由器 DHCP 自动获取 DNS` })
  }

  const handleFlushDnsCache = async () => {
    const res = await flushSystemDnsCache(props.hostOverride)
    if (!res.ok) {
      await showToast({
        style: Toast.Style.Failure,
        title: res.error || '刷新 DNS 缓存失败'
      })
      return
    }
    await showToast({
      style: Toast.Style.Success,
      title: '已清空并刷新本机 DNS 解析缓存'
    })
  }

  const nicLabel = selectedAdapter || '未找到可修改的网卡'
  const summaryText = loadError
    ? `测速未完成：${loadError}`
    : dnsReadError
      ? `当前网卡: ${nicLabel} · DNS 状态未知（重新读取失败：${dnsReadError}），请重新测速确认`
      : allTimeout
      ? `当前网卡: ${nicLabel} · 所有公共 DNS 节点响应超时，请检查本机网络连接`
      : fastestDns
        ? `当前网卡: ${nicLabel} (${currentDnsText}) · 实测最快: ${fastestDns.name} (${fastestDns.avgMs} ms)`
        : isTesting
          ? `当前网卡: ${nicLabel} · 正在并发实测 15 组公共 DNS 延迟...`
          : `当前网卡: ${nicLabel} · 没有可用的测速结果`

  return (
    <List
      navigationTitle="DNS 测速与一键切换"
      isLoading={isTesting}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="搜索 DNS 名称、IP 地址（如 223.5.5.5）或适用场景..."
      searchBarAccessory={
        <List.Dropdown
          value={selectedAdapter}
          onChange={setSelectedAdapter}
          tooltip="选择要修改的活动网卡"
        >
          {adapters.map((nic) => (
            <List.Dropdown.Item
              key={nic.name}
              title={`${nic.name} (当前: ${nic.currentDns.join(', ') || 'DHCP自动'})`}
              value={nic.name}
              icon={Icon.Wifi}
            />
          ))}
        </List.Dropdown>
      }
      filterBar={{
        summaryText,
        actions: [
          {
            id: 'retest',
            title: '重新测速',
            onAction: () => {
              void handleRunBenchmark()
            }
          },
          {
            id: 'reset-dhcp',
            title: '恢复自动获取(DHCP)',
            onAction: () => {
              void handleResetDhcp()
            }
          }
        ]
      }}
    >
      <List.Section
        title="15 组国内外权威公共 DNS 实测排行"
        subtitle={`按 DNS 服务器 TCP 53 端口连接延迟从快到慢排序 · 共 ${filteredDnsList.length} 组`}
      >
        {filteredDnsList.map((dns, index) => (
          <List.Item
            key={dns.id}
            id={dns.id}
            title={`${dns.name} (${dns.primary} / ${dns.secondary})`}
            subtitle={dns.description}
            icon={dns.isCurrentActive ? Icon.CheckCircle : Icon.Globe}
            accessories={
              [
                dns.timeout
                  ? { tag: { value: '响应超时', color: Color.Red } }
                  : dns.noResult
                    ? { tag: '无结果' }
                    : { progress: Math.max(0.05, 1 - dns.avgMs / 300) },
                dns.isCurrentActive
                  ? { tag: '当前生效' }
                  : index === 0 && !dns.timeout && !dns.noResult
                    ? { tag: '实测最快' }
                    : { tag: dns.categoryLabel },
                { text: dns.timeout ? '超时' : dns.noResult ? '—' : `${dns.avgMs} ms` }
              ].filter(Boolean) as Array<Record<string, unknown>>
            }
            actions={
              <ActionPanel>
                <Action
                  title={`切换网卡 DNS 为 ${dns.name}`}
                  icon={Icon.CheckCircle}
                  onAction={() => handleApplyDns(dns)}
                />
                <Action
                  title="恢复网卡为 DHCP 自动获取 DNS"
                  icon={Icon.RotateAntiClockwise}
                  onAction={handleResetDhcp}
                />
                <Action
                  title="仅刷新本机 DNS 解析缓存 (Flush DNS)"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ['cmd'], key: 'r' }}
                  onAction={handleFlushDnsCache}
                />
                <Action.CopyToClipboard
                  title="复制主备 DNS 地址"
                  content={`${dns.primary}, ${dns.secondary}`}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  )
}

export function DnsBenchmarkCommand(props: DnsBenchmarkCommandProps = {}) {
  const [platform, setPlatform] = useState(''), [failure, setFailure] = useState('')
  useEffect(() => { let alive = true; void clientPlatform().then(value => { if (alive) setPlatform(value) }, error => { if (alive) setFailure(error instanceof Error ? error.message : String(error)) }); return () => { alive = false } }, [])
  if (platform === 'macos') return MacDnsCommand({ featureCode: props.featureCode })
  if (platform === 'windows') return WindowsDnsBenchmarkCommand(props)
  return <List navigationTitle="DNS 工具" isLoading={!platform && !failure}><List.Item id="status" title={failure || (platform ? '当前平台暂不支持' : '正在连接客户端')} /></List>
}
export const commands = {
  'dns-benchmark-run': () => DnsBenchmarkCommand({ featureCode: 'dns-benchmark-run' }),
  'dns-flush-cache': () => DnsBenchmarkCommand({ featureCode: 'dns-flush-cache' }),
  'dns-reset-dhcp': () => DnsBenchmarkCommand({ featureCode: 'dns-reset-dhcp' })
}
export { MacDnsCommand }
export default DnsBenchmarkCommand
