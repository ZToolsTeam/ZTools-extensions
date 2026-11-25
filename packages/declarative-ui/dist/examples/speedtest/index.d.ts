import type { BandwidthResult, ProbeNodeResult } from './types.js';
export * from './types.js';
export * from './speedtest-service.js';
export interface SpeedtestProps {
    featureCode?: string;
    initialBandwidth?: BandwidthResult | null;
    initialProbes?: ProbeNodeResult[];
}
export declare function Speedtest({ featureCode, initialBandwidth, initialProbes }?: SpeedtestProps): JSX.Element;
export declare const SpeedtestCommand: typeof Speedtest;
export default Speedtest;
export declare function SpeedtestDetailView({ report }: {
    report?: Record<string, unknown>;
}): JSX.Element;
