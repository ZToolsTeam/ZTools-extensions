import type { DocFontSize, StylePreset } from './types.js';
export * from './types.js';
export * from './md-to-office-service.js';
export interface MdToOfficeCommandProps {
    featureCode?: string;
    initialMarkdown?: string;
    initialPreset?: StylePreset;
    initialFontSize?: DocFontSize;
    hostOverride?: unknown;
}
export declare function MdToOfficeCommand(props?: MdToOfficeCommandProps): JSX.Element;
export default MdToOfficeCommand;
