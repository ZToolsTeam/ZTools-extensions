/**
 * environment.ts
 * Raycast 兼容扩展运行环境信息对象
 */
export interface Environment {
    /** 扩展标识符名称 */
    extensionName: string;
    /** 当前执行的命令标识 */
    commandName: string;
    /** 命令模式: view (UI 视图) | no-view (后台命令) | menu-bar */
    commandMode: "view" | "no-view" | "menu-bar";
    /** 是否为本地开发调试模式 */
    isDevelopment: boolean;
    /** 插件私有持久化支持目录路径 */
    supportPath: string;
    /** 插件静态资产目录路径 */
    assetsPath: string;
    /** 界面字体缩放级别 */
    textSize?: "small" | "medium" | "large";
    /** 当前宿主主题 */
    theme: "light" | "dark";
}
/**
 * 获取当前命令运行时的环境上下文
 */
export declare const environment: Environment;
/**
 * 宿主/测试配置当前扩展环境
 */
export declare function setEnvironment(env: Partial<Environment>): void;
