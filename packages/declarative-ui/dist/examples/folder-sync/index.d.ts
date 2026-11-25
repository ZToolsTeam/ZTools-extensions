import type { SyncMode } from './types.js';
export * from './types.js';
export * from './sync-service.js';
export interface FolderSyncCommandProps {
    featureCode?: string;
    initialSourceDir?: string;
    initialTargetDir?: string;
    initialSyncMode?: SyncMode;
    hostOverride?: unknown;
}
export declare function FolderSyncCommand(props?: FolderSyncCommandProps): JSX.Element;
export default FolderSyncCommand;
