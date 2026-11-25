/**
 * Windows Screenshots (截图捕获参数与截图历史回贴工作台 - 布局三)
 *
 * 严格遵循 ZTools 效率工具箱【布局三：左 34% 参数配置工作台 + 右 66% 任务队列/结果工作台】规范：
 * - 左栏 34% workbenchPanel：配置捕获区域模式、输出图像格式、截图后自动动作、窗口阴影边框、自动哈希去重 + previewCard
 * - 右栏 66% subList：本机扫描到的截图文件可勾选队列（支持一键回贴到活动窗口 Enter、复制图片到剪贴板 Ctrl+Enter、定位、批量清理）
 * - 100% 保留 ScreenshotsCommand, ScreenshotDetailView, ScreenshotsManager, defaultScreenshotsManager 导出
 */
import { ScreenshotItem } from "./types.js";
import { defaultScreenshotsManager, ScreenshotsManager, generateScreenshotThumbnailSvg, INITIAL_SCREENSHOTS } from "./screenshots-service.js";
export * from "./types.js";
export * from "./screenshots-service.js";
export { ScreenshotsManager, defaultScreenshotsManager, generateScreenshotThumbnailSvg, INITIAL_SCREENSHOTS };
/**
 * 独立单项详情查看页 (供导航栈或独立路由调用)
 */
export declare function ScreenshotDetailView({ item }: {
    item: ScreenshotItem;
}): JSX.Element;
export declare function ScreenshotsCommand(): JSX.Element;
export default ScreenshotsCommand;
