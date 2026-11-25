import type { ContainerSummary } from './types.js';
export * from './types.js';
export * from './docker-service.js';
export interface DockerManagerCommandProps {
    featureCode?: string;
    initialContainers?: ContainerSummary[];
    hostOverride?: unknown;
}
export declare function DockerManagerCommand(props?: DockerManagerCommandProps): JSX.Element;
export default DockerManagerCommand;
