import type { BandwidthResult, ProbeNodeResult, SpeedtestDiagnosticSummary } from './types.js';
export declare function mbpsToMBps(mbps: number): number;
export declare function normalizeCustomHostInput(raw: string): string | null;
export declare function buildSpeedtestDiagnosticSummary(bandwidth: BandwidthResult | null, probes: ProbeNodeResult[]): SpeedtestDiagnosticSummary;
export declare function probeSpeedtestNodes(options?: {
    customHost?: string;
    signal?: AbortSignal;
}, hostOverride?: unknown): Promise<ProbeNodeResult[]>;
export declare function runSpeedtestBandwidth(options?: {
    signal?: AbortSignal;
}, hostOverride?: unknown): Promise<BandwidthResult>;
