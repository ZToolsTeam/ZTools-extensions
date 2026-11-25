import { GithubDashboardItem } from "./types.js";
export * from "./types.js";
export * from "./data.js";
/**
 * GitHub Personal Access Token / BYOK 配置表单
 */
export declare function GithubTokenForm({ onSaved }: {
    onSaved?: () => void;
}): JSX.Element;
/**
 * GitHub 详情视图 (现代纯正 TSX 模式)
 */
export declare function GithubDetailView({ item, onUpdate }: {
    item: GithubDashboardItem;
    onUpdate?: (updated: GithubDashboardItem) => void;
}): JSX.Element;
/**
 * GitHub 仪表盘主命令 (现代纯正 TSX 模式)
 */
export default function GithubDashboardCommand(): JSX.Element;
