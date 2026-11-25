/**
 * ZTools 2.0 标杆原生插件视图: C盘大目录无感乾坤大挪移 (Mover 2.0 - 布局二：左 32% 迁移分类树 + 右 68% 可勾选大目录明细列表)
 *
 * 严格遵循 ZTools 效率工具箱 UI 与交互设计五大黄金法则：
 * 1. 布局二（Master-SubList Cleaner）：左 32% 4 大目录分类树 + 右 68% C 盘高占用目录可勾选列表
 * 2. 顶部唯一筛选：searchBarAccessory Dropdown 切换目标迁移盘符路径 (D:\ZToolsMoved / E:\ZToolsMoved)
 * 3. 单行极简状态条：filterBar.summaryText 融合 C 盘剩余空间、目标盘可用容量与预计腾出空间，右侧仅保留 1 个重新扫描按钮
 * 4. 系统保护安全锁：C:\Windows\System32 等核心目录强制设置 checkable: false 与 lockedReason，零彩色 Emoji
 */
export declare function MoverCommand(): import("../../index.js").ViewDescriptor<import("../../index.js").ListProps>;
export default MoverCommand;
