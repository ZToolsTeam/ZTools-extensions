import type { LanDevice, NetworkInterfaceInfo } from './types.js';
export * from './types.js';
export * from './lan-service.js';
export interface LanScannerCommandProps {
    featureCode?: string;
    initialInterfaces?: NetworkInterfaceInfo[];
    initialDevices?: LanDevice[];
    hostOverride?: unknown;
}
export declare function LanScannerCommand(props?: LanScannerCommandProps): JSX.Element;
export default LanScannerCommand;
