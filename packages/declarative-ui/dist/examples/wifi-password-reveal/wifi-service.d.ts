import { FetchWifiProfilesOptions, WifiParseDetailResult, WifiProfileInfo, WifiSecurityFilter, WifiSecurityType, WifiSortBy } from './types.js';
export declare const SAMPLE_WIFI_PROFILES: readonly WifiProfileInfo[];
export declare function parseNetshWlanProfiles(output: string): string[];
export declare const parseWindowsWlanProfiles: typeof parseNetshWlanProfiles;
export declare function normalizeSecurityType(rawAuth: string): WifiSecurityType;
export declare function parseWindowsWlanProfileDetail(ssidInput: string, output: string): WifiParseDetailResult;
export declare function parseWifiInterface(output: string): string;
export declare function escapeWifiQrField(value: string): string;
export declare function generateWifiQrString(ssid: string, password?: string, authType?: WifiSecurityType): string;
export declare function generateWifiQrSvgDataUrl(profile: WifiProfileInfo): string;
export declare function filterAndSortWifiProfiles(profiles: readonly WifiProfileInfo[], options?: {
    query?: string;
    securityFilter?: WifiSecurityFilter;
    sortBy?: WifiSortBy;
}): WifiProfileInfo[];
export declare function revealWifiPasswordFromHost(ssid: string, hostOverride?: unknown): Promise<string>;
export declare function fetchSavedWifiProfiles(options?: FetchWifiProfilesOptions): Promise<WifiProfileInfo[]>;
