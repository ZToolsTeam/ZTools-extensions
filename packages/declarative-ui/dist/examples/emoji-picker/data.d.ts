import { EmojiCategory, CategoryInfo, EmojiItem } from "./types.js";
export declare const CATEGORIES: readonly CategoryInfo[];
export declare function getUnicodeHex(char: string): string;
export declare function getHtmlEntity(char: string, hex?: boolean): string;
export declare function getCategoryLabel(category: EmojiCategory): string;
export declare const EMOJI_DATABASE: readonly EmojiItem[];
