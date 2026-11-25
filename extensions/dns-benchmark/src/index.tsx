import React, {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
  useEffect,
  useLocale,
  useMemo,
  useState
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  getPublicDnsPresets,
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
import { resolveErrorMessage } from './error-i18n.js'

export * from './types.js'
export * from './dns-service.js'

export interface DnsBenchmarkCommandProps {
  featureCode?: string
  hostOverride?: unknown
}

function WindowsDnsBenchmarkCommand(props: DnsBenchmarkCommandProps = {}) {
  const locale = useLocale()
  const presets = useMemo(() => getPublicDnsPresets(), [locale])
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
    currentDnsList.length > 0 ? currentDnsList.join(', ') : t('dhcpAutoText')

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
      const res = await runDnsBenchmark(dnsToMark, props.hostOverride, presets)
      setDnsItems(res.items)
      setLoadError('')
      setDnsReadError('')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      await showToast({ style: Toast.Style.Failure, title: t('errBenchmarkFailed'), message })
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
          presets,
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
        title: t('toastReadFailedTitle', { title: failureTitle }),
        message: t('toastReadFailedMsg', { error: message })
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
            ? { style: Toast.Style.Success, title: t('toastFlushedOnLaunch') }
            : { style: Toast.Style.Failure, title: t('errFlushCache'), message: fRes.error })
        }
      } else if (props.featureCode === 'dns-reset-dhcp') {
        try {
          const loadedAdapters = await getActiveNetworkAdapters(props.hostOverride)
          if (cancelled) return
          setAdapters(loadedAdapters)
          const activeAdapter = loadedAdapters[0]
          if (!activeAdapter) {
            await showToast({ style: Toast.Style.Failure, title: t('toastNoAdapter') })
          } else {
            setSelectedAdapter(activeAdapter.name)
            const confirmed = await confirmAlert({
              title: t('confirmResetDhcpTitle', { nic: activeAdapter.name }),
              message: t('confirmResetDhcpMsg', {
                nic: activeAdapter.name,
                dns: activeAdapter.currentDns.join(', ') || t('dhcpAutoText')
              }),
              primaryAction: { title: t('confirmResetDhcpBtn'), style: 'destructive' },
              dismissAction: { title: t('cancelBtn') }
            })
            if (confirmed && !cancelled) {
              const rRes = await resetAdapterToDhcp(activeAdapter.name, props.hostOverride)
              if (!cancelled) {
                if (!rRes.ok) {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: resolveErrorMessage(rRes, t('errResetDhcp'))
                  })
                } else {
                  await showToast(
                    rRes.flushError
                      ? {
                          style: Toast.Style.Failure,
                          title: t('toastResetFlushFailed', { nic: activeAdapter.name }),
                          message: rRes.flushError
                        }
                      : {
                          style: Toast.Style.Success,
                          title: t('toastResetSuccess', { nic: activeAdapter.name })
                        }
                  )
                }
              }
            }
          }
        } catch (error) {
          if (!cancelled) {
            const message = error instanceof Error ? error.message : String(error)
            setLoadError(message)
            await showToast({ style: Toast.Style.Failure, title: t('errResetDhcp'), message })
          }
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
        title: dns.timeout ? t('toastNodeTimeout', { name: dns.name }) : t('toastNodeNoResult', { name: dns.name })
      })
      return
    }
    const targetNic = currentAdapterObj?.name || selectedAdapter
    if (!targetNic) {
      await showToast({ style: Toast.Style.Failure, title: t('toastNoAdapter') })
      return
    }
    const res = await applyAdapterDns(targetNic, dns.primary, dns.secondary, props.hostOverride)
    if (!res.ok) {
      const title = resolveErrorMessage(res, t('errApplyDns'))
      await showToast({
        style: Toast.Style.Failure,
        title,
        ...(res.errorCode === 'SECONDARY_DNS_FAILED' ? { message: t('toastSecondaryDnsFailedMsg') } : {})
      })
      // 任何失败都可能已改了一部分（如 SECONDARY_DNS_FAILED 时主 DNS 已生效），以重新读取的结果为准
      await refreshAdapterDns(title)
      return
    }
    // 读不到系统实际 DNS 时重新读取，不假定已生效
    if (!res.currentDns) {
      await handleRunBenchmark()
      await showToast({ style: Toast.Style.Animated, title: t('toastDnsSubmitted', { nic: targetNic }) })
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
        presets,
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
      ? { style: Toast.Style.Failure, title: t('toastAppliedFlushFailed', { nic: targetNic, name: dns.name }), message: res.flushError }
      : { style: Toast.Style.Success, title: t('toastAppliedSuccess', { nic: targetNic, name: dns.name, ip: dns.primary }) })
  }

  const handleResetDhcp = async () => {
    const targetNic = currentAdapterObj?.name || selectedAdapter
    if (!targetNic) {
      await showToast({ style: Toast.Style.Failure, title: t('toastNoAdapter') })
      return
    }
    const res = await resetAdapterToDhcp(targetNic, props.hostOverride)
    if (!res.ok) {
      const title = resolveErrorMessage(res, t('errResetDhcp'))
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
      ? { style: Toast.Style.Failure, title: t('toastResetFlushFailed', { nic: targetNic }), message: res.flushError }
      : { style: Toast.Style.Success, title: t('toastResetSuccess', { nic: targetNic }) })
  }

  const handleFlushDnsCache = async () => {
    const res = await flushSystemDnsCache(props.hostOverride)
    if (!res.ok) {
      await showToast({
        style: Toast.Style.Failure,
        title: resolveErrorMessage(res, t('errFlushCache'))
      })
      return
    }
    await showToast({
      style: Toast.Style.Success,
      title: t('toastFlushSuccess')
    })
  }

  const nicLabel = selectedAdapter || t('noAdapterLabel')
  const summaryText = loadError
    ? t('summaryLoadErr', { error: loadError })
    : dnsReadError
      ? t('summaryDnsReadErr', { nic: nicLabel, error: dnsReadError })
      : allTimeout
      ? t('summaryAllTimeout', { nic: nicLabel })
      : fastestDns
        ? t('summaryFastest', { nic: nicLabel, dns: currentDnsText, name: fastestDns.name, ms: fastestDns.avgMs })
        : isTesting
          ? t('summaryTesting', { nic: nicLabel })
          : t('summaryNoResult', { nic: nicLabel })

  return (
    <List
      navigationTitle={t('winNavTitle')}
      isLoading={isTesting}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={t('winSearchPlaceholder')}
      searchBarAccessory={
        <List.Dropdown
          value={selectedAdapter}
          onChange={setSelectedAdapter}
          tooltip={t('winAdapterTooltip')}
        >
          {adapters.map((nic) => (
            <List.Dropdown.Item
              key={nic.name}
              title={t('winAdapterItemTitle', { name: nic.name, dns: nic.currentDns.join(', ') || t('winDhcpShort') })}
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
            title: t('macRetestBtn'),
            onAction: () => {
              void handleRunBenchmark()
            }
          },
          {
            id: 'reset-dhcp',
            title: t('winResetDhcpBtn'),
            onAction: () => {
              void handleResetDhcp()
            }
          }
        ]
      }}
    >
      <List.Section
        title={t('winSectionTitle')}
        subtitle={t('winSectionSubtitle', { count: filteredDnsList.length })}
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
                  ? { tag: { value: t('tagTimeout'), color: Color.Red } }
                  : dns.noResult
                    ? { tag: t('tagNoResult') }
                    : { progress: Math.max(0.05, 1 - dns.avgMs / 300) },
                dns.isCurrentActive
                  ? { tag: t('tagActive') }
                  : index === 0 && !dns.timeout && !dns.noResult
                    ? { tag: t('tagFastest') }
                    : { tag: dns.categoryLabel },
                { text: dns.timeout ? t('textTimeout') : dns.noResult ? '—' : `${dns.avgMs} ms` }
              ].filter(Boolean) as Array<Record<string, unknown>>
            }
            actions={
              <ActionPanel>
                <Action
                  title={t('actionApplyNicDns', { name: dns.name })}
                  icon={Icon.CheckCircle}
                  onAction={() => handleApplyDns(dns)}
                />
                <Action
                  title={t('actionResetNicDhcp')}
                  icon={Icon.RotateAntiClockwise}
                  onAction={handleResetDhcp}
                />
                <Action
                  title={t('actionFlushOnly')}
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ['ctrl'], key: 'r' }}
                  onAction={handleFlushDnsCache}
                />
                <Action.CopyToClipboard
                  title={t('actionCopyPair')}
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
  useLocale()
  const [platform, setPlatform] = useState(''), [failure, setFailure] = useState('')
  useEffect(() => { let alive = true; void clientPlatform().then(value => { if (alive) setPlatform(value) }, error => { if (alive) setFailure(error instanceof Error ? error.message : String(error)) }); return () => { alive = false } }, [])
  if (platform === 'macos') return MacDnsCommand({ featureCode: props.featureCode })
  if (platform === 'windows') return WindowsDnsBenchmarkCommand(props)
  return <List navigationTitle={t('fallbackNavTitle')} isLoading={!platform && !failure}><List.Item id="status" title={failure || (platform ? t('platformUnsupported') : t('connectingClient'))} /></List>
}
export const commands = {
  'dns-benchmark-run': () => DnsBenchmarkCommand({ featureCode: 'dns-benchmark-run' }),
  'dns-flush-cache': () => DnsBenchmarkCommand({ featureCode: 'dns-flush-cache' }),
  'dns-reset-dhcp': () => DnsBenchmarkCommand({ featureCode: 'dns-reset-dhcp' })
}
export { MacDnsCommand }
export default DnsBenchmarkCommand
