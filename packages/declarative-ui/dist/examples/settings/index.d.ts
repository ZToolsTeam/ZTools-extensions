import { ZToolsGlobalPreferences, SettingsSectionKey, ExtensionConfigItem, GeneralSettings } from "./types.js";
export * from "./types.js";
export * from "./settings-storage.js";
/**
 * 扩展独立配置与热键别名表单
 */
export declare function ExtensionConfigForm(props: {
    extension: ExtensionConfigItem;
    onSaved: (updated: ExtensionConfigItem) => void;
}): JSX.Element;
/**
 * 常规设置表单 (General Settings Form)
 */
export declare function GeneralSettingsForm(props: {
    initial: GeneralSettings;
    onSaved: (updated: GeneralSettings) => void;
}): JSX.Element;
/**
 * 兼容旧版的设置项编辑表单视图
 */
export declare function SettingsFormView(props: {
    sectionKey: SettingsSectionKey;
    initialPreferences: ZToolsGlobalPreferences;
    onSaved: (updated: ZToolsGlobalPreferences) => void;
}): JSX.Element;
/**
 * ZTools 系统偏好设置中心主入口
 * 对标 Raycast Settings 规范，5 大分组交互式治理中心
 */
export default function SettingsCommand(): JSX.Element;
