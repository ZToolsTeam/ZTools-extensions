/**
 * 多线程下载界面（布局二：左侧当前链接与下载文件分类 + 右侧可勾选文件列表）
 *
 * - 搜索框右侧下拉框选择 aria2 线程档位（16 / 8 / 4 / 1 线程，只在连接到本机 aria2 时生效）
 * - 单行状态条显示 aria2 连接状态、下载盘剩余空间（不足 10% 时提示）与勾选汇总，只保留 1 个全局「重新扫描」按钮
 * - 移入回收站只处理已勾选的文件，执行前必须确认
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
  useState
} from "@ztools/declarative-ui";
import { isRealElectronHost } from "./native-ipc.js";
import {
  ARIA2_ENDPOINT,
  DOWNLOAD_CATEGORIES,
  THREAD_SPLIT_PRESETS,
  copyAria2cCommand,
  deleteDownloadedFiles,
  detectDownloadUrlFromText,
  fetchMultiDownloadSnapshot,
  formatBytes,
  isDriveLowOnSpace,
  openDownloadedFile,
  openDownloadedFileLocation,
  startMultiThreadDownloadTask,
  type DownloadFileCategory,
  type MultiDownloadSnapshot,
  type NativeInvocationResult,
  type ThreadSplitPresetId
} from "./logic.js";

export const OUTSIDE_CLIENT_TEXT = "需要在 ZTools 客户端中使用";
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

export function MultiDownloadCommand() {
  const inClient = isRealElectronHost();
  const [snapshot, setSnapshot] = useState<MultiDownloadSnapshot>(() => createEmptySnapshot());
  const [selectedCategory, setSelectedCategory] = useState<DownloadFileCategory>("all");
  const [selectedPresetId, setSelectedPresetId] = useState<ThreadSplitPresetId>("threads_16");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const [statusBanner, setStatusBanner] = useState<string>(inClient ? "" : OUTSIDE_CLIENT_TEXT);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const reportResult = async (res: NativeInvocationResult) => {
    setStatusBanner(res.message);
    if (res.error === "CANCELED") return;
    await showToast({ style: res.ok ? Toast.Style.Success : Toast.Style.Failure, title: res.message });
  };

  const reloadDownloadSnapshot = async () => {
    if (!inClient) {
      setStatusBanner(OUTSIDE_CLIENT_TEXT);
      return;
    }
    setIsLoading(true);
    try {
      const data = await fetchMultiDownloadSnapshot();
      setSnapshot(data);
      // 扫描后不自动勾选，只保留仍然存在的已勾选项
      const existing = new Set(data.files.map((f) => f.id));
      setCheckedIds((prev) => prev.filter((id) => existing.has(id)));
    } catch (err) {
      setStatusBanner(`扫描下载文件夹失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void reloadDownloadSnapshot();
  }, []);

  const currentPreset =
    THREAD_SPLIT_PRESETS.find((p) => p.id === selectedPresetId) || THREAD_SPLIT_PRESETS[0];

  const trimmedSearch = searchText.trim();
  const searchHasLink = LINK_PATTERN.test(trimmedSearch);
  const keyword = searchHasLink ? "" : trimmedSearch.toLowerCase();
  const activeLink = searchHasLink ? detectDownloadUrlFromText(trimmedSearch) : null;
  const activeDownloadUrl = activeLink?.url || snapshot.sniffedClipboardUrl;
  const activeProtocol = activeLink?.url ? activeLink.protocol : snapshot.sniffedProtocol;

  const filteredFiles = snapshot.files.filter((file) => {
    if (selectedCategory !== "all" && file.category !== selectedCategory) return false;
    if (keyword) {
      const hay = `${file.name} ${file.path} ${file.categoryName}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  const checkedSet = new Set(checkedIds);
  const selectedFiles = snapshot.files.filter((file) => checkedSet.has(file.id));
  const selectedTotalBytes = selectedFiles.reduce((acc, item) => acc + item.sizeBytes, 0);

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

  const runAndReport = async (task: () => Promise<NativeInvocationResult>, reloadOnSuccess = false) => {
    setIsLoading(true);
    try {
      const res = await task();
      await reportResult(res);
      if (res.ok && reloadOnSuccess) await reloadDownloadSnapshot();
    } catch (err) {
      await reportResult({
        ok: false,
        code: -1,
        error: "UNEXPECTED_ERROR",
        message: `操作失败: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setIsLoading(false);
    }
  };

  const requireClient = (): boolean => {
    if (inClient) return true;
    setStatusBanner(OUTSIDE_CLIENT_TEXT);
    return false;
  };

  const handleStartDownload = async () => {
    if (!requireClient()) return;
    if (!activeDownloadUrl) {
      setStatusBanner("");
      await reloadDownloadSnapshot();
      return;
    }
    await runAndReport(
      () => startMultiThreadDownloadTask(activeDownloadUrl, snapshot.downloadDir, currentPreset),
      true
    );
  };

  const handleCopyCommand = async () => {
    if (!requireClient()) return;
    await runAndReport(() => copyAria2cCommand(activeDownloadUrl, snapshot.downloadDir, currentPreset));
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
      setStatusBanner("请先勾选要移入回收站的文件");
      return;
    }
    const preview = targetList
      .slice(0, 5)
      .map((f) => f.name)
      .join("\n");
    const more = targetList.length > 5 ? `\n等 ${targetList.length} 个文件` : "";
    const confirmed = await confirmAlert({
      title: `把 ${targetList.length} 个文件移入回收站？`,
      message: `共 ${formatBytes(selectedTotalBytes)}，可在系统回收站中恢复。\n${preview}${more}`,
      primaryAction: { title: "移入回收站", style: "destructive" },
      dismissAction: { title: "取消" }
    });
    if (!confirmed) {
      setStatusBanner("已取消移入回收站");
      return;
    }
    setIsLoading(true);
    try {
      const res = await deleteDownloadedFiles(
        targetList.map((f) => f.path),
        targetList
      );
      const failedText =
        res.failed.length > 0
          ? `；${res.failed.length} 个失败：${res.failed
              .slice(0, 3)
              .map((f) => `${baseName(f.path)}（${f.reason}）`)
              .join("、")}`
          : "";
      const message =
        res.deletedCount > 0
          ? `已将 ${res.deletedCount} 个文件移入回收站（${formatBytes(res.freedBytes)}）${failedText}`
          : `没有文件被移入回收站${failedText}`;
      setStatusBanner(message);
      await showToast({
        style: res.failed.length === 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: message
      });
      // 失败的条目保持勾选，方便重试；成功的条目取消勾选
      const failedSet = new Set(res.failed.map((f) => f.path));
      setCheckedIds((prev) => prev.filter((id) => failedSet.has(id)));
      await reloadDownloadSnapshot();
    } finally {
      setIsLoading(false);
    }
  };

  const maxCategoryBytes = Math.max(1, ...snapshot.categoryStats.map((c) => c.sizeBytes));
  const maxFileBytes = Math.max(1, ...filteredFiles.map((f) => f.sizeBytes));
  const driveLowSpace = isDriveLowOnSpace(snapshot);

  const aria2Text = snapshot.aria2Status.online
    ? `aria2 已连接（${currentPreset.name}）`
    : "未连接 aria2：HTTP 链接用客户端单连接下载，线程档位不生效";
  const driveText = !snapshot.driveInfoAvailable
    ? "下载盘剩余空间未知"
    : `${snapshot.driveLetter} 剩余 ${formatBytes(snapshot.driveFreeBytes)}${driveLowSpace ? "（不足 10%）" : ""}`;
  const summaryText =
    statusBanner ||
    `${aria2Text} · ${driveText} · 已选 ${selectedFiles.length}/${filteredFiles.length} 项 (${formatBytes(selectedTotalBytes)})`;

  const trashAction = () =>
    Action({
      title: `移入回收站（已勾选 ${selectedFiles.length} 项 / ${formatBytes(selectedTotalBytes)}）`,
      icon: Icon.Trash,
      style: "destructive",
      onAction: handleBatchTrashSelected
    });

  const openFolderAction = () =>
    Action({
      title: "打开下载文件夹",
      icon: Icon.Folder,
      onAction: handleOpenFolder
    });

  const linkItem = List.Item({
    id: "nav-dl-link",
    title: activeDownloadUrl ? `当前链接 · ${activeProtocol}` : "当前链接",
    subtitle: activeDownloadUrl || "复制下载链接后点「重新扫描」，或把链接粘贴到搜索框",
    icon: Icon.Link,
    accessories: [
      ...(driveLowSpace ? [{ tag: { value: "磁盘空间不足 10%", color: Color.Red } }] : []),
      { tag: { value: !activeDownloadUrl ? "未识别" : snapshot.aria2Status.online ? "aria2 多线程" : "单连接" } }
    ],
    actions: ActionPanel({
      children: [
        Action({
          title: activeDownloadUrl ? "下载此链接" : "重新读取剪贴板链接",
          icon: activeDownloadUrl ? Icon.Download : Icon.ArrowClockwise,
          onAction: handleStartDownload
        }),
        openFolderAction(),
        ...(activeDownloadUrl
          ? [
              Action({
                title: `复制 aria2c 命令（${currentPreset.name}）`,
                icon: Icon.Clipboard,
                onAction: handleCopyCommand
              })
            ]
          : []),
        ...(selectedFiles.length > 0 ? [trashAction()] : [])
      ]
    })
  });

  const leftNavNodes = [
    linkItem,
    List.Item({
      id: "nav-dl-all",
      title: "全部已下载文件",
      subtitle: `${snapshot.downloadDir} (${snapshot.files.length} 个文件)`,
      icon: Icon.Folder,
      onSelect: () => setSelectedCategory("all"),
      accessories: [
        { tag: { value: `${snapshot.files.length} 项` } },
        { text: formatBytes(snapshot.totalSizeBytes) }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: "查看全部文件",
            icon: Icon.Filter,
            onAction: () => setSelectedCategory("all")
          }),
          openFolderAction(),
          ...(selectedFiles.length > 0 ? [trashAction()] : [])
        ]
      })
    }),
    ...DOWNLOAD_CATEGORIES.map((cat) => {
      const stat = snapshot.categoryStats.find((s) => s.category === cat.id);
      const catSize = stat?.sizeBytes || 0;
      const catCount = stat?.count || 0;
      const ratio = Math.min(1, catSize / maxCategoryBytes);

      return List.Item({
        id: `nav-dl-${cat.id}`,
        title: cat.name,
        subtitle: cat.exts.length > 0 ? `后缀: ${cat.exts.slice(0, 5).join(" ")}` : "其他未分类下载文件",
        icon: Icon.Document,
        onSelect: () => setSelectedCategory(cat.id),
        accessories: [
          { progress: ratio },
          { tag: { value: `${catCount} 项` } },
          { text: formatBytes(catSize) }
        ],
        actions: ActionPanel({
          children: [
            Action({
              title: `只看${cat.name}`,
              icon: Icon.Filter,
              onAction: () => setSelectedCategory(cat.id)
            }),
            openFolderAction(),
            ...(selectedFiles.length > 0 ? [trashAction()] : [])
          ]
        })
      });
    })
  ];

  const subListItems = filteredFiles.map((file) => {
    const isChecked = checkedSet.has(file.id);
    const ratio = Math.min(1, file.sizeBytes / maxFileBytes);
    const dateStr = file.mtimeMs > 0 ? new Date(file.mtimeMs).toLocaleDateString() : "";

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
        { progress: ratio },
        { tag: { value: file.categoryName } },
        { text: formatBytes(file.sizeBytes) }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: "用默认程序打开",
            icon: Icon.ArrowRight,
            onAction: () => handleOpenFile(file.path)
          }),
          Action({
            title: "在资源管理器中显示",
            icon: Icon.Folder,
            onAction: () => handleShowFile(file.path)
          }),
          Action({
            title: isChecked ? "取消勾选" : "勾选",
            icon: Icon.CheckCircle,
            onAction: () => toggleFileCheck(file.id)
          }),
          ...(selectedFiles.length > 0 ? [trashAction()] : [])
        ]
      })
    });
  });

  const activeCategoryName =
    selectedCategory === "all"
      ? "全部已下载文件"
      : DOWNLOAD_CATEGORIES.find((c) => c.id === selectedCategory)?.name || "下载文件";

  const allChecked = filteredFiles.length > 0 && filteredFiles.every((f) => checkedSet.has(f.id));
  const someChecked = filteredFiles.some((f) => checkedSet.has(f.id));

  return List({
    isLoading,
    searchBarPlaceholder: "粘贴 HTTP/HTTPS/FTP/磁力链接，或搜索「下载」文件夹里的文件名...",
    onSearchTextChange: (text: string) => setSearchText(text),
    isShowingDetail: false,
    searchBarAccessory: List.Dropdown({
      tooltip: "aria2 线程档位（只在连接到本机 aria2 时生效）",
      value: selectedPresetId,
      onChange: (val) => setSelectedPresetId(val as ThreadSplitPresetId),
      children: THREAD_SPLIT_PRESETS.map((preset) =>
        List.Dropdown.Item({
          title: `${preset.name} (分块 ${preset.splitSize})`,
          value: preset.id
        })
      )
    }),
    filterBar: {
      summaryText,
      actions: [
        {
          id: "rescan",
          title: "重新扫描",
          style: "secondary",
          onAction: () => {
            setStatusBanner(inClient ? "" : OUTSIDE_CLIENT_TEXT);
            void reloadDownloadSnapshot();
          }
        }
      ]
    },
    subList: {
      title: `${activeCategoryName} (${filteredFiles.length} 项 · 已选 ${formatBytes(selectedTotalBytes)})`,
      subtitle: snapshot.downloadDir,
      emptyText: inClient ? "当前分类下没有匹配的下载文件" : OUTSIDE_CLIENT_TEXT,
      checkable: filteredFiles.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: "链接与文件分类",
        subtitle: `${snapshot.files.length} 个文件`,
        children: leftNavNodes
      })
    ]
  });
}

export default MultiDownloadCommand;
