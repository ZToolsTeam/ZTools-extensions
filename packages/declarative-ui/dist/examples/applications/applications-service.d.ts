import { ApplicationRecord, ApplicationCategory, ApplicationActionResult } from "./types.js";
export declare function computePinyin(name: string): {
    pinyin: string;
    initials: string;
};
/**
 * 标杆内置应用程序全景库 (涵盖 Win32 用户自装、UWP 现代化应用、Windows 核心系统工具)
 */
export declare const INITIAL_APPLICATIONS: ApplicationRecord[];
export declare class ApplicationsManager {
    private apps;
    private mapHostAppRecord;
    /**
     * 从宿主同步真实已安装应用列表 (Windows 注册表/Appx 或 macOS mdfind/system_profiler + ~/Library 残留分析)
     */
    syncFromHost(forceRefresh?: boolean, hostOverride?: unknown): Promise<ApplicationRecord[]>;
    getApplications(forceRefresh?: boolean, hostOverride?: unknown): Promise<ApplicationRecord[]>;
    filterAndSearch(apps: ApplicationRecord[], query: string, category: ApplicationCategory): ApplicationRecord[];
    openApplication(app: ApplicationRecord, options?: {
        runAsAdmin?: boolean;
    }, hostOverride?: unknown): Promise<ApplicationActionResult>;
    revealApplication(app: ApplicationRecord, hostOverride?: unknown): Promise<ApplicationActionResult>;
    terminateApplication(app: ApplicationRecord, force?: boolean): Promise<ApplicationActionResult>;
    restartApplication(app: ApplicationRecord): Promise<ApplicationActionResult>;
    uninstallApplication(app: ApplicationRecord, hostOverride?: unknown): Promise<ApplicationActionResult>;
    toggleGameStatus(app: ApplicationRecord): ApplicationActionResult;
    toggleAutoQuit(app: ApplicationRecord): ApplicationActionResult;
}
export declare const defaultApplicationsManager: ApplicationsManager;
