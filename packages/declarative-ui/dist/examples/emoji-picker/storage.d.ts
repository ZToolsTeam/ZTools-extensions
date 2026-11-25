export declare function getPinnedEmojis(): Promise<string[]>;
export declare function savePinnedEmojis(pinned: string[]): Promise<void>;
export declare function togglePinnedEmoji(char: string): Promise<boolean>;
export declare function isEmojiPinned(char: string): Promise<boolean>;
