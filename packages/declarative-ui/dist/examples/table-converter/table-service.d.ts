import type { DetectedSourceFormat, TableConversionTarget, TableGrid } from './types.js';
/**
 * 符合 RFC 4180 规范的分隔符解析器（支持双引号包裹、内部含分隔符或真实换行 `\n`、双引号转义 `""`）
 */
export declare function parseDelimitedRows(rawText: string, delimiter: string): string[][];
export declare function detectAndParse(rawText: string, hasHeader?: boolean): {
    format: DetectedSourceFormat;
    grid: TableGrid;
};
export declare function gridToMarkdown(grid: TableGrid): string;
export declare function gridToJson(grid: TableGrid): string;
export declare function gridToSql(grid: TableGrid, tableName?: string): string;
export declare function gridToHtml(grid: TableGrid): string;
export declare function gridToCsv(grid: TableGrid): string;
export declare function buildAllConversionTargets(grid: TableGrid, sqlTableName?: string): TableConversionTarget[];
