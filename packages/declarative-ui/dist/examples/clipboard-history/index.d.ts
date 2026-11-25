import { ClipboardItem } from "./types.js";
export * from "./types.js";
export * from "./clipboard-storage.js";
export declare function getClipboardMarkdown(item: ClipboardItem): string;
/**
 * 剪贴板条目详情视图
 */
export declare function ClipboardDetailView({ item, onDeleted, onPinToggled }?: {
    item?: ClipboardItem;
    onDeleted?: (id: string) => void;
    onPinToggled?: (id: string) => void;
}): JSX.Element;
/**
 * 新建或编辑剪贴板条目表单
 */
export declare function ClipboardItemForm({ initialItem, onSaved }: {
    initialItem?: ClipboardItem;
    onSaved?: (item: ClipboardItem) => void;
}): JSX.Element;
/**
 * 官方内置核心能力: 剪贴板历史管理器
 * 布局一标杆：左 48% 历史列表 + 右 52% 真实内容本体预览，零彩色 Emoji 污染
 */
export default function ClipboardHistoryCommand(): JSX.Element;
