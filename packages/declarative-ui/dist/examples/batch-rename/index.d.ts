/**
 * 批量文件重命名工作台视图 (BatchRename 2.0 - 布局二：左 32% 10 大重命名规则导航树 + 右 68% 实时原名->新名对比可勾选列表)
 * - 初始列表为空 []，不扫描任何本机默认目录
 * - 顶栏固定 2 个全局按钮：选择文件、选择文件夹（仅取一级子文件）
 */
export declare function BatchRenameCommand(): import("../../index.js").ViewDescriptor<import("../../index.js").ListProps>;
export default BatchRenameCommand;
