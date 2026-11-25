import type { DnsRecordEntry, DnsRecordType, SslCertHealthReport } from './types.js';
export declare function normalizeDomainInput(raw: string): string;
export declare function evaluateSslCertInfo(certInput: {
    domain: string;
    subjectCN: string;
    issuerName: string;
    validFrom: string | number | Date;
    validTo: string | number | Date;
    serialNumber?: string;
    fingerprint256?: string;
    subjectAltNames?: string[];
    protocol?: string;
}, nowMs?: number): SslCertHealthReport;
export declare function inspectDomainSslCert(rawDomain: string, options?: {
    port?: number;
    timeoutMs?: number;
    hostInvoke?: (plugin: string, fn: string, params: Record<string, unknown>) => Promise<unknown>;
}): Promise<SslCertHealthReport>;
export declare function resolveDomainDoh(rawDomain: string, recordTypes?: DnsRecordType[], options?: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
}): Promise<DnsRecordEntry[]>;
