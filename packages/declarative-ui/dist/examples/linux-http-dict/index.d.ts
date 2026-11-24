import type { DictCategory } from './types.js';
export * from './types.js';
export * from './dict-service.js';
export interface LinuxHttpDictCommandProps {
    featureCode?: string;
    initialCategory?: DictCategory;
    initialSearchText?: string;
}
export declare function LinuxHttpDictCommand(props?: LinuxHttpDictCommandProps): JSX.Element;
export default LinuxHttpDictCommand;
