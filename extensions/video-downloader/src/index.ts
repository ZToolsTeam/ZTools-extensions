/**
 * 视频下载界面（布局二：左侧当前链接与链接类型 + 右侧可勾选的本机视频列表）
 *
 * - 搜索框右侧下拉框选择 yt-dlp 命令的画质与音轨档位（视频直链按原文件下载，不受档位影响）
 * - 单行状态条显示当前链接的处理方式、档位与勾选汇总，只保留 1 个全局「重新扫描」按钮
 * - 移入回收站只处理已勾选的视频，执行前必须确认
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
  useState
} from "@ztools/declarative-ui";
import { isRealElectronHost } from "./native-ipc.js";
import {
  STREAM_PLATFORMS,
  VIDEO_QUALITY_PRESETS,
  copyYtDlpCommand,
  describeVideoLink,
  downloadDirectVideo,
  fetchVideoDownloaderSnapshot,
  formatBytes,
  openLocalVideoFile,
  openLocalVideoFolder,
  trashLocalVideoFiles,
  type NativeInvocationResult,
  type VideoDownloaderSnapshot,
  type VideoQualityPresetId
} from "./logic.js";

export const OUTSIDE_CLIENT_TEXT = "需要在 ZTools 客户端中使用";
const LINK_PATTERN = /(https?:\/\/|\bBV[0-9A-Za-z]{10}\b)/i;

function createEmptySnapshot(): VideoDownloaderSnapshot {
  return {
    saveDir: "",
    clipboardUrl: "",
    detectedPlatform: STREAM_PLATFORMS[STREAM_PLATFORMS.length - 1],
    videos: [],
    totalSizeBytes: 0,
    updatedAt: ""
  };
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export function VideoDownloaderCommand() {
  const inClient = isRealElectronHost();
  const [snapshot, setSnapshot] = useState<VideoDownloaderSnapshot>(() => createEmptySnapshot());
  const [selectedQuality, setSelectedQuality] = useState<VideoQualityPresetId>("q_1080p_mp4");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const [statusBanner, setStatusBanner] = useState<string>(inClient ? "" : OUTSIDE_CLIENT_TEXT);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const reportResult = async (res: NativeInvocationResult) => {
    setStatusBanner(res.message);
    if (res.error === "CANCELED") return;
    await showToast({ style: res.ok ? Toast.Style.Success : Toast.Style.Failure, title: res.message });
  };

  const reloadVideoSnapshot = async () => {
    if (!inClient) {
      setStatusBanner(OUTSIDE_CLIENT_TEXT);
      return;
    }
    setIsLoading(true);
    try {
      const data = await fetchVideoDownloaderSnapshot();
      setSnapshot(data);
      // 扫描后不自动勾选，只保留仍然存在的已勾选项
      const existing = new Set(data.videos.map((v) => v.id));
      setCheckedIds((prev) => prev.filter((id) => existing.has(id)));
    } catch (err) {
      setStatusBanner(`扫描本机视频失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void reloadVideoSnapshot();
  }, []);

  const trimmedSearch = searchText.trim();
  const searchHasLink = LINK_PATTERN.test(trimmedSearch);
  const activeInputText = searchHasLink ? trimmedSearch : snapshot.clipboardUrl;
  const link = describeVideoLink(activeInputText);
  const currentQuality =
    VIDEO_QUALITY_PRESETS.find((q) => q.id === selectedQuality) || VIDEO_QUALITY_PRESETS[1];
  const keyword = searchHasLink ? "" : trimmedSearch.toLowerCase();

  const filteredVideos = snapshot.videos.filter((video) => {
    if (!keyword) return true;
    return `${video.name} ${video.path} ${video.sourceDirLabel}`.toLowerCase().includes(keyword);
  });

  const checkedSet = new Set(checkedIds);
  const selectedVideos = snapshot.videos.filter((v) => checkedSet.has(v.id));
  const selectedTotalBytes = selectedVideos.reduce((acc, item) => acc + item.sizeBytes, 0);

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

  const runAndReport = async (task: () => Promise<NativeInvocationResult>, reloadOnSuccess = false) => {
    setIsLoading(true);
    try {
      const res = await task();
      await reportResult(res);
      if (res.ok && reloadOnSuccess) await reloadVideoSnapshot();
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

  const handleLinkPrimary = async () => {
    if (!requireClient()) return;
    if (link.directExt) {
      await runAndReport(() => downloadDirectVideo(link.url, snapshot.saveDir), true);
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
      setStatusBanner("请先勾选要移入回收站的视频");
      return;
    }
    const preview = targets
      .slice(0, 5)
      .map((v) => v.name)
      .join("\n");
    const more = targets.length > 5 ? `\n等 ${targets.length} 个文件` : "";
    const confirmed = await confirmAlert({
      title: `把 ${targets.length} 个视频移入回收站？`,
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
      const res = await trashLocalVideoFiles(
        targets.map((v) => v.path),
        targets
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
          ? `已将 ${res.deletedCount} 个视频移入回收站（${formatBytes(res.freedBytes)}）${failedText}`
          : `没有视频被移入回收站${failedText}`;
      setStatusBanner(message);
      await showToast({
        style: res.failed.length === 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: message
      });
      // 失败的条目保持勾选，方便重试；成功的条目取消勾选
      const failedSet = new Set(res.failed.map((f) => f.path));
      setCheckedIds((prev) => prev.filter((id) => failedSet.has(id)));
      await reloadVideoSnapshot();
    } finally {
      setIsLoading(false);
    }
  };

  const maxVideoBytes = Math.max(1, ...filteredVideos.map((v) => v.sizeBytes));

  const linkSummary = !link.url
    ? "未识别到视频链接"
    : link.directExt
      ? `视频直链（${link.directExt.toUpperCase()}）可下载`
      : `${link.platform.name} 链接：只能复制 yt-dlp 命令（${currentQuality.badge}）`;
  const summaryText =
    statusBanner ||
    `${linkSummary} · 本机视频 ${filteredVideos.length} 个 (已选 ${selectedVideos.length} 个 / ${formatBytes(selectedTotalBytes)})`;

  const linkPrimaryTitle = !link.url
    ? "重新读取剪贴板链接"
    : link.directExt
      ? "下载视频直链"
      : `复制 yt-dlp 命令（${currentQuality.badge}）`;

  const trashAction = () =>
    Action({
      title: `移入回收站（已勾选 ${selectedVideos.length} 个 / ${formatBytes(selectedTotalBytes)}）`,
      icon: Icon.Trash,
      style: "destructive",
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
                setStatusBanner(inClient ? "" : OUTSIDE_CLIENT_TEXT);
                await reloadVideoSnapshot();
              }
            : handleLinkPrimary
        }),
        Action({
          title: "打开视频文件夹",
          icon: Icon.Folder,
          onAction: handleOpenFolder
        }),
        ...(link.url && link.directExt
          ? [
              Action({
                title: `复制 yt-dlp 命令（${currentQuality.badge}）`,
                icon: Icon.Clipboard,
                onAction: handleCopyCommand
              })
            ]
          : []),
        ...(selectedVideos.length > 0 ? [trashAction()] : [])
      ]
    });

  const leftNavNodes = [
    List.Item({
      id: "nav-current-link",
      title: link.url ? `当前链接 · ${link.platform.name}` : "当前链接",
      subtitle: link.url || "复制视频链接后点「重新扫描」，或把链接、BV 号粘贴到搜索框",
      icon: Icon.Link,
      accessories: [
        {
          tag: {
            value: !link.url ? "未识别" : link.directExt ? "可直接下载" : "复制 yt-dlp 命令"
          }
        }
      ],
      actions: linkActions()
    }),
    ...STREAM_PLATFORMS.map((platform) => {
      const isDetected = Boolean(link.url) && link.platform.id === platform.id;
      return List.Item({
        id: `nav-plat-${platform.id}`,
        title: platform.name,
        subtitle: platform.features,
        icon: Icon.Globe,
        accessories: [{ tag: { value: isDetected ? "当前链接" : platform.handlerName } }],
        actions: linkActions()
      });
    })
  ];

  const subListItems = filteredVideos.map((video) => {
    const isChecked = checkedSet.has(video.id);
    const ratio = Math.min(1, video.sizeBytes / maxVideoBytes);
    const dateStr = video.mtimeMs > 0 ? new Date(video.mtimeMs).toLocaleDateString() : "";

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
        { progress: ratio },
        { tag: { value: video.sourceDirLabel } },
        { text: formatBytes(video.sizeBytes) }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: "用默认程序打开",
            icon: Icon.Play,
            onAction: () => handleOpenVideo(video.path)
          }),
          Action({
            title: "在资源管理器中显示",
            icon: Icon.Folder,
            onAction: () => handleShowVideo(video.path)
          }),
          Action({
            title: isChecked ? "取消勾选" : "勾选",
            icon: Icon.CheckCircle,
            onAction: () => toggleVideoCheck(video.id)
          }),
          ...(selectedVideos.length > 0 ? [trashAction()] : [])
        ]
      })
    });
  });

  const allChecked = filteredVideos.length > 0 && filteredVideos.every((v) => checkedSet.has(v.id));
  const someChecked = filteredVideos.some((v) => checkedSet.has(v.id));

  return List({
    isLoading,
    searchBarPlaceholder: "粘贴视频链接或 BV 号，或搜索本机视频文件名...",
    onSearchTextChange: (text: string) => setSearchText(text),
    isShowingDetail: false,
    searchBarAccessory: List.Dropdown({
      tooltip: "yt-dlp 命令的画质与音轨档位（视频直链按原文件下载）",
      value: selectedQuality,
      onChange: (val) => setSelectedQuality(val as VideoQualityPresetId),
      children: VIDEO_QUALITY_PRESETS.map((preset) =>
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
          id: "rescan",
          title: "重新扫描",
          style: "secondary",
          onAction: () => {
            setStatusBanner(inClient ? "" : OUTSIDE_CLIENT_TEXT);
            void reloadVideoSnapshot();
          }
        }
      ]
    },
    subList: {
      title: `本机视频 (${filteredVideos.length} 个 · 已选 ${formatBytes(selectedTotalBytes)})`,
      subtitle: snapshot.saveDir,
      emptyText: inClient ? "「视频」和「下载」文件夹里没有找到视频文件" : OUTSIDE_CLIENT_TEXT,
      checkable: filteredVideos.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: "链接",
        subtitle: "平台链接只能复制 yt-dlp 命令",
        children: leftNavNodes
      })
    ]
  });
}

export default VideoDownloaderCommand;
