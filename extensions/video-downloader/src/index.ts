/**
 * 视频下载界面（布局二：左侧当前链接与链接类型 + 右侧本次下载与手动导入的视频列表）
 *
 * - 搜索框右侧下拉框选择 yt-dlp 命令的画质与音轨档位（视频直链按原文件下载，不受档位影响）
 * - 顶栏固定「选择文件」「选择文件夹」2 个全局按钮，并支持拖入/粘贴文件夹展开导入
 * - 右栏仅展示本次下载完成或手动导入的视频，移入回收站只处理已勾选项且执行前必须确认
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
  useState,
  getLocale
} from "@ztools/declarative-ui";
import { isRealElectronHost } from "./native-ipc.js";
import {
  getStreamPlatforms,
  getVideoQualityPresets,
  VIDEO_IMPORT_RULES,
  VIDEO_IMPORT_SUPPORTED_TEXT,
  copyYtDlpCommand,
  createDownloadedVideoItem,
  createVideoImportTransport,
  describeVideoLink,
  downloadDirectVideo,
  fetchVideoDownloaderSnapshot,
  formatBytes,
  openLocalVideoFile,
  openLocalVideoFolder,
  toLocalMediaVideoItem,
  trashLocalVideoFiles,
  type LocalMediaVideoItem,
  type NativeInvocationResult,
  type VideoDownloaderSnapshot,
  type VideoQualityPresetId
} from "./logic.js";
import { t } from "./i18n.js";
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
const LINK_PATTERN = /(https?:\/\/|\bBV[0-9A-Za-z]{10}\b)/i;

function createEmptySnapshot(): VideoDownloaderSnapshot {
  const platforms = getStreamPlatforms();
  return {
    saveDir: "",
    clipboardUrl: "",
    detectedPlatform: platforms[platforms.length - 1],
    videos: [],
    totalSizeBytes: 0,
    updatedAt: ""
  };
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function formatVideoSize(bytes: number | null): string {
  return bytes === null ? t("sizeUnknown") : formatBytes(bytes);
}

function isDeclarativeFileInputSupported(): boolean {
  if (typeof window === "undefined") return true;
  const w = window as unknown as { __ztoolsDeclarativeFeatures?: { fileInput?: boolean } };
  return w.__ztoolsDeclarativeFeatures?.fileInput === true;
}

export function VideoDownloaderCommand() {
  useLocale();
  const inClient = isRealElectronHost();
  const transport = createVideoImportTransport();
  const [snapshot, setSnapshot] = useState<VideoDownloaderSnapshot>(() => createEmptySnapshot());
  const [videos, setVideos] = useState<LocalMediaVideoItem[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<VideoQualityPresetId>("q_1080p_mp4");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const [statusBanner, setStatusBanner] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<{ visitedDirs: number; matchedFiles: number } | null>(null);
  const [trashingIds, setTrashingIds] = useState<string[]>([]);

  const mountedRef = useRef<boolean>(true);
  const busyRef = useRef<boolean>(false);
  const importSeqRef = useRef<number>(0);
  const importAbortRef = useRef<AbortController | null>(null);
  const videosRef = useRef<LocalMediaVideoItem[]>([]);
  videosRef.current = videos;

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
      const data = await fetchVideoDownloaderSnapshot();
      if (!mountedRef.current) return;
      setSnapshot(data);
    } catch (err) {
      if (!mountedRef.current) return;
      setStatusBanner(t("errRefreshMeta", { err: err instanceof Error ? err.message : String(err) }));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const requireClient = (): boolean => {
    if (inClient) return true;
    setStatusBanner("");
    void showToast({ style: Toast.Style.Failure, title: t("outsideClient") });
    return false;
  };

  const commitImportedVideos = (result: FileImportResult) => {
    const incoming = result.files.map((f) => toLocalMediaVideoItem(f, t("sourceManualImport")));
    const { merged, added, duplicates } = mergeByPath(videosRef.current, incoming, (v) => v.path);
    if (added.length > 0) {
      videosRef.current = merged;
      setVideos(merged);
      setStatusBanner("");
    }
    const summary = summarizeImport(result, { added: added.length, duplicates }, VIDEO_IMPORT_SUPPORTED_TEXT);
    if (summary) {
      void showToast({
        style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: summary.title,
        message: summary.message
      });
    }
  };

  const runVideoImport = async (
    task: (signal: AbortSignal, onProgress: (p: { visitedDirs: number; matchedFiles: number }) => void) => Promise<FileImportResult>
  ) => {
    if (!requireClient()) return;
    importAbortRef.current?.abort();
    const controller = new AbortController();
    importAbortRef.current = controller;
    const seq = ++importSeqRef.current;
    setIsImporting(true);
    setImportProgress(null);
    try {
      const result = await task(controller.signal, (p) => {
        if (mountedRef.current && seq === importSeqRef.current) setImportProgress(p);
      });
      if (!mountedRef.current || seq !== importSeqRef.current) return;
      commitImportedVideos(result);
    } catch (err) {
      if (!mountedRef.current || seq !== importSeqRef.current) return;
      void showToast({ style: Toast.Style.Failure, title: t("toastImportFailed"), message: friendlyFileError(err) });
    } finally {
      if (mountedRef.current && seq === importSeqRef.current) {
        importAbortRef.current = null;
        setIsImporting(false);
        setImportProgress(null);
      }
    }
  };

  const handlePickFiles = () => {
    void runVideoImport(() => pickFiles(transport, VIDEO_IMPORT_RULES, { title: t("pickFilesTitle"), filterName: t("pickFilesFilter") }));
  };

  const handlePickFolder = () => {
    void runVideoImport(async (signal, onProgress) => {
      const picked = await pickFolder(transport, { title: t("pickFolderTitle"), defaultPath: snapshot.saveDir || undefined });
      if (picked.canceled) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true };
      if (picked.error || !picked.folderPath) {
        return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false, error: resolveErrorMessage(picked, t("errNoFolderSelected")) };
      }
      if (isVolumeRoot(picked.folderPath)) {
        const ok = await confirmAlert({
          title: t("confirmVolumeRootTitle", { root: picked.folderPath }),
          message: t("confirmVolumeRootMsg"),
          primaryAction: { title: t("actionContinueImport"), style: "default" }
        });
        if (!ok) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true };
      }
      return collectFolderFiles(transport, picked.folderPath, VIDEO_IMPORT_RULES, { signal, onProgress });
    });
  };

  const handleFileInput = (input: NormalizedFileInput) => {
    void runVideoImport((signal, onProgress) =>
      expandInputPaths(transport, input.paths, VIDEO_IMPORT_RULES, {
        knownDirectories: input.directories,
        signal,
        onProgress
      })
    );
  };

  useEffect(() => {
    mountedRef.current = true;
    if (inClient) void refreshHostMeta();

    let cleanupDrop: (() => void) | undefined;
    if (!isDeclarativeFileInputSupported()) {
      const ztools = (
        globalThis as {
          window?: {
            ztools?: {
              events?: {
                on?: (event: string, cb: (payload: unknown) => void) => (() => void) | void;
                off?: (event: string, cb: (payload: unknown) => void) => void;
              };
            };
          };
        }
      ).window?.ztools;
      if (typeof ztools?.events?.on === "function") {
        const handler = (raw: unknown) => {
          const input = normalizeFileInput(raw);
          if (input.paths.length > 0) handleFileInput(input);
        };
        const off = ztools.events.on("plugin_files_dropped", handler);
        cleanupDrop = () => {
          if (typeof off === "function") off();
          else ztools.events?.off?.("plugin_files_dropped", handler);
        };
      }
    }

    return () => {
      mountedRef.current = false;
      importSeqRef.current += 1;
      importAbortRef.current?.abort();
      cleanupDrop?.();
    };
  }, []);

  const fileInputProps = createImportInputProps(handleFileInput, {
    dropTitle: t("dropTitle"),
    dropSubtitle: t("dropSubtitle")
  });

  const trimmedSearch = searchText.trim();
  const searchHasLink = LINK_PATTERN.test(trimmedSearch);
  const activeInputText = searchHasLink ? trimmedSearch : snapshot.clipboardUrl;
  const link = describeVideoLink(activeInputText);
  const qualityPresets = getVideoQualityPresets();
  const currentQuality =
    qualityPresets.find((q) => q.id === selectedQuality) || qualityPresets[1];
  const keyword = searchHasLink ? "" : trimmedSearch.toLowerCase();

  const filteredVideos = videos.filter((video) => {
    if (!keyword) return true;
    return `${video.name} ${video.path} ${video.sourceDirLabel}`.toLowerCase().includes(keyword);
  });

  const checkedSet = new Set(checkedIds);
  const selectedVideos = videos.filter((v) => checkedSet.has(v.id));
  const selectedTotalBytes = selectedVideos.reduce((acc, item) => acc + (item.sizeBytes ?? 0), 0);

  const toggleVideoCheck = (id: string) => {
    setCheckedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleAllVisible = () => {
    const visibleIds = filteredVideos.map((v) => v.id);
    const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedSet.has(id));
    if (allChecked) {
      const removeSet = new Set(visibleIds);
      setCheckedIds((prev) => prev.filter((id) => !removeSet.has(id)));
    } else {
      setCheckedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleRemoveVideo = (video: LocalMediaVideoItem) => {
    if (trashingIds.includes(video.id)) {
      void showToast({ style: Toast.Style.Failure, title: t("toastTrashingWait") });
      return;
    }
    const next = videosRef.current.filter((item) => item.id !== video.id);
    videosRef.current = next;
    setVideos(next);
    setCheckedIds((prev) => prev.filter((id) => id !== video.id));
    setStatusBanner("");
  };

  const handleClearVideos = () => {
    if (busyRef.current) {
      void showToast({ style: Toast.Style.Failure, title: t("toastBusyWait") });
      return;
    }
    importSeqRef.current += 1;
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    setIsImporting(false);
    setImportProgress(null);
    videosRef.current = [];
    setVideos([]);
    setCheckedIds([]);
    setStatusBanner("");
  };

  const appendDownloadedVideo = (filePath: string, sizeBytes?: number) => {
    const item = createDownloadedVideoItem(filePath, sizeBytes);
    const targetKey = pathKey(item.path);
    const existsIdx = videosRef.current.findIndex((v) => pathKey(v.path) === targetKey);
    const next =
      existsIdx >= 0
        ? videosRef.current.map((v, idx) => (idx === existsIdx ? { ...item, id: v.id } : v))
        : [...videosRef.current, item];
    videosRef.current = next;
    setVideos(next);
  };

  const runAndReport = async (
    task: () => Promise<NativeInvocationResult>,
    onSuccess?: (res: NativeInvocationResult) => void
  ) => {
    busyRef.current = true;
    setIsLoading(true);
    try {
      const res = await task();
      if (!mountedRef.current) return;
      await reportResult(res);
      if (res.ok && onSuccess) onSuccess(res);
    } catch (err) {
      if (!mountedRef.current) return;
      await reportResult({
        ok: false,
        code: -1,
        error: "UNEXPECTED_ERROR",
        message: t("errUnexpectedOp", { err: err instanceof Error ? err.message : String(err) })
      });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const handleLinkPrimary = async () => {
    if (!requireClient()) return;
    if (link.directExt) {
      await runAndReport(
        () => downloadDirectVideo(link.url, snapshot.saveDir),
        (res) => {
          const data = res.data as { path?: unknown; size?: unknown } | undefined;
          if (typeof data?.path === "string" && data.path) {
            appendDownloadedVideo(data.path, typeof data.size === "number" ? data.size : undefined);
          }
        }
      );
    } else {
      await runAndReport(() => copyYtDlpCommand(link.url, snapshot.saveDir, currentQuality));
    }
  };

  const handleCopyCommand = async () => {
    if (!requireClient()) return;
    await runAndReport(() => copyYtDlpCommand(link.url, snapshot.saveDir, currentQuality));
  };

  const handleOpenFolder = async () => {
    if (!requireClient()) return;
    const res = await openLocalVideoFile(snapshot.saveDir);
    if (!res.ok) await reportResult(res);
  };

  const handleOpenVideo = async (path: string) => {
    const res = await openLocalVideoFile(path);
    if (!res.ok) await reportResult(res);
  };

  const handleShowVideo = async (path: string) => {
    const res = await openLocalVideoFolder(path);
    if (!res.ok) await reportResult(res);
  };

  const handleTrashChecked = async () => {
    const targets = selectedVideos;
    if (targets.length === 0) {
      setStatusBanner(t("bannerCheckBeforeTrash"));
      return;
    }
    const preview = targets
      .slice(0, 5)
      .map((v) => v.name)
      .join("\n");
    const more = targets.length > 5 ? t("moreFilesCount", { count: targets.length }) : "";
    const confirmed = await confirmAlert({
      title: t("confirmTrashTitle", { count: targets.length }),
      message: t("confirmTrashMsg", { size: formatBytes(selectedTotalBytes), preview, more }),
      primaryAction: { title: t("actionMoveToTrash"), style: "destructive" },
      dismissAction: { title: t("actionCancel") }
    });
    if (!confirmed) {
      setStatusBanner(t("bannerTrashCancelled"));
      return;
    }
    busyRef.current = true;
    setIsLoading(true);
    setTrashingIds(targets.map((v) => v.id));
    try {
      const res = await trashLocalVideoFiles(
        targets.map((v) => v.path),
        targets
      );
      if (!mountedRef.current) return;
      const failedText =
        res.failed.length > 0
          ? t("trashFailedPart", {
              count: res.failed.length,
              details: res.failed
                .slice(0, 3)
                .map((f) => `${baseName(f.path)} (${f.reason})`)
                .join(", ")
            })
          : "";
      const message =
        res.deletedCount > 0
          ? t("msgTrashedCount", { count: res.deletedCount, size: formatBytes(res.freedBytes), failed: failedText })
          : t("msgNoneTrashed", { failed: failedText });
      setStatusBanner(message);
      await showToast({
        style: res.failed.length === 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: message
      });
      const failedKeys = new Set(res.failed.map((f) => pathKey(f.path)));
      const targetKeys = new Set(targets.map((t) => pathKey(t.path)));
      const remaining = videosRef.current.filter((v) => {
        const key = pathKey(v.path);
        return !targetKeys.has(key) || failedKeys.has(key);
      });
      videosRef.current = remaining;
      setVideos(remaining);
      const remainingIds = new Set(remaining.map((v) => v.id));
      setCheckedIds((prev) => prev.filter((id) => remainingIds.has(id)));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setIsLoading(false);
        setTrashingIds([]);
      }
    }
  };

  const maxVideoBytes = Math.max(1, ...filteredVideos.map((v) => v.sizeBytes ?? 0));
  const allChecked = filteredVideos.length > 0 && filteredVideos.every((v) => checkedSet.has(v.id));
  const someChecked = filteredVideos.some((v) => checkedSet.has(v.id));

  const linkSummary = !link.url
    ? t("errNoStreamUrl")
    : link.directExt
      ? t("linkSummaryDirect", { ext: link.directExt.toUpperCase() })
      : t("linkSummaryCmd", { platform: link.platform.name, badge: currentQuality.badge });
  const summaryText = isImporting
    ? t("summaryImporting", { dirs: importProgress?.visitedDirs ?? 0, files: importProgress?.matchedFiles ?? 0 })
    : !inClient
      ? t("outsideClient")
      : statusBanner
        ? statusBanner
        : videos.length === 0
          ? t("summaryEmptyList", { link: linkSummary })
          : t("summaryWithList", { link: linkSummary, count: filteredVideos.length, selected: selectedVideos.length, size: formatBytes(selectedTotalBytes) });

  const linkPrimaryTitle = !link.url
    ? t("actionRereadClipboard")
    : link.directExt
      ? t("actionDownloadDirect")
      : t("actionCopyYtDlpBadge", { badge: currentQuality.badge });

  const pickFilesAction = () =>
    Action({
      title: t("actionPickFiles"),
      icon: Icon.Plus,
      shortcut: { modifiers: ["ctrl"], key: "o" },
      onAction: handlePickFiles
    });

  const pickFolderAction = () =>
    Action({
      title: t("actionPickFolder"),
      icon: Icon.Folder,
      shortcut: { modifiers: ["ctrl", "shift"], key: "o" },
      onAction: handlePickFolder
    });

  const clearListAction = () =>
    Action({
      title: t("actionClearList"),
      icon: Icon.Trash,
      style: Action.Style.Destructive,
      shortcut: { modifiers: ["ctrl", "shift"], key: "backspace" },
      onAction: handleClearVideos
    });

  const trashAction = () =>
    Action({
      title: t("actionTrashSelected", { count: selectedVideos.length, size: formatBytes(selectedTotalBytes) }),
      icon: Icon.Trash,
      style: Action.Style.Destructive,
      onAction: handleTrashChecked
    });

  const linkActions = () =>
    ActionPanel({
      children: [
        Action({
          title: linkPrimaryTitle,
          icon: !link.url ? Icon.ArrowClockwise : link.directExt ? Icon.Download : Icon.Clipboard,
          onAction: !link.url
            ? async () => {
                setStatusBanner("");
                await refreshHostMeta();
              }
            : handleLinkPrimary
        }),
        Action({
          title: t("actionOpenVideoFolder"),
          icon: Icon.Folder,
          onAction: handleOpenFolder
        }),
        ...(link.url && link.directExt
          ? [
              Action({
                title: t("actionCopyYtDlpBadge", { badge: currentQuality.badge }),
                icon: Icon.Clipboard,
                onAction: handleCopyCommand
              })
            ]
          : []),
        ...(selectedVideos.length > 0 ? [trashAction()] : []),
        ActionPanel.Section({
          title: t("sectionList"),
          children: [
            pickFilesAction(),
            pickFolderAction(),
            ...(videos.length > 0 ? [clearListAction()] : [])
          ]
        })
      ]
    });

  const leftNavNodes = [
    List.Item({
      id: "nav-current-link",
      title: link.url ? t("navCurrentLinkWithPlat", { platform: link.platform.name }) : t("navCurrentLink"),
      subtitle: link.url || t("navCurrentLinkSub"),
      icon: Icon.Link,
      accessories: [
        {
          tag: {
            value: !link.url ? t("tagUnrecognized") : link.directExt ? t("tagDirectDownloadable") : t("handlerCopyCmd")
          }
        }
      ],
      actions: linkActions()
    }),
    ...getStreamPlatforms().map((platform) => {
      const isDetected = Boolean(link.url) && link.platform.id === platform.id;
      return List.Item({
        id: `nav-plat-${platform.id}`,
        title: platform.name,
        subtitle: platform.features,
        icon: Icon.Globe,
        accessories: [{ tag: { value: isDetected ? t("tagCurrentLink") : platform.handlerName } }],
        actions: linkActions()
      });
    })
  ];

  const subListItems = filteredVideos.map((video) => {
    const isChecked = checkedSet.has(video.id);
    const isTrashing = trashingIds.includes(video.id);
    const dateStr = video.mtimeMs > 0 ? new Date(video.mtimeMs).toLocaleDateString(getLocale()) : "";

    return List.Item({
      id: `vid-item-${video.id}`,
      title: video.name,
      subtitle: dateStr ? `${video.path} · ${dateStr}` : video.path,
      icon: Icon.Video,
      checkable: true,
      checked: isChecked,
      onCheckChange: () => toggleVideoCheck(video.id),
      onToggleCheck: () => toggleVideoCheck(video.id),
      accessories: [
        ...(video.sizeBytes !== null ? [{ progress: Math.min(1, video.sizeBytes / maxVideoBytes) }] : []),
        { tag: { value: video.sourceDirLabel } },
        { text: formatVideoSize(video.sizeBytes) }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: t("actionOpenDefault"),
            icon: Icon.Play,
            onAction: () => handleOpenVideo(video.path)
          }),
          Action({
            title: t("actionRevealInExplorer"),
            icon: Icon.Folder,
            onAction: () => handleShowVideo(video.path)
          }),
          Action({
            title: isChecked ? t("actionUncheck") : t("actionCheck"),
            icon: Icon.CheckCircle,
            onAction: () => toggleVideoCheck(video.id)
          }),
          ...(selectedVideos.length > 0 ? [trashAction()] : []),
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
                      onAction: () => handleRemoveVideo(video)
                    })
                  ]),
              pickFilesAction(),
              pickFolderAction(),
              Action({
                title: allChecked ? t("actionUnselectAll") : t("actionSelectAll"),
                icon: Icon.CheckCircle,
                shortcut: { modifiers: ["ctrl"], key: "a" },
                onAction: toggleAllVisible
              }),
              clearListAction()
            ]
          })
        ]
      })
    });
  });

  const emptyText = !inClient
    ? t("outsideClient")
    : keyword && videos.length > 0
      ? t("emptyNoMatch")
      : t("emptyNoFiles");

  return List({
    ...fileInputProps,
    isLoading: isLoading || isImporting,
    searchBarPlaceholder: t("searchPlaceholder"),
    onSearchTextChange: (text: string) => setSearchText(text),
    isShowingDetail: false,
    actions: ActionPanel({
      children: [
        pickFilesAction(),
        pickFolderAction(),
        Action({
          title: t("actionRereadClipboard"),
          icon: Icon.ArrowClockwise,
          onAction: () => {
            setStatusBanner("");
            void refreshHostMeta();
          }
        }),
        Action({
          title: t("actionOpenVideoFolder"),
          icon: Icon.Folder,
          onAction: handleOpenFolder
        })
      ]
    }),
    searchBarAccessory: List.Dropdown({
      tooltip: t("qualityTooltip"),
      value: selectedQuality,
      onChange: (val) => setSelectedQuality(val as VideoQualityPresetId),
      children: qualityPresets.map((preset) =>
        List.Dropdown.Item({
          title: preset.name,
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
      title: t("subListTitle", { count: filteredVideos.length, size: formatBytes(selectedTotalBytes) }),
      subtitle: snapshot.saveDir,
      emptyText,
      checkable: filteredVideos.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: t("sectionLinksTitle"),
        subtitle: t("sectionLinksSub"),
        children: leftNavNodes
      })
    ]
  });
}

export default VideoDownloaderCommand;
