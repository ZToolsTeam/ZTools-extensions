import { ViewDescriptor } from "../descriptors/types.js";
import { DeclarativeRenderInstance } from "./context.js";
import { NavigationHandler } from "../api/navigation.js";
export interface DeclarativeRootOptions {
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
export interface DeclarativeRoot {
    getLatest(): ViewDescriptor;
    forceRender(): ViewDescriptor;
    unmount(): void;
    getInstance(): DeclarativeRenderInstance;
}
/**
 * 挂载并执行声明式根组件
 */
export declare function renderDeclarativeRoot(component: () => any, options?: DeclarativeRootOptions): DeclarativeRoot;
