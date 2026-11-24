import { WingetPackage } from "./packages.js";
export * from "./packages.js";
/**
 * 查看软件包详情视图 (现代纯正 TSX 模式)
 */
export declare function WingetDetailView({ pkg, onPackageUpdated }: {
    pkg: WingetPackage;
    onPackageUpdated?: (updated: WingetPackage) => void;
}): JSX.Element;
/**
 * Winget 包管理器前端主命令 (现代纯正 TSX 模式)
 */
export default function WingetCommand(): JSX.Element;
