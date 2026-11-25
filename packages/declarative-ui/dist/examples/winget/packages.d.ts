export interface WingetPackage {
    id: string;
    name: string;
    publisher: string;
    installedVersion: string | null;
    latestVersion: string;
    status: "installed" | "upgradable" | "available";
    description: string;
    tags: string[];
    license: string;
    homepage: string;
    architecture: "x64" | "ARM64" | "Neutral";
    source?: string;
}
export declare const SAMPLE_WINGET_PACKAGES: WingetPackage[];
export declare function filterWingetPackages(packages: WingetPackage[], query: string, filterType: string): WingetPackage[];
export declare function installWingetPackage(packages: WingetPackage[], id: string): WingetPackage[];
export declare function upgradeWingetPackage(packages: WingetPackage[], id: string): WingetPackage[];
export declare function uninstallWingetPackage(packages: WingetPackage[], id: string): WingetPackage[];
