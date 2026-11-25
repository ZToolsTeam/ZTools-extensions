import type { HostsProfile } from './types.js';
export * from './types.js';
export * from './hosts-service.js';
export declare function HostsProfileForm({ initialProfile, onSave }: {
    initialProfile?: HostsProfile;
    onSave: (profile: HostsProfile) => void;
}): JSX.Element;
export interface HostsSwitcherCommandProps {
    featureCode?: string;
    initialProfiles?: HostsProfile[];
    hostOverride?: unknown;
}
export declare function HostsSwitcherCommand(props?: HostsSwitcherCommandProps): JSX.Element;
export default HostsSwitcherCommand;
