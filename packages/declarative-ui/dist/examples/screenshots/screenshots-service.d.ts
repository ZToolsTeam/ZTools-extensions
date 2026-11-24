import { ScreenshotItem, ScreenshotCategory, ScreenshotActionResult } from "./types.js";
/**
 * 从真实图片头部字节流解析真实像素宽高 (支持 PNG / GIF / BMP / JPEG / WebP)
 */
export declare function parseImageDimensionsFromBytes(bytes: Uint8Array): {
    width: number;
    height: number;
} | null;
/**
 * 生成轻量且逼真的 SVG 缩略图数据 URL (用于双栏详情展示)
 */
export declare function generateScreenshotThumbnailSvg(label: string, width: number, height: number, accentColor?: string): string;
/**
 * 初始高频基准截图数据集（仅用于无宿主离线快照回退）
 */
export declare const INITIAL_SCREENSHOTS: ScreenshotItem[];
export declare class ScreenshotsManager {
    private items;
    private pinnedSet;
    private scanned;
    private mapHostScreenshot;
    /**
     * 立即截取当前屏幕并加入截图历史 (调用宿主 screen_capture IPC)
     */
    captureScreenNow(optionsOrHost?: {
        captureRegionMode?: string;
        imageFormat?: string;
        postCaptureAction?: string;
        includeWindowShadow?: boolean;
        autoHashDedupe?: boolean;
    } | any, hostOverride?: any): Promise<ScreenshotActionResult>;
    /**
     * 探测系统默认截图目录 (支持 Windows Pictures/Screenshots 与 macOS Desktop / Pictures)
     */
    getDefaultLocations(): readonly string[];
    /**
     * 扫描真实截图文件并解析图片宽高
     */
    scanRealScreenshots(hostOverride?: any): Promise<ScreenshotItem[]>;
    /**
     * 扫描系统磁盘中的截图文件 (优先通过 screenshots_scan IPC 调用主进程扫描，或扫描真实 Pictures / Desktop 目录并解析真实图片文件头尺寸)
     */
    loadScreenshots(forceRefresh?: boolean, hostOverride?: any): Promise<ScreenshotItem[]>;
    /**
     * 搜索与筛选截图 (支持文件名、路径以及 OCR 提取文字过滤)
     */
    filterScreenshots(items: ScreenshotItem[], query: string, category?: ScreenshotCategory): ScreenshotItem[];
    /**
     * 提取指定截图的真实 OCR 文字并写入剪贴板
     * 接入 invokePluginService('OcrPlugin', 'recognizeImage', { path: item.path }, hostBridge)
     * 彻底删除返回假文本 `系统自动提取文件文本 [${item.title}]` 的逻辑
     */
    extractOcr(item: ScreenshotItem, hostOverride?: any): Promise<string>;
    /**
     * 粘贴截图到当前活动窗口 (Paste to Active Window)
     * 接入 callHostTransport('clipboard_hide_and_paste_file', { filePath: item.path }, hostBridge)
     */
    pasteToActiveWindow(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult>;
    /**
     * 快速回贴最新一张截图 (优先调用 screenshots_paste_latest IPC)
     */
    pasteLatestScreenshot(hostOverride?: any): Promise<ScreenshotActionResult>;
    /**
     * 复制图片本身到剪贴板
     * 接入 callHostTransport('clipboard_copy_file', { filePath: item.path }, hostBridge)
     */
    copyImageToClipboard(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult>;
    /**
     * 复制图片本地路径
     */
    copyImagePath(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult>;
    /**
     * 复制 OCR 提取文字
     */
    copyOcrText(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult>;
    /**
     * 在 Finder / 资源管理器中定位 (Show in Finder / Explorer)
     */
    showInExplorer(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult>;
    /**
     * 用默认图片查看器打开 (Open with Default App)
     */
    openWithDefaultApp(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult>;
    /**
     * 删除截图文件 (移至废纸篓 / 回收站)
     */
    deleteScreenshot(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult>;
    /**
     * 置顶/取消置顶截图
     */
    togglePinScreenshot(item: ScreenshotItem): Promise<ScreenshotActionResult>;
}
export declare const defaultScreenshotsManager: ScreenshotsManager;
export declare function scanRealScreenshots(hostOverride?: any): Promise<ScreenshotItem[]>;
export declare function extractOcr(item: ScreenshotItem, hostOverride?: any): Promise<string>;
export declare function pasteToActiveWindow(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult>;
export declare function copyImageToClipboard(item: ScreenshotItem, hostOverride?: any): Promise<ScreenshotActionResult>;
