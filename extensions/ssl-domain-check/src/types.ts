export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT'
export interface CertificateSummary {
  subjectCN: string; issuerName: string; validFrom: string; validTo: string
  serialNumber: string; fingerprint256: string
}
export interface SslCertHealthReport extends CertificateSummary {
  domain: string; port: number; protocol: string; subjectAltName: string
  authorized: boolean; authorizationError: string; hostnameMatches: boolean
  chain: CertificateSummary[]; chainTruncated: boolean
  validFromIso: string; validToIso: string; daysRemaining: number
  isExpired: boolean; isExpiringSoon: boolean; isNotYetValid: boolean; isHealthy: boolean
}
export interface DnsRecordEntry { name: string; type: DnsRecordType; ttl: number; data: string }
