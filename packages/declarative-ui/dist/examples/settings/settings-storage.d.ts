/**
 * Raycast Settings 偏好设置存取与校验引擎
 * 支持与 LocalStorage / window.ztools.config 联动，严格校验并防御恶意/损坏配置
 * 真实双向绑定：变更即时存盘至 LocalStorage 并协同写入配置
 */
import { ZToolsGlobalPreferences, SettingsSectionMetadata, ExtensionConfigItem } from "./types.js";
export declare const SETTINGS_STORAGE_KEY = "ztools_global_preferences_v1";
/**
 * ZTools 官方内置扩展清单
 */
export declare const BUILTIN_EXTENSIONS: readonly ExtensionConfigItem[];
/**
 * 已下线的内置扩展 ID：旧版本存下的配置里如果还有，读取时直接丢弃，不再显示
 */
export declare const RETIRED_BUILTIN_EXTENSION_IDS: readonly string[];
/** 本地模型默认地址：Ollama 11434、LM Studio 1234 */
export declare const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
export declare const DEFAULT_LM_STUDIO_ENDPOINT = "http://127.0.0.1:1234";
export declare const DEFAULT_PREFERENCES: ZToolsGlobalPreferences;
/**
 * 系统设置分类元数据（8 个分类）
 */
export declare const SETTINGS_SECTIONS: SettingsSectionMetadata[];
export declare function sanitizePreferences(rawInput: unknown): ZToolsGlobalPreferences;
/**
 * 读取偏好设置
 */
export declare function getPreferences(): Promise<ZToolsGlobalPreferences>;
/**
 * 真实双向绑定存盘：写入 LocalStorage 并联动宿主
 */
export declare function savePreferences(patch: Partial<ZToolsGlobalPreferences>): Promise<ZToolsGlobalPreferences>;
/**
 * 更新单一扩展的配置（启用/禁用、别名、热键）
 */
export declare function updateExtensionConfig(extId: string, patch: Partial<ExtensionConfigItem>): Promise<ZToolsGlobalPreferences>;
/**
 * 获取本地 SQLite 缓存体积 (字节数与人类可读格式)
 */
export declare function getSqliteCacheInfo(): Promise<{
    sizeBytes: number;
    formattedSize: string;
}>;
/**
 * 一键清空本地 SQLite 缓存
 */
export declare function clearSqliteCache(): Promise<{
    clearedBytes: number;
    remainingBytes: number;
}>;
/**
 * 偏好设置更新特定 Section
 */
export declare function updatePreferenceSection<K extends keyof ZToolsGlobalPreferences>(sectionKey: K, data: Partial<ZToolsGlobalPreferences[K]>): Promise<ZToolsGlobalPreferences>;
/**
 * 重置出厂默认
 */
export declare function resetPreferences(): Promise<ZToolsGlobalPreferences>;
/**
 * 导出配置 JSON 字符串
 */
export declare function exportPreferencesJson(): Promise<string>;
/**
 * 导入配置并防御损坏格式（安全包裹，返回统一契约对象）
 */
export declare function importPreferencesJson(rawJson: string): Promise<{
    success: boolean;
    preferences?: ZToolsGlobalPreferences;
    error?: string;
}>;
/**
 * 根据关键字过滤设置分类
 */
export declare function filterSettingsSections(query: string): SettingsSectionMetadata[];
