/**
 * Navigation (窗口切换与顶部菜单栏搜索中枢)
 *
 * 深度对齐 Raycast 官方 `navigation` 套件 (`Switch Windows` & `Search Menu Items`)：
 * - Switch Windows: 枚举当前桌面所有打开的活动窗口（含标题、所属应用、PID、显示器与状态），一键聚焦置顶或关闭窗口
 * - Search Menu Items: 搜索当前前台应用顶部菜单栏（macOS Menu Bar / Windows 应用菜单树），模糊匹配并一键触发原生点击
 */
export type NavigationFilterMode = "all" | "windows" | "menus";
export interface NavigationWindowItem {
    readonly id: string;
    readonly handle: string;
    readonly title: string;
    readonly appName: string;
    readonly pid: number;
    readonly bundleId?: string;
    readonly isMinimized?: boolean;
    readonly isFocused?: boolean;
    readonly workspace?: string;
}
export interface NavigationMenuItem {
    readonly id: string;
    readonly label: string;
    readonly path: readonly string[];
    readonly appName: string;
    readonly shortcut?: string;
    readonly enabled: boolean;
}
export declare const DEFAULT_NAVIGATION_WINDOWS: readonly NavigationWindowItem[];
export declare const DEFAULT_NAVIGATION_MENU_ITEMS: readonly NavigationMenuItem[];
/**
 * 获取当前系统活动窗口列表（优先调用 navigation_list_windows IPC）
 */
export declare function fetchNavigationWindows(query?: string, hostOverride?: any): Promise<NavigationWindowItem[]>;
/**
 * 激活并聚焦指定窗口（优先调用 navigation_activate_window / navigation_switch_window IPC）
 */
export declare function activateNavigationWindow(handleOrId: string, hostOverride?: any): Promise<{
    ok: boolean;
    message: string;
}>;
/**
 * 对选中窗口执行快捷分屏/布局管理（先激活目标窗口，再调用 window_manage IPC）
 */
export declare function manageNavigationWindow(handleOrId: string, preset: "left_half" | "right_half" | "maximize" | "center", hostOverride?: any): Promise<{
    ok: boolean;
    message: string;
}>;
/**
 * 关闭指定窗口（优先调用 navigation_close_window IPC）
 */
export declare function closeNavigationWindow(handleOrId: string, hostOverride?: any): Promise<{
    ok: boolean;
    message: string;
}>;
/**
 * 搜索当前前台应用的顶部菜单栏条目（优先调用 navigation_search_menu_items IPC）
 */
export declare function searchNavigationMenuItems(query?: string, hostOverride?: any): Promise<NavigationMenuItem[]>;
/**
 * 触发点击指定应用菜单项（优先调用 navigation_click_menu_item IPC）
 */
export declare function triggerNavigationMenuItem(menuItem: {
    id?: string;
    appName?: string;
    path?: readonly string[];
}, hostOverride?: any): Promise<{
    ok: boolean;
    message: string;
}>;
export declare const fetchActiveWindows: typeof fetchNavigationWindows;
export declare const switchToWindow: typeof activateNavigationWindow;
export declare const closeAppWindow: typeof closeNavigationWindow;
export declare const fetchMenuBars: typeof searchNavigationMenuItems;
export declare const triggerMenuItem: typeof triggerNavigationMenuItem;
export declare function NavigationWindowDetailView({ win }: {
    win: NavigationWindowItem;
}): JSX.Element;
/** 宿主返回的错误是否是缺少辅助功能等系统权限 */
export declare function isNavigationPermissionError(error: unknown): boolean;
/**
 * 汇总窗口列表与菜单查询的失败信息；都成功时返回 null。
 * 任何一侧是权限错误时提示去授权辅助功能（重试无用，必须用户在系统设置里授权）。
 */
export declare function describeNavigationFailure(windowError: unknown, menuError: unknown): {
    title: string;
    message: string;
} | null;
export declare function NavigationCommand(): JSX.Element;
export default NavigationCommand;
