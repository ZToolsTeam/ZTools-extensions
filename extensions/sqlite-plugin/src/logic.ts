/**
 * SQLite 查看器：打开用户选择或拖入的 SQLite 数据库文件，只读查看表结构与记录，
 * 把勾选的记录导出为 JSON / CSV / SQL INSERT 文本复制到剪贴板。
 *
 * - 不在启动时扫描本机目录：数据库候选列表完全由用户导入（选择文件、选择文件夹、拖入或粘贴）维护
 * - 只读：不执行任何写入或整理（VACUUM 等）语句，不修改数据库文件
 * - 表与列信息、记录都来自客户端读取的数据库文件，读不到时如实报错，不显示示例数据
 * - 每张表最多读取前 PREVIEW_LIMIT 行
 */

import { t } from "./i18n.js";
import {
  formatBytes as formatByteCount,
  callHostTransport,
  isRealElectronHost,
  showRealItemInFolder,
  type NativeInvocationResult
} from "./native-ipc.js";
import {
  pathKey,
  type FileImportRules,
  type FileImportTransport,
  type ImportedFile
} from "./file-import.js";

export type { NativeInvocationResult };

type DynamicBridge = ReturnType<typeof JSON.parse>;

export const NOT_IN_CLIENT_MESSAGE = "需要在 ZTools 客户端中使用";
export const getNotInClientMessage = (): string => t("notInClient");
/** 每张表最多读取的行数（与客户端预览第一张表的行数一致） */
export const PREVIEW_LIMIT = 50;
/** 可导入的数据库扩展名（与客户端 SqlitePlugin 能打开的格式一致） */
export const SQLITE_EXTENSIONS = [".db", ".sqlite", ".sqlite3", ".db3"] as const;
/** 导入提示里的格式说明 */
export const SQLITE_SUPPORTED_TEXT = ".db / .sqlite / .sqlite3 / .db3";
export const FORBIDDEN_SQLITE_PATH_PATTERN = new RegExp("\\\\Windows\\\\System32|\\.\\.\\\\|\\.\\./", "i");

/** SQLite 导入规则：递归 5 层、最多 500 个文件，跳过系统受保护目录 */
export const SQLITE_IMPORT_RULES: FileImportRules = {
  extensions: SQLITE_EXTENSIONS,
  forbiddenPath: FORBIDDEN_SQLITE_PATH_PATTERN
};

export function createSqliteImportTransport(hostBridge?: DynamicBridge): FileImportTransport {
  return (method, params) => callHostTransport(method, params, hostBridge);
}

export function toSqliteDatabaseFile(file: ImportedFile): SqliteDatabaseFile {
  return {
    id: `db:${pathKey(file.path)}`,
    name: file.name,
    path: file.path,
    sizeBytes: file.sizeBytes
  };
}

export interface SqliteDatabaseFile {
  id: string;
  name: string;
  path: string;
  /** 字节数；宿主没有返回时为 null（显示“大小未识别”，不填默认值） */
  sizeBytes: number | null;
}

/** 显示文件大小；未知时如实显示“大小未识别” */
export function formatBytes(bytes: number | null | undefined): string {
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0 ? formatByteCount(bytes) : t("sizeUnknown");
}

export interface SqliteColumnMeta {
  name: string;
  type: string;
  pk: boolean;
}

export interface SqliteTableMeta {
  id: string;
  tableName: string;
  type: "table" | "view";
  rowCount: number;
  columns: SqliteColumnMeta[];
  schemaSummary: string;
}

export interface SqliteRowRecord {
  id: string;
  tableName: string;
  rowNumber: number;
  data: Record<string, unknown>;
  summaryTitle: string;
  rowJsonPreview: string;
}

export interface SqliteWorkspaceSnapshot {
  databases: SqliteDatabaseFile[];
  activeDbPath: string;
  tables: SqliteTableMeta[];
  /** 客户端随表结构一起返回的记录所属的表（按表名排序的第一张表） */
  rowsTableName: string;
  rows: SqliteRowRecord[];
  updatedAt: string;
  error?: string;
}

export interface SqliteRowsResult {
  ok: boolean;
  rows: SqliteRowRecord[];
  error?: string;
}

