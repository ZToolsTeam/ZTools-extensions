import { Snippet, SnippetArgumentDescriptor, SnippetFilterOptions, SnippetMacroContext, MacroExpandResult, SnippetImportExportResult } from "./types.js";
export declare const SAMPLE_SNIPPETS: Snippet[];
/**
 * 解析模板中的 {argument name="..." default="..." options="..." type="..."} 动态参数列表（同名参数自动去重合并）
 */
export declare function parseSnippetArguments(template: string): SnippetArgumentDescriptor[];
export declare function hasSnippetArguments(template: string): boolean;
/**
 * 动态宏展开解析引擎 (Dynamic Macro Engine)
 * 完整对齐 Raycast 官方宏标准：
 * - {clipboard} : 当前剪贴板文本
 * - {date} / {date format="YYYY-MM-DD"} : 格式化日期
 * - {time} / {time format="HH:mm:ss"} : 格式化时间
 * - {datetime} : 完整日期时间 (YYYY-MM-DD HH:mm:ss)
 * - {year} / {month} / {day} : 年月日独立片段
 * - {uuid} : 标准 UUID v4 随机串
 * - {cursor} : 光标重定位落点（自动计算从末尾往左回退字符数）
 * - {argument name="..." default="..." options="..."} / {query} : 动态变量提示插入
 */
export declare function expandSnippetTemplate(template: string, clipboardContent?: string, context?: SnippetMacroContext): MacroExpandResult;
/**
 * 获取所有 Snippets (优先宿主 IPC / SQLite，次选 Bridge，兜底 LocalStorage)
 */
export declare function getSnippets(): Promise<Snippet[]>;
/**
 * 保存 Snippets 列表
 */
export declare function saveSnippets(snippets: Snippet[]): Promise<void>;
/**
 * 快捷创建 Snippet (带后端直连同步)
 */
export declare function createSnippetService(snippet: Partial<Snippet>): Promise<Snippet>;
/**
 * 更新 Snippet
 */
export declare function updateSnippetService(id: string, updates: Partial<Snippet>): Promise<void>;
/**
 * 删除 Snippet
 */
export declare function deleteSnippetService(id: string): Promise<boolean>;
/**
 * 切换 Snippet 状态
 */
export declare function toggleSnippetService(id: string): Promise<boolean>;
/**
 * 导出全部短语为 JSON 字符串
 */
export declare function exportSnippetsJSON(currentSnippets?: Snippet[]): Promise<string>;
/**
 * 批量导入短语
 */
export declare function importSnippetsJSON(rawInput: string | Snippet[], currentSnippets: Snippet[]): Promise<SnippetImportExportResult>;
/**
 * 筛选与排序 Snippets
 */
export declare function filterSnippets(snippets: Snippet[], options: SnippetFilterOptions): Snippet[];
