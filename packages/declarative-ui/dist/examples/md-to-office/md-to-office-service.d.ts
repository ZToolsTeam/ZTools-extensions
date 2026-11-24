import type { ConvertOptions, DocElement, DocMetadata } from './types.js';
export declare function countMarkdownWords(markdownText: string): number;
/**
 * 容错式 Markdown AST 解析器（支持未闭合代码块、畸形/断头表格与大文本线性扫描）
 */
export declare function parseMarkdownAST(markdownText: string): {
    metadata: DocMetadata;
    elements: DocElement[];
};
export declare function buildDocxXmlParts(markdownText: string, options: ConvertOptions): {
    documentXml: string;
    stylesXml: string;
    metadata: DocMetadata;
};
export declare function buildDocxBuffer(markdownText: string, options: ConvertOptions): Promise<Uint8Array>;
export declare function extractDocxXmlFromBuffer(docxBuffer: Uint8Array): {
    documentXml: string;
    stylesXml: string;
};
export declare function buildWordClipboardHtml(markdownText: string, options: ConvertOptions): string;
export declare function exportMarkdownToDocxFile(markdownText: string, options: ConvertOptions, outputPath?: string, hostOverride?: unknown): Promise<{
    ok: boolean;
    outputPath?: string;
    byteLength?: number;
    error?: string;
}>;
