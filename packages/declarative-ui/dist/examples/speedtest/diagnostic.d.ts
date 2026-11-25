export type SpeedtestPhase = "idle" | "ping" | "jitter" | "download" | "upload" | "completed" | "error";
export interface LocalNetInfo {
    interfaceName: string;
    ip: string;
    subnetMask: string;
    gateway: string;
    mac: string;
}
export interface PublicIpInfo {
    ip: string;
    isp: string;
    asn: string;
    country: string;
    city: string;
    timezone: string;
}
export interface DnsServerLatency {
    name: string;
    ip: string;
    latencyMs: number;
    status: "fast" | "medium" | "slow";
    location: string;
}
export interface SpeedMetrics {
    pingMs: number;
    jitterMs: number;
    downloadMbps: number;
    uploadMbps: number;
    packetLossPercent: number;
    timestamp: string;
}
export interface NetworkDiagnosticReport {
    local: LocalNetInfo;
    publicIp: PublicIpInfo;
    dnsList: DnsServerLatency[];
    speed: SpeedMetrics;
    rating?: {
        rating: string;
        badge: string;
        description: string;
    };
}
export interface SpeedtestHistoryRecord {
    id: string;
    timestamp: string;
    pingMs: number;
    jitterMs: number;
    downloadMbps: number;
    uploadMbps: number;
    packetLossPercent: number;
    rating: string;
    ratingBadge: string;
    isp: string;
}
export declare const STORAGE_KEY_SPEEDTEST_HISTORY = "speedtest_benchmark_history";
export declare function getSpeedRating(downloadMbps: number, pingMs: number): {
    rating: string;
    badge: string;
    description: string;
};
export declare function runNetworkDiagnostics(metricsOverride?: Partial<SpeedMetrics>): NetworkDiagnosticReport;
export declare function getSpeedtestHistory(): Promise<SpeedtestHistoryRecord[]>;
export declare function saveSpeedtestRecord(report: NetworkDiagnosticReport): Promise<SpeedtestHistoryRecord[]>;
export declare function clearSpeedtestHistory(): Promise<void>;
export declare function compareWithPrevious(current: SpeedMetrics, previous: SpeedtestHistoryRecord | null): {
    downloadDiff: string;
    pingDiff: string;
    trend: "stable" | "improved" | "declined";
};
export declare function exportReportSummary(report: NetworkDiagnosticReport): string;
export declare function exportReportAsMarkdown(report: NetworkDiagnosticReport, history?: SpeedtestHistoryRecord[]): string;
export declare function generateAsciiBar(value: number, max: number, length?: number): string;
