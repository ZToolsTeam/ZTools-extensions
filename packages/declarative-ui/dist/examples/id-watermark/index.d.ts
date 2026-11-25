import type { ImageMetadata } from './types.js';
export * from './types.js';
export * from './watermark-service.js';
export interface IdWatermarkCommandProps {
    featureCode?: string;
    initialImageMeta?: ImageMetadata | null;
    initialBusinessName?: string;
    initialOpacityPercent?: number;
}
export declare function IdWatermarkCommand(props?: IdWatermarkCommandProps): JSX.Element;
export default IdWatermarkCommand;
