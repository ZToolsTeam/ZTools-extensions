/**
 * 批量文件重命名工作台视图 (BatchRename 2.0 - 布局二：左 32% 10 大重命名规则导航树 + 右 68% 实时原名->新名对比可勾选列表)
 *
 * 严格遵循 ZTools 效率工具箱 UI 与交互设计五大黄金法则：
 * 1. 布局二（Master-SubList Cleaner）：左 32% 10 大重命名规则预设导航树 + 右 68% 原文件名 -> 新文件名 Diff 实时预览可勾选列表
 * 2. 顶部唯一筛选：searchBarAccessory Dropdown 切换本机目标目录 (Downloads / Desktop / Documents / Pictures / Videos)
 * 3. 单行极简状态条：filterBar.summaryText 融合目标目录、规则名称、已勾选待改名数与冲突告警，仅保留 1 个全局重新扫描按钮
 * 4. 零彩色 Emoji 与去彩虹化：100% 单色 SVG 图标、中性灰标签（仅在重命名同名冲突时使用 color: "red" 高危告警）
 */

import { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useRef, useState } from "@ztools/declarative-ui";
import { formatBytes, getRealSystemPath, isRealElectronHost } from "./native-ipc.js";
import {
  MAX_RENAME_FILES,
  RENAME_RULE_PRESETS,
  buildRenamePreview,
  conflictReasonText,
  executeRealFileRename,
  fetchDirectoryFiles,
  fileManagerName,
  isPermissionError,
  isSameOrParentDir,
  openRenameFileLocation,
  requestFolderAccess,
  undoBatchRenameHistory,
  type DirectoryFilesResult,
  type RealFileEntry,
  type RenamePreviewItem,
  type RenameRule,
  type RenameRuleType,
  type RenameUndoEntry,
  type SourceScope
} from "./logic.js";
import { usePopoutValue } from "./popout-state.js";

type SourceDirScope = SourceScope | "custom";

const SOURCE_SCOPES: Array<{ id: SourceDirScope; label: string }> = [
  { id: "downloads", label: "下载目录 (Downloads)" },
  { id: "desktop", label: "桌面目录 (Desktop)" },
  { id: "documents", label: "文档目录 (Documents)" },
  { id: "pictures", label: "图片目录 (Pictures)" },
  { id: "videos", label: "视频目录 (Videos)" }
];

const INITIAL_FALLBACK_FILES: RealFileEntry[] = [
  {
    name: "IMG_2026_raw_01 (副本).JPG",
    fullPath: "C:\\Users\\Default\\Downloads\\IMG_2026_raw_01 (副本).JPG",
    parentDir: "C:\\Users\\Default\\Downloads",
    extension: ".jpg",
    sizeBytes: 4250 * 1024,
    lastModifiedMs: Date.now() - 3600_000
  },
  {
    name: "IMG_2026_raw_02 [广告].JPG",
    fullPath: "C:\\Users\\Default\\Downloads\\IMG_2026_raw_02 [广告].JPG",
    parentDir: "C:\\Users\\Default\\Downloads",
    extension: ".jpg",
    sizeBytes: 3980 * 1024,
    lastModifiedMs: Date.now() - 7200_000
  },
  {
    name: "01_季度财务审计报告-v1.xlsx",
    fullPath: "C:\\Users\\Default\\Downloads\\01_季度财务审计报告-v1.xlsx",
    parentDir: "C:\\Users\\Default\\Downloads",
    extension: ".xlsx",
    sizeBytes: 1840 * 1024,
    lastModifiedMs: Date.now() - 10800_000
  },
  {
    name: "02_产品架构评审纪要【内部】.docx",
    fullPath: "C:\\Users\\Default\\Downloads\\02_产品架构评审纪要【内部】.docx",
    parentDir: "C:\\Users\\Default\\Downloads",
    extension: ".docx",
    sizeBytes: 960 * 1024,
    lastModifiedMs: Date.now() - 14400_000
  },
  {
    name: "My-Screen-Recording-Clip.MP4",
    fullPath: "C:\\Users\\Default\\Downloads\\My-Screen-Recording-Clip.MP4",
    parentDir: "C:\\Users\\Default\\Downloads",
    extension: ".mp4",
    sizeBytes: 28400 * 1024,
    lastModifiedMs: Date.now() - 18000_000
  }
];

