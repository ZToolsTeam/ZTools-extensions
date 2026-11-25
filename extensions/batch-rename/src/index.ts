/**
 * 批量重命名（布局二）：左侧选择重命名规则，右侧列出「原名 -> 新名」预览，可勾选后执行。
 * - 通过「选择文件」「选择文件夹」或拖入 / 粘贴导入文件与文件夹（仅一级直接子文件，支持多次追加去重）
 * - 选择文件或拖入文件 / 文件夹为「只读预览」，执行改名前按目录通过选目录对话框补充写授权
 * - 同名冲突按所在目录独立检测，改名使用不覆盖移动接口，执行前确认，本次打开期间可撤销
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
import { callHostTransport, isRealElectronHost } from "./native-ipc.js";
import { hostUpgradeError, isDeclarativeFileInputSupported } from "./host-compat.js";
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
  type FileImportRules,
  type FileImportTransport,
  type NormalizedFileInput
} from "./file-import.js";
import {
  FORBIDDEN_TARGET_PATTERN,
  MAX_RENAME_FILES,
  RENAME_RULE_IDS,
  buildRenamePreview,
  conflictReasonText,
  executeRealFileRename,
  fileManagerName,
  formatBytes,
  getRenameRulePresets,
  importedFileToEntry,
  inspectDirectoryState,
  isPermissionError,
  openRenameFileLocation,
  parseDirectoryState,
  undoBatchRenameHistory,
  type DirectoryStateInfo,
  type RealFileEntry,
  type RenamePreviewItem,
  type RenameRule,
  type RenameRuleType,
  type RenameUndoEntry
} from "./logic.js";
import { usePopoutValue } from "./popout-state.js";
import { resolveErrorMessage } from './error-i18n.js'

const IMPORT_RULES: FileImportRules = {
  maxDepth: 1,
  maxFiles: MAX_RENAME_FILES,
  skipEmptyFiles: false,
  forbiddenPath: FORBIDDEN_TARGET_PATTERN
};

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isRuleType = (v: unknown): v is RenameRuleType => RENAME_RULE_IDS.some((id) => id === v);
const isPathList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText);
const isPersistedFile = (v: unknown): v is RealFileEntry => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.name === "string" &&
    r.name.length > 0 &&
    typeof r.fullPath === "string" &&
    r.fullPath.length > 0 &&
    typeof r.parentDir === "string" &&
    typeof r.extension === "string" &&
    (r.sizeBytes === null || (typeof r.sizeBytes === "number" && Number.isFinite(r.sizeBytes) && r.sizeBytes >= 0)) &&
    typeof r.lastModifiedMs === "number" &&
    Number.isFinite(r.lastModifiedMs)
  );
};
const isPersistedFileList = (v: unknown): v is RealFileEntry[] => Array.isArray(v) && v.every(isPersistedFile);

function baseNameOf(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed;
}

function parentDirOf(p: string): string {
  const stripped = String(p || "").replace(/[\\/]+$/, "");
  const idx = Math.max(stripped.lastIndexOf("/"), stripped.lastIndexOf("\\"));
  if (idx < 0) return "";
  if (idx === 0) return stripped.slice(0, 1);
  const parent = stripped.slice(0, idx);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

function toast(style: "success" | "failure", title: string, message?: string) {
  void showToast({
    style: style === "success" ? Toast.Style.Success : Toast.Style.Failure,
    title,
    ...(message ? { message } : {})
  });
}

function createInitialDirStates(files: readonly RealFileEntry[], authorizedDirs: readonly string[]): Map<string, DirectoryStateInfo> {
  const map = new Map<string, DirectoryStateInfo>();
  for (const dir of authorizedDirs) {
    const k = pathKey(dir);
    if (k && !map.has(k)) {
      map.set(k, { directory: dir, writeAuthorized: true, occupiedNames: [], existingFileNames: [] });
    }
  }
  for (const f of files) {
    const k = pathKey(f.parentDir);
    if (k && !map.has(k)) {
      map.set(k, { directory: f.parentDir, writeAuthorized: false, occupiedNames: [], existingFileNames: [] });
    }
  }
  return map;
}

function replaceNameInOccupied(names: readonly string[], oldName: string, newName: string): string[] {
  const idx = names.indexOf(oldName);
  if (idx >= 0) {
    const next = [...names];
    next[idx] = newName;
    return next;
  }
  return [...names, newName];
}

export function BatchRenameCommand() {
  useLocale();
  const rulePresets = getRenameRulePresets();
  // 独立窗口交接：同时携带列表文件与已获得写授权的文件夹路径，确保新窗口有权限写入新文件名
  const [files, setFiles, filesRestored] = usePopoutValue<RealFileEntry[]>("files", () => [], isPersistedFileList, {
    paths: (items) => items.map((i) => i.fullPath)
  });
  const [authorizedDirs, setAuthorizedDirs, dirsRestored] = usePopoutValue<string[]>(
    "authorizedDirs",
    () => [],
    isPathList,
    { paths: (dirs) => dirs }
  );
  const [ruleType, setRuleType] = usePopoutValue<RenameRuleType>("ruleType", () => "number", isRuleType);
  const [checkedPaths, setCheckedPaths] = usePopoutValue<string[]>("checkedPaths", () => [], isPathList, {
    paths: (v) => v
  });

  const [dirStates, setDirStates] = useState<Map<string, DirectoryStateInfo>>(() =>
    createInitialDirStates(files, authorizedDirs)
  );
  const [searchText, setSearchText] = useState<string>("");
  const [undoStack, setUndoStack] = useState<RenameUndoEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [importTruncated, setImportTruncated] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<{ visitedDirs: number; matchedFiles: number } | null>(null);

  const filesRef = useRef<RealFileEntry[]>(files);
  filesRef.current = files;
  const dirStatesRef = useRef<Map<string, DirectoryStateInfo>>(dirStates);
  dirStatesRef.current = dirStates;
  const checkedPathsRef = useRef<string[]>(checkedPaths);
  checkedPathsRef.current = checkedPaths;
  const busyRef = useRef(false);
  const importSeqRef = useRef(0);
  const importAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const syncDirStates = (nextMap: Map<string, DirectoryStateInfo>, currentFiles: readonly RealFileEntry[] = filesRef.current) => {
    const activeDirMap = new Map<string, string>();
    for (const f of currentFiles) {
      const k = pathKey(f.parentDir);
      if (k && !activeDirMap.has(k)) activeDirMap.set(k, f.parentDir);
    }
    const nextAuthDirs: string[] = [];
    for (const [k, dirPath] of activeDirMap) {
      if (nextMap.get(k)?.writeAuthorized === true) {
        nextAuthDirs.push(dirPath);
      }
    }
    dirStatesRef.current = nextMap;
    setDirStates(nextMap);
    setAuthorizedDirs(nextAuthDirs);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importSeqRef.current += 1;
      importAbortRef.current?.abort();
      importAbortRef.current = null;
    };
  }, []);

  // 仅当由独立窗口交接恢复出数据时，核查转交过来的目录写授权与最新占用名；正常新开插件零 IPC 扫描
  useEffect(() => {
    if (!isRealElectronHost()) return;
    if (!filesRestored && !dirsRestored) return;
    const restoredFiles = filesRef.current;
    const restoredDirs = new Map<string, string>();
    for (const d of authorizedDirs) {
      const k = pathKey(d);
      if (k && !restoredDirs.has(k)) restoredDirs.set(k, d);
    }
    for (const f of restoredFiles) {
      const k = pathKey(f.parentDir);
      if (k && !restoredDirs.has(k)) restoredDirs.set(k, f.parentDir);
    }
    if (restoredDirs.size === 0) return;

    let cancelled = false;
    void (async () => {
      const nextStates = new Map(dirStatesRef.current);
      const existingByDir = new Map<string, Set<string>>();
      for (const [dirKey, dirPath] of restoredDirs) {
        const info = await inspectDirectoryState(dirPath);
        if (cancelled || !mountedRef.current) return;
        nextStates.set(dirKey, info);
        if (!info.error) {
          existingByDir.set(dirKey, new Set(info.existingFileNames));
        }
      }
      // 对于在弹出期间已被磁盘删除的文件（且该目录成功读到了最新列表），同步清理，不自动追加新文件
      const filteredFiles = filesRef.current.filter((f) => {
        const set = existingByDir.get(pathKey(f.parentDir));
        return !set || set.has(f.name);
      });
      if (filteredFiles.length !== filesRef.current.length) {
        const keptKeys = new Set(filteredFiles.map((f) => pathKey(f.fullPath)));
        setFiles(filteredFiles);
        setCheckedPaths((prev) => prev.filter((p) => keptKeys.has(pathKey(p))));
      }
      syncDirStates(nextStates, filteredFiles);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const transport: FileImportTransport = (method, params) => callHostTransport<unknown>(method, params);

  const runImportTask = async (
    task: (
      signal: AbortSignal,
      trackingTransport: FileImportTransport
    ) => Promise<{
      result: FileImportResult;
      pickedFolderPath?: string;
      abortedEarly?: boolean;
    }>
  ) => {
    const seq = ++importSeqRef.current;
    importAbortRef.current?.abort();
    const controller = new AbortController();
    importAbortRef.current = controller;

    setIsLoading(true);
    setImportProgress({ visitedDirs: 0, matchedFiles: 0 });

    const inspectedDirs = new Map<string, DirectoryStateInfo>();
    const trackingTransport: FileImportTransport = async (method, params) => {
      const res = await callHostTransport<unknown>(method, params);
      if (method === "filesystem_get_directory_contents" && res.ok && typeof params.path === "string") {
        const info = parseDirectoryState(params.path, res.data);
        if (info) inspectedDirs.set(pathKey(params.path), info);
      }
      return res;
    };

    try {
      const outcome = await task(controller.signal, trackingTransport);
      if (seq !== importSeqRef.current || !mountedRef.current || controller.signal.aborted) return;
      if (outcome.abortedEarly) return;

      const { result } = outcome;
      if (result.canceled) return;

      const uniqueParentDirs = new Map<string, string>();
      for (const f of result.files) {
        const k = pathKey(f.parentDir);
        if (k && !uniqueParentDirs.has(k)) uniqueParentDirs.set(k, f.parentDir);
      }
      if (outcome.pickedFolderPath) {
        const pk = pathKey(outcome.pickedFolderPath);
        if (pk && !uniqueParentDirs.has(pk)) uniqueParentDirs.set(pk, outcome.pickedFolderPath);
      }

      for (const [dirKey, dirPath] of uniqueParentDirs) {
        if (!inspectedDirs.has(dirKey)) {
          const info = await inspectDirectoryState(dirPath);
          if (seq !== importSeqRef.current || !mountedRef.current || controller.signal.aborted) return;
          inspectedDirs.set(dirKey, info);
        }
      }

      const prevDirStates = dirStatesRef.current;
      const nextDirStates = new Map(prevDirStates);
      let upgradedReadOnlyFolder = false;
      for (const [dirKey, info] of inspectedDirs) {
        const prev = prevDirStates.get(dirKey);
        if (prev && !prev.writeAuthorized && info.writeAuthorized) {
          upgradedReadOnlyFolder = true;
        }
        nextDirStates.set(dirKey, info);
      }

      const incoming = result.files.map(importedFileToEntry);
      const { merged, added, duplicates } = mergeByPath(filesRef.current, incoming, (item) => item.fullPath);

      filesRef.current = merged;
      setFiles(merged);
      syncDirStates(nextDirStates, merged);

      if (added.length > 0) {
        setCheckedPaths((prev) => {
          const existingKeys = new Set(prev.map(pathKey));
          const extra = added.filter((a) => !existingKeys.has(pathKey(a.fullPath))).map((a) => a.fullPath);
          return extra.length > 0 ? [...prev, ...extra] : prev;
        });
      }
      if (result.truncated) {
        setImportTruncated(true);
      }

      if (added.length === 0 && duplicates > 0 && upgradedReadOnlyFolder) {
        toast("success", t("authAcquiredTitle"), t("authAcquiredMsg", { count: duplicates }));
        return;
      }

      const summaryMsg = summarizeImport(result, { added: added.length, duplicates });
      if (summaryMsg) {
        toast(summaryMsg.ok ? "success" : "failure", summaryMsg.title, summaryMsg.message);
      }
    } catch (err) {
      if (seq !== importSeqRef.current || !mountedRef.current || controller.signal.aborted) return;
      toast("failure", t("importFailedTitle"), friendlyFileError(err));
    } finally {
      if (seq === importSeqRef.current && mountedRef.current) {
        if (importAbortRef.current === controller) {
          importAbortRef.current = null;
        }
        setIsLoading(false);
        setImportProgress(null);
      }
    }
  };

  const handlePickFiles = () =>
    runImportTask(async (signal, trackingTransport) => {
      const result = await pickFiles(trackingTransport, IMPORT_RULES, {
        title: t("pickFilesTitle")
      });
      if (signal.aborted) return { result: { ...result, canceled: true }, abortedEarly: true };
      return { result };
    });

  const handlePickFolder = () =>
    runImportTask(async (signal, trackingTransport) => {
      const currentSingleDir = (() => {
        const dirs = Array.from(new Set(filesRef.current.map((f) => f.parentDir).filter(Boolean)));
        return dirs.length === 1 ? dirs[0] : undefined;
      })();
      const picked = await pickFolder(trackingTransport, {
        title: t("pickFolderTitle"),
        ...(currentSingleDir ? { defaultPath: currentSingleDir } : {})
      });
      if (signal.aborted) {
        return { result: { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }, abortedEarly: true };
      }
      if (picked.canceled) {
        return { result: { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true } };
      }
      if (picked.error || !picked.folderPath) {
        return {
          result: { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false, error: resolveErrorMessage(picked, t("noFolderSelected")) }
        };
      }
      if (isVolumeRoot(picked.folderPath)) {
        const confirmed = await confirmAlert({
          title: t("confirmRootTitle"),
          message: t("confirmRootMsg", { path: picked.folderPath }),
          primaryAction: { title: t("confirmRootAction") },
          dismissAction: { title: t("cancelAction") }
        });
        if (!confirmed || signal.aborted) {
          return {
            result: { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true },
            abortedEarly: true
          };
        }
      }
      const result = await collectFolderFiles(trackingTransport, picked.folderPath, IMPORT_RULES, {
        signal,
        onProgress: (p) => {
          if (!signal.aborted && mountedRef.current) setImportProgress(p);
        }
      });
      return { result, pickedFolderPath: picked.folderPath };
    });

  const handleExternalInput = (input: NormalizedFileInput) => {
    if (input.paths.length === 0) return;
    return runImportTask(async (signal, trackingTransport) => {
      const result = await expandInputPaths(trackingTransport, input.paths, IMPORT_RULES, {
        ...(input.directories ? { knownDirectories: input.directories } : {}),
        signal,
        onProgress: (p) => {
          if (!signal.aborted && mountedRef.current) setImportProgress(p);
        }
      });
      return { result };
    });
  };

  const handleExternalInputRef = useRef(handleExternalInput);
  handleExternalInputRef.current = handleExternalInput;

  // 旧版客户端没有 DeclarativeView 栈顶 onFileInput 路由时，订阅 plugin_files_dropped 并统一走同一导入函数
  useEffect(() => {
    if (!isRealElectronHost() || isDeclarativeFileInputSupported()) return;
    if (typeof window === "undefined") return;
    const events = (
      window as unknown as {
        ztools?: { events?: { on?: (ev: string, cb: (raw: unknown) => void) => (() => void) | void; off?: (ev: string, cb: (raw: unknown) => void) => void } };
      }
    ).ztools?.events;
    if (!events?.on) return;
    const handler = (raw: unknown) => {
      const normalized = normalizeFileInput(raw);
      if (normalized.paths.length > 0) {
        void handleExternalInputRef.current(normalized);
      }
    };
    const off = events.on("plugin_files_dropped", handler);
    return () => {
      if (typeof off === "function") off();
      else events.off?.("plugin_files_dropped", handler);
    };
  }, []);

  const importInputProps = createImportInputProps(
    (input) => {
      void handleExternalInput(input);
    },
    {
      dropTitle: t("dropTitle"),
      dropSubtitle: t("dropSubtitle")
    }
  );

  if (!isRealElectronHost()) {
    return List({
      searchBarPlaceholder: t("searchPlaceholderShort"),
      children: [
        List.Section({
          title: t("sectionBatchRename"),
          children: [
            List.Item({
              id: "batch-rename-client-required",
              title: t("notInClient"),
              subtitle: t("clientRequiredSub"),
              icon: Icon.Info
            })
          ]
        })
      ]
    });
  }

  const trimmedQuery = searchText.trim();
  const buildActiveRule = (): RenameRule => {
    if (trimmedQuery.includes("->")) {
      const [findPart, replacePart] = trimmedQuery.split("->");
      return {
        type: "replace",
        find: (findPart || "").trim(),
        replace: (replacePart || "").trim()
      };
    }
    switch (ruleType) {
      case "prefix":
        return { type: "prefix", prefix: trimmedQuery };
      case "date_prefix":
        return { type: "date_prefix" };
      case "suffix":
        return { type: "suffix", suffix: trimmedQuery };
      case "case":
        return { type: "case", caseMode: "lower" };
      case "number_cn":
        return { type: "number_cn" };
      case "number_roman":
        return { type: "number_roman" };
      case "trim_head3":
        return { type: "trim_head3" };
      case "clean_brackets":
        return { type: "clean_brackets" };
      case "snake_case":
        return { type: "snake_case" };
      case "number":
      default:
        return { type: "number", startNumber: 1, padDigits: 2 };
    }
  };

  const activeRule = buildActiveRule();

  const filterKeyword =
    trimmedQuery.includes("->") || ruleType === "prefix" || ruleType === "suffix"
      ? ""
      : trimmedQuery.normalize("NFC").toLowerCase();

  const buildOccupiedMap = (states: ReadonlyMap<string, DirectoryStateInfo>): Map<string, readonly string[]> => {
    const map = new Map<string, readonly string[]>();
    for (const [k, info] of states) {
      map.set(k, info.occupiedNames);
    }
    return map;
  };

  const computePreview = (
    sourceFiles: readonly RealFileEntry[],
    states: ReadonlyMap<string, DirectoryStateInfo>
  ): RenamePreviewItem[] => {
    const visible = sourceFiles.filter(
      (file) => !filterKeyword || file.name.normalize("NFC").toLowerCase().includes(filterKeyword)
    );
    return buildRenamePreview(visible, activeRule, buildOccupiedMap(states));
  };

  const checkedKeySet = new Set(checkedPaths.map(pathKey));
  const previewItems = computePreview(files, dirStates).map((item) => {
    const dirInfo = dirStates.get(pathKey(item.parentDir));
    return {
      ...item,
      isChecked: checkedKeySet.has(pathKey(item.fullPath)),
      writeAuthorized: dirInfo?.writeAuthorized === true
    };
  });

  const selectedItems = previewItems.filter((item) => item.isChecked);
  const runnableSelected = selectedItems.filter((item) => item.changed && !item.conflict);
  const changedSelectedCount = runnableSelected.length;
  const conflictCount = previewItems.filter((item) => item.conflict).length;

  const toggleFileCheck = (fullPath: string) => {
    const targetKey = pathKey(fullPath);
    setCheckedPaths((prev) =>
      prev.some((p) => pathKey(p) === targetKey)
        ? prev.filter((p) => pathKey(p) !== targetKey)
        : [...prev, fullPath]
    );
  };

  const toggleAllVisible = () => {
    const visiblePaths = previewItems.map((item) => item.fullPath);
    const visibleKeys = new Set(visiblePaths.map(pathKey));
    const allChecked = visiblePaths.length > 0 && visiblePaths.every((p) => checkedKeySet.has(pathKey(p)));
    if (allChecked) {
      setCheckedPaths((prev) => prev.filter((p) => !visibleKeys.has(pathKey(p))));
    } else {
      setCheckedPaths((prev) => {
        const existing = new Set(prev.map(pathKey));
        const added = visiblePaths.filter((p) => !existing.has(pathKey(p)));
        return [...prev, ...added];
      });
    }
  };

  const removeFileFromList = (targetPath: string) => {
    if (busyRef.current) {
      toast("failure", t("removeBusy"));
      return;
    }
    const targetKey = pathKey(targetPath);
    const nextFiles = filesRef.current.filter((f) => pathKey(f.fullPath) !== targetKey);
    const remainingDirKeys = new Set(nextFiles.map((f) => pathKey(f.parentDir)));
    const nextDirStates = new Map<string, DirectoryStateInfo>();
    for (const [k, state] of dirStatesRef.current) {
      if (remainingDirKeys.has(k)) nextDirStates.set(k, state);
    }
    filesRef.current = nextFiles;
    setFiles(nextFiles);
    setCheckedPaths((prev) => prev.filter((p) => pathKey(p) !== targetKey));
    syncDirStates(nextDirStates, nextFiles);
  };

  const clearAllFiles = () => {
    if (busyRef.current) {
      toast("failure", t("clearBusy"));
      return;
    }
    importSeqRef.current += 1;
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    setIsLoading(false);
    setImportProgress(null);
    setImportTruncated(false);
    filesRef.current = [];
    setFiles([]);
    setCheckedPaths([]);
    setUndoStack([]);
    syncDirStates(new Map(), []);
  };

  /**
   * 为指定目录通过系统选目录对话框请求读写授权，校验路径必须精确匹配 pathKey(picked) === pathKey(dir)
   */
  const authorizeDirectoryForWrite = async (
    dir: string,
    title: string,
    workingStates: Map<string, DirectoryStateInfo>
  ): Promise<{ ok: boolean; reason?: string; state?: DirectoryStateInfo }> => {
    const dirKey = pathKey(dir);
    const existing = workingStates.get(dirKey);
    if (existing?.writeAuthorized === true) {
      return { ok: true, state: existing };
    }
    const picked = await pickFolder(transport, { title, defaultPath: dir });
    if (!mountedRef.current) return { ok: false, reason: t("windowClosed") };
    if (picked.error) return { ok: false, reason: picked.error };
    if (picked.canceled || !picked.folderPath) return { ok: false, reason: t("authCanceled") };
    if (pathKey(picked.folderPath) !== dirKey) {
      return {
        ok: false,
        reason: t("authFolderMismatch", { picked: baseNameOf(picked.folderPath), expected: baseNameOf(dir) })
      };
    }
    const inspected = await inspectDirectoryState(dir);
    if (!mountedRef.current) return { ok: false, reason: t("windowClosed") };
    workingStates.set(dirKey, inspected);
    syncDirStates(new Map(workingStates), filesRef.current);
    if (inspected.hostOutdated) {
      return { ok: false, reason: hostUpgradeError(t("batchRenameFeature")).message, state: inspected };
    }
    if (!inspected.writeAuthorized) {
      return {
        ok: false,
        reason: inspected.error ? friendlyFileError(inspected.error) : t("authWriteFailed"),
        state: inspected
      };
    }
    return { ok: true, state: inspected };
  };

  /** 将改名或还原成功的结果精确同步到当前内存列表与目录占用名（只更新仍在列表里的条目） */
  const applyRenameResultsToState = async (
    mappings: ReadonlyArray<{ oldPath: string; newPath: string; oldName: string; newName: string }>,
    workingStates: Map<string, DirectoryStateInfo>
  ) => {
    if (mappings.length === 0 || !mountedRef.current) return;
    const byOldKey = new Map(mappings.map((m) => [pathKey(m.oldPath), m]));

    const nextFiles = filesRef.current.map((f) => {
      const hit = byOldKey.get(pathKey(f.fullPath));
      if (!hit) return f;
      const dot = hit.newName.lastIndexOf(".");
      return {
        ...f,
        name: hit.newName,
        fullPath: hit.newPath,
        extension: dot > 0 ? hit.newName.slice(dot).toLowerCase() : ""
      };
    });
    filesRef.current = nextFiles;
    setFiles(nextFiles);

    setCheckedPaths((prev) =>
      prev.map((p) => {
        const hit = byOldKey.get(pathKey(p));
        return hit ? hit.newPath : p;
      })
    );

    const touchedDirs = new Map<string, string>();
    for (const m of mappings) {
      const dir = parentDirOf(m.oldPath);
      const k = pathKey(dir);
      const prevState = workingStates.get(k);
      if (prevState) {
        workingStates.set(k, {
          ...prevState,
          occupiedNames: replaceNameInOccupied(prevState.occupiedNames, m.oldName, m.newName)
        });
      }
      if (k && dir && !touchedDirs.has(k)) touchedDirs.set(k, dir);
    }

    for (const [dirKey, dirPath] of touchedDirs) {
      const refreshed = await inspectDirectoryState(dirPath);
      if (!mountedRef.current) return;
      if (!refreshed.error) {
        workingStates.set(dirKey, refreshed);
      }
    }
    syncDirStates(new Map(workingStates), filesRef.current);
  };

  const runRename = async (targets: RenamePreviewItem[], mode: "batch" | "single") => {
    if (busyRef.current) return
    if (targets.length === 0) {
      toast(
        "failure",
        filesRef.current.length === 0
          ? t("noFilesAdded")
          : conflictCount > 0
            ? t("noRunnableConflict")
            : t("noCheckedNeedRename")
      );
      return;
    }

    busyRef.current = true;
    setIsProcessing(true);
    setIsLoading(true);

    try {
      const workingStates = new Map(dirStatesRef.current);
      const anyHostOutdated = Array.from(workingStates.values()).some((s) => s.hostOutdated);
      if (anyHostOutdated) {
        toast("failure", t("cannotRenameTitle"), hostUpgradeError(t("batchRenameFeature")).message);
        return;
      }

      if (mode === "batch") {
        const sample = targets[0]!;
        const confirmed = await confirmAlert({
          title: t("confirmBatchTitle", { count: targets.length }),
          message: t("confirmBatchMsg", { oldName: sample.name, newName: sample.newName }),
          primaryAction: { title: t("confirmRenameAction") },
          dismissAction: { title: t("cancelAction") }
        });
        if (!confirmed || !mountedRef.current) return;
      }

      // 按 parentDir 分组收集尚无写授权的目录，逐个请求写授权并校验选中的正是该目录
      const targetDirs = new Map<string, string>();
      for (const item of targets) {
        const k = pathKey(item.parentDir);
        if (k && !targetDirs.has(k)) targetDirs.set(k, item.parentDir);
      }

      const unauthorizedDirs = new Map<string, string>();
      for (const [dirKey, dir] of targetDirs) {
        const current = workingStates.get(dirKey);
        if (current?.writeAuthorized === true) continue;
        const authRes = await authorizeDirectoryForWrite(
          dir,
          t("authDirTitle", { name: baseNameOf(dir) }),
          workingStates
        );
        if (!mountedRef.current) return;
        if (!authRes.ok) {
          unauthorizedDirs.set(dirKey, authRes.reason || t("authNotObtained"));
        }
      }

      // 若全部目录均未取得写授权，不执行任何改名并如实提示
      if (unauthorizedDirs.size === targetDirs.size) {
        const reasons = Array.from(unauthorizedDirs.values());
        if (reasons.every((r) => r === t("authCanceled"))) {
          toast("failure", t("authCanceledNoChanges"));
        } else {
          toast("failure", t("authMissingTitle"), t("authMissingMsg", { reason: reasons[0] }));
        }
        return;
      }

      // 已授权目录读到了完整 occupiedNames，复核一次冲突（防止单文件只读预览期间未察觉同目录已有同名文件）
      const recomputed = computePreview(filesRef.current, workingStates);
      const freshByPath = new Map(recomputed.map((item) => [pathKey(item.fullPath), item]));

      const history: RenameUndoEntry[] = [];
      const failures: Array<{ name: string; error: string }> = [];
      const skippedUnauthorized: Array<{ name: string; error: string }> = [];
      const expiredDirKeys = new Set<string>();

      for (const item of targets) {
        const dirKey = pathKey(item.parentDir);
        if (unauthorizedDirs.has(dirKey)) {
          skippedUnauthorized.push({
            name: item.name,
            error: t("skippedUnauthorizedMsg", { reason: unauthorizedDirs.get(dirKey) })
          });
          continue;
        }
        if (expiredDirKeys.has(dirKey)) {
          failures.push({ name: item.name, error: t("skippedExpiredAuth") });
          continue;
        }
        const fresh = freshByPath.get(pathKey(item.fullPath));
        if (!fresh || !fresh.changed) {
          failures.push({ name: item.name, error: t("skippedNoChangeOrMissing") });
          continue;
        }
        if (fresh.conflict) {
          failures.push({
            name: item.name,
            error: t("skippedConflict", { reason: conflictReasonText(fresh.conflictReason), newName: fresh.newName })
          });
          continue;
        }

        const res = await executeRealFileRename(item.fullPath, fresh.newName);
        if (res.ok && res.destinationPath) {
          history.push({
            oldPath: item.fullPath,
            newPath: res.destinationPath,
            oldName: item.name,
            newName: fresh.newName
          });
          continue;
        }

        const friendly = friendlyFileError(resolveErrorMessage(res, t("renameFailedDefault")));
        failures.push({ name: item.name, error: friendly });
        if (isPermissionError(res.error)) {
          expiredDirKeys.add(dirKey);
          const prev = workingStates.get(dirKey);
          if (prev) {
            workingStates.set(dirKey, { ...prev, writeAuthorized: false });
          }
        }
      }

      if (history.length > 0) {
        setUndoStack(history);
      }
      await applyRenameResultsToState(history, workingStates);
      if (!mountedRef.current) return;

      const allIssues = [...failures, ...skippedUnauthorized];
      const total = targets.length;
      if (allIssues.length === 0) {
        toast(
          "success",
          mode === "single"
            ? t("renameSingleSuccess", { oldName: targets[0]!.name, newName: history[0]!.newName })
            : t("renameBatchSuccess", { count: history.length }),
          t("undoHint")
        );
      } else if (history.length === 0) {
        const first = allIssues[0]!;
        toast(
          "failure",
          skippedUnauthorized.length > 0 && failures.length === 0
            ? t("renameNoneExecuted", { total })
            : t("renameAllFailed", { total }),
          `${first.name}: ${first.error}`
        );
      } else {
        const first = allIssues[0]!;
        const issueNoun = skippedUnauthorized.length === 0 ? t("issueFailed") : t("issueIncomplete");
        toast(
          "failure",
          t("renamePartialTitle", { ok: history.length, total, fail: allIssues.length, noun: issueNoun }),
          t("renamePartialMsg", { name: first.name, error: first.error })
        );
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setIsProcessing(false);
        setIsLoading(false);
      }
    }
  };

  const executeBatchRename = () => runRename(runnableSelected, "batch");

  const handleUndoLastBatch = async () => {
    if (busyRef.current) return;
    if (undoStack.length === 0) {
      toast("failure", t("noUndoAvailable"));
      return;
    }
    busyRef.current = true;
    setIsProcessing(true);
    setIsLoading(true);
    try {
      const workingStates = new Map(dirStatesRef.current);
      let pending = [...undoStack];
      let res = await undoBatchRenameHistory(pending);

      // 若因授权失效失败，按目录逐个补授权后再重试尚未还原的部分
      if (res.failed.some((f) => isPermissionError(f.error))) {
        const retryEntries: RenameUndoEntry[] = [];
        const stillUnauthorized: Array<{ entry: RenameUndoEntry; error: string }> = [];
        const failedDirCache = new Map<string, string>();

        for (const item of res.failed) {
          if (!isPermissionError(item.error)) {
            stillUnauthorized.push(item);
            continue;
          }
          const dir = parentDirOf(item.entry.newPath);
          const dirKey = pathKey(dir);
          if (!failedDirCache.has(dirKey)) {
            const authRes = await authorizeDirectoryForWrite(
              dir,
              t("undoAuthDirTitle", { name: baseNameOf(dir) }),
              workingStates
            );
            if (!mountedRef.current) return;
            failedDirCache.set(dirKey, authRes.ok ? "" : authRes.reason || t("undoAuthMissing"));
          }
          const reason = failedDirCache.get(dirKey);
          if (reason) {
            stillUnauthorized.push({ entry: item.entry, error: reason });
          } else {
            retryEntries.push(item.entry);
          }
        }

        if (retryEntries.length > 0) {
          const retryOrdered = pending.filter((p) => retryEntries.some((r) => pathKey(r.newPath) === pathKey(p.newPath)));
          const second = await undoBatchRenameHistory(retryOrdered);
          res = {
            ok: second.ok && stillUnauthorized.length === 0,
            restoredCount: res.restoredCount + second.restoredCount,
            failed: [...stillUnauthorized, ...second.failed]
          };
        } else {
          res = { ...res, failed: stillUnauthorized };
        }
      }

      if (!mountedRef.current) return;
      const failedKeys = new Set(res.failed.map((f) => pathKey(f.entry.newPath)));
      const restoredEntries = pending.filter((entry) => !failedKeys.has(pathKey(entry.newPath)));

      await applyRenameResultsToState(
        restoredEntries.map((e) => ({
          oldPath: e.newPath,
          newPath: e.oldPath,
          oldName: e.newName,
          newName: e.oldName
        })),
        workingStates
      );
      if (!mountedRef.current) return;

      setUndoStack(res.failed.map((f) => f.entry));
      if (res.failed.length === 0) {
        toast("success", t("undoSuccessTitle", { count: res.restoredCount }));
      } else {
        const first = res.failed[0]!;
        toast(
          "failure",
          t("undoPartialTitle", { ok: res.restoredCount, fail: res.failed.length }),
          `${first.entry.newName}: ${friendlyFileError(first.error)}`
        );
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setIsProcessing(false);
        setIsLoading(false);
      }
    }
  };

  const revealInFileManager = async (fullPath: string) => {
    const manager = fileManagerName(fullPath);
    let res = await openRenameFileLocation(fullPath);
    if (!res.ok && isPermissionError(res.error)) {
      const dir = parentDirOf(fullPath);
      const workingStates = new Map(dirStatesRef.current);
      const authRes = await authorizeDirectoryForWrite(
        dir,
        t("revealAuthTitle", { name: baseNameOf(dir), manager }),
        workingStates
      );
      if (!mountedRef.current) return;
      if (!authRes.ok) {
        toast("failure", t("revealFailedTitle", { manager }), authRes.reason);
        return;
      }
      res = await openRenameFileLocation(fullPath);
    }
    if (!res.ok) {
      toast("failure", t("revealFailedTitle", { manager }), friendlyFileError(res.error));
    }
  };

  const activePresetMeta = rulePresets.find((r) => r.id === ruleType) || rulePresets[0]!;
  const cleanActiveRuleLabel = trimmedQuery.includes("->") ? t("ruleFindReplace") : activePresetMeta.label;

  const uniqueDirs = Array.from(new Set(files.map((f) => f.parentDir).filter(Boolean)));
  const readOnlyDirCount = Array.from(new Set(files.map((f) => pathKey(f.parentDir)).filter(Boolean))).filter(
    (k) => dirStates.get(k)?.writeAuthorized !== true
  ).length;
  const hasHostOutdated = Array.from(dirStates.values()).some((s) => s.hostOutdated);

  let summaryText = t("summaryEmpty");
  if (importProgress) {
    summaryText = t("summaryImporting", { dirs: importProgress.visitedDirs, files: importProgress.matchedFiles });
  } else if (files.length > 0) {
    const summaryParts: string[] = [
      uniqueDirs.length === 1
        ? t("summarySingleDir", { name: baseNameOf(uniqueDirs[0]!) })
        : t("summaryMultiDir", { files: files.length, dirs: uniqueDirs.length }),
      t("summaryRule", { label: cleanActiveRuleLabel }),
      t("summaryPending", { count: changedSelectedCount })
    ];
    if (!trimmedQuery && (ruleType === "prefix" || ruleType === "suffix")) {
      summaryParts.push(ruleType === "prefix" ? t("summaryHintPrefix") : t("summaryHintSuffix"));
    }
    if (conflictCount > 0) summaryParts.push(t("summaryConflict", { count: conflictCount }));
    if (undoStack.length > 0) summaryParts.push(t("summaryUndoable", { count: undoStack.length }));
    if (importTruncated) summaryParts.push(t("summaryTruncated", { max: MAX_RENAME_FILES }));
    if (hasHostOutdated) {
      summaryParts.push(t("summaryHostOutdated"));
    } else if (readOnlyDirCount > 0) {
      summaryParts.push(
        readOnlyDirCount === 1
          ? t("summaryReadOnlySingle")
          : t("summaryReadOnlyMulti", { count: readOnlyDirCount })
      );
    }
    summaryParts.push(t("summaryClearShortcut"));
    summaryText = summaryParts.join(" · ");
  }

  const maxSizeBytes = Math.max(1, ...previewItems.map((f) => f.sizeBytes ?? 0));

  const undoAction = () =>
    Action({
      title: t("actionUndo", { count: undoStack.length }),
      icon: Icon.RotateAntiClockwise,
      onAction: handleUndoLastBatch
    });

  const pickFilesAction = () =>
    Action({
      title: t("actionPickFilesEllipsis"),
      icon: Icon.Document,
      shortcut: { modifiers: ["ctrl"], key: "o" },
      onAction: () => {
        void handlePickFiles();
      }
    });

  const pickFolderAction = () =>
    Action({
      title: t("actionPickFolderEllipsis"),
      icon: Icon.Folder,
      shortcut: { modifiers: ["ctrl", "shift"], key: "o" },
      onAction: () => {
        void handlePickFolder();
      }
    });

  const leftNavNodes = rulePresets.map((preset) => {
    const isActive = ruleType === preset.id;
    return List.Item({
      id: `nav-rule-${preset.id}`,
      title: preset.label,
      subtitle: preset.desc,
      icon: Icon.Pencil,
      onSelect: () => setRuleType(preset.id),
      accessories: isActive ? [{ tag: { value: t("tagActiveRule") } }] : [],
      actions: ActionPanel({
        children: [
          Action({
            title: t("actionSwitchRule", { label: preset.label }),
            icon: Icon.CheckCircle,
            onAction: () => setRuleType(preset.id)
          }),
          Action({
            title: t("actionExecuteBatch", { count: changedSelectedCount }),
            icon: Icon.ArrowRight,
            onAction: executeBatchRename
          }),
          ...(undoStack.length > 0 ? [undoAction()] : [])
        ]
      })
    });
  });

  const allChecked = previewItems.length > 0 && previewItems.every((f) => f.isChecked);
  const someChecked = previewItems.some((f) => f.isChecked);

  const subListItems = previewItems.map((item) => {
    const sizeKnown = item.sizeBytes !== null;
    const ratio = sizeKnown ? Math.min(1, item.sizeBytes! / maxSizeBytes) : 0;
    const statusLabel = item.conflict
      ? t("statusConflict")
      : item.changed
        ? t("statusPending")
        : t("statusUnchanged");
    const manager = fileManagerName(item.fullPath);

    return List.Item({
      id: `rename-item-${item.fullPath}`,
      title: item.name,
      subtitle: item.conflict
        ? t("itemConflictSub", { newName: item.newName, reason: conflictReasonText(item.conflictReason) })
        : `-> ${item.newName}`,
      icon: Icon.Document,
      checkable: true,
      checked: item.isChecked,
      onCheckChange: () => toggleFileCheck(item.fullPath),
      onToggleCheck: () => toggleFileCheck(item.fullPath),
      accessories: [
        { progress: ratio },
        {
          tag: {
            value: statusLabel,
            color: item.conflict ? "red" : undefined
          }
        },
        {
          tag: {
            value: item.writeAuthorized ? t("tagAuthorized") : t("tagReadOnly")
          }
        },
        { text: sizeKnown ? formatBytes(item.sizeBytes!) : t("sizeUnknown") }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: t("actionExecuteSelected", { count: changedSelectedCount }),
            icon: Icon.CheckCircle,
            onAction: executeBatchRename
          }),
          Action({
            title: t("actionRevealInManager", { manager }),
            icon: Icon.Folder,
            onAction: () => revealInFileManager(item.fullPath)
          }),
          Action({
            title: t("actionRenameSingle"),
            icon: Icon.Document,
            onAction: async () => {
              if (!item.changed) {
                toast("failure", t("msgNoChangeNeeded"));
                return;
              }
              if (item.conflict) {
                toast("failure", t("msgCannotRenameConflict", { reason: conflictReasonText(item.conflictReason) }), item.newName);
                return;
              }
              await runRename([item], "single");
            }
          }),
          ...(undoStack.length > 0 ? [undoAction()] : []),
          ActionPanel.Section({
            title: t("sectionList"),
            children: [
              ...(!isProcessing
                ? [
                    Action({
                      title: t("actionRemove"),
                      icon: Icon.Minus,
                      shortcut: { modifiers: ["ctrl"], key: "backspace" },
                      onAction: () => removeFileFromList(item.fullPath)
                    })
                  ]
                : []),
              pickFilesAction(),
              pickFolderAction(),
              Action({
                title: allChecked ? t("actionDeselectAll") : t("actionSelectAll"),
                icon: Icon.CheckCircle,
                shortcut: { modifiers: ["ctrl"], key: "a" },
                onAction: toggleAllVisible
              }),
              Action({
                title: t("actionClearList"),
                icon: Icon.Trash,
                style: Action.Style.Destructive,
                shortcut: { modifiers: ["ctrl", "shift"], key: "backspace" },
                onAction: clearAllFiles
              })
            ]
          })
        ]
      })
    });
  });

  return List({
    ...importInputProps,
    isLoading,
    searchBarPlaceholder: t("searchPlaceholder"),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    filterBar: {
      summaryText,
      actions: [
        {
          id: "pick-files",
          title: t("btnPickFiles"),
          style: "secondary",
          onAction: () => {
            void handlePickFiles();
          }
        },
        {
          id: "pick-folder",
          title: t("btnPickFolder"),
          style: "secondary",
          onAction: () => {
            void handlePickFolder();
          }
        }
      ]
    },
    actions: ActionPanel({
      children: [
        pickFilesAction(),
        pickFolderAction(),
        ...(undoStack.length > 0 ? [undoAction()] : [])
      ]
    }),
    subList: {
      title:
        files.length > 0
          ? t("subListTitleWithCount", { total: previewItems.length, changed: changedSelectedCount })
          : t("subListTitleDefault"),
      subtitle: uniqueDirs.length === 1 ? uniqueDirs[0] : uniqueDirs.length > 1 ? t("subListSubMultiDir", { count: uniqueDirs.length }) : "",
      emptyText:
        files.length === 0
          ? t("emptyNoFiles")
          : t("emptyNoMatch"),
      checkable: previewItems.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: t("sectionRulesTitle"),
        subtitle: t("sectionRulesSubtitle"),
        children: leftNavNodes
      })
    ]
  });
}

export default BatchRenameCommand;
