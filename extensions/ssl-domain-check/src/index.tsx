import React, { List, ActionPanel, Action, Icon, Color, showToast, ToastStyle, useState, useRef, useEffect, useLocale } from '@ztools/declarative-ui'
import type { DnsRecordEntry, SslCertHealthReport } from './types.js'
import { normalizeDomainInput, markdownLiteral, inspectDomainSslCert, resolveDomainDoh } from './ssl-dns-service.js'
import { t } from './i18n.js'
export * from './types.js'
export * from './ssl-dns-service.js'
const reason = (error: unknown) => error instanceof Error ? error.message : String(error)
export function certificateMarkdown(cert: SslCertHealthReport): string {
  const fields = [
    [t('fieldTrustVerify'), cert.authorized ? t('trustPassed') : t('trustFailed', { error: cert.authorizationError })],
    [t('fieldDomainMatch'), cert.hostnameMatches ? t('matched') : t('mismatched')], [t('fieldTlsProtocol'), cert.protocol],
    [t('fieldValidFrom'), cert.validFromIso], [t('fieldValidTo'), cert.validToIso],
    [t('fieldCommonName'), cert.subjectCN || t('notProvided')], [t('fieldIssuer'), cert.issuerName || t('notProvided')],
    [t('fieldSan'), cert.subjectAltName || t('notProvided')], [t('fieldSerialNumber'), cert.serialNumber], [t('fieldSha256'), cert.fingerprint256],
  ]
  return markdownLiteral(fields.map(([key, value]) => `${key}：${value}`).join('\n\n') +
    `\n\n${t('certChainTitle')}\n\n` + cert.chain.map((entry, index) => `${index + 1}. ${entry.subjectCN || t('unnamed')}\n${t('chainIssuer', { issuer: entry.issuerName })}\n${t('chainValidity', { from: entry.validFrom, to: entry.validTo })}\n${t('chainSha256', { fp: entry.fingerprint256 })}`).join('\n\n') +
    (cert.chainTruncated ? `\n\n${t('chainTruncatedNote')}` : ''))
}
export function SslDomainCheckCommand() {
  useLocale()
  const [query, setQuery] = useState(''), [recordFilter, setRecordFilter] = useState('ALL')
  const [cert, setCert] = useState<SslCertHealthReport | null>(null), [records, setRecords] = useState<DnsRecordEntry[]>([])
  const [certError, setCertError] = useState(''), [dnsError, setDnsError] = useState('')
  const [statusKey, setStatusKey] = useState<{ type: 'empty' | 'cancelled' | 'querying' | 'done'; domain?: string; failures?: number; dnsCount?: number }>({ type: 'empty' })
  const [loading, setLoading] = useState(false)
  const operation = useRef<AbortController | null>(null), generation = useRef(0), alive = useRef(true)
  const clear = () => { setCert(null); setRecords([]); setCertError(''); setDnsError('') }
  const cancel = () => {
    generation.current++; operation.current?.abort(); operation.current = null
    setLoading(false); clear(); setStatusKey({ type: 'cancelled' })
  }
  const changeQuery = (value: string) => {
    // 输入提示只保留在空状态条目上，工具栏摘要不再重复
    cancel(); setQuery(value); setStatusKey({ type: 'empty' })
  }
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; generation.current++; operation.current?.abort() }
  }, [])
  const run = async () => {
    if (operation.current) return
    let domain: string
    try { domain = normalizeDomainInput(query) }
    catch (error) { await showToast({ style: ToastStyle.Failure, title: t('errInvalidDomain'), message: reason(error) }); return }
    const controller = new AbortController(), id = ++generation.current
    operation.current = controller; clear(); setLoading(true); setStatusKey({ type: 'querying', domain })
    try {
      const [tls, dns] = await Promise.allSettled([
        inspectDomainSslCert(domain, { signal: controller.signal }),
        resolveDomainDoh(domain, undefined, { signal: controller.signal }),
      ])
      if (!alive.current || id !== generation.current || controller.signal.aborted) return
      if (tls.status === 'fulfilled') setCert(tls.value); else setCertError(reason(tls.reason))
      if (dns.status === 'fulfilled') setRecords(dns.value); else setDnsError(reason(dns.reason))
      const failures = Number(tls.status === 'rejected') + Number(dns.status === 'rejected')
      setStatusKey({ type: 'done', domain, failures, dnsCount: dns.status === 'fulfilled' ? dns.value.length : undefined })
    } finally {
      if (alive.current && id === generation.current) { operation.current = null; setLoading(false) }
    }
  }
  const status = statusKey.type === 'empty' ? ''
    : statusKey.type === 'cancelled' ? t('statusCancelled')
    : statusKey.type === 'querying' ? t('statusQuerying', { domain: statusKey.domain ?? '' })
    : `${statusKey.domain} · ${statusKey.failures === 2 ? t('statusAllFailed') : statusKey.failures ? t('statusPartialFailed') : t('statusCompleted')}${statusKey.dnsCount !== undefined ? t('statusDnsCount', { count: statusKey.dnsCount }) : ''}`
  const filtered = records.filter(record => recordFilter === 'ALL' || record.type === recordFilter)
  const certificateStatus = cert ? cert.isExpired ? t('certExpired') : cert.isNotYetValid ? t('certNotYetValid') : !cert.hostnameMatches ? t('certHostnameMismatch') : !cert.authorized ? t('certUntrusted') : cert.isExpiringSoon ? t('certExpiringSoon') : t('certVerified') : ''
  return (
    <List isShowingDetail={Boolean(cert)} isLoading={loading} searchText={query} onSearchTextChange={changeQuery}
      searchBarPlaceholder={t('searchPlaceholder')}
      searchBarAccessory={<List.Dropdown tooltip={t('filterTooltip')} value={recordFilter} onChange={setRecordFilter}>
        <List.Dropdown.Item title={t('filterAll')} value="ALL" />
        {['A', 'AAAA', 'CNAME', 'MX', 'TXT'].map(type => <List.Dropdown.Item key={type} title={type} value={type} />)}
      </List.Dropdown>}
      filterBar={{ summaryText: status, actions: loading ? [{ id: 'cancel', title: t('cancelAction'), onAction: cancel }] : [] }}>
      <List.Item id="ssl-probe-trigger" title={loading ? t('probeLoadingTitle') : query.trim() ? t('probeDiagnoseTitle', { query: query.trim() }) : t('probePromptTitle')}
        subtitle={t('probeSubtitle')} icon={Icon.Globe}
        actions={<ActionPanel><Action title={t('queryAction')} icon={Icon.Globe} onAction={run} /></ActionPanel>} />
      {certError && <List.Item id="tls-error" title={t('tlsErrorTitle')} subtitle={certError} icon={Icon.ExclamationMark}
        detail={<List.Item.Detail markdown={markdownLiteral(certError)} />}
        actions={<ActionPanel><Action title={t('retryAction')} icon={Icon.ArrowClockwise} onAction={run} /><Action.CopyToClipboard title={t('copyErrorAction')} content={certError} /></ActionPanel>} />}
      {cert && <List.Item id="ssl-certificate" title={cert.domain} subtitle={`${cert.protocol} · ${cert.isExpired ? t('certExpiredSub') : t('certDaysRemainingSub', { days: cert.daysRemaining })}`}
        icon={cert.isHealthy ? Icon.Shield : Icon.ExclamationMark}
        accessories={[cert.isHealthy && !cert.isExpiringSoon ? { tag: certificateStatus } : { tag: { value: certificateStatus, color: Color.Red } }]}
        detail={<List.Item.Detail markdown={certificateMarkdown(cert)} />}
        actions={<ActionPanel><Action.CopyToClipboard title={t('copyCertDiagAction')} content={t('certDiagClipboard', { domain: cert.domain, port: cert.port, status: certificateStatus, matches: String(cert.hostnameMatches), authorized: String(cert.authorized), authError: cert.authorizationError, protocol: cert.protocol, from: cert.validFromIso, to: cert.validToIso, fp: cert.fingerprint256 })} /></ActionPanel>} />}
      {dnsError && <List.Item id="dns-error" title={t('dnsErrorTitle')} subtitle={dnsError} icon={Icon.ExclamationMark}
        detail={<List.Item.Detail markdown={markdownLiteral(dnsError)} />}
        actions={<ActionPanel><Action title={t('retryAction')} icon={Icon.ArrowClockwise} onAction={run} /><Action.CopyToClipboard title={t('copyErrorAction')} content={dnsError} /></ActionPanel>} />}
      {filtered.map((record, index) => <List.Item key={`${record.type}-${index}`} id={`dns-${record.type}-${index}`} title={record.data}
        subtitle={t('dnsTtlSub', { name: record.name, ttl: record.ttl })} icon={Icon.Globe} accessories={[{ tag: record.type }]}
        detail={<List.Item.Detail markdown={t('dnsDetailMarkdown', { value: markdownLiteral(record.data) })} />}
        actions={<ActionPanel><Action.CopyToClipboard title={t('copyRecordAction')} content={record.data} /></ActionPanel>} />)}
    </List>
  )
}
export default SslDomainCheckCommand
