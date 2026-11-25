/**
 * ZTools 2.0 标杆原生插件视图: 全平台流媒体音视频解析与下载工坊 (Video Downloader 2.0 - 布局二：左 32% 平台分类树 + 右 68% 视频队列)
 *
 * 严格遵循显式导入规范：
 * 1. 挂载时不扫描本机 Videos/Downloads 目录、不读取剪贴板，初始视频队列为空 `[]`
 * 2. 顶栏 filterBar.actions 最多 2 个：「选择文件」「选择文件夹」，另支持拖入视频/文件夹与粘贴下载链接
 * 3. 本次下载完成的文件或手动导入的视频均汇总展示在右栏，动作面板支持「从列表移除」与「清空列表」
 */
export declare function VideoDownloaderCommand(): import("../../index.js").ViewDescriptor<import("../../index.js").ListProps>;
export default VideoDownloaderCommand;
