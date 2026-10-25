/**
 * 截图历史与回贴 (布局三：左 34% 截取参数工作台 + 右 66% 截图队列)
 *
 * - 左栏 workbenchPanel：只保留宿主真实支持的截取选项（截取后是否复制到剪贴板）与截图库概览
 * - 右栏 subList：宿主扫描到的本机截图 + 本次运行中立即截取的截图，可勾选
 * - 底部黄金三键：回贴到活动窗口 ↵ / 复制图片 ⌘↵ / 动作面板 ⌘K
 * - 100% 保留 ScreenshotsCommand, ScreenshotDetailView, ScreenshotsManager, defaultScreenshotsManager 导出
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
  generateScreenshotThumbnailSvg,
  INITIAL_SCREENSHOTS,
  AUTHORIZE_FOLDER_ACTION_TITLE,
  isOcrSupported
} from "./screenshots-service.js";
import { isRealElectronHost } from "./native-ipc.js";

export * from "./types.js";
export * from "./screenshots-service.js";
export { ScreenshotsManager, defaultScreenshotsManager, generateScreenshotThumbnailSvg, INITIAL_SCREENSHOTS };

function formatTotalBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(2)} ${units[idx]}`;
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
export function ScreenshotDetailView({ item }: { item: ScreenshotItem }) {
  const ocrEnabled = isOcrSupported();
  const markdown = `![${item.filename}](${item.thumbnailSvg})

---
${ocrEnabled && item.ocrText ? `
### 识别提取文字 (OCR Result)

\`\`\`text
${item.ocrText}
\`\`\`
` : ""}
- **存储路径**: \`${item.path}\`
- **分辨率**: **${item.dimensions}**
- **文件大小**: ${item.formattedSize} (${item.sizeBytes.toLocaleString()} bytes)
- **拍摄时间**: ${item.formattedDate}`;

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`截图详情: ${item.filename}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="文件名称" text={item.filename} icon={Icon.Image} />
          <Detail.Metadata.Label title="分辨率" text={item.dimensions} icon={Icon.Monitor} />
          <Detail.Metadata.Label title="文件大小" text={item.formattedSize} icon={Icon.HardDrive} />
          <Detail.Metadata.Label title="拍摄时间" text={item.formattedDate} icon={Icon.Calendar} />
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
            title="粘贴到活动窗口 (Paste to Active Window)"
            icon={Icon.Window}
            onAction={async () => {
              await toastResult(await defaultScreenshotsManager.pasteToActiveWindow(item));
            }}
          />
          <Action
            title="复制图片本身 (Copy Image to Clipboard)"
            icon={Icon.Clipboard}
            onAction={async () => {
              await toastResult(await defaultScreenshotsManager.copyImageToClipboard(item));
            }}
          />
          <Action
            title="复制图片本地路径 (Copy Image Path)"
            icon={Icon.Document}
            onAction={async () => {
              await Clipboard.copy(item.path);
              await showToast(Toast.Style.Success, `已复制路径: ${item.path}`);
            }}
          />
          {ocrEnabled ? (
            <Action
              title="复制提取的文字 (Copy OCR Text)"
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
    } catch (err: any) {
      await showToast(Toast.Style.Failure, "回贴最新截图失败", err.message || String(err));
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
    } catch (err: any) {
      await showToast(Toast.Style.Failure, "提取 OCR 文字失败", err.message || String(err));
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
    const confirmed = await confirmAlert({
      title: `将 ${targets.length} 张截图移入废纸篓？`,
      message: `仅清理当前列表中可见、已勾选且未置顶的截图：\n${targets
        .slice(0, 5)
        .map((t) => t.filename)
        .join("\n")}${targets.length > 5 ? `\n… 等 ${targets.length} 张` : ""}`,
      primaryAction: { title: "移入废纸篓", style: "destructive" }
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
    } catch (err: any) {
      await showToast(Toast.Style.Failure, "置顶操作失败", err.message || String(err));
    }
  };

  const renderActionPanel = (item: ScreenshotItem) => (
    <ActionPanel title={`截图: ${item.filename}`}>
      <Action
        title="粘贴到活动窗口 (Paste Image to Active Window)"
        icon={Icon.Window}
        shortcut={{ modifiers: ["cmd"], key: "enter" }}
        onAction={() => handlePasteToActive(item)}
      />
      <Action
        title="复制图片本身 (Copy Image to Clipboard)"
        icon={Icon.Clipboard}
        shortcut={{ modifiers: ["cmd"], key: "c" }}
        onAction={() => handleCopyImage(item)}
      />
      <Action
        title="复制图片本地路径 (Copy Image Path)"
        icon={Icon.Document}
        shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
        onAction={() => handleCopyPath(item)}
      />
      {ocrEnabled ? (
        <Action
          title="复制提取的文字 (Copy Recognized Text)"
          icon={Icon.Text}
          shortcut={{ modifiers: ["cmd", "alt"], key: "c" }}
          onAction={() => handleCopyOcr(item)}
        />
      ) : null}
      <Action
        title="在资源管理器中定位 (Show in Explorer)"
        icon={Icon.Folder}
        shortcut={{ modifiers: ["cmd"], key: "o" }}
        onAction={() => handleShowInExplorer(item)}
      />
      <Action
        title="用默认图片查看器打开 (Open with Default App)"
        icon={Icon.ArrowRight}
        shortcut={{ modifiers: ["cmd", "shift"], key: "o" }}
        onAction={() => handleOpenWithDefault(item)}
      />
      <Action
        title="立即截取全部屏幕 (Capture Screen Now)"
        icon={Icon.Camera}
        shortcut={{ modifiers: ["ctrl", "shift"], key: "s" }}
        onAction={handleCaptureScreenNow}
      />
      <Action
        title={item.pinned ? "取消置顶 (Unpin Screenshot)" : "置顶此截图 (Pin Screenshot)"}
        icon={Icon.Pin}
        shortcut={{ modifiers: ["cmd"], key: "p" }}
        onAction={() => handleTogglePin(item)}
      />
      <Action
        title="回贴最新一张截图 (Paste Latest)"
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
        title={`批量清理已勾选截图 (${batchTargets.length}项)`}
        icon={Icon.Trash}
        onAction={handleBatchDeleteChecked}
      />
      <Action
        title="删除此截图 (Delete Screenshot)"
        icon={Icon.Trash}
        shortcut={{ modifiers: ["ctrl"], key: "x" }}
        onAction={() => handleDelete(item)}
      />
    </ActionPanel>
  );

  const pinnedCount = items.filter((s) => s.pinned).length;
  const totalBytes = items.reduce((sum, s) => sum + s.sizeBytes, 0);
  const latestDimensions = items[0]?.dimensions || "无截图";
  const maxShotBytes = Math.max(1, ...filtered.map((s) => s.sizeBytes));

  const rightQueueItems = filtered.map((item) => {
    const isChecked = checkedIds.includes(item.id);
    const sizeRatio = Math.max(10, Math.min(100, Math.round((item.sizeBytes / maxShotBytes) * 100)));
    const knownDims = item.width > 0 && item.height > 0;
    const tagText = [item.pinned ? "置顶" : "", item.source === "capture" ? "本次截取" : "", knownDims ? item.dimensions : ""]
      .filter(Boolean)
      .join(" · ");

    return List.Item({
      id: item.id,
      title: item.filename,
      subtitle: `${item.dimensions} · ${item.formattedDate} · ${ocrEnabled && item.ocrText ? item.ocrText.slice(0, 42).replace(/\s+/g, " ") : item.path}`,
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
        {
          progress: {
            value: sizeRatio
          }
        },
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
        summaryText: scanError ? `截图列表不可用或已过期：${scanError}` : `截图队列共 ${filtered.length} 张 (${formatTotalBytes(totalBytes)}) · 已置顶 ${pinnedCount} 张${filtered[0] ? ` · 最新: ${filtered[0].filename}` : ""}`,
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
            value: "全部显示器（截取前自动隐藏 ZTools 窗口）"
          },
          {
            id: "wb-save-dir",
            label: "截取文件保存位置",
            type: "info",
            value: "ZTools 缓存目录 (PNG，本次运行内保留在列表中)"
          }
        ],
        previewCard: {
          title: "截图库概览",
          badge: "PNG",
          subtitle: `已选 ${visibleCheckedCount}/${filtered.length} 张 · 可清理 ${batchTargets.length} 张`,
          metrics: [
            { label: "本机截图总数", value: `${items.length} 张` },
            { label: "收藏置顶数", value: `${pinnedCount} 张` },
            { label: "总占用空间", value: formatTotalBytes(totalBytes) },
            { label: "最新截图尺寸", value: latestDimensions }
          ]
        }
      }}
      subList={{
        title: "本机截图历史与回贴队列 (按拍摄时间排序，按 ↵ 回贴到活动窗口)",
        subtitle: `${filtered.length} 张截图 · 已选 ${visibleCheckedCount} 项 · 总计 ${formatTotalBytes(totalBytes)}`,
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
            title="立即截取全部屏幕 (Capture Screen Now)"
            icon={Icon.Camera}
            onAction={handleCaptureScreenNow}
          />
          <Action
            title="重新扫描截图目录 (Refresh Screenshots)"
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
          <List.Dropdown.Item title="全部截图 (All Screenshots)" value="all" />
          <List.Dropdown.Item title="已置顶截图 (Pinned)" value="pinned" />
          <List.Dropdown.Item title="1小时内拍摄 (Recent)" value="recent" />
          {ocrEnabled ? <List.Dropdown.Item title="包含提取文字 (With OCR Text)" value="ocr" /> : null}
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
                  markdown={`![${item.filename}](${item.thumbnailSvg})\n\n---\n\n### OCR 文字提取识别 (Text Recognition)\n\n\`\`\`text\n${item.ocrText}\n\`\`\``}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="文件名称" text={item.filename} icon={Icon.Image} />
                      <List.Item.Detail.Metadata.Label title="分辨率" text={item.dimensions} icon={Icon.Monitor} />
                      <List.Item.Detail.Metadata.Label title="文件大小" text={item.formattedSize} icon={Icon.HardDrive} />
                      <List.Item.Detail.Metadata.Label title="拍摄时间" text={item.formattedDate} icon={Icon.Calendar} />
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
