/**
 * SQLite 查看器（布局二：左侧数据表 + 右侧可勾选记录）
 *
 * - 顶部下拉框切换在 %APPDATA% / %LOCALAPPDATA% 下找到的数据库文件
 * - 左侧列出表与视图（行数、列），选中后右侧只读显示该表前 50 行
 * - 勾选的记录（未勾选时为当前列表）可导出为 JSON / CSV / SQL INSERT 文本复制到剪贴板
 * - 只读，不执行写入或整理语句；读取失败时在状态条与空列表中如实显示原因
 */

import {
  Action,
  ActionPanel,
  Clipboard,
  Icon,
  List,
  Toast,
  showToast,
  useEffect,
  useState
} from "@ztools/declarative-ui";
import { callHostTransport, isRealElectronHost } from "./native-ipc.js";
import {
  NOT_IN_CLIENT_MESSAGE,
  PREVIEW_LIMIT,
  createEmptySqliteWorkspace,
  exportTableRecords,
  fetchSqliteWorkspace,
  fetchTableRows,
  formatBytes,
  openSqliteDbLocation,
  type SqlExportFormat,
  type SqliteRowRecord,
  type SqliteWorkspaceSnapshot
} from "./logic.js";

interface TableRowsState {
  loading: boolean;
  rows: SqliteRowRecord[];
  error?: string;
}

