import type { LanDevice, NetworkInterfaceInfo } from './types.js';
export declare function normalizeMacAddress(rawMac: string): string;
export declare function lookupOuiVendor(mac?: string): string;
/**
 * 构造符合 IEEE 802.3 规范的 102 字节 Wake-on-LAN 魔术包（6 字节 0xFF + 16 组 6 字节 MAC）
 */
export declare function buildWolMagicPacketBytes(mac: string): Uint8Array;
export declare function parseArpTableOutput(arpOutput: string): LanDevice[];
export declare function detectActiveInterfaces(options?: {
    simulateOffline?: boolean;
}, hostOverride?: unknown): Promise<NetworkInterfaceInfo[]>;
export declare function scanSubnet(iface?: NetworkInterfaceInfo, options?: {
    simulateOffline?: boolean;
}, hostOverride?: unknown): Promise<LanDevice[]>;
export declare function sendWakeOnLan(mac: string, broadcastIp?: string, options?: {
    dryRun?: boolean;
}, hostOverride?: unknown): Promise<{
    success: boolean;
    byteLength: number;
    packetHex: string;
}>;
