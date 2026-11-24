import type { MediaMetadataSummary, MediaParamItem } from './types.js';
export * from './types.js';
export * from './media-service.js';
export interface MediaMetadataCommandProps {
    featureCode?: string;
    initialSummary?: MediaMetadataSummary | null;
    initialParams?: MediaParamItem[];
    initialRawBytes?: Uint8Array;
    hostOverride?: unknown;
}
export declare function MediaMetadataCommand(props?: MediaMetadataCommandProps): JSX.Element;
export default MediaMetadataCommand;
