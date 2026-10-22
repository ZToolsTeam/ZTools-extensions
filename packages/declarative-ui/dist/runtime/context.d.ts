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
    /**
     * 弹出独立窗口时由宿主交来的 usePopoutState 初值（key → 值，必须是纯 JSON）。
     * 每个 key 只在对应 hook 首次执行时用一次；没有被用到的 key 随实例卸载丢弃。
     */
    handoffSeed?: Record<string, unknown> | null;
}
export interface CollectedPopoutEntry {
    key: string;
    value: unknown;
    /** 插件声明值里引用的本地路径（只做了类型过滤，长度 / 是否绝对路径由宿主校验） */
    paths: string[];
}
export interface CollectedPopoutState {
    entries: CollectedPopoutEntry[];
    /** paths 函数抛错或返回了非数组的 key：整项不带，避免带着状态却丢了授权 */
    rejected: string[];
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
    private popoutSeed;
    private popoutRegistry;
    constructor(component: () => any, options?: DeclarativeRenderInstanceOptions);
    /** 取出并删除某个 key 的交接初值（只用一次） */
    consumePopoutSeed(key: string): {
        found: true;
        value: unknown;
    } | {
        found: false;
    };
    /** 登记 usePopoutState；同一实例里 key 重复时只保留第一个，返回 false */
    registerPopoutState(key: string, index: number, paths?: (value: any) => unknown): boolean;
    /** 读取当前登记的状态最新值（独立窗口弹出前调用） */
    collectPopoutState(): CollectedPopoutState;
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
