import type { SqlHelperTab } from './types.js';
export * from './types.js';
export * from './sql-helper-service.js';
export interface SqlHelperCommandProps {
    featureCode?: string;
    initialTab?: SqlHelperTab;
    initialSearchText?: string;
}
export declare function SqlHelperCommand(props?: SqlHelperCommandProps): JSX.Element;
export default SqlHelperCommand;
