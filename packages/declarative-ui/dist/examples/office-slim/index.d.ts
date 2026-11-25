import type { OfficeDocSummary } from './types.js';
export * from './types.js';
export * from './office-slim-service.js';
export interface OfficeSlimProps {
    featureCode?: string;
    initialDocSummary?: OfficeDocSummary | null;
    initialRawBytes?: Uint8Array | null;
    hostOverride?: unknown;
}
export declare function OfficeSlim({ featureCode, initialDocSummary, initialRawBytes, hostOverride }?: OfficeSlimProps): JSX.Element;
export declare const OfficeSlimCommand: typeof OfficeSlim;
export default OfficeSlim;
