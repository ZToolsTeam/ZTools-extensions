import { ApplicationRecord } from "./types.js";
import { ApplicationsManager } from "./applications-service.js";
export * from "./types.js";
export * from "./applications-service.js";
/**
 * 应用程序详情视图 (Markdown 正文 + 右侧 Metadata 侧边栏)
 */
export declare function AppDetailView({ app, manager }: {
    app: ApplicationRecord;
    manager?: ApplicationsManager;
}): JSX.Element;
/**
 * 根命令：已安装应用程序管理中枢
 */
export default function ApplicationsCommand({ manager }?: {
    manager?: ApplicationsManager;
}): JSX.Element;
