export * from './types.js';
export * from './cheatsheet-data.js';
export * from './hotkey-service.js';
export interface HotkeyRadarCommandProps {
    featureCode?: string;
    hostOverride?: unknown;
}
export declare function HotkeyRadarCommand(props?: HotkeyRadarCommandProps): JSX.Element;
export default HotkeyRadarCommand;
