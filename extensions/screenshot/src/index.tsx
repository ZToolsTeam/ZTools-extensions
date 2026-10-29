/**
 * 截图历史与回贴 (布局三：左 34% 截取参数工作台 + 右 66% 截图队列)
 *
 * - 左栏 workbenchPanel：只保留宿主真实支持的截取选项（截取后是否复制到剪贴板）与截图库概览
 * - 右栏 subList：宿主扫描到的本机截图 + 本次运行中立即截取的截图，可勾选
 * - 底部操作栏：回贴到活动窗口 ↵ / 复制图片 ⌘↵ / 动作面板 ⌘K
 * - 对外导出 ScreenshotsCommand、ScreenshotDetailView、ScreenshotsManager、defaultScreenshotsManager
 */

import React from "@ztools/declarative-ui";
import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  confirmAlert
} from "@ztools/declarative-ui";
import { useState, useMemo, useEffect } from "@ztools/declarative-ui";
import {
  ScreenshotItem,
  ScreenshotCategory,
  ScreenshotActionResult
} from "./types.js";
import {
  defaultScreenshotsManager,
  ScreenshotsManager,
  INITIAL_SCREENSHOTS,
  buildScreenshotDetailMarkdown,
  fileManagerName,
  type ScreenshotPreviewState,
  AUTHORIZE_FOLDER_ACTION_TITLE,
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
  return `${formatScreenshotSize(knownBytes)}${unknownCount ? ` + ${unknownCount} 张大小未知` : ""}`;
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
      navigationTitle={`截图详情: ${item.filename}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="文件名称" text={item.filename} icon={Icon.Image} />
          <Detail.Metadata.Label title="分辨率" text={item.dimensions} icon={Icon.Monitor} />
          <Detail.Metadata.Label title="文件大小" text={item.formattedSize} icon={Icon.HardDrive} />
          <Detail.Metadata.Label title="修改时间" text={item.formattedDate} icon={Icon.Calendar} />
          <Detail.Metadata.TagList title="状态">
            <Detail.Metadata.TagList.Item
              text={item.pinned ? "PINNED (已置顶)" : "NORMAL"}
              color={Color.SecondaryText}
            />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="存储路径" text={item.path} icon={Icon.Folder} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title={`截图: ${item.filename}`}>
          <Action
            title="粘贴到活动窗口"
            icon={Icon.Window}
            onAction={async () => {
              await toastResult(await defaultScreenshotsManager.pasteToActiveWindow(item));
            }}
          />
          <Action
            title="复制图片本身"
            icon={Icon.Clipboard}
            onAction={async () => {
              await toastResult(await defaultScreenshotsManager.copyImageToClipboard(item));
            }}
          />
          <Action
            title="复制图片本地路径"
            icon={Icon.Document}
            onAction={async () => {
              await Clipboard.copy(item.path);
              await showToast(Toast.Style.Success, `已复制路径: ${item.path}`);
            }}
          />
          {ocrEnabled ? (
            <Action
              title="复制提取的文字"
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
  const isRealHost = isRealElectronHost();
  const ocrEnabled = isOcrSupported();
  const initialList = isRealHost ? [] : [...INITIAL_SCREENSHOTS];
  const [items, setItems] = useState<ScreenshotItem[]>(() => initialList);
  // 默认不勾选任何截图：批量清理是破坏性操作，必须由用户主动勾选
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [scanError, setScanError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [category, setCategory] = useState<ScreenshotCategory>("all");
  const [copyAfterCapture, setCopyAfterCapture] = useState<"copy" | "none">("copy");
  const [refreshCount] = useState(0);
  const [, setSelectedId] = useState<string | null>(null);

  const applyList = (list: ScreenshotItem[]) => {
    const nextList = list.length > 0 ? list : isRealElectronHost() ? [] : [...INITIAL_SCREENSHOTS];
    setScanError("");
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
      void showToast({ style: Toast.Style.Failure, title: "截图扫描失败", message });
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
          res.error === "NO_SCREENSHOTS" ? "未找到截图" : "回贴最新截图失败",
          res.message
        );
      }
    } catch (err: unknown) {
      await showToast(Toast.Style.Failure, "回贴最新截图失败", errorText(err));
    }
  };

  const handleCopyImage = async (item: ScreenshotItem) => {
    await toastResult(await defaultScreenshotsManager.copyImageToClipboard(item));
  };

  const handleCopyPath = async (item: ScreenshotItem) => {
    await Clipboard.copy(item.path);
    await showToast(Toast.Style.Success, `已复制路径: ${item.path}`);
  };

  const handleCopyOcr = async (item: ScreenshotItem) => {
    try {
      const text = await defaultScreenshotsManager.extractOcr(item);
      await Clipboard.copy(text);
      await showToast(Toast.Style.Success, `已复制 OCR 文字 (${text.length} 字符)`);
    } catch (err: unknown) {
      await showToast(Toast.Style.Failure, "提取 OCR 文字失败", errorText(err));
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
      await showToast(Toast.Style.Failure, "没有可清理的截图", "请先在当前列表中勾选未置顶的截图");
      return;
    }
    // 本次立即截取的文件在缓存目录，删除后不进废纸篓 / 回收站，确认框里要说清楚
    const captureCount = targets.filter((t) => t.source === "capture").length;
    const confirmed = await confirmAlert({
      title: `清理 ${targets.length} 张截图？`,
      message: `仅清理当前列表中可见、已勾选且未置顶的截图；扫描到的截图移入${trashName()}${
        captureCount ? `，其中 ${captureCount} 张本次立即截取的截图会直接删除、无法恢复` : ""
      }：\n${targets
        .slice(0, 5)
        .map((t) => t.filename)
        .join("\n")}${targets.length > 5 ? `\n… 等 ${targets.length} 张` : ""}`,
      primaryAction: { title: "清理", style: "destructive" },
      dismissAction: { title: "取消" }
    });
    if (!confirmed) return;

    const deleted = new Set<string>();
    const failures: string[] = [];
    for (const item of targets) {
      const res = await defaultScreenshotsManager.deleteScreenshot(item);
      if (res.success) deleted.add(item.id);
      else failures.push(`${item.filename}: ${res.message.replace(/^删除截图失败:\s*/, "")}`);
    }
    setItems((prev) => prev.filter((s) => !deleted.has(s.id)));
    setCheckedIds((prev) => prev.filter((id) => !deleted.has(id)));
    if (failures.length === 0) {
      await showToast(Toast.Style.Success, `已清理 ${deleted.size} 张截图`);
    } else {
      reloadScreenshots(true);
      await showToast(
        Toast.Style.Failure,
        `已清理 ${deleted.size} 张，${failures.length} 张失败`,
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
      await showToast(Toast.Style.Failure, "置顶操作失败", errorText(err));
    }
  };

  const renderActionPanel = (item: ScreenshotItem) => (
    <ActionPanel title={`截图: ${item.filename}`}>
      <Action
        title="粘贴到活动窗口"
        icon={Icon.Window}
        onAction={() => handlePasteToActive(item)}
      />
      <Action
        title="复制图片本身"
        icon={Icon.Clipboard}
        shortcut={{ modifiers: ["cmd"], key: "c" }}
        onAction={() => handleCopyImage(item)}
      />
      <Action
        title="复制图片本地路径"
        icon={Icon.Document}
        shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
        onAction={() => handleCopyPath(item)}
      />
      {ocrEnabled ? (
        <Action
          title="复制提取的文字"
          icon={Icon.Text}
          shortcut={{ modifiers: ["cmd", "alt"], key: "c" }}
          onAction={() => handleCopyOcr(item)}
        />
      ) : null}
      <Action.Push
        title="查看截图预览"
        icon={Icon.Eye}
        shortcut={{ modifiers: ["cmd"], key: "y" }}
        target={<ScreenshotDetailView item={item} />}
      />
      <Action
        title={`在${fileManagerName(item.path)}中显示`}
        icon={Icon.Folder}
        shortcut={{ modifiers: ["cmd"], key: "o" }}
        onAction={() => handleShowInExplorer(item)}
      />
      <Action
        title="用默认图片查看器打开"
        icon={Icon.ArrowRight}
        shortcut={{ modifiers: ["cmd", "shift"], key: "o" }}
        onAction={() => handleOpenWithDefault(item)}
      />
      <Action
        title="立即截取全部屏幕"
        icon={Icon.Camera}
        shortcut={{ modifiers: ["ctrl", "shift"], key: "s" }}
        onAction={handleCaptureScreenNow}
      />
      <Action
        title={item.pinned ? "取消置顶" : "置顶此截图"}
        icon={Icon.Pin}
        shortcut={{ modifiers: ["cmd"], key: "p" }}
        onAction={() => handleTogglePin(item)}
      />
      <Action
        title="回贴最新一张截图"
        icon={Icon.Clock}
        shortcut={{ modifiers: ["cmd", "shift"], key: "v" }}
        onAction={handlePasteLatest}
      />
      <Action
        title={AUTHORIZE_FOLDER_ACTION_TITLE}
        icon={Icon.Lock}
        onAction={() => handleAuthorizeFolder(item)}
      />
      <Action
        title={`批量清理已勾选截图（${batchTargets.length} 项）`}
        icon={Icon.Trash}
        onAction={handleBatchDeleteChecked}
      />
      <Action
        title="删除此截图"
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
    const tagText = [item.pinned ? "置顶" : "", item.source === "capture" ? "本次截取" : "", knownDims ? item.dimensions : ""]
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
      searchBarPlaceholder={ocrEnabled ? "搜索截图文件名、路径、分辨率或 OCR 提取文字..." : "搜索截图文件名、路径或分辨率..."}
      onSearchTextChange={setSearchText}
      onSelectionChange={setSelectedId}
      filterBar={{
        summaryText: scanError ? `截图列表不可用或已过期：${scanError}` : `截图队列共 ${filtered.length} 张（${visibleSize}） · 已置顶 ${visiblePinnedCount} 张`,
        actions: [
          {
            id: "paste-latest",
            label: "粘贴最新截图",
            title: "粘贴最新截图",
            style: "primary",
            onAction: () => {
              void handlePasteLatest();
            }
          },
          {
            id: "rescan",
            label: "重新扫描队列",
            title: "重新扫描队列",
            style: "secondary",
            onAction: () => {
              reloadScreenshots(true);
            }
          }
        ]
      }}
      workbenchPanel={{
        title: "截图截取与回贴工作台",
        subtitle: "截取全部屏幕 · 截图历史回贴",
        fields: [
          {
            id: "wb-post-action",
            label: "截取后动作",
            type: "select",
            value: copyAfterCapture,
            onChange: (val) => setCopyAfterCapture(val === "none" ? "none" : "copy"),
            options: [
              { label: "复制到剪贴板", value: "copy" },
              { label: "仅加入截图列表", value: "none" }
            ]
          },
          {
            id: "wb-capture-scope",
            label: "截取范围",
            type: "info",
            value: "全部显示器"
          },
          {
            id: "wb-save-dir",
            label: "保存位置",
            type: "info",
            value: "ZTools 缓存目录"
          }
        ]
      }}
      subList={{
        title: "截图历史（按修改时间排序）",
        subtitle: `已选 ${visibleCheckedCount} 项`,
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
        emptyText: "当前分类下暂无匹配的截图记录",
        items: rightQueueItems
      }}
      actions={
        <ActionPanel title="屏幕截图全局操作">
          <Action
            title="立即截取全部屏幕"
            icon={Icon.Camera}
            onAction={handleCaptureScreenNow}
          />
          <Action
            title="重新扫描截图目录"
            icon={Icon.Repeat}
            onAction={() => reloadScreenshots(true)}
          />
          <Action
            title={AUTHORIZE_FOLDER_ACTION_TITLE}
            icon={Icon.Lock}
            onAction={() => handleAuthorizeFolder()}
          />
        </ActionPanel>
      }
      searchBarAccessory={
        <List.Dropdown
          tooltip="按分类筛选截图"
          value={category}
          onChange={(val) => setCategory(val as ScreenshotCategory)}
        >
          <List.Dropdown.Item title="全部截图" value="all" />
          <List.Dropdown.Item title="已置顶截图" value="pinned" />
          <List.Dropdown.Item title="1小时内拍摄" value="recent" />
          {ocrEnabled ? <List.Dropdown.Item title="包含提取文字" value="ocr" /> : null}
        </List.Dropdown>
      }
    >
      <List.Section title={`系统截图库 (${filtered.length})`}>
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
                  markdown={ocrEnabled && item.ocrText ? `### OCR 文字提取识别\n\n\`\`\`text\n${item.ocrText}\n\`\`\`` : ""}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="文件名称" text={item.filename} icon={Icon.Image} />
                      <List.Item.Detail.Metadata.Label title="分辨率" text={item.dimensions} icon={Icon.Monitor} />
                      <List.Item.Detail.Metadata.Label title="文件大小" text={item.formattedSize} icon={Icon.HardDrive} />
                      <List.Item.Detail.Metadata.Label title="修改时间" text={item.formattedDate} icon={Icon.Calendar} />
                      <List.Item.Detail.Metadata.TagList title="状态">
                        <List.Item.Detail.Metadata.TagList.Item
                          text={item.pinned ? "PINNED (已置顶)" : "NORMAL"}
                          color={Color.SecondaryText}
                        />
                      </List.Item.Detail.Metadata.TagList>
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label title="存储路径" text={item.path} icon={Icon.Folder} />
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
