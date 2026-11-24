import type { GitHelperMode } from './types.js';
export * from './types.js';
export * from './git-helper-service.js';
export interface GitHelperCommandProps {
    featureCode?: string;
    initialMode?: GitHelperMode;
    initialSearchText?: string;
    initialSelectedStacks?: string[];
}
export declare function GitHelperCommand(props?: GitHelperCommandProps): JSX.Element;
export default GitHelperCommand;
