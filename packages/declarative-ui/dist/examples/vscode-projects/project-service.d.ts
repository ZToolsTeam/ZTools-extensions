import type { EditorFilterGroup, ProjectEntry, SupportedEditor } from './types.js';
export declare function formatRelativeTime(lastOpenedMs: number, nowMs?: number): string;
export declare function normalizeFileUriToPath(rawUriOrPath: string): string;
/**
 * 解析 VS Code / Cursor / Trae / Windsurf `history.recentlyOpenedPathsList` JSON 结构
 */
export declare function parseVscRecentlyOpenedJson(jsonStr: string, editorType?: SupportedEditor, baseTimestampMs?: number): ProjectEntry[];
/**
 * 解析 JetBrains `options/recentProjects.xml` 结构
 */
export declare function parseJetBrainsRecentProjectsXml(xmlStr: string, editorType?: SupportedEditor, userHome?: string, nowMs?: number): ProjectEntry[];
/**
 * 解析 `.git/HEAD` 文本提取分支名或短 Commit Hash
 */
export declare function parseGitHeadContent(headContent: string): string | undefined;
export declare function mergeAndSortProjects(lists: ProjectEntry[][], nowMs?: number): ProjectEntry[];
export declare function filterProjectEntries(projects: ProjectEntry[], searchText: string, editorFilter?: EditorFilterGroup): ProjectEntry[];
export declare function scanAllRecentProjects(rawEntries?: Array<Partial<ProjectEntry>>, hostOverride?: unknown): Promise<ProjectEntry[]>;
export declare function launchProjectInEditor(item: ProjectEntry, hostOverride?: unknown): Promise<{
    ok: boolean;
    error?: string;
}>;
