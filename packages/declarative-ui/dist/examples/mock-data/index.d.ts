import type { MockDataTab } from './types.js';
export * from './types.js';
export * from './mock-service.js';
export interface MockDataCommandProps {
    featureCode?: string;
    initialTab?: MockDataTab;
    initialSeed?: number;
}
export declare function MockDataCommand(props?: MockDataCommandProps): JSX.Element;
export default MockDataCommand;
