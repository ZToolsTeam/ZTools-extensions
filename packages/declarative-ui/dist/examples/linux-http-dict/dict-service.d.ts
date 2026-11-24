import type { HttpStatusItem, LinuxCommandItem, PortItem } from './types.js';
export declare const LINUX_COMMANDS_DICT: LinuxCommandItem[];
export declare const HTTP_STATUS_DICT: HttpStatusItem[];
export declare const COMMON_PORTS_DICT: PortItem[];
export declare function searchLinuxCommands(query: string): LinuxCommandItem[];
export declare function searchHttpStatus(query: string): HttpStatusItem[];
export declare function searchCommonPorts(query: string): PortItem[];
