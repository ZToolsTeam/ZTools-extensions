import type { PopAndPasteResult, StackItem, StackPopMode } from './types.js';
export declare function cleanRichTextToPlain(rawInput: string): string;
export declare function readClipboardWithRetry(reader: () => Promise<string>, options?: {
    maxRetries?: number;
    baseDelayMs?: number;
}): Promise<string>;
export declare class PasteStackQueueManager {
    #private;
    constructor(initialItems?: StackItem[]);
    getItems(): StackItem[];
    isListening(): boolean;
    setListening(enabled: boolean): void;
    push(rawText: string, sourceApp?: string, nowMs?: number): {
        added: boolean;
        deduplicated: boolean;
        item?: StackItem;
    };
    pop(mode?: StackPopMode, itemId?: string): PopAndPasteResult;
    move(fromIndex: number, toIndex: number): StackItem[];
    remove(itemId: string): StackItem[];
    clear(): void;
}
export declare function fetchHostPasteStackState(hostOverride?: unknown): Promise<{
    isListening: boolean;
    items: StackItem[];
}>;