// 独立窗口带来的值可能来自旧版本或被篡改，逐项校验，不合法就用默认值
const isSourceScope = (v: unknown): v is SourceDirScope => v === "custom" || SOURCE_SCOPES.some((s) => s.id === v);
const isText = (v: unknown): v is string => typeof v === "string";
const isRuleType = (v: unknown): v is RenameRuleType => RENAME_RULE_PRESETS.some((r) => r.id === v);
const isPathList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText);

function stripLeadingEmoji(label: string): string {
  return label.replace(/^[^\u4e00-\u9fa5A-Za-z0-9(\[_-]+/, "").trim();
}

function baseNameOf(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed;
}

const FALLBACK_LISTING: DirectoryFilesResult = {
  directory: "C:\\Users\\Default\\Downloads",
  files: INITIAL_FALLBACK_FILES,
  occupiedNames: INITIAL_FALLBACK_FILES.map((f) => f.name),
  authorized: false,
  partial: false,
  totalFiles: INITIAL_FALLBACK_FILES.length,
  truncated: false
};

function toast(style: "success" | "failure", title: string, message?: string) {
  void showToast({
    style: style === "success" ? Toast.Style.Success : Toast.Style.Failure,
    title,
    ...(message ? { message } : {})
  });
}

function renamePlanKey(items: RenamePreviewItem[]): string {
  return items.map((i) => `${i.fullPath}\u0000${i.newName}`).join("\u0001");
}

export function BatchRenameCommand() {
  // 当前目录的授权随独立窗口转交（宿主只转交本窗口已有的授权），新窗口里不用重新授权即可执行
  const listingRef = useRef<DirectoryFilesResult | null>(null);
  // 弹出独立窗口时带走：目录来源、所选文件夹、规则与勾选；撤销记录与目录清单不带（新窗口重新读取目录）
  const [rawScope, setSourceScope] = usePopoutValue<SourceDirScope>("sourceScope", () => "downloads", isSourceScope, {
    paths: () => (listingRef.current?.directory ? [listingRef.current.directory] : [])
  });
  const [customDir, setCustomDir] = usePopoutValue("customDir", () => "", isText, { paths: (v) => (v ? [v] : []) });
  // 「所选文件夹」没有带来路径时退回默认目录
  const sourceScope: SourceDirScope = rawScope === "custom" && !customDir ? "downloads" : rawScope;
  const [listing, setListing] = useState<DirectoryFilesResult | null>(() =>
    isRealElectronHost() ? null : FALLBACK_LISTING
  );
  const [ruleType, setRuleType] = usePopoutValue<RenameRuleType>("ruleType", () => "number", isRuleType);
  const [checkedPaths, setCheckedPaths, checksRestored] = usePopoutValue<string[]>(
    "checkedPaths",
    () => (isRealElectronHost() ? [] : INITIAL_FALLBACK_FILES.map((f) => f.fullPath)),
    isPathList,
    { paths: (v) => v }
  );
  // 带来的勾选在第一次成功读取目录时生效（只保留仍存在的文件），之后按原规则：新出现的文件默认勾选。
  // 带来的是空列表时（旧窗口还没读完目录就弹出，分不清是否全部取消）按新开处理
  const restoreChecksRef = useRef(checksRestored && checkedPaths.length > 0);
  const [searchText, setSearchText] = useState<string>("");
  const [undoStack, setUndoStack] = useState<RenameUndoEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  // 改名 / 撤销互斥：执行中再次触发直接忽略，避免并发改名
  const busyRef = useRef(false);
  // 每次加载的序号，丢弃过期（已切换目录）的加载结果
  const loadSeqRef = useRef(0);
  listingRef.current = listing;

  const resolveDirectory = async (scope: SourceDirScope, custom: string): Promise<string> => {
    if (scope === "custom") return custom;
    return (await getRealSystemPath(scope)) || "";
  };

  /** 读取目录并更新列表；同目录重新加载时保留用户的勾选，新出现的文件（如改名结果）默认勾选 */
  const loadDirectory = async (dirPath: string): Promise<DirectoryFilesResult | null> => {
    const seq = ++loadSeqRef.current;
    setIsLoading(true);
    try {
      const res = await fetchDirectoryFiles(dirPath);
      if (seq !== loadSeqRef.current) return null;
      const prev = listingRef.current;
      const sameDir = Boolean(prev && prev.directory === res.directory);
      const prevPaths = new Set(sameDir && prev ? prev.files.map((f) => f.fullPath) : []);
      const keepRestored = restoreChecksRef.current;
      restoreChecksRef.current = false;
      setCheckedPaths((checked) => {
        const checkedSet = new Set(checked);
        return res.files
          .map((f) => f.fullPath)
          .filter((p) => (keepRestored ? checkedSet.has(p) : !sameDir || checkedSet.has(p) || !prevPaths.has(p)));
      });
      listingRef.current = res;
      setListing(res);
      return res;
    } catch (err) {
      if (seq !== loadSeqRef.current) return null;
      const failed: DirectoryFilesResult = {
        directory: dirPath,
        files: [],
        occupiedNames: [],
        authorized: false,
        partial: false,
        totalFiles: 0,
        truncated: false,
        error: err instanceof Error ? err.message : String(err)
      };
      listingRef.current = failed;
      setListing(failed);
      return failed;
    } finally {
      if (seq === loadSeqRef.current) setIsLoading(false);
    }
  };

  const reloadCurrent = async () => {
    const dir = listingRef.current?.directory || (await resolveDirectory(sourceScope, customDir));
    return loadDirectory(dir);
  };

  useEffect(() => {
    if (!isRealElectronHost()) return;
    void (async () => {
      const dir = await resolveDirectory(sourceScope, customDir);
      await loadDirectory(dir);
    })();
  }, [sourceScope, customDir]);

  const currentDir = listing?.directory || "";
  const managerName = fileManagerName(currentDir);

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
        return { type: "prefix", prefix: trimmedQuery || "ZTools_" };
      case "date_prefix":
        return { type: "date_prefix" };
      case "suffix":
        return { type: "suffix", suffix: trimmedQuery || "_v2" };
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
      : trimmedQuery.toLowerCase();

  const computePreview = (source: DirectoryFilesResult | null): RenamePreviewItem[] => {
    if (!source) return [];
    const visible = source.files.filter((file) => !filterKeyword || file.name.toLowerCase().includes(filterKeyword));
    return buildRenamePreview(visible, activeRule, source.occupiedNames);
  };

  const checkedSet = new Set(checkedPaths);
  const previewItems = computePreview(listing).map((item) => ({ ...item, isChecked: checkedSet.has(item.fullPath) }));

  const selectedItems = previewItems.filter((item) => item.isChecked);
  const runnableSelected = selectedItems.filter((item) => item.changed && !item.conflict);
  const changedSelectedCount = runnableSelected.length;
  const conflictCount = previewItems.filter((item) => item.conflict).length;

  const toggleFileCheck = (fullPath: string) => {
    setCheckedPaths((prev) =>
      prev.includes(fullPath) ? prev.filter((p) => p !== fullPath) : [...prev, fullPath]
    );
  };

  const toggleAllVisible = () => {
    const visiblePaths = previewItems.map((item) => item.fullPath);
    const allChecked = visiblePaths.length > 0 && visiblePaths.every((p) => checkedSet.has(p));
    if (allChecked) {
      const removeSet = new Set(visiblePaths);
      setCheckedPaths((prev) => prev.filter((p) => !removeSet.has(p)));
    } else {
      setCheckedPaths((prev) => Array.from(new Set([...prev, ...visiblePaths])));
    }
  };

  /**
   * 通过系统选目录对话框取得 dir 的读写授权。用户选了别的文件夹时切换过去并让用户先确认预览，不直接执行
   */
  const ensureFolderAccess = async (dir: string, title: string): Promise<boolean> => {
    const access = await requestFolderAccess(dir, title);
    if (access.error) {
      toast("failure", "无法取得文件夹授权", access.error);
      return false;
    }
    if (access.canceled || !access.folderPath) {
      toast("failure", "已取消授权，未执行任何改动");
      return false;
    }
    if (!isSameOrParentDir(access.folderPath, dir)) {
      setCustomDir(access.folderPath);
      setSourceScope("custom");
      toast("failure", `已切换到「${baseNameOf(access.folderPath)}」`, "所选文件夹与当前目录不同，请确认新预览后再执行");
      return false;
    }
    return true;
  };

  const runRename = async (targets: RenamePreviewItem[], mode: "batch" | "single") => {
    if (busyRef.current) return;
    if (targets.length === 0) {
      toast("failure", conflictCount > 0 ? "没有可执行的改名：存在同名冲突" : "没有需要改名的已勾选文件");
      return;
    }
    busyRef.current = true;
    setIsLoading(true);
    try {
      const startListing = listingRef.current;
      let plan = targets;
      if (!startListing?.authorized) {
        const dir = startListing?.directory || targets[0].parentDir;
        const granted = await ensureFolderAccess(dir, `授权批量重命名「${baseNameOf(dir)}」中的文件`);
        if (!granted) return;
        // 授权后读取完整目录并按同样的规则重算；与用户看到的预览不一致时先让用户确认
        const fresh = await loadDirectory(dir);
        if (!fresh || !fresh.authorized) {
          toast("failure", "授权后仍无法读取该文件夹", fresh?.error);
          return;
        }
        const freshByPath = new Map(computePreview(fresh).map((i) => [i.fullPath, i]));
        const recomputed = targets.map((t) => freshByPath.get(t.fullPath));
        if (recomputed.some((i) => !i || !i.changed || i.conflict) || renamePlanKey(recomputed as RenamePreviewItem[]) !== renamePlanKey(targets)) {
          toast("failure", "已读取完整文件清单，预览有变化", "请确认新的预览后再次执行");
          return;
        }
        plan = recomputed as RenamePreviewItem[];
      }

      const history: RenameUndoEntry[] = [];
      const failures: Array<{ name: string; error: string }> = [];
      for (let i = 0; i < plan.length; i++) {
        const item = plan[i];
        const res = await executeRealFileRename(item.fullPath, item.newName);
        if (res.ok && res.destinationPath) {
          history.push({ oldPath: item.fullPath, newPath: res.destinationPath, oldName: item.name, newName: item.newName });
          continue;
        }
        failures.push({ name: item.name, error: res.error || "改名失败" });
        if (isPermissionError(res.error)) {
          // 授权失效（超时）时后续必然全部失败，停止并如实报告
          for (const rest of plan.slice(i + 1)) failures.push({ name: rest.name, error: "未执行（文件夹授权已失效）" });
          break;
        }
      }

      if (history.length > 0) setUndoStack(history);
      const total = plan.length;
      if (failures.length === 0) {
        toast(
          "success",
          mode === "single" ? `已将 ${plan[0].name} 改名为 ${plan[0].newName}` : `已重命名 ${history.length} 个文件`,
          "可在动作面板撤销"
        );
      } else {
        const first = failures[0];
        toast(
          "failure",
          history.length > 0 ? `已重命名 ${history.length}/${total} 个，${failures.length} 个失败` : `重命名失败（0/${total}）`,
          `${first.name}：${first.error}` + (history.length > 0 ? " · 成功的部分可在动作面板撤销" : "")
        );
      }
      await reloadCurrent();
    } finally {
      busyRef.current = false;
      setIsLoading(false);
    }
  };

  const executeBatchRename = () => runRename(runnableSelected, "batch");

  const handleUndoLastBatch = async () => {
    if (busyRef.current) return;
    if (undoStack.length === 0) {
      toast("failure", "当前没有可撤销的重命名");
      return;
    }
    busyRef.current = true;
    setIsLoading(true);
    try {
      let res = await undoBatchRenameHistory(undoStack);
      if (res.restoredCount === 0 && res.failed.some((f) => isPermissionError(f.error))) {
        const dir = listingRef.current?.directory || "";
        if (await ensureFolderAccess(dir, `授权撤销「${baseNameOf(dir)}」中的重命名`)) {
          res = await undoBatchRenameHistory(undoStack);
        }
      }
      setUndoStack(res.failed.map((f) => f.entry).reverse());
      if (res.failed.length === 0) {
        toast("success", `已撤销 ${res.restoredCount} 个文件的重命名`);
      } else {
        const first = res.failed[0];
        toast(
          "failure",
          `已撤销 ${res.restoredCount} 个，${res.failed.length} 个未能还原`,
          `${first.entry.newName}：${first.error}`
        );
      }
      await reloadCurrent();
    } finally {
      busyRef.current = false;
      setIsLoading(false);
    }
  };

  const revealInFileManager = async (fullPath: string) => {
    let res = await openRenameFileLocation(fullPath);
    if (!res.ok && isPermissionError(res.error)) {
      const dir = listingRef.current?.directory || "";
      if (!(await ensureFolderAccess(dir, `授权访问「${baseNameOf(dir)}」以在${managerName}中显示文件`))) return;
      void reloadCurrent();
      res = await openRenameFileLocation(fullPath);
    }
    if (!res.ok) toast("failure", `无法在${managerName}中显示`, res.error);
  };

  const pickFolder = async () => {
    const access = await requestFolderAccess(currentDir, "选择要批量重命名的文件夹");
    if (access.error) {
      toast("failure", "无法打开选择文件夹对话框", access.error);
      return;
    }
    if (access.canceled || !access.folderPath) return;
    if (sourceScope === "custom" && access.folderPath === customDir) {
      void loadDirectory(access.folderPath);
      return;
    }
    setCustomDir(access.folderPath);
    setSourceScope("custom");
  };

  const activePresetMeta =
    RENAME_RULE_PRESETS.find((r) => r.id === ruleType) || RENAME_RULE_PRESETS[0];
  const cleanActiveRuleLabel = trimmedQuery.includes("->") ? "查找替换" : stripLeadingEmoji(activePresetMeta.label);

  const loadFailed = Boolean(listing && listing.files.length === 0 && listing.error);
  // 完整路径在右栏标题里；状态条只放目录名，避免长路径把规则、待改名数、冲突数挤出可视区
  const summaryParts: string[] = [`目录: ${currentDir ? baseNameOf(currentDir) : "读取中"}`];
  if (loadFailed) {
    summaryParts.push("目录不存在、为空或无权限读取");
  } else {
    summaryParts.push(`规则: ${cleanActiveRuleLabel}`, `待改名 ${changedSelectedCount} 项`);
    if (conflictCount > 0) summaryParts.push(`${conflictCount} 项同名冲突（不会执行）`);
    if (undoStack.length > 0) summaryParts.push(`可撤销 ${undoStack.length} 项`);
    if (listing && listing.truncated) summaryParts.push(`仅显示前 ${MAX_RENAME_FILES} 个（共 ${listing.totalFiles} 个）`);
    if (listing && !listing.authorized && listing.files.length > 0 && isRealElectronHost()) {
      summaryParts.push(listing.partial ? "预览可能不完整，执行时需授权文件夹" : "执行时需授权文件夹");
    }
  }
  const summaryText = summaryParts.join(" · ");

  const maxSizeBytes = Math.max(1, ...previewItems.map((f) => f.sizeBytes));

  const undoAction = () =>
    Action({
      title: `撤销上一次重命名 (${undoStack.length} 项)`,
      icon: Icon.RotateAntiClockwise,
      onAction: handleUndoLastBatch
    });

  const leftNavNodes = RENAME_RULE_PRESETS.map((preset) => {
    const cleanLabel = stripLeadingEmoji(preset.label);
    const isActive = ruleType === preset.id;

    return List.Item({
      id: `nav-rule-${preset.id}`,
      title: cleanLabel,
      subtitle: preset.desc,
      icon: Icon.Document,
      onSelect: () => setRuleType(preset.id),
      accessories: [
        { tag: { value: isActive ? "当前生效" : "规则预设" } }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: `切换至「${cleanLabel}」规则`,
            icon: Icon.CheckCircle,
            onAction: () => setRuleType(preset.id)
          }),
          Action({
            title: `执行批量重命名 (${changedSelectedCount} 项)`,
            icon: Icon.ArrowRight,
            onAction: executeBatchRename
          }),
          ...(undoStack.length > 0 ? [undoAction()] : [])
        ]
      })
    });
  });

  const subListItems = previewItems.map((item) => {
    const ratio = Math.min(1, item.sizeBytes / maxSizeBytes);
    const statusLabel = item.conflict
      ? "同名冲突"
      : item.changed
        ? "待改名"
        : "保持不变";

    return List.Item({
      id: `rename-item-${item.fullPath}`,
      title: item.name,
      subtitle: item.conflict
        ? `-> ${item.newName} (${conflictReasonText(item.conflictReason)}，不会执行)`
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
        { text: formatBytes(item.sizeBytes) }
      ],
      actions: ActionPanel({
        children: [
          Action({
            title: `执行批量重命名 (${changedSelectedCount} 个已选文件)`,
            icon: Icon.CheckCircle,
            onAction: executeBatchRename
          }),
          Action({
            title: `在${managerName}中显示`,
            icon: Icon.Folder,
            onAction: () => revealInFileManager(item.fullPath)
          }),
          Action({
            title: "只改名此文件",
            icon: Icon.Document,
            onAction: async () => {
              if (!item.changed) {
                toast("failure", "此文件按当前规则不需要改名");
                return;
              }
              if (item.conflict) {
                toast("failure", `无法改名：${conflictReasonText(item.conflictReason)}`, item.newName);
                return;
              }
              await runRename([item], "single");
            }
          }),
          ...(undoStack.length > 0 ? [undoAction()] : [])
        ]
      })
    });
  });

  const allChecked = previewItems.length > 0 && previewItems.every((f) => f.isChecked);
  const someChecked = previewItems.some((f) => f.isChecked);

  const dropdownScopes = [
    ...SOURCE_SCOPES,
    ...(customDir ? [{ id: "custom" as SourceDirScope, label: `所选文件夹 (${baseNameOf(customDir)})` }] : [])
  ];

  return List({
    isLoading,
    searchBarPlaceholder: "输入「旧词->新词」实时替换，或输入前缀/后缀参数、搜索文件名...",
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    searchBarAccessory: List.Dropdown({
      tooltip: "切换待重命名的文件夹",
      value: sourceScope,
      onChange: (val) => setSourceScope(val as SourceDirScope),
      children: dropdownScopes.map((s) =>
        List.Dropdown.Item({
          title: s.label,
          value: s.id
        })
      )
    }),
    filterBar: {
      summaryText,
      actions: [
        {
          id: "pick-folder",
          title: "选择文件夹",
          style: "secondary",
          onAction: () => {
            void pickFolder();
          }
        },
        {
          id: "rescan",
          title: "重新扫描",
          style: "secondary",
          onAction: () => {
            void reloadCurrent();
          }
        }
      ]
    },
    subList: {
      title: `原名 -> 新名实时对比预览 (${previewItems.length} 项 · 待执行 ${changedSelectedCount} 项)`,
      subtitle: currentDir,
      emptyText: loadFailed ? "目录不存在、为空或无权限读取" : "当前目录下暂无可重命名文件",
      checkable: previewItems.length > 0,
      checked: allChecked ? true : someChecked ? "indeterminate" : false,
      onCheckChange: () => toggleAllVisible(),
      items: subListItems
    },
    children: [
      List.Section({
        title: "10 大重命名规则预设导航 (32%)",
        subtitle: "点击实时预览新文件名",
        children: leftNavNodes
      })
    ]
  });
}

export default BatchRenameCommand;
