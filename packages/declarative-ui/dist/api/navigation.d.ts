export interface NavigationHandler {
    push: (target: any) => void;
    /** 宿主返回 true 表示本页面已移出栈，运行时应立即停止本轮副作用。 */
    pop: () => boolean | void;
}
export declare function setActiveNavigation(nav: NavigationHandler | null): NavigationHandler | null;
/**
 * useNavigation Hook
 */
export declare function useNavigation(): {
    push: (target: unknown) => void;
    pop: () => void;
};
