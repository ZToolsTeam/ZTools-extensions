/**
 * 截图历史与回贴 (布局三：左 34% 截取参数工作台 + 右 66% 截图队列)
 *
 * - 左栏 workbenchPanel：只保留宿主真实支持的截取选项（截取后是否复制到剪贴板）与截图库概览
 * - 右栏 subList：宿主扫描到的本机截图 + 本次运行中立即截取的截图，可勾选
 * - 底部操作栏：回贴到活动窗口 ↵ / 复制图片 ⌘↵ / 动作面板 ⌘K
 * - 对外导出 ScreenshotsCommand、ScreenshotDetailView、ScreenshotsManager、defaultScreenshotsManager
 */

import React, {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  confirmAlert,
  useLocale,
  useState,
  useMemo,
  useEffect
} from "@ztools/declarative-ui";
import { t } from "./i18n.js";
import {
  ScreenshotItem,
  ScreenshotCategory,
  ScreenshotActionResult,
  ScreenshotScanFailure
} from "./types.js";
import {
  defaultScreenshotsManager,
  ScreenshotsManager,
  INITIAL_SCREENSHOTS,
  buildScreenshotDetailMarkdown,
  fileManagerName,
  type ScreenshotPreviewState,
  getAuthorizeFolderActionTitle,
  formatScreenshotSize,
  isOcrSupported,
  trashName
} from "./screenshots-service.js";
import { isRealElectronHost } from "./native-ipc.js";

export * from "./types.js";
export * from "./screenshots-service.js";

/** 与原来「优先取 message、否则转字符串」的结果一致；catch 参数是 unknown，不能直接读 .message */
function errorText(err: unknown): string {
  const message = typeof err === "object" && err !== null ? (err as { message?: unknown }).message : undefined;
  return message ? String(message) : String(err);
}
export { ScreenshotsManager, defaultScreenshotsManager, INITIAL_SCREENSHOTS };

function formatTotalSize(items: readonly ScreenshotItem[]): string {
  const knownBytes = items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
  const unknownCount = items.filter((item) => item.sizeBytes === null).length;
  return `${formatScreenshotSize(knownBytes)}${unknownCount ? t("totalSizeUnknownNote", { count: unknownCount }) : ""}`;
}

/** 按宿主真实结果选择提示样式：失败一律用失败样式，不再出现带成功勾的失败提示 */
async function toastResult(res: ScreenshotActionResult): Promise<void> {
  if (res.success) {
    await showToast(Toast.Style.Success, res.message);
    return;
  }
  // 失败提示拆成「标题 + 原因」两行，原因较长时也能完整看到
  const idx = res.message.indexOf(": ");
  if (idx > 0) await showToast(Toast.Style.Failure, res.message.slice(0, idx), res.message.slice(idx + 2));
  else await showToast(Toast.Style.Failure, res.message);
}

function parentDir(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx > 0 ? filePath.slice(0, idx) : "";
}

/**
 * 独立单项详情查看页 (供导航栈或独立路由调用)
 */
