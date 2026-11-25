/**
 * ZTools 2.0 标杆原生插件视图: 系统与开发环境关键配置备份工坊 (System Backup 2.0 - 布局二：左 32% 配置分类树 + 右 68% 可勾选配置与快照列表)
 *
 * 严格遵循 ZTools 效率工具箱 UI 与交互设计五大黄金法则：
 * 1. 布局二（Master-SubList Cleaner）：左 32% 4 大系统与极客配置分类导航树 + 右 68% 可勾选配置文件与快照列表
 * 2. 顶部唯一筛选：searchBarAccessory Dropdown 切换备份策略模式 (全量快照 / 极客 Dotfiles / 增量归档)
 * 3. 单行极简状态条：filterBar.summaryText 融合备份归档仓库路径、已选配置项数量与总大小，仅保留 1 个全局重新扫描按钮
 * 4. 零彩色 Emoji 与去彩虹化：100% 单色 SVG 图标、单色中性灰进度条与标签
 */
export declare function SystemBackupCommand(): import("../../index.js").ViewDescriptor<import("../../index.js").ListProps>;
export default SystemBackupCommand;
