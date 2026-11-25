/**
 * ZTools 2.0 标杆原生插件视图: 多线程分块高速下载工作台 (Multi-Download 2.0 - 布局二：左 32% 导航分类树 + 右 68% 明细队列)
 *
 * 严格遵循显式导入规范：
 * 1. 挂载时不扫描本机 Downloads 目录、不偷读剪贴板，初始文件列表为空 `[]`
 * 2. 顶栏 filterBar.actions 最多 2 个：「选择文件」「选择文件夹」，另支持拖入文件/文件夹与粘贴下载链接
 * 3. 本次下载完成的文件或手动导入的文件均展示在右栏，动作面板支持「从列表移除」与「清空列表」
 */
export declare function MultiDownloadCommand(): import("../../index.js").ViewDescriptor<import("../../index.js").ListProps>;
export default MultiDownloadCommand;
