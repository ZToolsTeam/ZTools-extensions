/**
 * Homebrew (macOS Formulae & Casks 极客包管理工作台)
 *
 * 深度对齐 Raycast 官方 `brew` 套件（对标 Windows 端 `winget`）：
 * - 支持检索、安装、升级、卸载 Homebrew Formulae (CLI) 与 Casks (GUI 应用)
 * - 顶部 <List.Dropdown> 筛选：all / installed / outdated / formula / cask
 * - 对接主进程 `brew_exec` 安全受控通道（action: list | search | info | outdated | install | upgrade | uninstall | cleanup）
 */
export type HomebrewFilterCategory = "all" | "installed" | "outdated" | "formula" | "cask";
export interface HomebrewPackage {
    readonly name: string;
    readonly fullName: string;
    readonly type: "formula" | "cask";
    readonly installedVersion?: string;
    readonly latestVersion: string;
    readonly outdated: boolean;
    readonly pinned?: boolean;
    readonly description: string;
    readonly homepage: string;
    readonly license: string;
    readonly tap: string;
    readonly dependencies: readonly string[];
}
export declare const SAMPLE_HOMEBREW_PACKAGES: readonly HomebrewPackage[];
export declare function getBrewCliCommand(action: "install" | "upgrade" | "uninstall" | "cleanup", pkg?: HomebrewPackage | {
    name: string;
    type?: "formula" | "cask";
}): string;
export declare function filterHomebrewPackages(packages: readonly HomebrewPackage[], query?: string, category?: HomebrewFilterCategory): HomebrewPackage[];
/**
 * 调用主进程 `brew_exec` 安全受控通道执行 Homebrew / 本机包管理器操作
 */
export declare function executeHomebrewAction(action: "list" | "search" | "info" | "outdated" | "install" | "upgrade" | "uninstall" | "cleanup" | "doctor", options?: {
    pkg?: string;
    cask?: boolean;
    query?: string;
}, hostOverride?: any): Promise<{
    ok: boolean;
    message: string;
    packages?: HomebrewPackage[];
    output?: string;
}>;
export declare function searchBrewPackages(query?: string, category?: HomebrewFilterCategory, hostOverride?: any): Promise<HomebrewPackage[]>;
export declare const installBrewPackage: (pkg: string, cask?: boolean, hostOverride?: any) => Promise<{
    ok: boolean;
    message: string;
    packages?: HomebrewPackage[];
    output?: string;
}>;
export declare const upgradeBrewPackage: (pkg: string, cask?: boolean, hostOverride?: any) => Promise<{
    ok: boolean;
    message: string;
    packages?: HomebrewPackage[];
    output?: string;
}>;
export declare const uninstallBrewPackage: (pkg: string, cask?: boolean, hostOverride?: any) => Promise<{
    ok: boolean;
    message: string;
    packages?: HomebrewPackage[];
    output?: string;
}>;
export declare const runBrewCleanup: (hostOverride?: any) => Promise<{
    ok: boolean;
    message: string;
    packages?: HomebrewPackage[];
    output?: string;
}>;
export declare const runBrewDoctor: (hostOverride?: any) => Promise<{
    ok: boolean;
    message: string;
    packages?: HomebrewPackage[];
    output?: string;
}>;
export declare function HomebrewDetailView({ pkg, onPackageMutated }: {
    pkg: HomebrewPackage;
    onPackageMutated?: (updated: HomebrewPackage) => void;
}): JSX.Element;
export declare function HomebrewCommand(): JSX.Element;
export default HomebrewCommand;
