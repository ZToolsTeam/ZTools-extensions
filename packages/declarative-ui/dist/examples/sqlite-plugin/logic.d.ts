/**
 * ZTools 2.0 标杆原生插件: 本地 SQLite 数据库多表管理与导出工坊 (SQLite Plugin 2.0)
 * - 初始数据库与表结构为空，完全由用户显式导入（选择文件、选择文件夹、拖入或粘贴）维护
 * - 切换选中数据库仅读取目标库表结构，绝不触发任何目录扫描
 */
import { formatBytes, type NativeInvocationResult } from '../shared/native-ipc.js';
import { type ExampleImportRules, type ExampleImportedFile } from '../shared/file-import.js';
export { formatBytes };
export type { NativeInvocationResult };
export declare const DLL_PLUGIN_NAME = "SqlitePlugin";
export declare const FORBIDDEN_TARGET_PATTERN: RegExp;
export declare const FORBIDDEN_REASON = "\u7981\u6B62\u5305\u542B\u8DEF\u5F84\u7A7F\u8D8A\u6216\u9AD8\u5371\u7834\u574F\u6027\u7CFB\u7EDF\u6307\u4EE4";
export declare const SQLITE_EXTENSIONS: readonly ['.db', '.sqlite', '.sqlite3', '.db3'];
export declare const SQLITE_SUPPORTED_TEXT = ".db / .sqlite / .sqlite3 / .db3";
export declare const SQLITE_IMPORT_RULES: ExampleImportRules;
export type SqliteTableId = 'all_tables' | 'clipboard_history' | 'snippets' | 'notes' | 'plugin_kv_cache' | 'audit_logs' | string;
export interface SqliteDatabaseFile {
    id: string;
    name: string;
    path: string;
    sizeBytes: number;
    journalMode: 'WAL' | 'DELETE';
}
export interface SqliteTableMeta {
    id: SqliteTableId;
    tableName: string;
    displayName: string;
    rowCount: number;
    sizeBytes: number;
    indexes: string[];
    schemaSummary: string;
}
export interface SqliteRowRecord {
    id: string;
    tableId: SqliteTableId;
    tableName: string;
    primaryKey: string;
    summaryTitle: string;
    rowJsonPreview: string;
    columnSchema: string;
    sizeBytes: number;
    updatedAt: string;
}
export interface SqliteWorkspaceSnapshot {
    databases: SqliteDatabaseFile[];
    activeDbPath: string;
    tables: SqliteTableMeta[];
    rows: SqliteRowRecord[];
    totalSizeBytes: number;
    updatedAt: string;
    error?: string;
}
export declare const SQLITE_TABLES: SqliteTableMeta[];
export declare function createEmptySqliteWorkspace(error?: string): SqliteWorkspaceSnapshot;
export declare function toSqliteDatabaseFile(file: ExampleImportedFile, index?: number): SqliteDatabaseFile;
export declare function validateInvocationPayload(method: string, params: Record<string, unknown>): {
    valid: boolean;
    reason?: string;
};
export declare function invokeNativeCapability(method: string, params: Record<string, unknown>, hostOverride?: unknown): Promise<NativeInvocationResult>;
/**
 * 仅查看指定 SQLite 数据库的表结构与采样记录（不扫描任何系统目录）
 */
export declare function fetchSqliteWorkspace(activeDbPath?: string, hostBridge?: unknown): Promise<SqliteWorkspaceSnapshot>;
/**
 * 通过用户显式选择文件夹导入其中的 SQLite 数据库文件列表
 */
export declare function importSqliteDatabasesFromFolder(hostBridge?: unknown): Promise<SqliteDatabaseFile[]>;
export type SqlExportFormat = 'json' | 'csv' | 'sql_insert';
export declare function exportTableRecords(records: SqliteRowRecord[], format: SqlExportFormat, hostBridge?: unknown): Promise<{
    ok: boolean;
    exportedText: string;
    message: string;
}>;
export declare function executeSqliteQuery(dbPathOrTarget: string | {
    dbPath?: string;
    activeDbPath?: string;
}, sql: string, hostOverride?: unknown): Promise<{
    ok: boolean;
    rows?: unknown[];
    affectedRows?: number;
    data?: unknown;
    error?: string;
    message: string;
}>;
export declare function openSqliteDbLocation(dbPath: string, hostBridge?: unknown): Promise<boolean>;
