import React, { List, ActionPanel, Action, Icon, Color, showToast, ToastStyle, useState, useRef, useEffect, } from '../../index.js';
import { normalizeDomainInput, inspectDomainSslCert, resolveDomainDoh, } from './ssl-dns-service.js';
export * from './types.js';
export * from './ssl-dns-service.js';
export function SslDomainCheckCommand() {
    const [queryDomain, setQueryDomain] = useState('github.com');
    const [recordFilter, setRecordFilter] = useState('ALL');
    const [certReports, setCertReports] = useState([]);
    const [certError, setCertError] = useState('');
    const [dnsRecords, setDnsRecords] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const abortRef = useRef(null);
    const handleRunDiagnosis = async (targetDomain) => {
        const raw = (targetDomain ?? queryDomain).trim();
        let domain;
        try {
            domain = normalizeDomainInput(raw);
        }
        catch (err) {
            await showToast({
                style: ToastStyle.Failure,
                title: '域名格式不合法',
                message: err instanceof Error ? err.message : String(err),
            });
            return;
        }
        if (abortRef.current) {
            abortRef.current.abort();
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setIsLoading(true);
        setCertError('');
        try {
            const types = recordFilter === 'ALL'
                ? ['A', 'AAAA', 'CNAME', 'MX', 'TXT']
                : [recordFilter];
            const [certOutcome, dnsOutcome] = await Promise.allSettled([
                inspectDomainSslCert(domain),
                resolveDomainDoh(domain, types, { signal: controller.signal }),
            ]);
            if (certOutcome.status === 'fulfilled') {
                setCertReports((prev) => {
                    const rest = prev.filter((item) => item.domain !== certOutcome.value.domain);
                    return [certOutcome.value, ...rest];
                });
            }
            else {
                setCertError(certOutcome.reason instanceof Error
                    ? certOutcome.reason.message
                    : String(certOutcome.reason));
            }
            if (dnsOutcome.status === 'fulfilled') {
                setDnsRecords(dnsOutcome.value);
                await showToast({
                    style: ToastStyle.Success,
                    title: `已完成 ${domain} 诊断`,
                    message: `获取 ${dnsOutcome.value.length} 条 DNS 记录`,
                });
            }
            else {
                const reasonMsg = dnsOutcome.reason instanceof Error
                    ? dnsOutcome.reason.message
                    : String(dnsOutcome.reason);
                if (!reasonMsg.includes('DOH_ABORTED')) {
                    await showToast({
                        style: ToastStyle.Failure,
                        title: 'DNS-over-HTTPS 查询失败',
                        message: reasonMsg,
                    });
                }
            }
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        void handleRunDiagnosis('github.com');
        return () => {
            if (abortRef.current) {
                abortRef.current.abort();
            }
        };
    }, []);
    return (React.createElement(List, { isShowingDetail: true, isLoading: isLoading, searchBarPlaceholder: "\u8F93\u5165\u57DF\u540D\uFF08\u5982 github.com\uFF09\u67E5\u8BE2\u771F\u5B9E SSL \u8BC1\u4E66\u4E0E DNS \u89E3\u6790...", searchText: queryDomain, onSearchTextChange: setQueryDomain, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u7B5B\u9009 DNS \u8BB0\u5F55\u7C7B\u578B", value: recordFilter, onChange: (val) => setRecordFilter(val) },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u8BB0\u5F55 (SSL + DNS)", value: "ALL" }),
            React.createElement(List.Dropdown.Item, { title: "A \u8BB0\u5F55 (IPv4)", value: "A" }),
            React.createElement(List.Dropdown.Item, { title: "AAAA \u8BB0\u5F55 (IPv6)", value: "AAAA" }),
            React.createElement(List.Dropdown.Item, { title: "CNAME \u522B\u540D\u8BB0\u5F55", value: "CNAME" }),
            React.createElement(List.Dropdown.Item, { title: "MX \u90AE\u4EF6\u4EA4\u6362\u8BB0\u5F55", value: "MX" }),
            React.createElement(List.Dropdown.Item, { title: "TXT \u6587\u672C\u6821\u9A8C\u8BB0\u5F55", value: "TXT" })) },
        React.createElement(List.Section, { title: "SSL/TLS \u8BC1\u4E66\u5065\u5EB7\u5EA6\u5DE1\u68C0" },
            React.createElement(List.Item, { id: "ssl-probe-trigger", title: `探测 ${queryDomain.trim() || '目标域名'} 实时 TLS 证书与 DoH 解析`, subtitle: certError ? `上次探测异常: ${certError}` : '按回车发起真实 TLS 443 握手与 Cloudflare DoH 查询', icon: certError ? Icon.ExclamationMark : Icon.Globe, accessories: [certError ? { tag: { value: '探测异常', color: Color.Red } } : { tag: '实时探测' }], detail: React.createElement(List.Item.Detail, { markdown: `### 实时域名 TLS & DoH 诊断\n\n当前输入域名: \`${queryDomain.trim() || '-'}\`\n\n${certError ? `> **TLS 握手提示**: ${certError}\n\n` : ''}按回车立即通过宿主 \`tls.connect(443)\` 获取真实对端 X.509 证书链，并并发查询 Cloudflare DNS-over-HTTPS 记录。` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: `立即诊断 ${queryDomain.trim() || '域名'}`, icon: Icon.Globe, onAction: () => {
                            void handleRunDiagnosis(queryDomain);
                        } })) }),
            certReports.map((cert) => (React.createElement(List.Item, { key: cert.domain, id: `ssl-${cert.domain}`, title: cert.domain, subtitle: `颁发机构: ${cert.issuerName} · 到期日: ${cert.validToIso}`, icon: cert.isExpired || cert.isExpiringSoon ? Icon.ExclamationMark : Icon.Shield, accessories: [
                    cert.isExpired
                        ? { tag: { value: `已过期 ${Math.abs(cert.daysRemaining)} 天`, color: Color.Red } }
                        : cert.isExpiringSoon
                            ? { tag: { value: `仅剩 ${cert.daysRemaining} 天`, color: Color.Red } }
                            : { tag: `剩余 ${cert.daysRemaining} 天` },
                ], detail: React.createElement(List.Item.Detail, { markdown: `### SSL/TLS 证书诊断: \`${cert.domain}\`\n\n- **通用名称 (CN)**: \`${cert.subjectCN}\`\n- **颁发机构 (Issuer)**: ${cert.issuerName}\n- **SAN 备用域名**: ${cert.subjectAltNames
                        .map((s) => `\`${s}\``)
                        .join(', ')}\n- **SHA-256 指纹**: \`${cert.fingerprint256}\``, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u57DF\u540D (Domain)", text: cert.domain }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "TLS \u534F\u8BAE\u7248\u672C", text: cert.protocol }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7B7E\u53D1\u65E5\u671F", text: cert.validFromIso }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u622A\u6B62\u65E5\u671F", text: cert.validToIso }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5269\u4F59\u6709\u6548\u5929\u6570", text: cert.isExpired
                                ? `已过期 ${Math.abs(cert.daysRemaining)} 天`
                                : `${cert.daysRemaining} 天` }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5E8F\u5217\u53F7", text: cert.serialNumber })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: `查询 ${cert.domain} 实时 DNS 记录`, icon: Icon.Globe, onAction: () => {
                            setQueryDomain(cert.domain);
                            void handleRunDiagnosis(cert.domain);
                        } }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8BC1\u4E66\u8BCA\u65AD\u6458\u8981", content: `${cert.domain} | Issuer: ${cert.issuerName} | ValidTo: ${cert.validToIso} | DaysRemaining: ${cert.daysRemaining}` })) })))),
        React.createElement(List.Section, { title: `DNS-over-HTTPS 实时解析记录 (${dnsRecords.length} 条)` }, dnsRecords.map((rec, idx) => (React.createElement(List.Item, { key: `${rec.type}-${rec.data}-${idx}`, id: `dns-${rec.type}-${idx}`, title: rec.data, subtitle: `${rec.name} · TTL ${rec.ttl}s`, icon: Icon.Globe, accessories: [{ tag: rec.type }], detail: React.createElement(List.Item.Detail, { markdown: `### DNS ${rec.type} 记录\n\n\`\`\`text\n${rec.name}  ${rec.ttl}  IN  ${rec.type}  ${rec.data}\n\`\`\`` }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8BB0\u5F55\u503C", content: rec.data })) }))))));
}
export default SslDomainCheckCommand;
