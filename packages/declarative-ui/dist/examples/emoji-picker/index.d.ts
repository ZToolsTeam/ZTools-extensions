import { EmojiItem } from "./types.js";
export * from "./types.js";
export * from "./data.js";
export * from "./search.js";
export * from "./storage.js";
/**
 * Emoji 详情卡片组件 (双栏详情模式)
 */
export declare function EmojiDetailView({ item, isPinned }: {
    item: EmojiItem;
    isPinned: boolean;
}): JSX.Element;
/**
 * 全键盘极客 Emoji & 符号选择器主命令
 */
export default function EmojiPickerCommand(): JSX.Element;
