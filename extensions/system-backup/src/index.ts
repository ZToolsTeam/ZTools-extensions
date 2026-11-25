/** 布局二：左侧配置分类，右侧可勾选配置与历史快照。 */
import { Action, ActionPanel, confirmAlert, Icon, List, showToast, Toast, useEffect, useLocale, useRef, useState } from "@ztools/declarative-ui";
import {
  getBackupCategories, createBackupArchive, createInitialSystemBackupSnapshot,
  deleteBackupSnapshot, extractBackupSnapshot, fetchSystemBackupSnapshot, formatBytes, latestBackupArchive,
  openBackupConfigLocation, openExtractedDirectory,
  type BackupCategory, type BackupConfigItem
} from "./logic.js";
import { t } from "./i18n.js";
import { resolveErrorMessage } from './error-i18n.js'

export function SystemBackupCommand() {
  useLocale();
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
        setStatusBanner(t("bannerReadListFailed", { error: data.error }));
        return;
      }
      setSnapshot(data);
      const configIds = data.items.filter(item => item.category !== "snapshot_archives").map(item => item.id);
      setCheckedIds(previous => selectAll ? configIds : previous.filter(id => configIds.includes(id)));
      setStatusBanner(t("bannerScanned", { count: configIds.length, dir: data.backupVaultDir }));
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
        if (refreshed.error) message += t("bannerRefreshFailed", { error: refreshed.error });
        else setSnapshot(refreshed);
      }
      setStatusBanner(message);
      await showToast({
        style: result.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: result.ok
          ? t("toastBackupSuccessTitle")
          : result.partial
            ? t("toastBackupPartialTitle")
            : t("toastBackupFailedTitle"),
        message
      });
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  };

  const handleExtract = async (item?: BackupConfigItem) => {
    if (busy.current) return;
    const archive = item ?? latestBackupArchive(snapshot.items);
    if (!archive || archive.category !== "snapshot_archives") {
      const msg = t("bannerNoArchive");
      setStatusBanner(msg);
      await showToast({ style: Toast.Style.Failure, title: t("toastExtractFailedTitle"), message: msg });
      return;
    }
    busy.current = true;
    setIsLoading(true);
    setOutputDir("");
    try {
      const result = await extractBackupSnapshot(archive.path);
      setOutputDir(result.outputDir);
      setStatusBanner(result.message);
      await showToast({
        style: result.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: result.ok ? t("toastExtractSuccessTitle") : t("toastExtractFailedTitle"),
        message: result.message
      });
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  };

  const handleDeleteArchive = async (item: BackupConfigItem) => {
    if (busy.current || item.category !== "snapshot_archives") return;
    const confirmed = await confirmAlert({
      title: t("confirmDeleteTitle"),
      message: t("confirmDeleteMessage", { name: item.name }),
      primaryAction: { title: t("actionDeleteSnapshot"), style: "destructive" },
      dismissAction: { title: t("actionCancel") }
    });
    if (!confirmed) return;
    busy.current = true;
    setIsLoading(true);
    try {
      const result = await deleteBackupSnapshot(item.path);
      let message = result.message;
      if (result.ok) {
        const refreshed = await fetchSystemBackupSnapshot();
        if (refreshed.error) message += t("bannerRefreshFailed", { error: refreshed.error });
        else setSnapshot(refreshed);
      }
      setStatusBanner(message);
      await showToast({
        style: result.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: result.ok ? t("toastDeleteSuccessTitle") : t("toastDeleteFailedTitle"),
        message
      });
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  };

  const backupAction = () => Action({
    title: t("actionCreateSnapshot", { count: selectedItems.length }), icon: Icon.Download, onAction: handleCreateBackup
  });
  const leftNavNodes = [
    List.Item({
      id: "nav-all", title: t("navAllTitle"), icon: Icon.HardDrive,
      onSelect: () => setSelectedCategory("all"),
      accessories: [{ text: t("itemCountText", { count: snapshot.items.length }) }],
      actions: ActionPanel({ children: [
        backupAction(),
        Action({ title: t("actionExtractLatest"), icon: Icon.Folder, onAction: () => handleExtract() })
      ] })
    }),
    ...getBackupCategories().map(category => List.Item({
      id: `nav-${category.id}`, title: category.name, subtitle: category.subtitle, icon: Icon.Folder,
      onSelect: () => setSelectedCategory(category.id),
      accessories: [{ text: t("itemCountText", { count: snapshot.items.filter(item => item.category === category.id).length }) }],
      actions: ActionPanel({ children: [
        Action({ title: t("actionViewCategory", { name: category.name }), icon: Icon.Filter, onAction: () => setSelectedCategory(category.id) }),
        category.id === "snapshot_archives"
          ? Action({ title: t("actionExtractLatest"), icon: Icon.Folder, onAction: () => handleExtract() })
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
      actions: ActionPanel({ children: isArchive
        ? [
            Action({ title: t("actionExtractThis"), icon: Icon.Folder, onAction: () => handleExtract(item) }),
            Action({ title: t("actionShowInExplorer"), icon: Icon.Folder, onAction: async () => {
              if (!await openBackupConfigLocation(item.path)) {
                setStatusBanner(t("bannerRevealFailed"));
                await showToast({ style: Toast.Style.Failure, title: t("bannerRevealFailed"), message: item.path });
              }
            } }),
            Action({
              title: t("actionDeleteSnapshot"),
              icon: Icon.Trash,
              style: Action.Style.Destructive,
              onAction: () => handleDeleteArchive(item)
            })
          ]
        : [
            Action({
              title: isChecked ? t("actionUncheck") : t("actionCheck"),
              icon: Icon.CheckCircle,
              onAction: () => toggleItemCheck(item.id)
            }),
            Action({ title: t("actionShowInExplorer"), icon: Icon.Folder, onAction: async () => {
              if (!await openBackupConfigLocation(item.path)) {
                setStatusBanner(t("bannerRevealFailed"));
                await showToast({ style: Toast.Style.Failure, title: t("bannerRevealFailed"), message: item.path });
              }
            } }),
            backupAction()
          ] })
    });
  });
  const allChecked = visibleConfigs.length > 0 && visibleConfigs.every(item => checked.has(item.id));
  const someChecked = visibleConfigs.some(item => checked.has(item.id));

  return List({
    navigationTitle: t("pluginTitle"),
    isLoading, isShowingDetail: false,
    searchBarPlaceholder: t("searchPlaceholder"), onSearchTextChange: setSearchText,
    filterBar: {
      summaryText: statusBanner || t("summarySelected", { count: selectedItems.length, size: formatBytes(selectedBytes) }),
      actions: [
        { id: "create-backup", title: t("actionCreateSnapshot", { count: selectedItems.length }), onAction: handleCreateBackup },
        { id: "rescan", title: t("actionRescan"), style: "secondary", onAction: () => reloadBackupSnapshot() },
        ...(outputDir ? [{ id: "open-output", title: t("actionOpenExtractDir"), style: "secondary" as const, onAction: async () => {
          if (!await openExtractedDirectory(outputDir)) setStatusBanner(t("bannerOpenDirFailed", { dir: outputDir }));
        } }] : [])
      ]
    },
    subList: {
      title: t("subListTitle", { visible: visibleItems.length, selected: selectedItems.length }),
      subtitle: snapshot.backupVaultDir,
      emptyText: isLoading ? t("emptyScanning") : resolveErrorMessage(snapshot, t("emptyNoMatch")),
      checkable: visibleConfigs.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: toggleAllVisible, items: subListItems
    },
    children: [List.Section({ title: t("sectionCategories"), children: leftNavNodes })]
  });
}

export default SystemBackupCommand;
