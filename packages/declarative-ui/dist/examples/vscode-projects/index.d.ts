import type { ProjectEntry } from './types.js';
export * from './types.js';
export * from './project-service.js';
export interface VscodeProjectsCommandProps {
    featureCode?: string;
    initialProjects?: ProjectEntry[];
    hostOverride?: unknown;
}
export declare function VscodeProjectsCommand(props?: VscodeProjectsCommandProps): JSX.Element;
export default VscodeProjectsCommand;
