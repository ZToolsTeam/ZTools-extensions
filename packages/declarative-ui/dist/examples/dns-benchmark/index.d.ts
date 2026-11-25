export * from './types.js';
export * from './dns-service.js';
export interface DnsBenchmarkCommandProps {
    featureCode?: string;
    hostOverride?: unknown;
}
export declare function DnsBenchmarkCommand(props?: DnsBenchmarkCommandProps): JSX.Element;
export default DnsBenchmarkCommand;
