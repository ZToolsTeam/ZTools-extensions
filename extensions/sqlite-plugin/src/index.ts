/**
 * SQLite 查看器（布局二：左侧数据表 + 右侧可勾选记录）
 *
 * - 顶部下拉框切换用户导入的 SQLite 数据库文件（不扫描本机目录）
 * - 左侧列出表与视图（行数、列），选中后右侧只读显示该表前 50 行
 * - 勾选的记录（未勾选时为当前列表）可导出为 JSON / CSV / SQL INSERT 文本复制到剪贴板
 * - 只读，不执行写入或整理语句；读取失败时在状态条与空列表中如实显示原因
 */

import {
  Action,
  ActionPanel,
  Clipboard,
  FilterBar,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
  useEffect,
  useLocale,
  useRef,
  useState
} from "@ztools/declarative-ui";
import { t } from "./i18n.js";
import { isRealElectronHost } from "./native-ipc.js";
import { isDeclarativeFileInputSupported } from "./host-compat.js";
import {
  type FileImportResult,
  type NormalizedFileInput,
  collectFolderFiles,
  createImportInputProps,
  expandInputPaths,
  friendlyFileError,
  isVolumeRoot,
  mergeByPath,
  normalizeFileInput,
  pathKey,
  pickFiles,
  pickFolder,
  summarizeImport
} from "./file-import.js";
import {
  getNotInClientMessage,
  PREVIEW_LIMIT,
  SQLITE_IMPORT_RULES,
  SQLITE_SUPPORTED_TEXT,
  createEmptySqliteWorkspace,
  createSqliteImportTransport,
  exportTableRecords,
  fetchSqliteWorkspace,
  fetchTableRows,
  formatBytes,
  openSqliteDbLocation,
  toSqliteDatabaseFile,
  type SqlExportFormat,
  type SqliteDatabaseFile,
  type SqliteRowRecord,
  type SqliteWorkspaceSnapshot
} from "./logic.js";

export * from "./logic.js";

interface TableRowsState {
  loading: boolean;
  rows: SqliteRowRecord[];
  error?: string;
}

interface FolderImportProgress {
  visitedDirs: number;
  matchedFiles: number;
}

const KEY_OPEN_FILES = { modifiers: ["ctrl"] as ("ctrl")[], key: "o" };
const KEY_OPEN_FOLDER = { modifiers: ["ctrl", "shift"] as ("ctrl" | "shift")[], key: "o" };
const KEY_REMOVE_DB = { modifiers: ["ctrl"] as ("ctrl")[], key: "backspace" };
const KEY_CLEAR_LIST = { modifiers: ["ctrl", "shift"] as ("ctrl" | "shift")[], key: "backspace" };
const KEY_SELECT_ALL = { modifiers: ["ctrl"] as ("ctrl")[], key: "a" };

const cacheKey = (dbPath: string, table: string) => `${pathKey(dbPath)}\u0000${table}`;

