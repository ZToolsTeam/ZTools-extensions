/**
 * Raycast Settings 系统偏好设置类型契约
 * 对标 Raycast 官方设置规范与 ZTools 极客架构要求
 */
export type ThemeMode = "auto" | "dark" | "light";
export type WindowMode = "compact" | "expanded";
export type SearchSortAlgorithm = "frecency" | "alphabetical" | "usage_count";
export type NavigationStyle = "default" | "vim" | "emacs";
export type SyncProvider = "disabled" | "webdav" | "gist";
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface GeneralSettings {
    theme: ThemeMode;
    openAtLogin: boolean;
    autoHideOnBlur: boolean;
    windowMode: WindowMode;
    showInTray: boolean;
    globalHotkey: string;
    acrylicEffect: boolean;
}
export interface LauncherSettings {
    sortAlgorithm: SearchSortAlgorithm;
    maxHistoryItems: number;
    searchSensitivity: number;
    enableFrecencyDecay: boolean;
    enableFileSearch: boolean;
    fallbackToWebSearch: boolean;
}
export interface ShortcutItem {
    id: string;
    name: string;
    commandId: string;
    hotkey?: string;
    alias?: string;
    enabled: boolean;
}
export interface ExtensionConfigItem {
    id: string;
    name: string;
    description: string;
    category: "core" | "utility" | "developer" | "productivity" | "system";
    enabled: boolean;
    alias?: string;
    hotkey?: string;
    isBuiltin: boolean;
}
export interface KeyboardSettings {
    navigationStyle: NavigationStyle;
    hyperKeyModifier: string;
    popToRootOnClose: boolean;
    escBehavior: "pop_step" | "instant_hide";
    enterKeyPrimary: boolean;
}
export interface CloudSyncSettings {
    provider: SyncProvider;
    serverUrl?: string;
    username?: string;
    syncPassword?: string;
    gistToken?: string;
    gistId?: string;
    autoSyncIntervalMinutes: number;
    lastSyncTimestamp?: number;
    e2eeEnabled: boolean;
}
export interface AdvancedSettings {
    proxyMode: "system" | "none" | "manual";
    proxyUrl?: string;
    logLevel: LogLevel;
    rustSidecarPath?: string;
    enableUiaAccess: boolean;
    enableGpuPowerSaving: boolean;
    developerMode: boolean;
    sqliteCacheSizeBytes?: number;
    lastBackupTime?: string;
}
/** AI 本地模型地址（Ollama / LM Studio）；API Key 属于密钥，不放在普通偏好设置里 */
export interface AiSettings {
    ollamaEndpoint: string;
    lmStudioEndpoint: string;
}
export interface AboutSettings {
    version: string;
    buildNumber: string;
    electronVersion: string;
    vueVersion: string;
    rustSidecarVersion: string;
    updateChannel: "stable" | "beta" | "nightly";
    autoCheckUpdate: boolean;
}
export interface ZToolsGlobalPreferences {
    general: GeneralSettings;
    launcher: LauncherSettings;
    shortcuts: ShortcutItem[];
    extensions: ExtensionConfigItem[];
    keyboard: KeyboardSettings;
    cloudSync: CloudSyncSettings;
    advanced: AdvancedSettings;
    ai: AiSettings;
    about: AboutSettings;
    hotkey?: string;
    theme?: string;
    fontSize?: number;
    walCacheSizeMb?: number;
    telemetry?: boolean;
    language?: string;
}
export type SettingsSectionKey = "general" | "launcher" | "shortcuts" | "extensions" | "keyboard" | "cloud_sync" | "advanced" | "ai" | "about";
export type SettingsMainTab = "general" | "extensions" | "shortcuts" | "advanced" | "about";
export interface SettingsSectionMetadata {
    id?: string;
    key: SettingsSectionKey;
    title: string;
    description: string;
    iconName: string;
    keywords: string[];
}
