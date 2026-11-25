import type { FileDiagnosticResult } from './types.js';
export * from './types.js';
export * from './inspector-service.js';
export interface FileInspectorCommandProps {
    featureCode?: string;
    initialDiagnostic?: FileDiagnosticResult | null;
    initialRawBytes?: Uint8Array;
    hostOverride?: unknown;
}
export declare function FileInspectorCommand(props?: FileInspectorCommandProps): JSX.Element;
export default FileInspectorCommand;
