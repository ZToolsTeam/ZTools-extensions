import type { ProxyStatus, SshHostEntry } from './types.js';
export * from './types.js';
export * from './ssh-proxy-service.js';
export interface SshProxyHelperCommandProps {
    featureCode?: string;
    initialHosts?: SshHostEntry[];
    initialProxyStatus?: ProxyStatus;
    hostOverride?: unknown;
}
export declare function SshProxyHelperCommand(props?: SshProxyHelperCommandProps): JSX.Element;
export default SshProxyHelperCommand;
