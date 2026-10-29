import React, { List, ActionPanel, Action, Icon, Color, showToast, ToastStyle, useState, useRef, useEffect } from '@ztools/declarative-ui'
import type { DnsRecordEntry, SslCertHealthReport } from './types.js'
import { normalizeDomainInput, markdownLiteral, inspectDomainSslCert, resolveDomainDoh } from './ssl-dns-service.js'
export * from './types.js'
export * from './ssl-dns-service.js'
const reason = (error: unknown) => error instanceof Error ? error.message : String(error)
export function certificateMarkdown(cert: SslCertHealthReport): string {
  const fields = [
    ['证书信任验证', cert.authorized ? '通过' : `未通过：${cert.authorizationError}`],
    ['域名匹配', cert.hostnameMatches ? '匹配' : '不匹配'], ['TLS 协议', cert.protocol],
    ['生效时间', cert.validFromIso], ['到期时间', cert.validToIso],
    ['通用名称', cert.subjectCN || '未提供'], ['颁发机构', cert.issuerName || '未提供'],
    ['备用名称', cert.subjectAltName || '未提供'], ['序列号', cert.serialNumber], ['SHA-256 指纹', cert.fingerprint256],
  ]
  return markdownLiteral(fields.map(([key, value]) => `${key}：${value}`).join('\n\n') +
    '\n\n证书链\n\n' + cert.chain.map((entry, index) => `${index + 1}. ${entry.subjectCN || '未提供名称'}\n颁发机构：${entry.issuerName}\n有效期：${entry.validFrom} 至 ${entry.validTo}\nSHA-256：${entry.fingerprint256}`).join('\n\n') +
    (cert.chainTruncated ? '\n\n证书链超过显示上限，仅显示前 8 项。' : ''))
}
export function SslDomainCheckCommand() {
  const [query, setQuery] = useState(''), [recordFilter, setRecordFilter] = useState('ALL')
  const [cert, setCert] = useState<SslCertHealthReport | null>(null), [records, setRecords] = useState<DnsRecordEntry[]>([])
  const [certError, setCertError] = useState(''), [dnsError, setDnsError] = useState('')
  const [status, setStatus] = useState(''), [loading, setLoading] = useState(false)
  const operation = useRef<AbortController | null>(null), generation = useRef(0), alive = useRef(true)
  const clear = () => { setCert(null); setRecords([]); setCertError(''); setDnsError('') }
  const cancel = () => {
    generation.current++; operation.current?.abort(); operation.current = null
    setLoading(false); clear(); setStatus('查询已取消')
  }
  const changeQuery = (value: string) => {
    // 输入提示只保留在空状态条目上，工具栏摘要不再重复
    cancel(); setQuery(value); setStatus('')
  }
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; generation.current++; operation.current?.abort() }
  }, [])
  const run = async () => {
    if (operation.current) return
    let domain: string
    try { domain = normalizeDomainInput(query) }
    catch (error) { await showToast({ style: ToastStyle.Failure, title: '请输入有效域名', message: reason(error) }); return }
    const controller = new AbortController(), id = ++generation.current
    operation.current = controller; clear(); setLoading(true); setStatus(`正在查询 ${domain}`)
    try {
      const [tls, dns] = await Promise.allSettled([
        inspectDomainSslCert(domain, { signal: controller.signal }),
        resolveDomainDoh(domain, undefined, { signal: controller.signal }),
      ])
      if (!alive.current || id !== generation.current || controller.signal.aborted) return
      if (tls.status === 'fulfilled') setCert(tls.value); else setCertError(reason(tls.reason))
      if (dns.status === 'fulfilled') setRecords(dns.value); else setDnsError(reason(dns.reason))
      const failures = Number(tls.status === 'rejected') + Number(dns.status === 'rejected')
      setStatus(`${domain} · ${failures === 2 ? '查询失败' : failures ? '部分查询失败' : '查询完成'}${dns.status === 'fulfilled' ? ` · ${dns.value.length} 条 DNS 记录` : ''}`)
    } finally {
      if (alive.current && id === generation.current) { operation.current = null; setLoading(false) }
    }
  }
  const filtered = records.filter(record => recordFilter === 'ALL' || record.type === recordFilter)
  const certificateStatus = cert ? cert.isExpired ? '已过期' : cert.isNotYetValid ? '尚未生效' : !cert.hostnameMatches ? '域名不匹配' : !cert.authorized ? '信任验证未通过' : cert.isExpiringSoon ? '即将到期' : '验证通过' : ''
  return (
    <List isShowingDetail={Boolean(cert)} isLoading={loading} searchText={query} onSearchTextChange={changeQuery}
      searchBarPlaceholder="输入域名或网址，例如 example.com"
      searchBarAccessory={<List.Dropdown tooltip="筛选 DNS 记录" value={recordFilter} onChange={setRecordFilter}>
        <List.Dropdown.Item title="全部 DNS 记录" value="ALL" />
        {['A', 'AAAA', 'CNAME', 'MX', 'TXT'].map(type => <List.Dropdown.Item key={type} title={type} value={type} />)}
      </List.Dropdown>}
      filterBar={{ summaryText: status, actions: loading ? [{ id: 'cancel', title: '取消查询', onAction: cancel }] : [] }}>
      <List.Item id="ssl-probe-trigger" title={loading ? '正在查询…' : query.trim() ? `诊断 ${query.trim()}` : '输入域名后回车诊断'}
        subtitle="检查 HTTPS（443 端口）证书与 DNS 记录" icon={Icon.Globe}
        actions={<ActionPanel><Action title="查询域名" icon={Icon.Globe} onAction={run} /></ActionPanel>} />
      {certError && <List.Item id="tls-error" title="证书查询失败" subtitle={certError} icon={Icon.ExclamationMark}
        detail={<List.Item.Detail markdown={markdownLiteral(certError)} />}
        actions={<ActionPanel><Action title="重新查询" icon={Icon.ArrowClockwise} onAction={run} /><Action.CopyToClipboard title="复制失败原因" content={certError} /></ActionPanel>} />}
      {cert && <List.Item id="ssl-certificate" title={cert.domain} subtitle={`${cert.protocol} · ${cert.isExpired ? '证书已过期' : `剩余 ${cert.daysRemaining} 天`}`}
        icon={cert.isHealthy ? Icon.Shield : Icon.ExclamationMark}
        accessories={[cert.isHealthy && !cert.isExpiringSoon ? { tag: certificateStatus } : { tag: { value: certificateStatus, color: Color.Red } }]}
        detail={<List.Item.Detail markdown={certificateMarkdown(cert)} />}
        actions={<ActionPanel><Action.CopyToClipboard title="复制证书诊断" content={`${cert.domain}:${cert.port}\n${certificateStatus}\n域名匹配：${cert.hostnameMatches}\n证书可信：${cert.authorized}\n${cert.authorizationError}\n${cert.protocol}\n有效期：${cert.validFromIso} 至 ${cert.validToIso}\n${cert.fingerprint256}`} /></ActionPanel>} />}
      {dnsError && <List.Item id="dns-error" title="DNS 查询失败" subtitle={dnsError} icon={Icon.ExclamationMark}
        detail={<List.Item.Detail markdown={markdownLiteral(dnsError)} />}
        actions={<ActionPanel><Action title="重新查询" icon={Icon.ArrowClockwise} onAction={run} /><Action.CopyToClipboard title="复制失败原因" content={dnsError} /></ActionPanel>} />}
      {filtered.map((record, index) => <List.Item key={`${record.type}-${index}`} id={`dns-${record.type}-${index}`} title={record.data}
        subtitle={`${record.name} · TTL ${record.ttl} 秒`} icon={Icon.Globe} accessories={[{ tag: record.type }]}
        detail={<List.Item.Detail markdown={`**记录值**\n\n${markdownLiteral(record.data)}`} />}
        actions={<ActionPanel><Action.CopyToClipboard title="复制记录值" content={record.data} /></ActionPanel>} />)}
    </List>
  )
}
export default SslDomainCheckCommand
