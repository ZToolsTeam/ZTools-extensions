import type { MacroResolveResult, SnippetCategory, SnippetFormInput, SnippetItem } from './types.js';
export declare function getSnippetCategoryLabel(category: SnippetCategory): string;
export declare function formatMacroDateParts(now?: Date): {
    date: string;
    time: string;
    datetime: string;
};
export declare function resolveMacroTemplate(template: string, clipboardText?: string, options?: {
    fixedDate?: string;
    fixedTime?: string;
    fixedDatetime?: string;
}): MacroResolveResult;
export declare function validateSnippetInput(input: SnippetFormInput): {
    valid: boolean;
    error?: string;
};
export declare class SnippetStoreRepository {
    #private;
    constructor(initialItems?: SnippetItem[]);
    list(): SnippetItem[];
    save(input: SnippetFormInput, nowMs?: number): SnippetItem;
    delete(id: string): boolean;
}
export declare function expandSnippetTemplate(template: string, clipboardText?: string): {
    expanded: string;
    cursorOffset: number;
};
export interface SampleSnippet {
    id: string;
    name: string;
    title: string;
    keyword: string;
    snippet: string;
    content: string;
    category: string;
    createdAt: number;
    [key: string]: unknown;
}
export declare const SAMPLE_SNIPPETS: SampleSnippet[];
export declare function filterSnippets(items?: Array<SampleSnippet | Record<string, unknown>>, filter?: {
    query?: string;
} | string): Array<SampleSnippet | Record<string, unknown>>;
