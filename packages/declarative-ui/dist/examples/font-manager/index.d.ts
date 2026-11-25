import type { FontLicenseFilter, SystemFontInfo } from './types.js';
export * from './types.js';
export * from './font-service.js';
export interface FontManagerCommandProps {
    featureCode?: string;
    initialFonts?: SystemFontInfo[];
    initialFilter?: FontLicenseFilter;
    initialSampleText?: string;
    hostOverride?: unknown;
}
export declare function FontManagerCommand(props?: FontManagerCommandProps): JSX.Element;
export default FontManagerCommand;