export function SqlitePluginCommand() {
  useLocale();
  const isRealHost = isRealElectronHost();
  const notInClientMsg = getNotInClientMessage();
  const transport = createSqliteImportTransport();
  const [databases, setDatabases] = useState<SqliteDatabaseFile[]>([]);
  const [activeDbPath, setActiveDbPath] = useState<string>("");
  const [workspace, setWorkspace] = useState<SqliteWorkspaceSnapshot>(() =>
    isRealHost ? createEmptySqliteWorkspace() : createEmptySqliteWorkspace(notInClientMsg)
  );
  const [selectedTable, setSelectedTable] = useState<string>("");
  // 按「数据库路径 + 表名」缓存已读取的记录，切换回来时不重复读取，也不会把旧数据库的结果显示到新数据库上
  const [rowsCache, setRowsCache] = useState<Record<string, TableRowsState>>({});
  const [checkedRowIds, setCheckedRowIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const [isOpening, setIsOpening] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<FolderImportProgress | null>(null);

  const databasesRef = useRef(databases);
  databasesRef.current = databases;
  const activeDbPathRef = useRef(activeDbPath);
  activeDbPathRef.current = activeDbPath;

  const importSeqRef = useRef(0);
  const importAbortRef = useRef<AbortController | null>(null);
  const openSeqRef = useRef(0);
  const tableSeqRef = useRef(0);

  const clearOpenedView = () => {
    openSeqRef.current += 1;
    tableSeqRef.current += 1;
    activeDbPathRef.current = "";
    setActiveDbPath("");
    setWorkspace(isRealHost ? createEmptySqliteWorkspace() : createEmptySqliteWorkspace(notInClientMsg));
    setSelectedTable("");
    setCheckedRowIds([]);
    setRowsCache({});
    setIsOpening(false);
  };

  const openDatabase = async (targetPath: string) => {
    const trimmed = targetPath.trim();
    if (!trimmed) {
      clearOpenedView();
      return;
    }
    const seq = ++openSeqRef.current;
    tableSeqRef.current += 1;
    activeDbPathRef.current = trimmed;
    setActiveDbPath(trimmed);
    setSelectedTable("");
    setCheckedRowIds([]);
    setRowsCache({});
    setIsOpening(true);
    try {
      const data = await fetchSqliteWorkspace(trimmed);
      if (seq !== openSeqRef.current) return;
      if (!databasesRef.current.some((d) => pathKey(d.path) === pathKey(trimmed))) return;

      const resolvedSize = data.databases[0]?.sizeBytes ?? null;
      if (resolvedSize !== null) {
        const nextList = databasesRef.current.map((d) =>
          pathKey(d.path) === pathKey(trimmed) && d.sizeBytes === null ? { ...d, sizeBytes: resolvedSize } : d
        );
        databasesRef.current = nextList;
        setDatabases(nextList);
      }

      setWorkspace(data);
      const nextCache: Record<string, TableRowsState> = {};
      if (data.rowsTableName) {
        nextCache[cacheKey(data.activeDbPath, data.rowsTableName)] = { loading: false, rows: data.rows };
      }
      setRowsCache(nextCache);
      setSelectedTable(data.tables[0]?.tableName || "");
    } finally {
      if (seq === openSeqRef.current) setIsOpening(false);
    }
  };

  const commitImportResult = (result: FileImportResult) => {
    const incoming = result.files.map(toSqliteDatabaseFile);
    const { merged, added, duplicates } = mergeByPath(databasesRef.current, incoming, (d) => d.path);
    const hadActive = Boolean(activeDbPathRef.current);

    if (added.length > 0) {
      databasesRef.current = merged;
      setDatabases(merged);
    }

    const summary = summarizeImport(result, { added: added.length, duplicates }, SQLITE_SUPPORTED_TEXT);
    if (summary) {
      void showToast({
        style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: summary.title,
        message: summary.message
      });
    }

    // 导入前没有打开任何数据库时，自动打开新导入的第 1 个
    if (!hadActive && added.length > 0) {
      void openDatabase(added[0]!.path);
    }
  };

  const startDatabaseImport = async (
    loader: (signal: AbortSignal, onProgress: (p: FolderImportProgress) => void) => Promise<FileImportResult>
  ) => {
    importAbortRef.current?.abort();
    const ctrl = new AbortController();
    importAbortRef.current = ctrl;
    const seq = ++importSeqRef.current;
    setIsImporting(true);
    setImportProgress(null);
    try {
      const result = await loader(ctrl.signal, (p) => {
        if (seq === importSeqRef.current) setImportProgress(p);
      });
      if (seq !== importSeqRef.current) return;
      commitImportResult(result);
    } catch (err) {
      if (seq !== importSeqRef.current) return;
      await showToast({ style: Toast.Style.Failure, title: t("importFailed"), message: friendlyFileError(err) });
    } finally {
      if (seq === importSeqRef.current) {
        importAbortRef.current = null;
        setIsImporting(false);
        setImportProgress(null);
      }
    }
  };

  const handlePickFiles = () => {
    void startDatabaseImport(() =>
      pickFiles(transport, SQLITE_IMPORT_RULES, {
        title: t("pickDbFilesTitle"),
        filterName: t("pickDbFilterName")
      })
    );
  };

  const handlePickFolder = () => {
    void startDatabaseImport(async (signal, onProgress) => {
      const picked = await pickFolder(transport, { title: t("pickDbFolderTitle") });
      if (picked.canceled) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true };
      if (picked.error || !picked.folderPath) {
        return {
          files: [],
          ignored: 0,
          truncated: false,
          failedDirs: [],
          canceled: false,
          error: picked.error || t("noFolderSelected")
        };
      }
      if (isVolumeRoot(picked.folderPath)) {
        const confirmed = await confirmAlert({
          title: t("confirmVolumeTitle", { path: picked.folderPath }),
          message: t("confirmVolumeMsg"),
          primaryAction: { title: t("continueImport"), style: "default" }
        });
        if (!confirmed) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true };
      }
      return collectFolderFiles(transport, picked.folderPath, SQLITE_IMPORT_RULES, { signal, onProgress });
    });
  };

  const handleFileInput = (input: NormalizedFileInput) => {
    void startDatabaseImport((signal, onProgress) =>
      expandInputPaths(transport, input.paths, SQLITE_IMPORT_RULES, {
        knownDirectories: input.directories,
        signal,
        onProgress
      })
    );
  };

  const handleFileInputRef = useRef(handleFileInput);
  handleFileInputRef.current = handleFileInput;

  useEffect(() => {
    let cleanupDrop: (() => void) | undefined;
    if (!isDeclarativeFileInputSupported()) {
      const w = globalThis as {
        window?: {
          ztools?: {
            events?: {
              on?: (event: string, cb: (payload: unknown) => void) => (() => void) | void;
              off?: (event: string, cb: (payload: unknown) => void) => void;
            };
          };
        };
      };
      const events = w.window?.ztools?.events;
      if (typeof events?.on === "function") {
        const onDrop = (envelope: unknown) => {
          const input = normalizeFileInput(envelope);
          if (input.paths.length > 0) handleFileInputRef.current(input);
        };
        const off = events.on("plugin_files_dropped", onDrop);
        cleanupDrop = () => {
          if (typeof off === "function") off();
          else events.off?.("plugin_files_dropped", onDrop);
        };
      }
    }

    return () => {
      importSeqRef.current += 1;
      openSeqRef.current += 1;
      tableSeqRef.current += 1;
      importAbortRef.current?.abort();
      cleanupDrop?.();
    };
  }, []);

  const fileInputProps = createImportInputProps(
    (input) => handleFileInputRef.current(input),
    {
      dropTitle: t("dropTitle"),
      dropSubtitle: t("dropSubtitle")
    }
  );

  const handleRemoveDatabase = () => {
    const current = activeDbPathRef.current;
    if (!current) return;
    const key = pathKey(current);
    const idx = databasesRef.current.findIndex((d) => pathKey(d.path) === key);
    if (idx < 0) return;
    const remaining = databasesRef.current.filter((_, i) => i !== idx);
    databasesRef.current = remaining;
    setDatabases(remaining);
    if (remaining.length === 0) {
      clearOpenedView();
      return;
    }
    const nextDb = remaining[Math.min(idx, remaining.length - 1)]!;
    void openDatabase(nextDb.path);
  };

  const handleClearDatabases = () => {
    importSeqRef.current += 1;
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    setIsImporting(false);
    setImportProgress(null);
    databasesRef.current = [];
    setDatabases([]);
    clearOpenedView();
  };

  const loadTable = async (tableName: string) => {
    if (tableName !== selectedTable) {
      setSelectedTable(tableName);
      setCheckedRowIds([]);
    }
    const dbPath = activeDbPathRef.current;
    const key = cacheKey(dbPath, tableName);
    if (!dbPath || !tableName || rowsCache[key]) return;

    const seq = ++tableSeqRef.current;
    setRowsCache((prev) => ({ ...prev, [key]: { loading: true, rows: [] } }));
    const res = await fetchTableRows(dbPath, tableName);
    if (seq !== tableSeqRef.current || pathKey(activeDbPathRef.current) !== pathKey(dbPath)) return;
    setRowsCache((prev) => ({
      ...prev,
      [key]: res.ok ? { loading: false, rows: res.rows } : { loading: false, rows: [], error: res.error }
    }));
  };

  if (!isRealHost) {
    return List({
      searchBarPlaceholder: t("searchPlaceholder"),
      children: [
        List.Section({
          title: t("viewerSectionTitle"),
          children: [
            List.Item({
              id: "sqlite-client-required",
              title: notInClientMsg,
              subtitle: t("clientRequiredSubtitle"),
              icon: Icon.Info
            })
          ]
        })
      ]
    });
  }

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
    selectedRows.length > 0
      ? t("selectedRowsLabel", { count: selectedRows.length })
      : t("visibleRowsLabel", { count: visibleRows.length });

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
      title: res.ok ? t("copiedToClipboard") : t("exportFailed"),
      message: res.message
    });
  };

  const locateDb = async () => {
    const ok = await openSqliteDbLocation(workspace.activeDbPath);
    if (!ok) {
      showToast({
        style: Toast.Style.Failure,
        title: t("locateDbFailed"),
        message: workspace.activeDbPath || t("noDbOpened")
      });
    }
  };

  const pickFilesAction = () =>
    Action({
      title: t("pickFilesAction"),
      icon: Icon.Plus,
      shortcut: KEY_OPEN_FILES,
      onAction: handlePickFiles
    });
  const pickFolderAction = () =>
    Action({
      title: t("pickFolderAction"),
      icon: Icon.Folder,
      shortcut: KEY_OPEN_FOLDER,
      onAction: handlePickFolder
    });
  const removeDbAction = () =>
    Action({
      title: t("removeDbAction"),
      icon: Icon.Minus,
      shortcut: KEY_REMOVE_DB,
      onAction: handleRemoveDatabase
    });
  const clearListAction = () =>
    Action({
      title: t("clearListAction"),
      icon: Icon.Trash,
      style: Action.Style.Destructive,
      shortcut: KEY_CLEAR_LIST,
      onAction: handleClearDatabases
    });

  const activeDb = databases.find((d) => pathKey(d.path) === pathKey(activeDbPath));
  const dbLabel = activeDb ? `${activeDb.name} (${formatBytes(activeDb.sizeBytes)})` : activeDbPath;

  const summaryText = isImporting
    ? t("importingSummary", { dirs: importProgress?.visitedDirs ?? 0, files: importProgress?.matchedFiles ?? 0 })
    : databases.length === 0
      ? t("emptyDbPrompt")
      : workspace.error
        ? t("summaryErrorClear", { error: workspace.error })
        : tableState?.error
          ? t("summaryTableErrorClear", { table: selectedTable, error: tableState.error })
          : t("summaryReady", {
              db: dbLabel,
              tables: workspace.tables.length,
              tableStatus: selectedTable
                ? t("tablePreviewStatus", { table: selectedTable, count: tableRows.length })
                : t("noTableSelected"),
              checked: selectedRows.length
            });

  const exportActions = (primary: SqlExportFormat, secondary: SqlExportFormat) => {
    const titles: Record<SqlExportFormat, string> = {
      json: t("exportJsonTitle", { target: exportLabel }),
      sql_insert: t("exportSqlTitle", { target: exportLabel }),
      csv: t("exportCsvTitle", { target: exportLabel })
    };
    const order: SqlExportFormat[] = [
      primary,
      secondary,
      ...(["json", "sql_insert", "csv"] as SqlExportFormat[]).filter((f) => f !== primary && f !== secondary)
    ];
    return order.map((format) =>
      Action({
        title: titles[format],
        icon: format === "json" ? Icon.Clipboard : format === "csv" ? Icon.Document : Icon.Code,
        onAction: () => handleExport(format)
      })
    );
  };

  const allChecked = visibleRows.length > 0 && visibleRows.every((r) => checkedSet.has(r.id));
  const someChecked = visibleRows.some((r) => checkedSet.has(r.id));

  const leftNavNodes = workspace.tables.map((table) =>
    List.Item({
      id: `nav-sql-${table.id}`,
      title: table.tableName,
      subtitle: t("tableSubtitle", {
        type: table.type === "view" ? t("typeView") : t("typeTable"),
        cols: table.columns.length,
        schema: table.schemaSummary
      }),
      icon: Icon.Document,
      onSelect: () => {
        void loadTable(table.tableName);
      },
      accessories: [{ tag: { value: t("rowCountTag", { count: table.rowCount }) } }],
      actions: ActionPanel({
        children: [
          Action({
            title: t("viewTableRecords", { table: table.tableName }),
            icon: Icon.Filter,
            onAction: () => loadTable(table.tableName)
          }),
          ...exportActions("json", "csv"),
          Action({
            title: t("locateDbAction"),
            icon: Icon.Folder,
            onAction: locateDb
          }),
          ActionPanel.Section({
            title: t("listSectionTitle"),
            children: [
              ...(activeDbPath ? [removeDbAction()] : []),
              pickFilesAction(),
              pickFolderAction(),
              clearListAction()
            ]
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
      accessories: [{ text: t("rowNumberText", { num: row.rowNumber }) }],
      actions: ActionPanel({
        children: [
          ...exportActions("json", "sql_insert"),
          Action({
            title: t("locateDbAction"),
            icon: Icon.Folder,
            onAction: locateDb
          }),
          ActionPanel.Section({
            title: t("listSectionTitle"),
            children: [
              ...(activeDbPath ? [removeDbAction()] : []),
              pickFilesAction(),
              pickFolderAction(),
              Action({
                title: allChecked ? t("uncheckAll") : t("checkAll"),
                icon: Icon.CheckCircle,
                shortcut: KEY_SELECT_ALL,
                onAction: toggleAllVisible
              }),
              clearListAction()
            ]
          })
        ]
      })
    });
  });

  const emptyText = isImporting
    ? t("importingEllipsis")
    : databases.length === 0
      ? t("emptySqlitePrompt")
      : workspace.error ||
        (tableState?.error
          ? t("readFailedPrefix", { error: tableState.error })
          : isOpening || tableState?.loading
            ? t("readingEllipsis")
            : selectedTable
              ? keyword
                ? t("noMatchingRows")
                : t("emptyTableRows")
              : t("noTablesToDisplay"));

  const listActions = ActionPanel({
    children: [
      pickFilesAction(),
      pickFolderAction(),
      ...(databases.length > 0
        ? [
            ActionPanel.Section({
              title: t("listSectionTitle"),
              children: [...(activeDbPath ? [removeDbAction()] : []), clearListAction()]
            })
          ]
        : [])
    ]
  });

  return List({
    ...fileInputProps,
    isLoading: isImporting || isOpening || Boolean(tableState?.loading),
    searchBarPlaceholder: t("searchPlaceholder"),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    actions: listActions,
    searchBarAccessory: List.Dropdown({
      tooltip: t("switchDbTooltip"),
      value: activeDbPath,
      onChange: (val) => {
        if (val) void openDatabase(val);
      },
      children: databases.map((db) =>
        List.Dropdown.Item({
          title: `${db.name} (${formatBytes(db.sizeBytes)})`,
          value: db.path
        })
      )
    }),
    filterBar: FilterBar({
      summaryText,
      actions: [
        {
          id: "pick-files",
          label: t("pickFilesBtn"),
          title: t("pickFilesBtn"),
          style: "secondary",
          onAction: handlePickFiles
        },
        {
          id: "pick-folder",
          label: t("pickFolderBtn"),
          title: t("pickFolderBtn"),
          style: "secondary",
          onAction: handlePickFolder
        }
      ]
    }),
    subList: {
      title: selectedTable
        ? t("subListTitleWithTable", {
            table: selectedTable,
            limit: PREVIEW_LIMIT,
            visible: visibleRows.length,
            checked: selectedRows.length
          })
        : t("subListTitleDefault"),
      subtitle: workspace.activeDbPath,
      emptyText,
      checkable: visibleRows.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: t("tablesSectionTitle"),
        subtitle: t("tablesSectionSubtitle"),
        children: leftNavNodes
      })
    ]
  });
}

export default SqlitePluginCommand;
