/**
 * 多线程下载界面（布局二：左侧当前链接与下载文件分类 + 右侧本次下载与手动导入的文件列表）
 *
 * - 搜索框右侧下拉框选择 aria2 线程档位（16 / 8 / 4 / 1 线程，只在连接到本机 aria2 时生效）
 * - 顶栏固定「选择文件」「选择文件夹」2 个按钮，支持拖入/粘贴文件夹展开并按类型归类
 * - 移入回收站只处理已勾选的文件，执行前必须确认；从列表移除/清空列表不删除磁盘文件
 */

import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
  useEffect,
  useLocale,
  useRef,
  useState,
  getLocale
} from "@ztools/declarative-ui";
import { isRealElectronHost } from "./native-ipc.js";
import { t } from "./i18n.js";
import {
  ARIA2_ENDPOINT,
  MULTI_DOWNLOAD_IMPORT_RULES,
  computeDownloadStats,
  copyAria2cCommand,
  createClientDownloadedItem,
  createMultiDownloadImportTransport,
  deleteDownloadedFiles,
  detectDownloadUrlFromText,
  fetchMultiDownloadSnapshot,
  formatBytes,
  getDownloadCategories,
  getThreadSplitPresets,
  isDriveLowOnSpace,
  openDownloadedFile,
  openDownloadedFileLocation,
  startMultiThreadDownloadTask,
  toDownloadedFileItem,
  type DownloadFileCategory,
  type DownloadedFileItem,
  type MultiDownloadSnapshot,
  type NativeInvocationResult,
  type ThreadSplitPresetId
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
import { resolveErrorMessage } from './error-i18n.js'

export function getOutsideClientText(): string {
  return t("outsideClient");
}
const LINK_PATTERN = /^(https?|ftp|magnet):/i;

function createEmptySnapshot(): MultiDownloadSnapshot {
  return {
    downloadDir: "",
    driveLetter: "",
    driveInfoAvailable: false,
    driveFreeBytes: 0,
    driveTotalBytes: 0,
    aria2RpcOnline: false,
    aria2Status: { online: false },
    aria2Endpoint: ARIA2_ENDPOINT,
    sniffedClipboardUrl: "",
    sniffedProtocol: "",
    files: [],
    totalSizeBytes: 0,
    categoryStats: [],
    updatedAt: ""
  };
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function formatItemSize(bytes: number | null): string {
  return bytes === null ? t("sizeUnknown") : formatBytes(bytes);
}

export function MultiDownloadCommand() {
  useLocale();
  const inClient = isRealElectronHost();
  const transport = createMultiDownloadImportTransport();
  const [snapshot, setSnapshot] = useState<MultiDownloadSnapshot>(() => createEmptySnapshot());
  const [files, setFiles] = useState<DownloadedFileItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<DownloadFileCategory>("all");
  const [selectedPresetId, setSelectedPresetId] = useState<ThreadSplitPresetId>("threads_16");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const [statusBanner, setStatusBanner] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<{ visitedDirs: number; matchedFiles: number } | null>(null);
  const [trashingIds, setTrashingIds] = useState<string[]>([]);

  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const importBatchRef = useRef(0);
  const importAbortRef = useRef<AbortController | null>(null);
  const filesRef = useRef<DownloadedFileItem[]>([]);
  filesRef.current = files;

  const reportResult = async (res: NativeInvocationResult) => {
    if (!mountedRef.current) return;
    setStatusBanner(res.message);
    if (res.error === "CANCELED") return;
    await showToast({ style: res.ok ? Toast.Style.Success : Toast.Style.Failure, title: res.message });
  };

  const refreshHostMeta = async () => {
    if (!inClient) {
      setStatusBanner("");
      return;
    }
    setIsLoading(true);
    try {
      const data = await fetchMultiDownloadSnapshot();
      if (!mountedRef.current) return;
      setSnapshot(data);
    } catch (err) {
      if (!mountedRef.current) return;
      setStatusBanner(t("errRefreshFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const requireClient = (): boolean => {
    if (inClient) return true;
    const msg = t("outsideClient");
    setStatusBanner("");
    void showToast({ style: Toast.Style.Failure, title: msg });
    return false;
  };

  const applyImportedFiles = (result: FileImportResult) => {
    const incoming = result.files.map(toDownloadedFileItem);
    const { merged, added, duplicates } = mergeByPath(filesRef.current, incoming, (item) => item.path);
    if (added.length > 0) {
      filesRef.current = merged;
      setFiles(merged);
      setStatusBanner("");
    }
    const summary = summarizeImport(result, { added: added.length, duplicates }, t("importSupportedText"));
    if (summary) {
      void showToast({
        style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: summary.title,
        message: summary.message
      });
    }
  };

  const executeImport = async (
    loader: (signal: AbortSignal, notify: (p: { visitedDirs: number; matchedFiles: number }) => void) => Promise<FileImportResult>
  ) => {
    if (!requireClient()) return;
    importAbortRef.current?.abort();
    const controller = new AbortController();
    importAbortRef.current = controller;
    const batch = ++importBatchRef.current;
    setIsImporting(true);
    setImportProgress(null);
    try {
      const res = await loader(controller.signal, (progress) => {
        if (mountedRef.current && batch === importBatchRef.current) {
          setImportProgress(progress);
        }
      });
      if (!mountedRef.current || batch !== importBatchRef.current) return;
      applyImportedFiles(res);
    } catch (err) {
      if (!mountedRef.current || batch !== importBatchRef.current) return;
      void showToast({ style: Toast.Style.Failure, title: t("errImportFailed"), message: friendlyFileError(err) });
    } finally {
      if (mountedRef.current && batch === importBatchRef.current) {
        importAbortRef.current = null;
        setIsImporting(false);
        setImportProgress(null);
      }
    }
  };

  const handlePickFiles = () => {
    void executeImport(() => pickFiles(transport, MULTI_DOWNLOAD_IMPORT_RULES, { title: t("pickFilesTitle") }));
  };

  const handlePickFolder = () => {
    void executeImport(async (signal, notify) => {
      const picked = await pickFolder(transport, { title: t("pickFolderTitle"), defaultPath: snapshot.downloadDir || undefined });
      if (picked.canceled) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true };
      if (picked.error || !picked.folderPath) {
        return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false, error: resolveErrorMessage(picked, t("errNoFolderPicked")) };
      }
      if (isVolumeRoot(picked.folderPath)) {
        const accepted = await confirmAlert({
          title: t("confirmVolumeTitle", { path: picked.folderPath }),
          message: t("confirmVolumeMessage"),
          primaryAction: { title: t("confirmVolumePrimary"), style: "default" }
        });
        if (!accepted) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true };
      }
      return collectFolderFiles(transport, picked.folderPath, MULTI_DOWNLOAD_IMPORT_RULES, { signal, onProgress: notify });
    });
  };

  const handleFileInput = (input: NormalizedFileInput) => {
    void executeImport((signal, notify) =>
      expandInputPaths(transport, input.paths, MULTI_DOWNLOAD_IMPORT_RULES, {
        knownDirectories: input.directories,
        signal,
        onProgress: notify
      })
    );
  };

  useEffect(() => {
    mountedRef.current = true;
    if (inClient) void refreshHostMeta();

    const w =
      typeof window !== "undefined"
        ? (window as unknown as {
            __ztoolsDeclarativeFeatures?: { fileInput?: boolean };
            ztools?: {
              events?: {
                on?: (event: string, cb: (payload: unknown) => void) => (() => void) | void;
                off?: (event: string, cb: (payload: unknown) => void) => void;
              };
            };
          })
        : undefined;
    const supportsNativeInput = w?.__ztoolsDeclarativeFeatures?.fileInput === true;
    let disposeDrop: (() => void) | undefined;
    if (!supportsNativeInput && typeof w?.ztools?.events?.on === "function") {
      const listener = (raw: unknown) => {
        const parsed = normalizeFileInput(raw);
        if (parsed.paths.length > 0) handleFileInput(parsed);
      };
      const off = w.ztools.events.on("plugin_files_dropped", listener);
      disposeDrop = () => {
        if (typeof off === "function") off();
        else w.ztools?.events?.off?.("plugin_files_dropped", listener);
      };
    }

    return () => {
      mountedRef.current = false;
      importBatchRef.current += 1;
      importAbortRef.current?.abort();
      disposeDrop?.();
    };
  }, []);

  const fileInputProps = createImportInputProps(handleFileInput, {
    dropTitle: t("dropTitle"),
    dropSubtitle: t("dropSubtitle")
  });

  const presets = getThreadSplitPresets();
  const categories = getDownloadCategories();
  const currentPreset = presets.find((p) => p.id === selectedPresetId) || presets[0];

  const trimmedSearch = searchText.trim();
  const searchHasLink = LINK_PATTERN.test(trimmedSearch);
  const keyword = searchHasLink ? "" : trimmedSearch.toLowerCase();
  const activeLink = searchHasLink ? detectDownloadUrlFromText(trimmedSearch) : null;
  const activeDownloadUrl = activeLink?.url || snapshot.sniffedClipboardUrl;
  const activeProtocol = activeLink?.url ? activeLink.protocol : snapshot.sniffedProtocol;

  const { totalSizeBytes, categoryStats } = computeDownloadStats(files);

  const filteredFiles = files.filter((file) => {
    if (selectedCategory !== "all" && file.category !== selectedCategory) return false;
    if (keyword) {
      const hay = `${file.name} ${file.path} ${file.categoryName}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  const checkedSet = new Set(checkedIds);
  const selectedFiles = files.filter((file) => checkedSet.has(file.id));
  const selectedTotalBytes = selectedFiles.reduce((acc, item) => acc + (item.sizeBytes ?? 0), 0);

  const toggleFileCheck = (id: string) => {
    setCheckedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleAllVisible = () => {
    const visibleIds = filteredFiles.map((f) => f.id);
    const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedSet.has(id));
    if (allChecked) {
      const removeSet = new Set(visibleIds);
      setCheckedIds((prev) => prev.filter((id) => !removeSet.has(id)));
    } else {
      setCheckedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleRemoveFile = (file: DownloadedFileItem) => {
    if (trashingIds.includes(file.id)) {
      void showToast({ style: Toast.Style.Failure, title: t("errTrashingRemove") });
      return;
    }
    const next = filesRef.current.filter((item) => item.id !== file.id);
    filesRef.current = next;
    setFiles(next);
    setCheckedIds((prev) => prev.filter((id) => id !== file.id));
    setStatusBanner("");
  };

  const handleClearFiles = () => {
    if (busyRef.current) {
      void showToast({ style: Toast.Style.Failure, title: t("errBusyClear") });
      return;
    }
    importBatchRef.current += 1;
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    setIsImporting(false);
    setImportProgress(null);
    filesRef.current = [];
    setFiles([]);
    setCheckedIds([]);
    setStatusBanner("");
  };

  const upsertDownloadedFile = (filePath: string, sizeBytes?: number) => {
    const entry = createClientDownloadedItem(filePath, sizeBytes);
    const key = pathKey(entry.path);
    const existingIndex = filesRef.current.findIndex((item) => pathKey(item.path) === key);
    const next =
      existingIndex >= 0
        ? filesRef.current.map((item, idx) => (idx === existingIndex ? { ...entry, id: item.id } : item))
        : [...filesRef.current, entry];
    filesRef.current = next;
    setFiles(next);
  };

  const executeDownloadTask = async (
    runner: () => Promise<NativeInvocationResult>,
    trackClientFile = false
  ) => {
    busyRef.current = true;
    setIsLoading(true);
    try {
      const outcome = await runner();
      if (!mountedRef.current) return;
      await reportResult(outcome);
      if (trackClientFile && outcome.ok) {
        const payload = outcome.data as { engine?: unknown; path?: unknown; size?: unknown } | undefined;
        if (payload?.engine === "client" && typeof payload.path === "string" && payload.path) {
          upsertDownloadedFile(payload.path, typeof payload.size === "number" ? payload.size : undefined);
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      await reportResult({
        ok: false,
        code: -1,
        error: "UNEXPECTED_ERROR",
        message: t("errOperationFailed", { error: err instanceof Error ? err.message : String(err) })
      });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const handleStartDownload = async () => {
    if (!requireClient()) return;
    if (!activeDownloadUrl) {
      setStatusBanner("");
      await refreshHostMeta();
      return;
    }
    await executeDownloadTask(
      () => startMultiThreadDownloadTask(activeDownloadUrl, snapshot.downloadDir, currentPreset),
      true
    );
  };

  const handleCopyCommand = async () => {
    if (!requireClient()) return;
    await executeDownloadTask(() => copyAria2cCommand(activeDownloadUrl, snapshot.downloadDir, currentPreset));
  };

  const handleOpenFolder = async () => {
    if (!requireClient()) return;
    const res = await openDownloadedFile(snapshot.downloadDir);
    if (!res.ok) await reportResult(res);
  };

  const handleOpenFile = async (path: string) => {
    const res = await openDownloadedFile(path);
    if (!res.ok) await reportResult(res);
  };

  const handleShowFile = async (path: string) => {
    const res = await openDownloadedFileLocation(path);
    if (!res.ok) await reportResult(res);
  };

  const handleBatchTrashSelected = async () => {
    const targetList = selectedFiles;
    if (targetList.length === 0) {
      setStatusBanner(t("promptSelectTrash"));
      return;
    }
    const preview = targetList
      .slice(0, 5)
      .map((f) => f.name)
      .join("\n");
    const more = targetList.length > 5 ? t("confirmTrashMore", { count: targetList.length }) : "";
    const confirmed = await confirmAlert({
      title: t("confirmTrashTitle", { count: targetList.length }),
      message: t("confirmTrashMessage", { size: formatBytes(selectedTotalBytes), preview, more }),
      primaryAction: { title: t("confirmTrashPrimary"), style: "destructive" },
      dismissAction: { title: t("confirmCancel") }
    });
    if (!confirmed) {
      setStatusBanner(t("statusTrashCanceled"));
      return;
    }
    busyRef.current = true;
    setIsLoading(true);
    setTrashingIds(targetList.map((f) => f.id));
    try {
      const res = await deleteDownloadedFiles(
        targetList.map((f) => f.path),
        targetList
      );
      if (!mountedRef.current) return;
      const failedText =
        res.failed.length > 0
          ? t("trashFailedPrefix", {
              count: res.failed.length,
              details: res.failed
                .slice(0, 3)
                .map((f) => `${baseName(f.path)}（${f.reason}）`)
                .join(t("trashFailedSep"))
            })
          : "";
      const message =
        res.deletedCount > 0
          ? t("trashSuccessMsg", { count: res.deletedCount, size: formatBytes(res.freedBytes), failedText })
          : t("trashNoneMsg", { failedText });
      setStatusBanner(message);
      await showToast({
        style: res.failed.length === 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: message
      });
      const failedKeys = new Set(res.failed.map((f) => pathKey(f.path)));
      const targetKeys = new Set(targetList.map((item) => pathKey(item.path)));
      const remaining = filesRef.current.filter((f) => {
        const key = pathKey(f.path);
        return !targetKeys.has(key) || failedKeys.has(key);
      });
      filesRef.current = remaining;
      setFiles(remaining);
      const remainingIds = new Set(remaining.map((f) => f.id));
      setCheckedIds((prev) => prev.filter((id) => remainingIds.has(id)));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setIsLoading(false);
        setTrashingIds([]);
      }
    }
  };

  const maxCategoryBytes = Math.max(1, ...categoryStats.map((c) => c.sizeBytes));
  const maxFileBytes = Math.max(1, ...filteredFiles.map((f) => f.sizeBytes ?? 0));
  const driveLowSpace = isDriveLowOnSpace(snapshot);

  const aria2Text = snapshot.aria2Status.online
    ? t("aria2Online", { name: currentPreset.name })
    : t("aria2Offline");
  const driveText = !snapshot.driveInfoAvailable
    ? t("driveUnknown")
    : t("driveFree", {
        drive: snapshot.driveLetter,
        free: formatBytes(snapshot.driveFreeBytes),
        lowHint: driveLowSpace ? t("driveLowHint") : ""
      });
  const summaryText = isImporting
    ? t("summaryImporting", { dirs: importProgress?.visitedDirs ?? 0, files: importProgress?.matchedFiles ?? 0 })
    : !inClient
      ? t("outsideClient")
      : statusBanner
        ? statusBanner
        : files.length === 0
          ? t("summaryEmpty", { aria2: aria2Text, drive: driveText })
          : t("summaryFiles", {
              aria2: aria2Text,
              drive: driveText,
              selected: selectedFiles.length,
              total: filteredFiles.length,
              size: formatBytes(selectedTotalBytes)
            });

  const createPickFilesAction = () =>
    Action({ title: t("actionPickFiles"), icon: Icon.Plus, shortcut: { modifiers: ["ctrl"], key: "o" }, onAction: handlePickFiles });

  const createPickFolderAction = () =>
    Action({ title: t("actionPickFolder"), icon: Icon.Folder, shortcut: { modifiers: ["ctrl", "shift"], key: "o" }, onAction: handlePickFolder });

  const createClearAction = () =>
    Action({
      title: t("actionClearList"),
      icon: Icon.Trash,
      style: Action.Style.Destructive,
      shortcut: { modifiers: ["ctrl", "shift"], key: "backspace" },
      onAction: handleClearFiles
    });

  const trashAction = () =>
    Action({
      title: t("actionTrashSelected", { count: selectedFiles.length, size: formatBytes(selectedTotalBytes) }),
      icon: Icon.Trash,
      style: Action.Style.Destructive,
      onAction: handleBatchTrashSelected
    });

  const openFolderAction = () => Action({ title: t("actionOpenDownloadDir"), icon: Icon.Folder, onAction: handleOpenFolder });

  const navListSection = () =>
    ActionPanel.Section({
      title: t("sectionList"),
      children: [createPickFilesAction(), createPickFolderAction(), ...(files.length > 0 ? [createClearAction()] : [])]
    });

  const linkItem = List.Item({
    id: "nav-dl-link",
    title: activeDownloadUrl ? t("linkTitleWithProtocol", { protocol: activeProtocol }) : t("linkTitleEmpty"),
    subtitle: activeDownloadUrl || t("linkSubtitleEmpty"),
    icon: Icon.Link,
    accessories: [
      ...(driveLowSpace ? [{ tag: { value: t("tagLowSpace"), color: Color.Red } }] : []),
      { tag: { value: !activeDownloadUrl ? t("tagUnrecognized") : snapshot.aria2Status.online ? t("tagAria2Multi") : t("tagSingleConn") } }
    ],
    actions: ActionPanel({
      children: [
        Action({
          title: activeDownloadUrl ? t("actionDownloadLink") : t("actionRefreshClipboard"),
          icon: activeDownloadUrl ? Icon.Download : Icon.ArrowClockwise,
          onAction: handleStartDownload
        }),
        openFolderAction(),
        ...(activeDownloadUrl
          ? [
              Action({
                title: t("actionCopyAria2c", { name: currentPreset.name }),
                icon: Icon.Clipboard,
                onAction: handleCopyCommand
              })
            ]
          : []),
        ...(selectedFiles.length > 0 ? [trashAction()] : []),
        navListSection()
      ]
    })
  });

  const leftNavNodes = [
    linkItem,
    List.Item({
      id: "nav-dl-all",
      title: t("allFilesTitle"),
      subtitle: snapshot.downloadDir ? `${snapshot.downloadDir} (${t("allFilesCount", { count: files.length })})` : t("allFilesCount", { count: files.length }),
      icon: Icon.Folder,
      onSelect: () => setSelectedCategory("all"),
      accessories: [
        { tag: { value: t("itemCountTag", { count: files.length }) } },
        { text: formatBytes(totalSizeBytes) }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: t("actionViewAllFiles"),
            icon: Icon.Filter,
            onAction: () => setSelectedCategory("all")
          }),
          openFolderAction(),
          ...(selectedFiles.length > 0 ? [trashAction()] : []),
          navListSection()
        ]
      })
    }),
    ...categories.map((cat) => {
      const stat = categoryStats.find((s) => s.category === cat.id);
      const catSize = stat?.sizeBytes || 0;
      const catCount = stat?.count || 0;
      const ratio = Math.min(1, catSize / maxCategoryBytes);

      return List.Item({
        id: `nav-dl-${cat.id}`,
        title: cat.name,
        subtitle: cat.exts.length > 0 ? t("catExtsSubtitle", { exts: cat.exts.slice(0, 5).join(" ") }) : t("catOtherSubtitle"),
        icon: Icon.Document,
        onSelect: () => setSelectedCategory(cat.id),
        accessories: [
          { progress: ratio },
          { tag: { value: t("itemCountTag", { count: catCount }) } },
          { text: formatBytes(catSize) }
        ],
        actions: ActionPanel({
          children: [
            Action({
              title: t("actionFilterCat", { name: cat.name }),
              icon: Icon.Filter,
              onAction: () => setSelectedCategory(cat.id)
            }),
            openFolderAction(),
            ...(selectedFiles.length > 0 ? [trashAction()] : []),
            navListSection()
          ]
        })
      });
    })
  ];

  const allChecked = filteredFiles.length > 0 && filteredFiles.every((f) => checkedSet.has(f.id));
  const someChecked = filteredFiles.some((f) => checkedSet.has(f.id));

  const subListItems = filteredFiles.map((file) => {
    const isChecked = checkedSet.has(file.id);
    const isTrashing = trashingIds.includes(file.id);
    const dateStr = file.mtimeMs > 0 ? new Date(file.mtimeMs).toLocaleDateString(getLocale()) : "";

    return List.Item({
      id: `dl-file-${file.id}`,
      title: file.name,
      subtitle: dateStr ? `${file.path} · ${dateStr}` : file.path,
      icon: Icon.Document,
      checkable: true,
      checked: isChecked,
      onCheckChange: () => toggleFileCheck(file.id),
      onToggleCheck: () => toggleFileCheck(file.id),
      accessories: [
        ...(file.sizeBytes !== null ? [{ progress: Math.min(1, file.sizeBytes / maxFileBytes) }] : []),
        { tag: { value: file.categoryName } },
        { text: formatItemSize(file.sizeBytes) }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: t("actionOpenWithDefault"),
            icon: Icon.ArrowRight,
            onAction: () => handleOpenFile(file.path)
          }),
          Action({
            title: t("actionRevealInExplorer"),
            icon: Icon.Folder,
            onAction: () => handleShowFile(file.path)
          }),
          Action({
            title: isChecked ? t("actionUncheck") : t("actionCheck"),
            icon: Icon.CheckCircle,
            onAction: () => toggleFileCheck(file.id)
          }),
          ...(selectedFiles.length > 0 ? [trashAction()] : []),
          ActionPanel.Section({
            title: t("sectionList"),
            children: [
              ...(isTrashing
                ? []
                : [
                    Action({
                      title: t("actionRemoveFromList"),
                      icon: Icon.Minus,
                      shortcut: { modifiers: ["ctrl"], key: "backspace" },
                      onAction: () => handleRemoveFile(file)
                    })
                  ]),
              createPickFilesAction(),
              createPickFolderAction(),
              Action({
                title: allChecked ? t("actionUnselectAll") : t("actionSelectAll"),
                icon: Icon.CheckCircle,
                shortcut: { modifiers: ["ctrl"], key: "a" },
                onAction: toggleAllVisible
              }),
              createClearAction()
            ]
          })
        ]
      })
    });
  });

  const activeCategoryName =
    selectedCategory === "all"
      ? t("allFilesTitle")
      : categories.find((c) => c.id === selectedCategory)?.name || t("fileListFallbackTitle");

  const emptyText = !inClient
    ? t("outsideClient")
    : keyword && files.length > 0
      ? t("emptyNoMatch")
      : selectedCategory !== "all" && files.length > 0
        ? t("emptyCategory")
        : t("emptyDefault");

  return List({
    ...fileInputProps,
    isLoading: isLoading || isImporting,
    searchBarPlaceholder: t("searchPlaceholder"),
    onSearchTextChange: (text: string) => setSearchText(text),
    isShowingDetail: false,
    actions: ActionPanel({
      children: [
        createPickFilesAction(),
        createPickFolderAction(),
        openFolderAction(),
        Action({
          title: t("actionRefreshClipboard"),
          icon: Icon.ArrowClockwise,
          onAction: () => {
            setStatusBanner("");
            void refreshHostMeta();
          }
        })
      ]
    }),
    searchBarAccessory: List.Dropdown({
      tooltip: t("presetTooltip"),
      value: selectedPresetId,
      onChange: (val) => setSelectedPresetId(val as ThreadSplitPresetId),
      children: presets.map((preset) =>
        List.Dropdown.Item({
          title: t("presetItemTitle", { name: preset.name, splitSize: preset.splitSize }),
          value: preset.id
        })
      )
    }),
    filterBar: {
      summaryText,
      actions: [
        {
          id: "pick-files",
          label: t("btnPickFiles"),
          title: t("btnPickFiles"),
          style: "secondary",
          onAction: handlePickFiles
        },
        {
          id: "pick-folder",
          label: t("btnPickFolder"),
          title: t("btnPickFolder"),
          style: "secondary",
          onAction: handlePickFolder
        }
      ]
    },
    subList: {
      title: t("subListTitle", {
        category: activeCategoryName,
        count: filteredFiles.length,
        size: formatBytes(selectedTotalBytes)
      }),
      subtitle: snapshot.downloadDir,
      emptyText,
      checkable: filteredFiles.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: t("leftSectionTitle"),
        subtitle: t("allFilesCount", { count: files.length }),
        children: leftNavNodes
      })
    ]
  });
}

export default MultiDownloadCommand;