export function createEmptySqliteWorkspace(error?: string): SqliteWorkspaceSnapshot {
  return {
    databases: [],
    activeDbPath: "",
    tables: [],
    rowsTableName: "",
    rows: [],
    updatedAt: "",
    ...(error ? { error } : {})
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function baseName(p: string): string {
  return String(p || "").split(/[\\/]/).pop() || p;
}

function isBinary(value: unknown): value is ArrayBufferView {
  return typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value);
}

function toHex(value: ArrayBufferView): string {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** 单元格显示文本：二进制显示为十六进制，对象转 JSON */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (isBinary(value)) return `X'${toHex(value)}'`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function jsonSafe(value: unknown): unknown {
  if (isBinary(value)) return toHex(value);
  if (typeof value === "bigint") return value.toString();
  return value;
}

function mapColumns(raw: unknown): SqliteColumnMeta[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c: DynamicBridge) => ({
      name: String(c?.name ?? ""),
      type: String(c?.type ?? ""),
      pk: Boolean(c?.pk)
    }))
    .filter((c) => c.name.length > 0);
}

function summarizeColumns(columns: SqliteColumnMeta[]): string {
  if (columns.length === 0) return t("noColumnInfo");
  return columns.map((c) => `${c.name}${c.type ? ` ${c.type}` : ""}${c.pk ? " PK" : ""}`).join(", ");
}

export function mapRowRecords(tableName: string, rawRows: unknown): SqliteRowRecord[] {
  if (!Array.isArray(rawRows)) return [];
  return rawRows
    .filter((r) => r && typeof r === "object" && !Array.isArray(r))
    .map((raw: DynamicBridge, idx: number) => {
      const data = raw as Record<string, unknown>;
      const entries = Object.entries(data);
      const summaryTitle =
        entries.length > 0
          ? entries
              .slice(0, 3)
              .map(([k, v]) => `${k}=${cellText(v).slice(0, 40)}`)
              .join(" · ")
          : t("emptyRowTitle");
      const preview = JSON.stringify(data, (_k, v) => jsonSafe(v)) || "{}";
      return {
        id: `${tableName}#${idx}`,
        tableName,
        rowNumber: idx + 1,
        data,
        summaryTitle,
        rowJsonPreview: preview.length > 200 ? `${preview.slice(0, 200)}...` : preview
      };
    });
}

function hasClientHost(hostBridge?: DynamicBridge): boolean {
  return Boolean(hostBridge) || isRealElectronHost();
}

export async function fetchSqliteWorkspace(
  activeDbPath?: string,
  hostBridge?: DynamicBridge
): Promise<SqliteWorkspaceSnapshot> {
  if (!hasClientHost(hostBridge)) {
    return createEmptySqliteWorkspace(getNotInClientMessage());
  }
  const targetDbPath = (activeDbPath || "").trim();
  if (!targetDbPath) {
    return createEmptySqliteWorkspace();
  }
  try {
    const inspectRes = await callHostTransport<DynamicBridge>(
      "dllplugin_call",
      { plugin: "SqlitePlugin", func: "inspectWorkspace", params: { dbPath: targetDbPath } },
      hostBridge
    );
    if (!inspectRes.ok || !inspectRes.data || !Array.isArray(inspectRes.data.tables)) {
      const reason = inspectRes.error || t("hostNoTables");
      return {
        ...createEmptySqliteWorkspace(t("readDbFailed", { name: baseName(targetDbPath), reason })),
        activeDbPath: targetDbPath
      };
    }

    const rawSize = Number(inspectRes.data.sizeBytes);
    const sizeBytes =
      typeof inspectRes.data.sizeBytes === "number" && Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : null;
    const dbItem: SqliteDatabaseFile = {
      id: `db:${pathKey(targetDbPath)}`,
      name: baseName(targetDbPath),
      path: targetDbPath,
      sizeBytes
    };

    const tables: SqliteTableMeta[] = (inspectRes.data.tables as DynamicBridge[])
      .map((t) => {
        const tableName = String(t?.name ?? t?.tableName ?? "");
        const columns = mapColumns(t?.columns);
        return {
          id: tableName,
          tableName,
          type: (String(t?.type) === "view" ? "view" : "table") as "table" | "view",
          rowCount: Math.max(0, Number(t?.rowCount) || 0),
          columns,
          schemaSummary: summarizeColumns(columns)
        };
      })
      .filter((t) => t.tableName.length > 0);
    // 客户端随表结构返回的是按表名排序的第一张表的前若干行
    const rowsTableName = tables[0]?.tableName || "";
    const rows = rowsTableName ? mapRowRecords(rowsTableName, inspectRes.data.rows) : [];

    return {
      databases: [dbItem],
      activeDbPath: targetDbPath,
      tables,
      rowsTableName,
      rows,
      updatedAt: new Date().toLocaleTimeString()
    };
  } catch (err) {
    return {
      ...createEmptySqliteWorkspace(t("readSqliteFailed", { reason: errorText(err) })),
      activeDbPath: targetDbPath
    };
  }
}

