/** 布局二：左侧配置分类，右侧可勾选配置与历史快照。 */
import { Action, ActionPanel, Icon, List, useEffect, useRef, useState } from "@ztools/declarative-ui";
import {
  BACKUP_CATEGORIES, createBackupArchive, createInitialSystemBackupSnapshot,
  extractBackupSnapshot, fetchSystemBackupSnapshot, formatBytes, latestBackupArchive,
  openBackupConfigLocation, openExtractedDirectory,
  type BackupCategory, type BackupConfigItem
} from "./logic.js";

export function SystemBackupCommand() {
  const [snapshot, setSnapshot] = useState(createInitialSystemBackupSnapshot);
  const [selectedCategory, setSelectedCategory] = useState<BackupCategory>("all");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState("");
  const [statusBanner, setStatusBanner] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const busy = useRef(false);

  const reloadBackupSnapshot = async (selectAll = false) => {
    if (busy.current) return;
    busy.current = true;
    setIsLoading(true);
    try {
      const data = await fetchSystemBackupSnapshot();
      if (data.error) {
        setStatusBanner(`读取配置列表失败：${data.error}`);
        return;
      }
      setSnapshot(data);
      const configIds = data.items.filter(item => item.category !== "snapshot_archives").map(item => item.id);
      setCheckedIds(previous => selectAll ? configIds : previous.filter(id => configIds.includes(id)));
      setStatusBanner(`已扫描 ${configIds.length} 项配置 · 归档目录：${data.backupVaultDir}`);
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  };

  useEffect(() => { void reloadBackupSnapshot(true); }, []);

  const keyword = searchText.trim().toLowerCase();
  const visibleItems = snapshot.items.filter(item =>
    (selectedCategory === "all" || item.category === selectedCategory) &&
    (!keyword || `${item.name} ${item.path} ${item.categoryName}`.toLowerCase().includes(keyword))
  );
  const checked = new Set(checkedIds);
  const selectedItems = snapshot.items.filter(item => item.category !== "snapshot_archives" && checked.has(item.id));
  const selectedBytes = selectedItems.reduce((total, item) => total + item.sizeBytes, 0);
  const visibleConfigs = visibleItems.filter(item => item.category !== "snapshot_archives");

  const toggleItemCheck = (id: string) => setCheckedIds(previous =>
    previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]
  );
  const toggleAllVisible = () => {
    const ids = new Set(visibleConfigs.map(item => item.id));
    const all = visibleConfigs.every(item => checked.has(item.id));
    setCheckedIds(previous => all ? previous.filter(id => !ids.has(id)) : [...new Set([...previous, ...ids])]);
  };

  const handleCreateBackup = async () => {
    if (busy.current) return;
    busy.current = true;
    setIsLoading(true);
    try {
      const result = await createBackupArchive(selectedItems, snapshot.backupVaultDir);
      let message = result.message;
      if (result.archivePath) {
        const refreshed = await fetchSystemBackupSnapshot();
        if (refreshed.error) message += `；刷新列表失败：${refreshed.error}`;
        else setSnapshot(refreshed);
      }
      setStatusBanner(message);
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  };

  const handleExtract = async (item?: BackupConfigItem) => {
    if (busy.current) return;
    const archive = item ?? latestBackupArchive(snapshot.items);
    if (!archive || archive.category !== "snapshot_archives") {
      setStatusBanner("没有可解压的快照，请先创建快照");
      return;
    }
    busy.current = true;
    setIsLoading(true);
    setOutputDir("");
    try {
      const result = await extractBackupSnapshot(archive.path);
      setOutputDir(result.outputDir);
      setStatusBanner(result.message);
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  };

  const backupAction = () => Action({
    title: `创建快照（${selectedItems.length} 项配置）`, icon: Icon.Download, onAction: handleCreateBackup
  });
  const leftNavNodes = [
    List.Item({
      id: "nav-all", title: "全部配置与快照", icon: Icon.HardDrive,
      onSelect: () => setSelectedCategory("all"),
      accessories: [{ text: `${snapshot.items.length} 项` }],
      actions: ActionPanel({ children: [
        backupAction(),
        Action({ title: "解压最新快照", icon: Icon.Folder, onAction: () => handleExtract() })
      ] })
    }),
    ...BACKUP_CATEGORIES.map(category => List.Item({
      id: `nav-${category.id}`, title: category.name, subtitle: category.subtitle, icon: Icon.Folder,
      onSelect: () => setSelectedCategory(category.id),
      accessories: [{ text: `${snapshot.items.filter(item => item.category === category.id).length} 项` }],
      actions: ActionPanel({ children: [
        Action({ title: `查看${category.name}`, icon: Icon.Filter, onAction: () => setSelectedCategory(category.id) }),
        category.id === "snapshot_archives"
          ? Action({ title: "解压最新快照", icon: Icon.Folder, onAction: () => handleExtract() })
          : backupAction()
      ] })
    }))
  ];

  const subListItems = visibleItems.map(item => {
    const isArchive = item.category === "snapshot_archives";
    const isChecked = checked.has(item.id);
    return List.Item({
      id: `item-${item.id}`, title: item.name, subtitle: `${item.path} · ${item.lastModified}`, icon: Icon.Document,
      checkable: !isArchive, checked: !isArchive && isChecked,
      onCheckChange: () => { if (!isArchive) toggleItemCheck(item.id); },
      accessories: [{ tag: { value: item.statusTag } }, { text: formatBytes(item.sizeBytes) }],
      actions: ActionPanel({ children: [
        isArchive
          ? Action({ title: "解压此快照", icon: Icon.Folder, onAction: () => handleExtract(item) })
          : backupAction(),
        Action({ title: "在资源管理器中显示", icon: Icon.Folder, onAction: async () => {
          if (!await openBackupConfigLocation(item.path)) setStatusBanner("无法在资源管理器中显示该文件");
        } }),
        ...(!isArchive ? [Action({
          title: isChecked ? "取消勾选" : "勾选此配置", icon: Icon.CheckCircle, onAction: () => toggleItemCheck(item.id)
        })] : [])
      ] })
    });
  });
  const allChecked = visibleConfigs.length > 0 && visibleConfigs.every(item => checked.has(item.id));
  const someChecked = visibleConfigs.some(item => checked.has(item.id));

  return List({
    isLoading, isShowingDetail: false,
    searchBarPlaceholder: "搜索配置文件或快照...", onSearchTextChange: setSearchText,
    filterBar: {
      summaryText: statusBanner || `已选 ${selectedItems.length} 项配置（${formatBytes(selectedBytes)}）`,
      actions: [
        { id: "rescan", title: "重新扫描", style: "secondary", onAction: () => reloadBackupSnapshot() },
        ...(outputDir ? [{ id: "open-output", title: "打开解压目录", style: "secondary" as const, onAction: async () => {
          if (!await openExtractedDirectory(outputDir)) setStatusBanner(`无法打开解压目录：${outputDir}`);
        } }] : [])
      ]
    },
    subList: {
      title: `配置与快照（${visibleItems.length} 项 · 已选 ${selectedItems.length} 项配置）`,
      subtitle: snapshot.backupVaultDir,
      emptyText: isLoading ? "正在扫描..." : snapshot.error || "当前分类下没有匹配的配置或快照",
      checkable: visibleConfigs.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: toggleAllVisible, items: subListItems
    },
    children: [List.Section({ title: "配置分类", children: leftNavNodes })]
  });
}

export default SystemBackupCommand;