export function SqlitePluginCommand() {
  const [workspace, setWorkspace] = useState<SqliteWorkspaceSnapshot>(() =>
    isRealElectronHost() ? createEmptySqliteWorkspace() : createEmptySqliteWorkspace(NOT_IN_CLIENT_MESSAGE)
  );
  const [activeDbPath, setActiveDbPath] = useState<string>("");
  const [selectedTable, setSelectedTable] = useState<string>("");
  // 按「数据库路径 + 表名」缓存已读取的记录，切换回来时不重复读取，也不会把旧数据库的结果显示到新数据库上
  const [rowsCache, setRowsCache] = useState<Record<string, TableRowsState>>({});
  const [checkedRowIds, setCheckedRowIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(isRealElectronHost());

  const cacheKey = (dbPath: string, table: string) => `${dbPath}\u0000${table}`;

  const reloadSqliteWorkspace = async (dbPath = activeDbPath) => {
    setIsLoading(true);
    try {
      const data = await fetchSqliteWorkspace(dbPath);
      setWorkspace(data);
      setCheckedRowIds([]);
      const nextCache: Record<string, TableRowsState> = {};
      if (data.rowsTableName) {
        nextCache[cacheKey(data.activeDbPath, data.rowsTableName)] = { loading: false, rows: data.rows };
      }
      setRowsCache(nextCache);
      setSelectedTable(data.tables[0]?.tableName || "");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void reloadSqliteWorkspace(activeDbPath);
  }, [activeDbPath]);

  const loadTable = async (tableName: string) => {
    if (tableName !== selectedTable) {
      setSelectedTable(tableName);
      setCheckedRowIds([]);
    }
    const dbPath = workspace.activeDbPath;
    const key = cacheKey(dbPath, tableName);
    if (!dbPath || !tableName || rowsCache[key]) return;
    setRowsCache((prev) => ({ ...prev, [key]: { loading: true, rows: [] } }));
    const res = await fetchTableRows(dbPath, tableName);
    setRowsCache((prev) => ({
      ...prev,
      [key]: res.ok ? { loading: false, rows: res.rows } : { loading: false, rows: [], error: res.error }
    }));
  };

  const tableMeta = workspace.tables.find((t) => t.tableName === selectedTable);
  const tableState = rowsCache[cacheKey(workspace.activeDbPath, selectedTable)];
  const tableRows = tableState?.rows || [];

  const keyword = searchText.trim().toLowerCase();
  const visibleRows = tableRows.filter((row) => {
    if (!keyword) return true;
    return `${row.summaryTitle} ${row.rowJsonPreview}`.toLowerCase().includes(keyword);
  });

  const checkedSet = new Set(checkedRowIds);
  const selectedRows = tableRows.filter((r) => checkedSet.has(r.id));
  const exportTargets = selectedRows.length > 0 ? selectedRows : visibleRows;
  const exportLabel =
    selectedRows.length > 0 ? `已勾选的 ${selectedRows.length} 行` : `当前列表的 ${visibleRows.length} 行`;

  const toggleRowCheck = (id: string) => {
    setCheckedRowIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const toggleAllVisible = () => {
    const visibleIds = visibleRows.map((r) => r.id);
    const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedSet.has(id));
    if (allChecked) {
      const removeSet = new Set(visibleIds);
      setCheckedRowIds((prev) => prev.filter((id) => !removeSet.has(id)));
    } else {
      setCheckedRowIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleExport = async (format: SqlExportFormat) => {
    const res = await exportTableRecords(exportTargets, format, (text) => Clipboard.copy(text), tableMeta);
    showToast({
      style: res.ok ? Toast.Style.Success : Toast.Style.Failure,
      title: res.ok ? "已复制到剪贴板" : "导出失败",
      message: res.message
    });
  };

  const locateDb = async () => {
    const ok = await openSqliteDbLocation(workspace.activeDbPath);
    if (!ok) {
      showToast({
        style: Toast.Style.Failure,
        title: "无法在资源管理器中定位数据库文件",
        message: workspace.activeDbPath || "没有打开数据库"
      });
    }
  };

  const activeDb = workspace.databases.find((d) => d.path === workspace.activeDbPath);
  const dbLabel = activeDb ? `${activeDb.name} (${formatBytes(activeDb.sizeBytes)})` : workspace.activeDbPath;

  const summaryText = workspace.error
    ? workspace.error
    : tableState?.error
      ? `读取表「${selectedTable}」失败：${tableState.error}`
      : `${dbLabel} · ${workspace.tables.length} 张表 · ${selectedTable ? `「${selectedTable}」显示前 ${tableRows.length} 行` : "未选择表"} · 已勾选 ${selectedRows.length} 行`;

  const exportActions = (primary: SqlExportFormat, secondary: SqlExportFormat) => {
    const titles: Record<SqlExportFormat, string> = {
      json: `导出${exportLabel}为 JSON`,
      sql_insert: `导出${exportLabel}为 SQL INSERT 语句`,
      csv: `导出${exportLabel}为 CSV`
    };
    const order: SqlExportFormat[] = [primary, secondary, ...(["json", "sql_insert", "csv"] as SqlExportFormat[]).filter(
      (f) => f !== primary && f !== secondary
    )];
    return order.map((format) =>
      Action({
        title: titles[format],
        icon: format === "json" ? Icon.Clipboard : format === "csv" ? Icon.Document : Icon.Code,
        onAction: () => handleExport(format)
      })
    );
  };

  const leftNavNodes = workspace.tables.map((table) =>
    List.Item({
      id: `nav-sql-${table.id}`,
      title: table.tableName,
      subtitle: `${table.type === "view" ? "视图" : "表"} · ${table.columns.length} 列：${table.schemaSummary}`,
      icon: Icon.Document,
      onSelect: () => {
        void loadTable(table.tableName);
      },
      accessories: [{ tag: { value: `${table.rowCount} 行` } }],
      actions: ActionPanel({
        children: [
          Action({
            title: `查看「${table.tableName}」的记录`,
            icon: Icon.Filter,
            onAction: () => loadTable(table.tableName)
          }),
          ...exportActions("json", "csv"),
          Action({
            title: "在资源管理器中定位数据库文件",
            icon: Icon.Folder,
            onAction: locateDb
          })
        ]
      })
    })
  );

  const subListItems = visibleRows.map((row) => {
    const isChecked = checkedSet.has(row.id);
    return List.Item({
      id: `sql-row-${row.id}`,
      title: row.summaryTitle,
      subtitle: row.rowJsonPreview,
      icon: Icon.Code,
      checkable: true,
      checked: isChecked,
      onCheckChange: () => toggleRowCheck(row.id),
      onToggleCheck: () => toggleRowCheck(row.id),
      accessories: [{ text: `第 ${row.rowNumber} 行` }],
      actions: ActionPanel({
        children: [
          ...exportActions("json", "sql_insert"),
          Action({
            title: "在资源管理器中定位数据库文件",
            icon: Icon.Folder,
            onAction: locateDb
          })
        ]
      })
    });
  });

  const allChecked = visibleRows.length > 0 && visibleRows.every((r) => checkedSet.has(r.id));
  const someChecked = visibleRows.some((r) => checkedSet.has(r.id));

  const emptyText =
    workspace.error ||
    (tableState?.error
      ? `读取失败：${tableState.error}`
      : isLoading || tableState?.loading
        ? "正在读取..."
        : selectedTable
          ? keyword
            ? "没有匹配的记录"
            : "这张表没有记录"
          : "没有可显示的数据表");

  return List({
    isLoading: isLoading || Boolean(tableState?.loading),
    searchBarPlaceholder: "搜索当前表已读取的记录...",
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    searchBarAccessory: List.Dropdown({
      tooltip: "切换数据库文件",
      value: workspace.activeDbPath,
      onChange: (val) => setActiveDbPath(val),
      children: workspace.databases.map((db) =>
        List.Dropdown.Item({
          title: `${db.name} (${formatBytes(db.sizeBytes)})`,
          value: db.path
        })
      )
    }),
    filterBar: {
      summaryText,
      actions: [
        {
          id: "open-database",
          title: "打开数据库…",
          style: "secondary",
          onAction: async () => {
            const result = await callHostTransport<{ canceled?: boolean; filePath?: string }>("window_show_open_dialog", {
              title: "打开 SQLite 数据库",
              filters: "SQLite 数据库|*.db;*.sqlite;*.sqlite3",
              properties: ["openFile"]
            });
            if (!result.ok) {
              await showToast({ style: Toast.Style.Failure, title: "无法打开数据库", message: result.error });
            } else if (!result.data?.canceled && result.data?.filePath) {
              if (activeDbPath === result.data.filePath) await reloadSqliteWorkspace(activeDbPath);
              else setActiveDbPath(result.data.filePath);
            }
          }
        },
        {
          id: "rescan",
          title: "重新扫描",
          style: "secondary",
          onAction: () => {
            void reloadSqliteWorkspace(activeDbPath);
          }
        }
      ]
    },
    subList: {
      title: selectedTable
        ? `「${selectedTable}」前 ${PREVIEW_LIMIT} 行（显示 ${visibleRows.length} 行 · 已选 ${selectedRows.length} 行）`
        : "记录",
      subtitle: workspace.activeDbPath,
      emptyText,
      checkable: visibleRows.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: "数据表",
        subtitle: "选中后右侧显示前 50 行",
        children: leftNavNodes
      })
    ]
  });
}

export default SqlitePluginCommand;
