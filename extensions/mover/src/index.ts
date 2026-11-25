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
  useLocale,
  useRef,
  useState
} from "@ztools/declarative-ui";
import { isRealElectronHost } from "./native-ipc.js";
import { t } from "./i18n.js";
import {
  authorizeMoveTarget,
  createEmptyMoverSnapshot,
  destinationPathFor,
  executeDirectoryMove,
  fetchMoverSnapshot,
  formatBytes,
  getMoverCategories,
  openMoverFolderLocation,
  validateMoveSelection,
  type MovableFolderItem,
  type MoverCategory,
  type MoverSnapshot
} from "./logic.js";
import { resolveErrorMessage } from './error-i18n.js'

export function MoverCommand() {
  useLocale();
  const isRealHost = isRealElectronHost();
  const [snapshot, setSnapshot] = useState<MoverSnapshot>(() =>
    createEmptyMoverSnapshot(isRealHost ? undefined : t("notInClient"))
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
      await showToast({ style: Toast.Style.Failure, title: t("notInClient") });
      return;
    }
    if (busy.current) return;
    if (!targetRoot) {
      await showToast({ style: Toast.Style.Failure, title: t("noTargetDriveTitle"), message: t("noTargetDriveMessage") });
      return;
    }
    const folders = selectedFolders;
    const invalid = validateMoveSelection(folders, targetRoot, targetDrive?.freeBytes || 0);
    if (invalid) {
      await showToast({ style: Toast.Style.Failure, title: t("cannotMoveTitle"), message: invalid });
      return;
    }
    busy.current = true;
    try {
      const hasApproximate = folders.some((f) => f.isApproximate === true);
      const list = folders
        .map((f) =>
          t(f.isApproximate ? "confirmMoveItemApprox" : "confirmMoveItem", {
            name: f.name,
            sourcePath: f.sourcePath,
            size: formatBytes(f.sizeBytes)
          })
        )
        .join("\n");
      const confirmed = await confirmAlert({
        title: t("confirmMoveTitle", { count: folders.length, targetRoot }),
        message: `${t("confirmMoveMessage", { list })}${hasApproximate ? t("confirmMoveApproxWarning") : ""}`,
        primaryAction: { title: t("confirmMovePrimary"), style: "destructive" }
      });
      if (!confirmed) return;
      const grant = await authorizeMoveTarget(targetRoot);
      if (!grant.ok) {
        if (grant.canceled) {
          setStatusBanner(t("statusCanceled"));
        } else {
          await showToast({ style: Toast.Style.Failure, title: t("noAuthTitle"), message: grant.error });
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
        title: res.ok ? t("movedCountToast", { count: res.movedCount }) : res.movedCount > 0 ? t("partialMoveToast") : t("moveFailedToast"),
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
    if (!ok) await showToast({ style: Toast.Style.Failure, title: t("revealFailedTitle"), message: folder.sourcePath });
  };

  const maxFolderBytes = Math.max(1, ...visibleFolders.map((f) => f.sizeBytes));

  const hasApproxSelected = selectedFolders.some((f) => f.isApproximate === true);
  const summaryText =
    statusBanner ||
    (snapshot.error
      ? snapshot.error
      : isLoading && snapshot.folders.length === 0
        ? t("scanningCDrive")
        : snapshot.targetDrives.length === 0
          ? t("noNonCDrive")
          : `${t("summaryDefault", {
              free: formatBytes(snapshot.cDriveFreeBytes),
              count: selectedFolders.length,
              selected: formatBytes(selectedBytes),
              target: targetRoot || t("targetUnselected")
            })}${hasApproxSelected ? t("summaryApproxHint") : ""}`);

  const categories = getMoverCategories();

  const leftNavNodes = [
    List.Item({
      id: "nav-mover-all",
      title: t("allDirsTitle"),
      subtitle: t("allDirsSubtitle", { count: snapshot.folders.length }),
      icon: Icon.HardDrive,
      onSelect: () => setSelectedCategory("all"),
      accessories: [
        { tag: { value: t("itemCountText", { count: snapshot.folders.length }) } },
        { text: formatBytes(snapshot.totalMovableBytes) }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: t("viewAllDirsAction"),
            icon: Icon.Filter,
            onAction: () => setSelectedCategory("all")
          })
        ]
      })
    }),
    ...categories.map((cat) => {
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
          { tag: { value: t("itemCountText", { count: catFolders.length }) } },
          { text: formatBytes(catBytes) }
        ],
        actions: ActionPanel({
          children: [
            Action({
              title: t("viewCategoryAction", { name: cat.name }),
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
        ...(folder.isApproximate ? [{ tag: { value: t("tagApproximateEstimate") } }] : []),
        {
          text: folder.isApproximate
            ? t("approxSizeText", { size: formatBytes(folder.sizeBytes) })
            : formatBytes(folder.sizeBytes)
        }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: t("moveCheckedAction", { count: selectedFolders.length }),
            icon: Icon.ArrowRight,
            onAction: handleBatchMove
          }),
          Action({
            title: t("revealInExplorerAction"),
            icon: Icon.Folder,
            onAction: () => handleShowInFolder(folder)
          }),
          Action({
            title: isChecked ? t("uncheckAction") : t("checkAction"),
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
    searchBarPlaceholder: t("searchPlaceholder"),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    searchBarAccessory:
      snapshot.targetDrives.length > 0
        ? List.Dropdown({
            tooltip: t("targetDropdownTooltip"),
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
              title: t("rescanAction"),
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
      title: t("subListTitle", { count: visibleFolders.length }),
      subtitle: targetRoot,
      emptyText: resolveErrorMessage(snapshot, t("subListEmptyText")),
      checkable: visibleFolders.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: t("leftSectionTitle"),
        children: leftNavNodes
      })
    ]
  });
}

export default MoverCommand;
