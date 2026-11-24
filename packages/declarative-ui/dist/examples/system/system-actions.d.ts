/**
 * Windows 原生运维动作集合 (System Actions Definition)
 * 参考常见启动器的系统命令集自研实现
 * 包含电源与会话、进程与桌面治理、音频与硬件控制、维护与通知 4 大分类 20+ 项指令
 */
import { Icon } from "../../constants/icons.js";
export type SystemCategory = 'power' | 'apps' | 'audio' | 'maintenance' | 'desktop' | 'process';
export interface SystemActionItem {
    id: string;
    actionKey: string;
    title: string;
    subtitle: string;
    description: string;
    category: SystemCategory;
    icon: Icon | string;
    destructive?: boolean;
    shortcut?: string;
    keywords?: string[];
    requiresConfirmation?: boolean;
    confirmationMessage?: string;
    technicalDetails?: string;
}
export declare const SYSTEM_ACTIONS: readonly SystemActionItem[];
/**
 * 智能过滤系统运维指令
 */
export declare function filterSystemActions(query: string, category?: string): SystemActionItem[];
/**
 * 执行系统原生运维调度
 */
export declare function executeSystemAction(itemOrId: SystemActionItem | string, options?: {
    force?: boolean;
    confirmBypass?: boolean;
    hostOverride?: any;
}): Promise<{
    success: boolean;
    executed: boolean;
    message: string;
}>;
