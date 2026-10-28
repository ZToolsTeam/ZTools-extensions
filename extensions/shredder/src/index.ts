/**
 * 文件粉碎（布局二：左侧候选区域 + 右侧可勾选文件列表）
 *
 * - 顶部下拉框选择覆写方式；状态条显示覆写方式与已勾选的文件数、体积，右侧只有「重新扫描」
 * - 打开时不勾选任何文件；粉碎前弹出确认框，逐个列出将被粉碎的文件
 * - 只粉碎已勾选的文件，失败的文件如实列出原因，不连带处理未勾选的文件
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
  NOT_IN_CLIENT_MESSAGE,
  SHRED_CATEGORIES,
  SHRED_STANDARDS,
  buildShredConfirmMessage,
  createEmptyShredderSnapshot,
  executeSecureShred,
  fetchShredCandidates,
  formatBytes,
  openShredCandidateLocation,
  type ShredCandidateItem,
  type ShredCategory,
  type ShredStandardId,
  type ShredderSnapshot
} from "./logic.js";

export function ShredderCommand() {
  const [snapshot, setSnapshot] = useState<ShredderSnapshot>(() =>
    isRealElectronHost() ? createEmptyShredderSnapshot() : createEmptyShredderSnapshot(NOT_IN_CLIENT_MESSAGE)
  );
  const [selectedCategory, setSelectedCategory] = useState<ShredCategory>("all");
  const [standardId, setStandardId] = useState<ShredStandardId>("dod_3pass");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const [statusBanner, setStatusBanner] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(isRealElectronHost());

  const reloadCandidates = async () => {
    setIsLoading(true);
    try {
      const data = await fetchShredCandidates();
      setSnapshot(data);
      const existing = new Set(data.candidates.map((c) => c.id));
      // 只保留仍然存在的勾选项，不自动勾选任何文件
      setCheckedIds((prev) => prev.filter((id) => existing.has(id)));
      setStatusBanner("");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void reloadCandidates();
  }, []);

  const currentStandard = SHRED_STANDARDS.find((s) => s.id === standardId) || SHRED_STANDARDS[0];

  const keyword = searchText.trim().toLowerCase();
  const visibleItems = snapshot.candidates.filter((item) => {
    if (selectedCategory !== "all" && item.category !== selectedCategory) return false;
    if (keyword) {
      const hay = `${item.name} ${item.path} ${item.categoryName}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  const checkedSet = new Set(checkedIds);
  const selectedSafeItems = snapshot.candidates.filter(
    (item) => !item.isSystemLocked && checkedSet.has(item.id)
  );
  const selectedBytes = selectedSafeItems.reduce((acc, item) => acc + item.sizeBytes, 0);

  const toggleItemCheck = (item: ShredCandidateItem) => {
    if (item.isSystemLocked) return;
    setCheckedIds((prev) =>
      prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
    );
  };

  const toggleAllVisible = () => {
    const checkableIds = visibleItems.filter((i) => !i.isSystemLocked).map((i) => i.id);
    const allChecked = checkableIds.length > 0 && checkableIds.every((id) => checkedSet.has(id));
    if (allChecked) {
      const removeSet = new Set(checkableIds);
      setCheckedIds((prev) => prev.filter((id) => !removeSet.has(id)));
    } else {
      setCheckedIds((prev) => Array.from(new Set([...prev, ...checkableIds])));
    }
  };

  const handleBatchShred = async () => {
    const targets = selectedSafeItems;
    if (targets.length === 0) {
      showToast({ style: Toast.Style.Failure, title: "请先勾选要粉碎的文件" });
      return;
    }
    const confirmed = await confirmAlert({
      title: `确认粉碎 ${targets.length} 个文件？`,
      message: buildShredConfirmMessage(targets, standardId),
      primaryAction: { title: "粉碎", style: "destructive" }
    });
    if (!confirmed) return;

    setIsLoading(true);
    try {
      const res = await executeSecureShred(targets, standardId);
      const done = new Set(res.shreddedPaths);
      if (done.size > 0) {
        const removedIds = new Set(targets.filter((t) => done.has(t.path)).map((t) => t.id));
        setSnapshot((prev) => {
          const candidates = prev.candidates.filter((c) => !removedIds.has(c.id));
          return {
            ...prev,
            candidates,
            totalShreddableBytes: candidates.reduce((acc, c) => acc + c.sizeBytes, 0)
          };
        });
        setCheckedIds((prev) => prev.filter((id) => !removedIds.has(id)));
      }
      setStatusBanner(res.message);
      showToast({
        style: res.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: res.ok ? "粉碎完成" : res.shreddedCount > 0 ? "部分文件粉碎失败" : "粉碎失败",
        message: res.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const locateItem = async (item: ShredCandidateItem) => {
    const ok = await openShredCandidateLocation(item.path);
    if (!ok) {
      showToast({ style: Toast.Style.Failure, title: "无法在资源管理器中定位此文件", message: item.path });
    }
  };

  const maxItemBytes = Math.max(1, ...visibleItems.map((i) => i.sizeBytes));

  const selectionText = `${currentStandard.name} · 已勾选 ${selectedSafeItems.length} 项 (${formatBytes(selectedBytes)})`;
  const summaryText = snapshot.error
    ? snapshot.error
    : statusBanner
      ? `${statusBanner} · ${selectionText}`
      : selectionText;

  const shredAction = (title: string) =>
    Action({
      title,
      icon: Icon.Trash,
      style: "destructive",
      onAction: handleBatchShred
    });

  const leftNavNodes = [
    List.Item({
      id: "nav-shred-all",
      title: "全部候选文件",
      subtitle: `共 ${snapshot.candidates.length} 项`,
      icon: Icon.Trash,
      onSelect: () => setSelectedCategory("all"),
      accessories: [
        { tag: { value: `${snapshot.candidates.length} 项` } },
        { text: formatBytes(snapshot.totalShreddableBytes) }
      ],
      actions: ActionPanel({
        children: [
          shredAction(`粉碎已勾选文件 (${selectedSafeItems.length} 项)`),
          Action({
            title: "重新扫描",
            icon: Icon.RotateAntiClockwise,
            onAction: () => {
              void reloadCandidates();
            }
          })
        ]
      })
    }),
    ...SHRED_CATEGORIES.map((cat) => {
      const catItems = snapshot.candidates.filter((i) => i.category === cat.id);
      const catBytes = catItems.reduce((s, i) => s + i.sizeBytes, 0);
      const ratio = Math.min(1, catBytes / Math.max(1, snapshot.totalShreddableBytes));

      return List.Item({
        id: `nav-shred-${cat.id}`,
        title: cat.name,
        subtitle: cat.subtitle,
        icon: Icon.Folder,
        onSelect: () => setSelectedCategory(cat.id),
        accessories: [
          { progress: ratio },
          { tag: { value: `${catItems.length} 项` } },
          { text: formatBytes(catBytes) }
        ],
        actions: ActionPanel({
          children: [
            Action({
              title: `查看「${cat.name}」`,
              icon: Icon.Filter,
              onAction: () => setSelectedCategory(cat.id)
            }),
            shredAction(`粉碎已勾选文件 (${selectedSafeItems.length} 项)`)
          ]
        })
      });
    })
  ];

  const subListItems = visibleItems.map((item) => {
    const isChecked = !item.isSystemLocked && checkedSet.has(item.id);
    const ratio = Math.min(1, item.sizeBytes / maxItemBytes);

    return List.Item({
      id: `shred-item-${item.id}`,
      title: item.name,
      subtitle: item.isSystemLocked ? `${item.path} · ${item.lockedReason}` : item.path,
      icon: item.isSystemLocked ? Icon.Lock : Icon.Document,
      checkable: !item.isSystemLocked,
      checked: isChecked,
      onCheckChange: () => toggleItemCheck(item),
      onToggleCheck: () => toggleItemCheck(item),
      accessories: [
        { progress: ratio },
        { tag: { value: item.categoryName } },
        { text: formatBytes(item.sizeBytes) }
      ],
      actions: ActionPanel({
        children: [
          shredAction(`粉碎已勾选文件 (${selectedSafeItems.length} 项 / ${formatBytes(selectedBytes)})`),
          Action({
            title: "在资源管理器中定位此文件",
            icon: Icon.Folder,
            onAction: () => locateItem(item)
          }),
          ...(!item.isSystemLocked
            ? [
                Action({
                  title: isChecked ? "取消勾选此文件" : "勾选此文件",
                  icon: Icon.CheckCircle,
                  onAction: () => toggleItemCheck(item)
                })
              ]
            : [])
        ]
      })
    });
  });

  const checkableVisible = visibleItems.filter((i) => !i.isSystemLocked);
  const allChecked =
    checkableVisible.length > 0 && checkableVisible.every((i) => checkedSet.has(i.id));
  const someChecked = checkableVisible.some((i) => checkedSet.has(i.id));

  return List({
    isLoading,
    searchBarPlaceholder: "搜索文件名或路径...",
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    searchBarAccessory: List.Dropdown({
      tooltip: "选择覆写方式",
      value: standardId,
      onChange: (val) => setStandardId(val as ShredStandardId),
      children: SHRED_STANDARDS.map((std) =>
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
          id: "rescan",
          title: "重新扫描",
          style: "secondary",
          onAction: () => {
            void reloadCandidates();
          }
        }
      ]
    },
    subList: {
      title: `候选文件 (${visibleItems.length} 项 · 已选 ${formatBytes(selectedBytes)})`,
      subtitle: currentStandard.description,
      emptyText: snapshot.error || (isLoading ? "正在扫描..." : "当前分类下没有可粉碎的文件"),
      checkable: checkableVisible.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: "候选区域",
        subtitle: "只列出临时文件夹与崩溃转储目录",
        children: leftNavNodes
      })
    ]
  });
}

export default ShredderCommand;
