export interface NavigationHandler {
    push: (target: any) => void;
    pop: () => void;
}
export declare function setActiveNavigation(nav: NavigationHandler | null): void;
/**
 * useNavigation Hook
 */
export declare function useNavigation(): NavigationHandler;
