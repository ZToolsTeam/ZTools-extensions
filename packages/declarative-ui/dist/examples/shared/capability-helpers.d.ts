export interface SharedCapabilityItem {
    id: string;
    title: string;
    subtitle: string;
    tag: string;
    method: string;
    params: Record<string, unknown>;
}
export interface SharedInvocationResult {
    ok: boolean;
    pluginName: string;
    method: string;
    data?: unknown;
    error?: string;
    fromFallback?: boolean;
}
export declare function cloneCapabilityItems<T extends SharedCapabilityItem>(items: readonly T[]): T[];
export declare function filterCapabilityList<T extends SharedCapabilityItem>(items: T[], query: string): T[];
export declare function validateCapabilityArgs(method: string, params: unknown, forbiddenPattern: RegExp, forbiddenReason: string): {
    valid: boolean;
    error?: string;
};
export declare function invokeValidatedDllCapability(pluginName: string, method: string, params: Record<string, unknown>, forbiddenPattern: RegExp, forbiddenReason: string, hostBridge?: unknown): Promise<SharedInvocationResult>;
