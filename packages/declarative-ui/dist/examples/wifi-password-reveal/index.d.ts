import type { WifiProfileInfo } from './types.js';
export * from './types.js';
export * from './wifi-service.js';
export declare function WifiDetailView({ profile, hostOverride }: {
    profile: WifiProfileInfo;
    hostOverride?: unknown;
}): JSX.Element;
export declare function WifiPasswordRevealCommand(props?: {
    featureCode?: string;
    hostOverride?: unknown;
}): JSX.Element;
export default WifiPasswordRevealCommand;