export function ScreenshotDetailView({
  item,
  manager = defaultScreenshotsManager
}: {
  item: ScreenshotItem;
  manager?: ScreenshotsManager;
}) {
  useLocale();
  const ocrEnabled = isOcrSupported();
  const [preview, setPreview] = useState<ScreenshotPreviewState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setPreview({ status: "loading" });
    manager
      .loadPreviewDataUrl(item)
      .then((res) => {
        if (!active) return;
        setPreview(res.ok ? { status: "ready", dataUrl: res.dataUrl } : { status: "unavailable", reason: res.reason });
      })
      .catch((error) => {
        if (active) setPreview({ status: "unavailable", reason: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      active = false;
    };
  }, [item.id, item.path]);

  const markdown = buildScreenshotDetailMarkdown(item, preview, ocrEnabled);

  return (
    <Detail
      markdown={markdown}
      isLoading={preview.status === "loading"}
      navigationTitle={t("detailNavTitle", { name: item.filename })}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title={t("metaFilename")} text={item.filename} icon={Icon.Image} />
          <Detail.Metadata.Label title={t("metaResolution")} text={item.dimensions} icon={Icon.Monitor} />
          <Detail.Metadata.Label title={t("metaFileSize")} text={item.formattedSize} icon={Icon.HardDrive} />
          <Detail.Metadata.Label title={t("metaModified")} text={item.formattedDate} icon={Icon.Calendar} />
          <Detail.Metadata.TagList title={t("metaStatus")}>
            <Detail.Metadata.TagList.Item
              text={item.pinned ? t("statusPinned") : t("statusNormal")}
              color={Color.SecondaryText}
            />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title={t("metaPath")} text={item.path} icon={Icon.Folder} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title={t("panelScreenshotTitle", { name: item.filename })}>
          <Action
            title={t("actionPasteActive")}
            icon={Icon.Window}
            onAction={async () => {
              await toastResult(await defaultScreenshotsManager.pasteToActiveWindow(item));
            }}
          />
          <Action
            title={t("actionCopyImage")}
            icon={Icon.Clipboard}
            onAction={async () => {
              await toastResult(await defaultScreenshotsManager.copyImageToClipboard(item));
            }}
          />
          <Action
            title={t("actionCopyPath")}
            icon={Icon.Document}
            onAction={async () => {
              await Clipboard.copy(item.path);
              await showToast(Toast.Style.Success, t("copiedPathToast", { path: item.path }));
            }}
          />
          {ocrEnabled ? (
            <Action
              title={t("actionCopyOcr")}
              icon={Icon.Text}
              onAction={async () => {
                const res = await defaultScreenshotsManager.copyOcrText(item);
                if (res.success && res.ocrText) await Clipboard.copy(res.ocrText);
                await toastResult(res);
              }}
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}

export function ScreenshotsCommand() {
  useLocale();
  const isRealHost = isRealElectronHost();
  const ocrEnabled = isOcrSupported();
  const initialList = isRealHost ? [] : [...INITIAL_SCREENSHOTS];
  const [items, setItems] = useState<ScreenshotItem[]>(() => initialList);
  // 默认不勾选任何截图：批量清理是破坏性操作，必须由用户主动勾选
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [scanError, setScanError] = useState("");
  const [scanFailures, setScanFailures] = useState<ScreenshotScanFailure[]>([]);
  const [searchText, setSearchText] = useState("");
  const [category, setCategory] = useState<ScreenshotCategory>("all");
  const [copyAfterCapture, setCopyAfterCapture] = useState<"copy" | "none">("copy");
  const [refreshCount] = useState(0);
  const [, setSelectedId] = useState<string | null>(null);

  const applyList = (list: ScreenshotItem[]) => {
    const nextList = list.length > 0 ? list : isRealElectronHost() ? [] : [...INITIAL_SCREENSHOTS];
    setScanError("");
    setScanFailures(defaultScreenshotsManager.getScanFailures());
    setItems(nextList);
    // 重新扫描后只保留仍存在的勾选项
    const alive = new Set(nextList.map((s) => s.id));
    setCheckedIds((prev) => prev.filter((id) => alive.has(id)));
  };

  useEffect(() => {
    let active = true;
    defaultScreenshotsManager.loadScreenshots().then((list) => {
      if (active) applyList(list);
    }).catch((error) => { if (active) setScanError(error instanceof Error ? error.message : String(error)); });
    return () => {
      active = false;
    };
  }, [refreshCount]);

  const reloadScreenshots = (force = false) => {
    defaultScreenshotsManager.loadScreenshots(force).then(applyList).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setScanError(message);
      void showToast({ style: Toast.Style.Failure, title: t("scanFailedToast"), message });
    });
  };

  const handleCaptureScreenNow = async () => {
    const res = await defaultScreenshotsManager.captureScreenNow({ copyToClipboard: copyAfterCapture === "copy" });
    if (res.screenshot) reloadScreenshots(false);
    await toastResult(res);
  };

  const handleAuthorizeFolder = async (item?: ScreenshotItem) => {
    const res = await defaultScreenshotsManager.authorizeFolder(item ? parentDir(item.path) : undefined);
    if (res.success) reloadScreenshots(true);
    if (res.error === "CANCELED") {
      await showToast(Toast.Style.Failure, res.message);
      return;
    }
    await toastResult(res);
  };

  const filtered = useMemo(() => {
    return defaultScreenshotsManager.filterScreenshots(items, searchText, ocrEnabled ? category : category === "ocr" ? "all" : category);
  }, [items, searchText, category, ocrEnabled]);

  // 批量清理只作用于当前可见、已勾选且未置顶的截图
  const batchTargets = useMemo(
    () => filtered.filter((s) => checkedIds.includes(s.id) && !s.pinned),
    [filtered, checkedIds]
  );
  const visibleCheckedCount = filtered.filter((s) => checkedIds.includes(s.id)).length;

  const handlePasteToActive = async (item: ScreenshotItem) => {
    await toastResult(await defaultScreenshotsManager.pasteToActiveWindow(item));
  };

  const handlePasteLatest = async () => {
    try {
      const res = await defaultScreenshotsManager.pasteLatestScreenshot();
      if (res.success) {
        await showToast(Toast.Style.Success, res.message);
      } else {
        await showToast(
          Toast.Style.Failure,
          res.error === "NO_SCREENSHOTS" ? t("notFoundTitle") : t("pasteLatestFailedTitle"),
          res.message
        );
      }
    } catch (err: unknown) {
      await showToast(Toast.Style.Failure, t("pasteLatestFailedTitle"), errorText(err));
    }
  };

  const handleCopyImage = async (item: ScreenshotItem) => {
    await toastResult(await defaultScreenshotsManager.copyImageToClipboard(item));
  };

  const handleCopyPath = async (item: ScreenshotItem) => {
    await Clipboard.copy(item.path);
    await showToast(Toast.Style.Success, t("copiedPathToast", { path: item.path }));
  };

  const handleCopyOcr = async (item: ScreenshotItem) => {
    try {
      const text = await defaultScreenshotsManager.extractOcr(item);
      await Clipboard.copy(text);
      await showToast(Toast.Style.Success, t("copiedOcrToast", { len: text.length }));
    } catch (err: unknown) {
      await showToast(Toast.Style.Failure, t("ocrFailedToast"), errorText(err));
    }
  };

  const handleShowInExplorer = async (item: ScreenshotItem) => {
    await toastResult(await defaultScreenshotsManager.showInExplorer(item));
  };

  const handleOpenWithDefault = async (item: ScreenshotItem) => {
    await toastResult(await defaultScreenshotsManager.openWithDefaultApp(item));
  };

  const handleDelete = async (item: ScreenshotItem) => {
    const res = await defaultScreenshotsManager.deleteScreenshot(item);
    if (res.success) {
      setItems((prev) => prev.filter((s) => s.id !== item.id));
      setCheckedIds((prev) => prev.filter((id) => id !== item.id));
    } else {
      // 删除失败（文件已不存在等）：以宿主重新扫描的结果为准，不在本地擅自删行
      reloadScreenshots(true);
    }
    await toastResult(res);
  };

  const handleBatchDeleteChecked = async () => {
    const targets = batchTargets;
    if (targets.length === 0) {
      await showToast(Toast.Style.Failure, t("noCleanableTitle"), t("noCleanableMsg"));
      return;
    }
    // 本次立即截取的文件在缓存目录，删除后不进废纸篓 / 回收站，确认框里要说清楚
    const captureCount = targets.filter((t) => t.source === "capture").length;
    const confirmed = await confirmAlert({
      title: t("confirmBatchTitle", { count: targets.length }),
      message: t("confirmBatchMsg", {
        trash: trashName(),
        captureNote: captureCount ? t("confirmCaptureNote", { count: captureCount }) : "",
        list: targets.slice(0, 5).map((t) => t.filename).join("\n"),
        more: targets.length > 5 ? t("confirmMoreItems", { count: targets.length }) : ""
      }),
      primaryAction: { title: t("cleanBtn"), style: "destructive" },
      dismissAction: { title: t("cancelBtn") }
    });
    if (!confirmed) return;

    const deleted = new Set<string>();
    const failures: string[] = [];
    for (const item of targets) {
      const res = await defaultScreenshotsManager.deleteScreenshot(item);
      if (res.success) deleted.add(item.id);
      else failures.push(`${item.filename}: ${res.message.replace(/^(?:删除截图失败|Failed to delete screenshot):\s*/, "")}`);
    }
    setItems((prev) => prev.filter((s) => !deleted.has(s.id)));
    setCheckedIds((prev) => prev.filter((id) => !deleted.has(id)));
    if (failures.length === 0) {
      await showToast(Toast.Style.Success, t("batchCleanSuccess", { count: deleted.size }));
    } else {
      reloadScreenshots(true);
      await showToast(
        Toast.Style.Failure,
        t("batchCleanPartial", { ok: deleted.size, fail: failures.length }),
        failures.slice(0, 3).join("\n")
      );
    }
  };

  const handleTogglePin = async (item: ScreenshotItem) => {
    try {
      const res = await defaultScreenshotsManager.togglePinScreenshot(item);
      reloadScreenshots();
      await toastResult(res);
    } catch (err: unknown) {
      await showToast(Toast.Style.Failure, t("pinFailedToast"), errorText(err));
    }
  };

  const authorizeTitle = getAuthorizeFolderActionTitle();
  const renderActionPanel = (item: ScreenshotItem) => (
    <ActionPanel title={t("panelScreenshotTitle", { name: item.filename })}>
      <Action
        title={t("actionPasteActive")}
        icon={Icon.Window}
        onAction={() => handlePasteToActive(item)}
      />
      <Action
        title={t("actionCopyImage")}
        icon={Icon.Clipboard}
        shortcut={{ modifiers: ["ctrl"], key: "c" }}
        onAction={() => handleCopyImage(item)}
      />
      <Action
        title={t("actionCopyPath")}
        icon={Icon.Document}
        shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
        onAction={() => handleCopyPath(item)}
      />
      {ocrEnabled ? (
        <Action
          title={t("actionCopyOcr")}
          icon={Icon.Text}
          shortcut={{ modifiers: ["ctrl", "alt"], key: "c" }}
          onAction={() => handleCopyOcr(item)}
        />
      ) : null}
      <Action.Push
        title={t("actionViewPreview")}
        icon={Icon.Eye}
        shortcut={{ modifiers: ["ctrl"], key: "y" }}
        target={<ScreenshotDetailView item={item} />}
      />
      <Action
        title={t("actionShowInMgr", { mgr: fileManagerName(item.path) })}
        icon={Icon.Folder}
        shortcut={{ modifiers: ["ctrl"], key: "o" }}
        onAction={() => handleShowInExplorer(item)}
      />
      <Action
        title={t("actionOpenDefault")}
        icon={Icon.ArrowRight}
        shortcut={{ modifiers: ["ctrl", "shift"], key: "o" }}
        onAction={() => handleOpenWithDefault(item)}
      />
      <Action
        title={t("actionCaptureNow")}
        icon={Icon.Camera}
        shortcut={{ modifiers: ["ctrl", "shift"], key: "s" }}
        onAction={handleCaptureScreenNow}
      />
      <Action
        title={item.pinned ? t("actionUnpin") : t("actionPin")}
        icon={Icon.Pin}
        shortcut={{ modifiers: ["ctrl"], key: "p" }}
        onAction={() => handleTogglePin(item)}
      />
      <Action
        title={t("actionPasteLatest")}
        icon={Icon.Clock}
        shortcut={{ modifiers: ["ctrl", "shift"], key: "v" }}
        onAction={handlePasteLatest}
      />
      <Action
        title={authorizeTitle}
        icon={Icon.Lock}
        onAction={() => handleAuthorizeFolder(item)}
      />
      <Action
        title={t("actionBatchClean", { count: batchTargets.length })}
        icon={Icon.Trash}
        onAction={handleBatchDeleteChecked}
      />
      <Action
        title={t("actionDeleteShot")}
        icon={Icon.Trash}
        shortcut={{ modifiers: ["ctrl"], key: "x" }}
        onAction={() => handleDelete(item)}
      />
    </ActionPanel>
  );

  const visiblePinnedCount = filtered.filter((s) => s.pinned).length;
  const visibleSize = formatTotalSize(filtered);
  const maxShotBytes = filtered.reduce((max, item) => Math.max(max, item.sizeBytes ?? 0), 1);

  const rightQueueItems = filtered.map((item) => {
    const isChecked = checkedIds.includes(item.id);
    const sizeRatio = item.sizeBytes === null ? null : Math.min(100, Math.round((item.sizeBytes / maxShotBytes) * 100));
    const knownDims = item.width > 0 && item.height > 0;
    const tagText = [item.pinned ? t("tagPinned") : "", item.source === "capture" ? t("tagCapture") : "", knownDims ? item.dimensions : ""]
      .filter(Boolean)
      .join(" · ");

    return List.Item({
      id: item.id,
      title: item.filename,
      subtitle: `${item.formattedDate} · ${ocrEnabled && item.ocrText ? item.ocrText.slice(0, 42).replace(/\s+/g, " ") : item.path}`,
      checkable: true,
      checked: isChecked,
      onCheckChange: (c) => {
        if (c) {
          setCheckedIds(Array.from(new Set([...checkedIds, item.id])));
        } else {
          setCheckedIds(checkedIds.filter((id) => id !== item.id));
        }
      },
      icon: {
        source: Icon.Image
      },
      accessories: [
        ...(sizeRatio === null ? [] : [{
          progress: {
            value: sizeRatio
          }
        }]),
        ...(tagText ? [{ tag: { value: tagText } }] : []),
        { text: item.formattedSize }
      ],
      actions: renderActionPanel(item)
    });
  });

  return (
    <List
      isShowingDetail={false}
      searchBarPlaceholder={ocrEnabled ? t("searchWithOcrPlaceholder") : t("searchNoOcrPlaceholder")}
      onSearchTextChange={setSearchText}
      onSelectionChange={setSelectedId}
      filterBar={{
        summaryText: scanError
          ? t("summaryError", { error: scanError })
          : t("summaryQueue", {
              count: filtered.length,
              size: visibleSize,
              pinned: visiblePinnedCount,
              failures: scanFailures.length ? t("summaryFailuresSuffix", { count: scanFailures.length }) : ""
            }),
        actions: [
          {
            id: "paste-latest",
            label: t("btnPasteLatest"),
            title: t("btnPasteLatest"),
            style: "primary",
            onAction: () => {
              void handlePasteLatest();
            }
          },
          {
            id: "rescan",
            label: t("btnRescanQueue"),
            title: t("btnRescanQueue"),
            style: "secondary",
            onAction: () => {
              reloadScreenshots(true);
            }
          }
        ]
      }}
      workbenchPanel={{
        title: t("wbTitle"),
        subtitle: t("wbSubtitle"),
        fields: [
          {
            id: "wb-post-action",
            label: t("wbPostActionLabel"),
            type: "select",
            value: copyAfterCapture,
            onChange: (val) => setCopyAfterCapture(val === "none" ? "none" : "copy"),
            options: [
              { label: t("wbOptCopy"), value: "copy" },
              { label: t("wbOptNone"), value: "none" }
            ]
          },
          {
            id: "wb-capture-scope",
            label: t("wbScopeLabel"),
            type: "info",
            value: t("wbScopeValue")
          },
          {
            id: "wb-save-dir",
            label: t("wbSaveDirLabel"),
            type: "info",
            value: t("wbSaveDirValue")
          }
        ]
      }}
      subList={{
        title: t("subListTitle"),
        subtitle: t("subListSubtitle", { count: visibleCheckedCount }),
        checkable: filtered.length > 0,
        checked:
          filtered.length > 0 && filtered.every((s) => checkedIds.includes(s.id))
            ? true
            : filtered.some((s) => checkedIds.includes(s.id))
            ? "indeterminate"
            : false,
        onCheckChange: (checked) => {
          // 全选 / 全不选只作用于当前可见的截图，不影响被搜索或分类隐藏的勾选状态
          const visible = new Set(filtered.map((s) => s.id));
          setCheckedIds((prev) =>
            checked ? Array.from(new Set([...prev, ...visible])) : prev.filter((id) => !visible.has(id))
          );
        },
        emptyText: scanError ? t("subListEmptyError") : t("subListEmptyNormal"),
        items: [
          ...scanFailures.map((failure, index) => List.Item({
            id: `scan-failure-${index}`,
            title: t("scanFailureTitle", { path: failure.path }),
            subtitle: failure.message,
            icon: Icon.ExclamationMark,
            checkable: false
          })),
          ...rightQueueItems
        ]
      }}
      actions={
        <ActionPanel title={t("globalActionsTitle")}>
          <Action
            title={t("actionCaptureNow")}
            icon={Icon.Camera}
            onAction={handleCaptureScreenNow}
          />
          <Action
            title={t("actionRescanDir")}
            icon={Icon.Repeat}
            onAction={() => reloadScreenshots(true)}
          />
          <Action
            title={authorizeTitle}
            icon={Icon.Lock}
            onAction={() => handleAuthorizeFolder()}
          />
        </ActionPanel>
      }
      searchBarAccessory={
        <List.Dropdown
          tooltip={t("categoryTooltip")}
          value={category}
          onChange={(val) => setCategory(val as ScreenshotCategory)}
        >
          <List.Dropdown.Item title={t("catAll")} value="all" />
          <List.Dropdown.Item title={t("catPinned")} value="pinned" />
          <List.Dropdown.Item title={t("catRecent")} value="recent" />
          {ocrEnabled ? <List.Dropdown.Item title={t("catOcr")} value="ocr" /> : null}
        </List.Dropdown>
      }
    >
      <List.Section title={t("sectionSystemShots", { count: filtered.length })}>
        {filtered.map((item) => (
          <List.Item
            key={item.id}
            id={item.id}
            title={item.filename}
            subtitle={item.dimensions}
            accessories={[
              ...(item.pinned ? [{ text: "PINNED" }] : []),
              { text: item.formattedSize },
              { text: item.formattedDate }
            ]}
            detail={
              isRealHost ? undefined : (
                <List.Item.Detail
                  markdown={ocrEnabled && item.ocrText ? `${t("ocrDetailHeader")}\`\`\`text\n${item.ocrText}\n\`\`\`` : ""}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title={t("metaFilename")} text={item.filename} icon={Icon.Image} />
                      <List.Item.Detail.Metadata.Label title={t("metaResolution")} text={item.dimensions} icon={Icon.Monitor} />
                      <List.Item.Detail.Metadata.Label title={t("metaFileSize")} text={item.formattedSize} icon={Icon.HardDrive} />
                      <List.Item.Detail.Metadata.Label title={t("metaModified")} text={item.formattedDate} icon={Icon.Calendar} />
                      <List.Item.Detail.Metadata.TagList title={t("metaStatus")}>
                        <List.Item.Detail.Metadata.TagList.Item
                          text={item.pinned ? t("statusPinned") : t("statusNormal")}
                          color={Color.SecondaryText}
                        />
                      </List.Item.Detail.Metadata.TagList>
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label title={t("metaPath")} text={item.path} icon={Icon.Folder} />
                    </List.Item.Detail.Metadata>
                  }
                />
              )
            }
            actions={renderActionPanel(item)}
          />
        ))}
      </List.Section>
    </List>
  );
}

export default ScreenshotsCommand;
