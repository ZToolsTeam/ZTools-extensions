import { ViewDescriptor } from "../descriptors/types.js";
import { NavigationHandler } from "../api/navigation.js";
export type EffectCleanup = () => void;
export type EffectCallback = () => void | EffectCleanup | Promise<void>;
export interface HookRecord {
    type: "state" | "effect" | "memo" | "ref";
    value?: any;
    setter?: (newVal: any) => void;
    deps?: any[];
    cleanup?: EffectCleanup;
}
export interface DeclarativeRenderInstanceOptions {
    onUpdate?: (descriptor: ViewDescriptor) => void;
    onRenderEmpty?: () => void;
    onRenderEvent?: (event: {
        type: "renderTree";
        descriptor: ViewDescriptor;
    } | {
        type: "renderEmpty";
    }) => void;
    navigation?: NavigationHandler;
}
export declare function areViewTreesEqual(a: any, b: any): boolean;
export declare class DeclarativeRenderInstance {
    private component;
    private hooks;
    private currentHookIndex;
    private isQueued;
    private isMounted;
    private latestDescriptor;
    private emptyRenderCount;
    private hasWarnedInfiniteLoop;
    private onUpdateCallback?;
    private onRenderEmptyCallback?;
    private onRenderEventCallback?;
    private navigationHandler?;
    constructor(component: () => any, options?: DeclarativeRenderInstanceOptions);
    get hookIndex(): number;
    set hookIndex(idx: number);
    getHooks(): HookRecord[];
    getLatestDescriptor(): ViewDescriptor | null;
    getEmptyRenderCount(): number;
    hasInfiniteLoopWarning(): boolean;
    scheduleRender(): void;
    executeRender(): ViewDescriptor;
    private runPendingEffects;
    unmount(): void;
}
export declare let currentInstance: DeclarativeRenderInstance | null;
export declare let isEvaluatingChildElement: boolean;
export declare function setCurrentInstance(instance: DeclarativeRenderInstance | null): DeclarativeRenderInstance | null;
export declare function setEvaluatingChildElement(flag: boolean): boolean;
