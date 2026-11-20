/**
 * 文件粉碎（布局二：左侧来源筛选 + 右侧可勾选文件列表）
 *
 * - 打开时不扫描任何本机目录，初始列表为空，由用户主动选择文件/文件夹、拖入或粘贴导入
 * - 安全红线：新导入的文件默认不自动勾选，粉碎前逐个确认并多次覆写后改名删除
 * - 「从列表移除」与「清空列表」只清理界面状态，不碰磁盘文件
 */

import {
  Action,
  ActionPanel,
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
  getNotInClientMessage,
  SHRED_IMPORT_RULES,
  getShredSources,
  getShredStandards,
  getShredSupportedText,
  buildShredConfirmMessage,
  createShredImportTransport,
  executeSecureShred,
  formatBytes,
  formatSize,
  openShredCandidateLocation,
  sumKnownBytes,
  toShredCandidate,
  type ShredCandidateItem,
  type ShredSource,
  type ShredStandardId
} from "./logic.js";
import {
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
  summarizeImport,
  type FileImportResult,
  type NormalizedFileInput
} from "./file-import.js";

type SourceFilter = "all" | ShredSource;

interface ImportProgress {
  visitedDirs: number;
  matchedFiles: number;
}

type ImportTask = (
  signal: AbortSignal,
  onProgress: (progress: ImportProgress) => void
) => Promise<FileImportResult>;

const SHORTCUT_PICK_FILES = { modifiers: ["ctrl"] as ("ctrl" | "shift")[], key: "o" };
const SHORTCUT_PICK_FOLDER = { modifiers: ["ctrl", "shift"] as ("ctrl" | "shift")[], key: "o" };
const SHORTCUT_REMOVE = { modifiers: ["ctrl"] as ("ctrl" | "shift")[], key: "backspace" };
const SHORTCUT_CLEAR = { modifiers: ["ctrl", "shift"] as ("ctrl" | "shift")[], key: "backspace" };
const SHORTCUT_TOGGLE_ALL = { modifiers: ["ctrl"] as ("ctrl" | "shift")[], key: "a" };

