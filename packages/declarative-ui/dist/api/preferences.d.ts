/**
 * preferences.ts
 * Raycast 兼容扩展用户配置读取 API
 */
/**
 * 获取当前扩展的用户偏好配置项 (Preferences)
 */
export declare function getPreferenceValues<T = Record<string, any>>(): T;
/**
 * 宿主/测试设置偏好项注入值
 */
export declare function setPreferenceValues(prefs: Record<string, any>): void;
/**
 * 清空配置存储（供测试或扩展重置）
 */
export declare function clearPreferenceValues(): void;