/** 只读读取指定表的前 PREVIEW_LIMIT 行 */
export async function fetchTableRows(
  dbPath: string,
  tableName: string,
  hostBridge?: DynamicBridge
): Promise<SqliteRowsResult> {
  if (!dbPath || !tableName) {
    return { ok: false, rows: [], error: t("noDbOrTableSelected") };
  }
  const res = await callHostTransport<DynamicBridge>(
    "dllplugin_call",
    { plugin: "SqlitePlugin", func: "executeQuery", params: { dbPath, tableName, limit: PREVIEW_LIMIT } },
    hostBridge
  );
  if (!res.ok || !res.data || !Array.isArray(res.data.rows)) {
    return { ok: false, rows: [], error: res.error || t("hostNoRows") };
  }
  return { ok: true, rows: mapRowRecords(tableName, res.data.rows) };
}

export type SqlExportFormat = "json" | "csv" | "sql_insert";

function orderedColumns(records: SqliteRowRecord[], table?: SqliteTableMeta): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  const push = (c: string) => {
    if (!seen.has(c)) {
      seen.add(c);
      cols.push(c);
    }
  };
  for (const c of table?.columns || []) push(c.name);
  for (const r of records) for (const k of Object.keys(r.data)) push(k);
  return cols;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  const text = isBinary(value) ? toHex(value) : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (isBinary(value)) return `X'${toHex(value)}'`;
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** 把记录转成导出文本（字段值原样导出，二进制字段为十六进制） */
export function formatExportText(
  records: SqliteRowRecord[],
  format: SqlExportFormat,
  table?: SqliteTableMeta
): string {
  const cols = orderedColumns(records, table);
  if (format === "json") {
    return JSON.stringify(
      records.map((r) => r.data),
      (_k, v) => jsonSafe(v),
      2
    );
  }
  if (format === "csv") {
    const header = cols.map((c) => csvCell(c)).join(",");
    const lines = records.map((r) => cols.map((c) => csvCell(r.data[c])).join(","));
    return [header, ...lines].join("\r\n");
  }
  return records
    .map((r) => {
      const present = cols.filter((c) => Object.prototype.hasOwnProperty.call(r.data, c));
      return `INSERT INTO ${quoteIdent(r.tableName)} (${present.map(quoteIdent).join(", ")}) VALUES (${present
        .map((c) => sqlLiteral(r.data[c]))
        .join(", ")});`;
    })
    .join("\n");
}

export async function exportTableRecords(
  records: SqliteRowRecord[],
  format: SqlExportFormat,
  copy: (text: string) => Promise<void>,
  table?: SqliteTableMeta
): Promise<{ ok: boolean; exportedText: string; message: string }> {
  if (!records || records.length === 0) {
    return { ok: false, exportedText: "", message: t("noExportableRows") };
  }
  const exportedText = formatExportText(records, format, table);
  const label = format === "sql_insert" ? "SQL INSERT" : format.toUpperCase();
  try {
    await copy(exportedText);
  } catch (err) {
    return { ok: false, exportedText, message: t("copyFailed", { reason: errorText(err) }) };
  }
  return {
    ok: true,
    exportedText,
    message: t("exportedRowsMsg", { count: records.length, format: label })
  };
}

export async function openSqliteDbLocation(dbPath: string, hostBridge?: DynamicBridge): Promise<boolean> {
  if (!dbPath) return false;
  return showRealItemInFolder(dbPath, hostBridge);
}