export function ShredderCommand() {
  useLocale();
  const transport = createShredImportTransport();
  const [items, setItems] = useState<ShredCandidateItem[]>([]);
  const [selectedSource, setSelectedSource] = useState<SourceFilter>("all");
  const [standardId, setStandardId] = useState<ShredStandardId>("dod_3pass");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const [statusBanner, setStatusBanner] = useState<string>("");
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [isShredding, setIsShredding] = useState<boolean>(false);
  const [runningIds, setRunningIds] = useState<string[]>([]);

  const itemsRef = useRef<ShredCandidateItem[]>([]);
  itemsRef.current = items;
  const shredBusyRef = useRef<boolean>(false);
  const importSeqRef = useRef<number>(0);
  const importAbortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef<boolean>(true);
  // 供旧版客户端事件回调读取最新的 handleFileInput，避免闭包陈旧
  const fileInputHandlerRef = useRef<(input: NormalizedFileInput) => void>(() => {});

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      importSeqRef.current += 1;
      importAbortRef.current?.abort();
    };
  }, []);

  /** 所有导入入口统一走同一个合并与提示函数；安全要求：新导入文件默认不自动勾选 */
  function applyImportResult(
    result: FileImportResult,
    sourceForPath: (filePath: string) => ShredSource
  ) {
    const incoming = result.files.map((file) => toShredCandidate(file, sourceForPath(file.path)));
    const { merged, added, duplicates } = mergeByPath(itemsRef.current, incoming, (item) => item.path);
    if (added.length > 0) {
      itemsRef.current = merged;
      setItems(merged);
      setStatusBanner("");
    }
    const summary = summarizeImport(
      result,
      { added: added.length, duplicates },
      getShredSupportedText()
    );
    if (summary) {
      showToast({
        style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: summary.title,
        message: summary.message
      });
    }
  }

  async function runImport(task: ImportTask, sourceForPath: (filePath: string) => ShredSource) {
    importAbortRef.current?.abort();
    const controller = new AbortController();
    importAbortRef.current = controller;
    const seq = ++importSeqRef.current;
    setIsImporting(true);
    setImportProgress(null);
    try {
      const result = await task(controller.signal, (progress) => {
        if (aliveRef.current && seq === importSeqRef.current) {
          setImportProgress(progress);
        }
      });
      if (!aliveRef.current || seq !== importSeqRef.current) return;
      applyImportResult(result, sourceForPath);
    } catch (err) {
      if (!aliveRef.current || seq !== importSeqRef.current) return;
      showToast({
        style: Toast.Style.Failure,
        title: t("importFailed"),
        message: friendlyFileError(err)
      });
    } finally {
      if (aliveRef.current && seq === importSeqRef.current) {
        importAbortRef.current = null;
        setIsImporting(false);
        setImportProgress(null);
      }
    }
  }

  function handlePickFiles() {
    void runImport(
      () => pickFiles(transport, SHRED_IMPORT_RULES, { title: t("pickFilesTitle") }),
      () => "manual"
    );
  }

  function handlePickFolder() {
    void runImport(
      async (signal, onProgress) => {
        const picked = await pickFolder(transport, { title: t("pickFolderTitle") });
        if (picked.canceled) {
          return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true };
        }
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
          if (!confirmed) {
            return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true };
          }
        }
        return collectFolderFiles(transport, picked.folderPath, SHRED_IMPORT_RULES, { signal, onProgress });
      },
      () => "folder"
    );
  }

  function handleFileInput(input: NormalizedFileInput) {
    const dirPrefixes = (input.directories ?? []).map((d) => {
      const key = pathKey(d);
      const sep = key.includes("\\") ? "\\" : "/";
      return key.endsWith(sep) ? key : `${key}${sep}`;
    });
    const resolveSource = (filePath: string): ShredSource => {
      if (dirPrefixes.length === 0) return "manual";
      const key = pathKey(filePath);
      return dirPrefixes.some((prefix) => key.startsWith(prefix)) ? "folder" : "manual";
    };
    void runImport(
      (signal, onProgress) =>
        expandInputPaths(transport, input.paths, SHRED_IMPORT_RULES, {
          knownDirectories: input.directories,
          signal,
          onProgress
        }),
      resolveSource
    );
  }
  fileInputHandlerRef.current = handleFileInput;

  useEffect(() => {
    if (isDeclarativeFileInputSupported()) return undefined;
    const scope = (globalThis as {
      window?: {
        ztools?: {
          events?: {
            on?: (event: string, cb: (payload: unknown) => void) => (() => void) | void;
            off?: (event: string, cb: (payload: unknown) => void) => void;
          };
        };
      };
    }).window;
    const eventsApi = scope?.ztools?.events;
    if (!eventsApi || typeof eventsApi.on !== "function") return undefined;
    const handler = (raw: unknown) => {
      const normalized = normalizeFileInput(raw);
      if (normalized.paths.length > 0) {
        fileInputHandlerRef.current(normalized);
      }
    };
    const off = eventsApi.on("plugin_files_dropped", handler);
    return () => {
      if (typeof off === "function") off();
      else eventsApi.off?.("plugin_files_dropped", handler);
    };
  }, []);

  function handleRemove(item: ShredCandidateItem) {
    if (runningIds.includes(item.id)) {
      showToast({ style: Toast.Style.Failure, title: t("itemShredding") });
      return;
    }
    const next = itemsRef.current.filter((entry) => entry.id !== item.id);
    itemsRef.current = next;
    setItems(next);
    setCheckedIds((prev) => prev.filter((id) => id !== item.id));
  }

  function handleClear() {
    if (shredBusyRef.current) {
      showToast({ style: Toast.Style.Failure, title: t("busyClearing") });
      return;
    }
    // 清空时使进行中的导入批次失效，迟到结果直接丢弃
    importSeqRef.current += 1;
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    setIsImporting(false);
    setImportProgress(null);
    itemsRef.current = [];
    setItems([]);
    setCheckedIds([]);
    setStatusBanner("");
  }

  const fileInputProps = createImportInputProps(handleFileInput, {
    dropTitle: t("dropTitle"),
    dropSubtitle: t("dropSubtitle")
  });

  const standards = getShredStandards();
  const sources = getShredSources();
  const currentStandard = standards.find((s) => s.id === standardId) || standards[0];
  const keyword = searchText.trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    if (selectedSource !== "all" && item.source !== selectedSource) return false;
    if (keyword) {
      const hay = `${item.name} ${item.path} ${item.sourceName}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  const checkedSet = new Set(checkedIds);
  const selectedItems = items.filter((item) => checkedSet.has(item.id));
  const selectedBytes = sumKnownBytes(selectedItems);

  const toggleItemCheck = (item: ShredCandidateItem) => {
    setCheckedIds((prev) =>
      prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
    );
  };

  const toggleAllVisible = () => {
    const visibleIds = visibleItems.map((i) => i.id);
    const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedSet.has(id));
    if (allChecked) {
      const removeSet = new Set(visibleIds);
      setCheckedIds((prev) => prev.filter((id) => !removeSet.has(id)));
    } else {
      setCheckedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleBatchShred = async () => {
    if (shredBusyRef.current) {
      showToast({ style: Toast.Style.Failure, title: t("shredBusy") });
      return;
    }
    const targets = selectedItems;
    if (targets.length === 0) {
      showToast({ style: Toast.Style.Failure, title: t("selectFilesFirst") });
      return;
    }
    const confirmed = await confirmAlert({
      title: t("confirmShredTitle", { count: targets.length }),
      message: buildShredConfirmMessage(targets, standardId),
      primaryAction: { title: t("shredActionLabel"), style: "destructive" }
    });
    if (!confirmed || !aliveRef.current) return;

    shredBusyRef.current = true;
    setIsShredding(true);
    setRunningIds(targets.map((t) => t.id));
    try {
      const res = await executeSecureShred(targets, standardId);
      if (!aliveRef.current) return;
      const done = new Set(res.shreddedPaths.map((p) => pathKey(p)));
      if (done.size > 0) {
        const removedIds = new Set(
          targets.filter((t) => done.has(pathKey(t.path))).map((t) => t.id)
        );
        // 只基于当前仍在列表里的条目过滤，不把粉碎期间已被移除的条目加回
        const nextItems = itemsRef.current.filter((item) => !removedIds.has(item.id));
        itemsRef.current = nextItems;
        setItems(nextItems);
        setCheckedIds((prev) => prev.filter((id) => !removedIds.has(id)));
      }
      setStatusBanner(res.message);
      showToast({
        style: res.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: res.ok ? t("shredComplete") : res.shreddedCount > 0 ? t("shredPartialFail") : t("shredFailed"),
        message: res.message
      });
    } finally {
      shredBusyRef.current = false;
      if (aliveRef.current) {
        setIsShredding(false);
        setRunningIds([]);
      }
    }
  };

  const locateItem = async (item: ShredCandidateItem) => {
    const ok = await openShredCandidateLocation(item.path);
    if (!ok) {
      showToast({
        style: Toast.Style.Failure,
        title: t("locateFailed"),
        message: item.path
      });
    }
  };

  const totalKnownBytes = sumKnownBytes(items);
  const maxItemBytes = Math.max(1, ...visibleItems.map((i) => i.sizeBytes ?? 0));
  const inClient = isRealElectronHost();

  const selectionText = t("selectionText", { standard: currentStandard.name, count: selectedItems.length, bytes: formatBytes(selectedBytes) });
  const summaryText = isImporting
    ? t("importingSummary", { dirs: importProgress?.visitedDirs ?? 0, files: importProgress?.matchedFiles ?? 0 })
    : items.length === 0
      ? inClient
        ? t("emptyPrompt")
        : getNotInClientMessage()
      : t("summaryWithClear", { banner: statusBanner ? `${statusBanner} · ` : "", selection: selectionText });

  const emptyText = !inClient
    ? getNotInClientMessage()
    : isImporting
      ? t("importingEmpty")
      : items.length === 0
        ? t("emptyPrompt")
        : t("noMatchingEmpty");

  const shredAction = (title: string) =>
    Action({
      title,
      icon: Icon.Trash,
      style: Action.Style.Destructive,
      onAction: handleBatchShred
    });

  const pickFilesAction = () =>
    Action({
      title: t("pickFilesAction"),
      icon: Icon.Plus,
      shortcut: SHORTCUT_PICK_FILES,
      onAction: handlePickFiles
    });

  const pickFolderAction = () =>
    Action({
      title: t("pickFolderAction"),
      icon: Icon.Folder,
      shortcut: SHORTCUT_PICK_FOLDER,
      onAction: handlePickFolder
    });

  const clearListAction = () =>
    Action({
      title: t("clearListAction"),
      icon: Icon.Trash,
      style: Action.Style.Destructive,
      shortcut: SHORTCUT_CLEAR,
      onAction: handleClear
    });

  const leftNavNodes = [
    List.Item({
      id: "nav-shred-all",
      title: t("allShredFiles"),
      subtitle: t("totalCountSub", { count: items.length }),
      icon: Icon.Trash,
      onSelect: () => setSelectedSource("all"),
      accessories: [
        { tag: { value: t("countTag", { count: items.length }) } },
        { text: formatBytes(totalKnownBytes) }
      ],
      actions: ActionPanel({
        children: [
          shredAction(t("shredCheckedCount", { count: selectedItems.length })),
          pickFilesAction(),
          pickFolderAction(),
          clearListAction()
        ]
      })
    }),
    ...sources.map((src) => {
      const srcItems = items.filter((i) => i.source === src.id);
      const srcBytes = sumKnownBytes(srcItems);
      const ratio = items.length === 0 ? 0 : Math.min(1, srcBytes / Math.max(1, totalKnownBytes));

      return List.Item({
        id: `nav-shred-${src.id}`,
        title: src.name,
        subtitle: src.subtitle,
        icon: src.id === "folder" ? Icon.Folder : Icon.Document,
        onSelect: () => setSelectedSource(src.id),
        accessories: [
          { progress: ratio },
          { tag: { value: t("countTag", { count: srcItems.length }) } },
          { text: formatBytes(srcBytes) }
        ],
        actions: ActionPanel({
          children: [
            Action({
              title: t("viewSourceAction", { name: src.name }),
              icon: Icon.Filter,
              onAction: () => setSelectedSource(src.id)
            }),
            shredAction(t("shredCheckedCount", { count: selectedItems.length })),
            pickFilesAction(),
            pickFolderAction(),
            clearListAction()
          ]
        })
      });
    })
  ];

  const allChecked =
    visibleItems.length > 0 && visibleItems.every((i) => checkedSet.has(i.id));
  const someChecked = visibleItems.some((i) => checkedSet.has(i.id));

  const subListItems = visibleItems.map((item) => {
    const isChecked = checkedSet.has(item.id);
    const isProcessing = runningIds.includes(item.id);
    const ratio = Math.min(1, (item.sizeBytes ?? 0) / maxItemBytes);
    const sourceLabel = sources.find((s) => s.id === item.source)?.name || item.sourceName;

    return List.Item({
      id: `shred-item-${item.id}`,
      title: item.name,
      subtitle: item.path,
      icon: Icon.Document,
      checkable: true,
      checked: isChecked,
      onCheckChange: () => toggleItemCheck(item),
      onToggleCheck: () => toggleItemCheck(item),
      accessories: [
        { progress: ratio },
        { tag: { value: sourceLabel } },
        { text: formatSize(item.sizeBytes) }
      ],
      actions: ActionPanel({
        children: [
          shredAction(t("shredCheckedCountBytes", { count: selectedItems.length, bytes: formatBytes(selectedBytes) })),
          Action({
            title: t("locateFileAction"),
            icon: Icon.Folder,
            onAction: () => locateItem(item)
          }),
          Action({
            title: isChecked ? t("uncheckFileAction") : t("checkFileAction"),
            icon: Icon.CheckCircle,
            onAction: () => toggleItemCheck(item)
          }),
          ActionPanel.Section({
            title: t("listSectionTitle"),
            children: [
              ...(isProcessing
                ? []
                : [
                    Action({
                      title: t("removeFromListAction"),
                      icon: Icon.Minus,
                      shortcut: SHORTCUT_REMOVE,
                      onAction: () => handleRemove(item)
                    })
                  ]),
              pickFilesAction(),
              pickFolderAction(),
              Action({
                title: allChecked ? t("uncheckAllAction") : t("checkAllAction"),
                icon: Icon.CheckCircle,
                shortcut: SHORTCUT_TOGGLE_ALL,
                onAction: toggleAllVisible
              }),
              clearListAction()
            ]
          })
        ]
      })
    });
  });

  return List({
    ...fileInputProps,
    isLoading: isImporting || isShredding,
    searchBarPlaceholder: t("searchPlaceholder"),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    actions: ActionPanel({
      children: [pickFilesAction(), pickFolderAction()]
    }),
    searchBarAccessory: List.Dropdown({
      tooltip: t("standardTooltip"),
      value: standardId,
      onChange: (val) => setStandardId(val as ShredStandardId),
      children: standards.map((std) =>
        List.Dropdown.Item({
          title: std.name,
          value: std.id
        })
      )
    }),
    filterBar: {
      summaryText,
      actions: [
        {
          id: "pick-files",
          title: t("pickFilesBtn"),
          style: "secondary",
          onAction: handlePickFiles
        },
        {
          id: "pick-folder",
          title: t("pickFolderBtn"),
          style: "secondary",
          onAction: handlePickFolder
        }
      ]
    },
    subList: {
      title: t("subListTitle", { count: visibleItems.length, bytes: formatBytes(selectedBytes) }),
      subtitle: currentStandard.description,
      emptyText,
      checkable: visibleItems.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: t("leftSectionTitle"),
        subtitle: t("leftSectionSubtitle"),
        children: leftNavNodes
      })
    ]
  });
}

export default ShredderCommand;
