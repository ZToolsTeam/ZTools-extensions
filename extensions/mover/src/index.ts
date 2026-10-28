/**
 * C 盘搬家（布局二：左侧目录分类 + 右侧可勾选目录明细）
 *
 * - 搜索框右侧下拉框选择目标分区（<盘符>\ZToolsMoved）
 * - 目录默认不勾选；迁移只作用于已勾选的目录，执行前确认，并在系统窗口里授权目标分区
 * - 左侧分类只用来筛选，不触发迁移
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
  useRef,
  useState
} from "@ztools/declarative-ui";
import { isRealElectronHost } from "./native-ipc.js";
import {
  MOVER_CATEGORIES,
  NOT_IN_CLIENT_MESSAGE,
  authorizeMoveTarget,
  createEmptyMoverSnapshot,
  destinationPathFor,
  executeDirectoryMove,
  fetchMoverSnapshot,
  formatBytes,
  openMoverFolderLocation,
  validateMoveSelection,
  type MovableFolderItem,
  type MoverCategory,
  type MoverSnapshot
} from "./logic.js";

export function MoverCommand() {
  const isRealHost = isRealElectronHost();
  const [snapshot, setSnapshot] = useState<MoverSnapshot>(() =>
    createEmptyMoverSnapshot(isRealHost ? undefined : NOT_IN_CLIENT_MESSAGE)
  );
  const [selectedCategory, setSelectedCategory] = useState<MoverCategory>("all");
  const [targetRoot, setTargetRoot] = useState<string>("");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const [statusBanner, setStatusBanner] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(isRealHost);
  const busy = useRef(false);

  const reloadMoverSnapshot = async () => {
    if (!isRealHost) return;
    setIsLoading(true);
    try {
      const data = await fetchMoverSnapshot();
      setSnapshot(data);
      // 重新扫描后只保留仍然存在的勾选，不自动勾选任何目录
      const ids = new Set(data.folders.map((f) => f.id));
      setCheckedIds((prev) => prev.filter((id) => ids.has(id)));
      setTargetRoot((prev) =>
        data.targetDrives.some((d) => d.targetRoot === prev) ? prev : data.targetDrives[0]?.targetRoot || ""
      );
      if (data.error) setStatusBanner(data.error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void reloadMoverSnapshot();
  }, []);

  const keyword = searchText.trim().toLowerCase();
  const visibleFolders = snapshot.folders.filter((folder) => {
    if (selectedCategory !== "all" && folder.category !== selectedCategory) return false;
    if (keyword) {
      const hay = `${folder.name} ${folder.sourcePath} ${folder.categoryName}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  const checkedSet = new Set(checkedIds);
  const selectedFolders = snapshot.folders.filter((f) => checkedSet.has(f.id));
  const selectedBytes = selectedFolders.reduce((acc, item) => acc + item.sizeBytes, 0);
  const targetDrive = snapshot.targetDrives.find((d) => d.targetRoot === targetRoot);

  const toggleFolderCheck = (folder: MovableFolderItem) => {
    setCheckedIds((prev) =>
      prev.includes(folder.id) ? prev.filter((id) => id !== folder.id) : [...prev, folder.id]
    );
  };

  const toggleAllVisible = () => {
    const visibleIds = visibleFolders.map((f) => f.id);
    const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedSet.has(id));
    if (allChecked) {
      const removeSet = new Set(visibleIds);
      setCheckedIds((prev) => prev.filter((id) => !removeSet.has(id)));
    } else {
      setCheckedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleBatchMove = async () => {
    if (!isRealHost) {
      await showToast({ style: Toast.Style.Failure, title: NOT_IN_CLIENT_MESSAGE });
      return;
    }
    if (busy.current) return;
    if (!targetRoot) {
      await showToast({ style: Toast.Style.Failure, title: "没有可用的目标分区", message: "需要 C 盘以外的分区" });
      return;
    }
    const folders = selectedFolders;
    const invalid = validateMoveSelection(folders, targetRoot, targetDrive?.freeBytes || 0);
    if (invalid) {
      await showToast({ style: Toast.Style.Failure, title: "无法迁移", message: invalid });
      return;
    }
    busy.current = true;
    try {
      const list = folders
        .map((f) => `- ${f.name}：${f.sourcePath}（约 ${formatBytes(f.sizeBytes)}）`)
        .join("\n");
      const confirmed = await confirmAlert({
        title: `迁移 ${folders.length} 个目录到 ${targetRoot}？`,
        message:
          `${list}\n\n` +
          "会先把目录复制到目标位置，再把原目录改名、在原位置建立指向新位置的目录联接，成功后删除原目录。" +
          "迁移前请退出微信、QQ 等正在使用这些目录的程序。插件不提供迁回功能。\n\n" +
          "确认后还需要在弹出的窗口里选择目标分区，授权插件检查目标位置并在失败时清理复制的内容。",
        primaryAction: { title: "迁移", style: "destructive" }
      });
      if (!confirmed) return;
      const grant = await authorizeMoveTarget(targetRoot);
      if (!grant.ok) {
        if (grant.canceled) {
          setStatusBanner("已取消，没有迁移任何目录");
        } else {
          await showToast({ style: Toast.Style.Failure, title: "没有获得目标位置授权", message: grant.error });
        }
        return;
      }
      setIsLoading(true);
      const res = await executeDirectoryMove(folders, targetRoot);
      setStatusBanner(res.message);
      const movedPaths = new Set(res.results.filter((r) => r.status === "moved").map((r) => r.sourcePath));
      setCheckedIds((prev) => prev.filter((id) => !folders.some((f) => f.id === id && movedPaths.has(f.sourcePath))));
      await showToast({
        style: res.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: res.ok ? `已迁移 ${res.movedCount} 个目录` : res.movedCount > 0 ? "部分目录没有迁移" : "迁移失败",
        message: res.message
      });
      await reloadMoverSnapshot();
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  };

  const handleShowInFolder = async (folder: MovableFolderItem) => {
    const ok = await openMoverFolderLocation(folder.sourcePath);
    if (!ok) await showToast({ style: Toast.Style.Failure, title: "无法在资源管理器中显示", message: folder.sourcePath });
  };

  const maxFolderBytes = Math.max(1, ...visibleFolders.map((f) => f.sizeBytes));

  const summaryText =
    statusBanner ||
    (snapshot.error
      ? snapshot.error
      : isLoading && snapshot.folders.length === 0
        ? "正在扫描 C 盘目录"
        : snapshot.targetDrives.length === 0
        ? "没有找到 C 盘以外的分区，无法迁移"
        : `C 盘剩余 ${formatBytes(snapshot.cDriveFreeBytes)} · 已选 ${selectedFolders.length} 个目录（约 ${formatBytes(selectedBytes)}）· 目标 ${targetRoot || "未选择"}`);

  const leftNavNodes = [
    List.Item({
      id: "nav-mover-all",
      title: "全部目录",
      subtitle: `共 ${snapshot.folders.length} 项`,
      icon: Icon.HardDrive,
      onSelect: () => setSelectedCategory("all"),
      accessories: [
        { tag: { value: `${snapshot.folders.length} 项` } },
        { text: formatBytes(snapshot.totalMovableBytes) }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: "查看全部目录",
            icon: Icon.Filter,
            onAction: () => setSelectedCategory("all")
          })
        ]
      })
    }),
    ...MOVER_CATEGORIES.map((cat) => {
      const catFolders = snapshot.folders.filter((f) => f.category === cat.id);
      const catBytes = catFolders.reduce((s, f) => s + f.sizeBytes, 0);
      return List.Item({
        id: `nav-mover-${cat.id}`,
        title: cat.name,
        subtitle: cat.subtitle,
        icon: Icon.Folder,
        onSelect: () => setSelectedCategory(cat.id),
        accessories: [
          { progress: Math.min(1, catBytes / Math.max(1, snapshot.totalMovableBytes)) },
          { tag: { value: `${catFolders.length} 项` } },
          { text: formatBytes(catBytes) }
        ],
        actions: ActionPanel({
          children: [
            Action({
              title: `查看「${cat.name}」`,
              icon: Icon.Filter,
              onAction: () => setSelectedCategory(cat.id)
            })
          ]
        })
      });
    })
  ];

  const subListItems = visibleFolders.map((folder) => {
    const isChecked = checkedSet.has(folder.id);
    return List.Item({
      id: `mover-item-${folder.id}`,
      title: folder.name,
      subtitle: targetRoot
        ? `${folder.sourcePath} → ${destinationPathFor(folder.sourcePath, targetRoot)}`
        : folder.sourcePath,
      icon: Icon.Folder,
      checkable: true,
      checked: isChecked,
      onCheckChange: () => toggleFolderCheck(folder),
      accessories: [
        { progress: Math.min(1, folder.sizeBytes / maxFolderBytes) },
        { tag: { value: folder.categoryName } },
        { text: formatBytes(folder.sizeBytes) }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: `迁移已勾选的 ${selectedFolders.length} 个目录`,
            icon: Icon.ArrowRight,
            onAction: handleBatchMove
          }),
          Action({
            title: "在资源管理器中显示",
            icon: Icon.Folder,
            onAction: () => handleShowInFolder(folder)
          }),
          Action({
            title: isChecked ? "取消勾选" : "勾选",
            icon: Icon.CheckCircle,
            onAction: () => toggleFolderCheck(folder)
          })
        ]
      })
    });
  });

  const allChecked = visibleFolders.length > 0 && visibleFolders.every((f) => checkedSet.has(f.id));
  const someChecked = visibleFolders.some((f) => checkedSet.has(f.id));

  return List({
    isLoading,
    searchBarPlaceholder: "搜索目录名称或路径",
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    searchBarAccessory:
      snapshot.targetDrives.length > 0
        ? List.Dropdown({
            tooltip: "目标位置",
            value: targetRoot,
            onChange: (val) => setTargetRoot(val),
            children: snapshot.targetDrives.map((d) =>
              List.Dropdown.Item({
                title: d.label,
                value: d.targetRoot
              })
            )
          })
        : undefined,
    filterBar: {
      summaryText,
      actions: isRealHost
        ? [
            {
              id: "rescan",
              title: "重新扫描",
              style: "secondary",
              onAction: () => {
                setStatusBanner("");
                void reloadMoverSnapshot();
              }
            }
          ]
        : []
    },
    subList: {
      title: `C 盘目录（${visibleFolders.length} 项）`,
      subtitle: targetRoot,
      emptyText: snapshot.error || "当前分类下没有找到可迁移的目录",
      checkable: visibleFolders.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: "目录分类",
        children: leftNavNodes
      })
    ]
  });
}

export default MoverCommand;
