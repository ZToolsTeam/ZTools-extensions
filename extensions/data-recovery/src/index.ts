/**
 * 回收站文件取回（布局二：左侧文件类型 + 右侧可勾选文件列表）
 *
 * - 列出客户端读取到的回收站文件，按扩展名分类；打开时不勾选任何文件
 * - 只复制已勾选的文件到桌面恢复文件夹下新建的子文件夹，不覆盖已有文件，回收站里的文件保持不动
 * - 读取或复制失败时在状态条与提示里如实显示原因
 */

import {
  Action,
  ActionPanel,
  Icon,
  List,
  Toast,
  showToast,
  useEffect,
  useState
} from "@ztools/declarative-ui";
import { isRealElectronHost } from "./native-ipc.js";
import {
  NOT_IN_CLIENT_MESSAGE,
  RECOVERY_CATEGORIES,
  createEmptyRecoverySnapshot,
  fetchRecoverableFiles,
  formatBytes,
  openRecoveryFolder,
  restoreSelectedFiles,
  showRecoveryItem,
  type DataRecoverySnapshot,
  type RecoveryCategory
} from "./logic.js";

export function DataRecoveryCommand() {
  const [snapshot, setSnapshot] = useState<DataRecoverySnapshot>(() =>
    isRealElectronHost() ? createEmptyRecoverySnapshot() : createEmptyRecoverySnapshot(NOT_IN_CLIENT_MESSAGE)
  );
  const [selectedCategory, setSelectedCategory] = useState<RecoveryCategory>("all");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const [statusBanner, setStatusBanner] = useState<string>("");
  const [lastOutputDir, setLastOutputDir] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(isRealElectronHost());

  const reloadRecoveryList = async () => {
    setIsLoading(true);
    try {
      const data = await fetchRecoverableFiles();
      setSnapshot(data);
      const existing = new Set(data.items.map((i) => i.id));
      setCheckedIds((prev) => prev.filter((id) => existing.has(id)));
      setStatusBanner("");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void reloadRecoveryList();
  }, []);

  const keyword = searchText.trim().toLowerCase();
  const visibleItems = snapshot.items.filter((item) => {
    if (selectedCategory !== "all" && item.category !== selectedCategory) return false;
    if (keyword) {
      const hay = `${item.name} ${item.cachePath} ${item.categoryName}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  const checkedSet = new Set(checkedIds);
  const selectedItems = snapshot.items.filter((item) => checkedSet.has(item.id));
  const selectedBytes = selectedItems.reduce((acc, item) => acc + item.sizeBytes, 0);

  const toggleItemCheck = (id: string) => {
    setCheckedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
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

  const handleBatchRestore = async () => {
    if (selectedItems.length === 0) {
      showToast({ style: Toast.Style.Failure, title: "请先勾选要恢复的文件" });
      return;
    }
    setIsLoading(true);
    try {
      const res = await restoreSelectedFiles(selectedItems, snapshot.restoreTargetDir);
      if (res.outputDir) setLastOutputDir(res.outputDir);
      setStatusBanner(res.message);
      showToast({
        style: res.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: res.ok ? "恢复完成" : res.restoredCount > 0 ? "部分文件恢复失败" : "恢复失败",
        message: res.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const openOutputFolder = async () => {
    const dir = lastOutputDir || snapshot.restoreTargetDir;
    const ok = await openRecoveryFolder(dir);
    if (!ok) {
      showToast({
        style: Toast.Style.Failure,
        title: "无法打开恢复文件夹",
        message: dir ? `${dir}（还没有恢复过文件时该文件夹可能不存在）` : "无法获取桌面路径"
      });
    }
  };

  const locateItem = async (path: string) => {
    const ok = await showRecoveryItem(path);
    if (!ok) {
      showToast({ style: Toast.Style.Failure, title: "无法在资源管理器中定位此文件", message: path });
    }
  };

  const selectionText = `已勾选 ${selectedItems.length} 项 (${formatBytes(selectedBytes)}) · 恢复到 ${
    snapshot.restoreTargetDir || "（未知）"
  }`;
  const summaryText = snapshot.error
    ? snapshot.error
    : statusBanner
      ? `${statusBanner} · ${selectionText}`
      : `回收站文件 ${snapshot.items.length} 项 (${formatBytes(snapshot.totalSizeBytes)}) · ${selectionText}`;

  const restoreAction = () =>
    Action({
      title: `复制已勾选文件到恢复文件夹 (${selectedItems.length} 项)`,
      icon: Icon.CheckCircle,
      onAction: handleBatchRestore
    });

  const leftNavNodes = [
    List.Item({
      id: "nav-rec-all",
      title: "全部回收站文件",
      subtitle: `${snapshot.items.length} 项`,
      icon: Icon.HardDrive,
      onSelect: () => setSelectedCategory("all"),
      accessories: [
        { tag: { value: `${snapshot.items.length} 项` } },
        { text: formatBytes(snapshot.totalSizeBytes) }
      ],
      actions: ActionPanel({
        children: [
          restoreAction(),
          Action({
            title: "打开恢复文件夹",
            icon: Icon.Folder,
            onAction: openOutputFolder
          })
        ]
      })
    }),
    ...RECOVERY_CATEGORIES.map((cat) => {
      const catItems = snapshot.items.filter((i) => i.category === cat.id);
      const catBytes = catItems.reduce((s, i) => s + i.sizeBytes, 0);
      const ratio = Math.min(1, catBytes / Math.max(1, snapshot.totalSizeBytes));

      return List.Item({
        id: `nav-rec-${cat.id}`,
        title: cat.name,
        subtitle: cat.subtitle,
        icon: Icon.Document,
        onSelect: () => setSelectedCategory(cat.id),
        accessories: [
          { progress: ratio },
          { tag: { value: `${catItems.length} 项` } },
          { text: formatBytes(catBytes) }
        ],
        actions: ActionPanel({
          children: [
            Action({
              title: `筛选「${cat.name}」`,
              icon: Icon.Filter,
              onAction: () => setSelectedCategory(cat.id)
            }),
            restoreAction()
          ]
        })
      });
    })
  ];

  const subListItems = visibleItems.map((item) => {
    const isChecked = checkedSet.has(item.id);

    return List.Item({
      id: `rec-item-${item.id}`,
      title: item.name,
      subtitle: item.modifiedText ? `${item.cachePath} · 修改于 ${item.modifiedText}` : item.cachePath,
      icon: Icon.Document,
      checkable: true,
      checked: isChecked,
      onCheckChange: () => toggleItemCheck(item.id),
      onToggleCheck: () => toggleItemCheck(item.id),
      accessories: [{ tag: { value: item.categoryName } }, { text: formatBytes(item.sizeBytes) }],
      actions: ActionPanel({
        children: [
          restoreAction(),
          Action({
            title: "在资源管理器中定位此文件",
            icon: Icon.Folder,
            onAction: () => locateItem(item.cachePath)
          }),
          Action({
            title: isChecked ? "取消勾选此文件" : "勾选此文件",
            icon: Icon.CheckCircle,
            onAction: () => toggleItemCheck(item.id)
          }),
          Action({
            title: "打开恢复文件夹",
            icon: Icon.Folder,
            onAction: openOutputFolder
          })
        ]
      })
    });
  });

  const allChecked = visibleItems.length > 0 && visibleItems.every((i) => checkedSet.has(i.id));
  const someChecked = visibleItems.some((i) => checkedSet.has(i.id));

  return List({
    isLoading,
    searchBarPlaceholder: "搜索文件名、扩展名（如 .docx）...",
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    filterBar: {
      summaryText,
      actions: [
        {
          id: "rescan",
          title: "重新扫描",
          style: "secondary",
          onAction: () => {
            void reloadRecoveryList();
          }
        }
      ]
    },
    subList: {
      title: `回收站文件 (${visibleItems.length} 项 · 已选 ${formatBytes(selectedBytes)})`,
      subtitle: "列表显示回收站内部文件名，恢复出的文件也使用这个名字",
      emptyText: snapshot.error || (isLoading ? "正在读取回收站..." : "当前分类下没有回收站文件"),
      checkable: visibleItems.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: "文件类型",
        subtitle: "按扩展名分类",
        children: leftNavNodes
      })
    ]
  });
}

export default DataRecoveryCommand;
