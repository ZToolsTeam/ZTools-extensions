/**
 * ZTools 2.0 标杆原生插件视图: 误删文件与回收站深度恢复工坊 (Data Recovery 2.0 - 布局二：左 32% 恢复分类树 + 右 68% 可勾选待恢复文件列表)
 *
 * 严格遵循 ZTools 效率工具箱 UI 与交互设计五大黄金法则：
 * 1. 布局二（Master-SubList Cleaner）：左 32% 5 大文件类型恢复树 + 右 68% 带完整度进度条与原路径对比的可勾选列表
 * 2. 顶部唯一筛选：searchBarAccessory Dropdown 切换扫描深度模式 (快速扫描回收站 / 深度扇区 MFT 扫描 / 办公自动保存扫描)
 * 3. 单行极简状态条：filterBar.summaryText 融合可恢复总数、高完整度占比与已勾选恢复体积，仅保留 1 个全局重新扫描按钮
 * 4. 零彩色 Emoji 与去彩虹化：100% 单色 SVG 图标、单色中性灰完整度进度条
 */
export declare function DataRecoveryCommand(): import("../../index.js").ViewDescriptor<import("../../index.js").ListProps>;
export default DataRecoveryCommand;
