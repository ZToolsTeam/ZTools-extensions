import { EmojiItem, EmojiCategory } from "./types.js";
export interface EmojiSearchResult {
    readonly allFiltered: EmojiItem[];
    readonly pinnedItems: EmojiItem[];
    readonly categoryGroups: {
        category: EmojiCategory;
        items: EmojiItem[];
    }[];
}
export declare function searchEmojis(query: string, categoryFilter?: string, pinnedSet?: Set<string>): EmojiSearchResult;
