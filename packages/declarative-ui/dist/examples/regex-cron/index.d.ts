import type { RegexCronMode } from './types.js';
export * from './types.js';
export * from './regex-cron-service.js';
export interface RegexCronCommandProps {
    featureCode?: string;
    initialMode?: RegexCronMode;
    initialSearchText?: string;
    initialTestSample?: string;
}
export declare function RegexCronCommand(props?: RegexCronCommandProps): JSX.Element;
export default RegexCronCommand;
