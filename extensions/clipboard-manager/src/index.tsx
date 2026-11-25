import React from "@ztools/declarative-ui";
import {
  List,
  Detail,
  Form,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  confirmAlert,
  useNavigation,
  useLocale
} from "@ztools/declarative-ui";
import { useState, useEffect } from "@ztools/declarative-ui";
import { t } from "./i18n.js";
import {
  callHostTransport,
  isRealElectronHost
} from "./native-ipc.js";
import {
  ClipboardItem,
  ClipboardContentType
} from "./types.js";
import {
  getClipboardHistory,
  syncCurrentSystemClipboard,
  saveEditedClipboardItem,
  filterClipboardItems,
  formatCopiedTime,
  parseColorDetails,
  maskSensitiveContent,
  toggleClipboardItemPin,
  deleteClipboardItem,
  clearUnpinnedClipboardHistory,
  restoreClipboardItem,
  pasteSequentialClipboard,
  resetPasteSequence,
  getLastHostHistoryError
} from "./clipboard-storage.js";
import { resolveErrorMessage } from './error-i18n.js'

export * from "./types.js";
export * from "./clipboard-storage.js";

function ClipboardColorActions({ color }: { color: ReturnType<typeof parseColorDetails> }) {
  return (<> {color ? (
            <>
              <Action.CopyToClipboard
                title={t("actionCopyRgb")}
                content={color.rgb}
                icon={Icon.Eye}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "r" }}
              />
              <Action.CopyToClipboard
                title={t("actionCopyHsl")}
                content={color.hsl}
                icon={Icon.Eye}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "s" }}
              />
            </>
          ) : null} </>);
}

/**
 * 把用户内容原样放进围栏代码块：围栏比内容里最长的连续反引号多一个，内容里的 ``` 不会提前结束代码块
 */
export function fencedBlock(content: string, lang = "text"): string {
  const runs = String(content).match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${content}\n${fence}`;
}

/**
 * 列表标题、提示里展示的文字：敏感内容只显示遮罩后的值
 */
export function getDisplayTitle(item: ClipboardItem): string {
  const sensitivity = maskSensitiveContent(item.content);
  if (sensitivity.isSensitive) return sensitivity.masked;
  return item.preview;
}

export function getClipboardMarkdown(item: ClipboardItem): string {
  let markdown = t("detailTitle");

  const sensitivity = maskSensitiveContent(item.content);
  if (sensitivity.isSensitive) {
    // 敏感内容：所有类型都只展示遮罩后的文本，不渲染可点击链接或完整 JSON
    markdown += t("detailSensitiveNote", { reason: sensitivity.reason || t("secretFallback") });
    let body = item.content;
    if (item.type === "json") {
      try {
        body = JSON.stringify(JSON.parse(item.content), null, 2);
      } catch {
        // 保持原文
      }
    }
    const maskedBody = maskSensitiveContent(body);
    markdown += fencedBlock(maskedBody.isSensitive ? maskedBody.masked : sensitivity.masked, item.type === "json" ? "json" : "text");
    return markdown;
  }

  if (item.type === "color") {
    const details = parseColorDetails(item.content);
    markdown += t("detailColorTitle");
    if (details) {
      markdown += `\`\`\`css\n/* HEX */\ncolor: ${details.hex};\n\n/* RGB */\nbackground-color: ${details.rgb};\n\n/* HSL */\nborder-color: ${details.hsl};\n\`\`\`\n\n`;
      markdown += `> **HEX**: \`${details.hex}\` | **RGB**: \`${details.rgb}\` | **HSL**: \`${details.hsl}\``;
    } else {
      markdown += fencedBlock(item.content);
    }
  } else if (item.type === "json") {
    try {
      const parsed = JSON.parse(item.content);
      const formatted = JSON.stringify(parsed, null, 2);
      const keysCount = typeof parsed === "object" && parsed !== null ? Object.keys(parsed).length : 0;
      markdown += t("detailJsonTitle", { count: keysCount, block: fencedBlock(formatted, "json") });
    } catch {
      markdown += fencedBlock(item.content, "json");
    }
  } else if (item.type === "code") {
    markdown += fencedBlock(item.content, "typescript");
  } else if (item.type === "link") {
    markdown += t("detailLinkSection", {
      url: item.content,
      proto: item.content.startsWith("https") ? "HTTPS" : "HTTP"
    });
  } else if (item.type === "image") {
    // 宿主只返回缩略图；缩略图生成失败时 content 为空，不能渲染成空图片，也不编造分辨率
    if (item.content.startsWith("data:image/")) {
      markdown += `![${t("detailImgAlt")}](${item.content})`;
      if (item.imageDimensions?.width && item.imageDimensions?.height) {
        markdown += t("detailImgRes", { w: item.imageDimensions.width, h: item.imageDimensions.height });
      }
    } else {
      markdown += t("detailImgNoThumb");
    }
  } else if (item.type === "files") {
    if (isUnavailableFileItem(item)) {
      markdown += t("detailForeignFilesNote");
    }
    markdown += t("detailFilesTitle") + fencedBlock(item.filePaths?.length ? item.filePaths.join("\n") : item.content);
  } else {
    // 纯文本按原样展示：保留换行与所有字符，不当作 Markdown 解析
    markdown += fencedBlock(item.content);
  }
  return markdown;
}

/** 删除前请用户确认；取消或无法弹出确认框时不删除 */
async function confirmDeleteItem(item: ClipboardItem): Promise<boolean> {
  return confirmAlert({
    title: t("confirmDeleteTitle"),
    message: getDisplayTitle(item).slice(0, 120),
    primaryAction: { title: t("actionDelete"), style: "destructive" },
    dismissAction: { title: t("actionCancel") }
  });
}

/** 当前运行平台：macOS 文案用访达，Windows 用资源管理器 */
export function currentPlatform(): "mac" | "windows" | "other" {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const signature = String(nav?.platform || nav?.userAgent || "");
  if (/Mac/i.test(signature)) return "mac";
  if (/Win/i.test(signature)) return "windows";
  return "other";
}

const isWindowsStylePath = (p: string): boolean => /^[a-zA-Z]:[\\/]|^\\\\/.test(p);

/** 路径写法属于另一个系统（Mac 上的 C:\\…，Windows 上的 /Users/…）：本机一定不存在 */
export function isForeignPlatformPath(filePath: string, platform = currentPlatform()): boolean {
  const p = String(filePath || "");
  if (platform === "mac") return isWindowsStylePath(p);
  if (platform === "windows") return p.startsWith("/");
  return false;
}

/** 文件历史里本机能用的路径；非文件记录返回 null */
export function localFilePaths(item: ClipboardItem): string[] | null {
  if (item.type !== "files" || !item.filePaths?.length) return null;
  return item.filePaths.filter((p) => !isForeignPlatformPath(p));
}

/** 文件历史的路径全部来自其他系统：不能粘贴、复制文件或定位 */
export function isUnavailableFileItem(item: ClipboardItem): boolean {
  const local = localFilePaths(item);
  return local !== null && local.length === 0;
}

/** 系统文件管理器名称：按当前平台；平台未知时按路径写法判断 */
export function fileManagerName(samplePath: string): string {
  const platform = currentPlatform();
  if (platform === "mac") return t("fmFinder");
  if (platform === "windows") return t("fmExplorer");
  return isWindowsStylePath(String(samplePath || "")) ? t("fmExplorer") : t("fmFinder");
}

/** 内容类型的显示名 */
export function typeLabel(type: string): string {
  switch (type) {
    case "code": return t("typeCode");
    case "image": return t("typeImage");
    case "files": return t("typeFiles");
    case "link": return t("typeLink");
    case "color": return t("typeColor");
    case "json": return t("typeJson");
    default: return t("typeText");
  }
}

/** 在文件管理器中定位文件：以宿主返回结果为准，失败时如实提示 */
async function revealClipboardFile(filePath: string): Promise<void> {
  // 只做“显示”：不能在定位失败时退回用默认程序打开文件
  const res = await callHostTransport("shell_show_item_in_folder", { fullPath: filePath });
  if (res.ok) await showToast(Toast.Style.Success, t("toastRevealed", { manager: fileManagerName(filePath) }), filePath);
  else await showToast(Toast.Style.Failure, t("toastRevealFailed"), `${filePath}\n${resolveErrorMessage(res, t("toastRevealMissingFallback"))}`);
}

async function handleRestoreClipboardItem(item: ClipboardItem, paste: boolean): Promise<void> {
  try {
    await restoreClipboardItem(item, paste);
    await showToast(Toast.Style.Success, paste ? t("toastPasted") : t("toastCopied"));
  } catch (error) {
    await showToast(Toast.Style.Failure, paste ? t("toastPasteFailed") : t("toastCopyFailed"), error instanceof Error ? error.message : String(error));
  }
}

/** 条目的 Enter / 复制动作：来自其他系统的文件只能复制路径文字 */
function ItemPrimaryActions({ item }: { item: ClipboardItem }) {
  if (isUnavailableFileItem(item)) {
    return (
      <Action.CopyToClipboard
        title={t("actionCopyFilePaths")}
        content={(item.filePaths || []).join("\n")}
        icon={Icon.CopyClipboard}
      />
    );
  }
  return (
    <>
      <Action
        title={t("actionPasteToActive")}
        onAction={() => handleRestoreClipboardItem(item, true)}
        icon={Icon.Checkmark}
      />
      <Action
        title={t("actionCopyToClipboard")}
        onAction={() => handleRestoreClipboardItem(item, false)}
        icon={Icon.CopyClipboard}
        shortcut={{ modifiers: ["ctrl"], key: "c" }}
      />
    </>
  );
}

/**
 * 剪贴板条目详情视图
 */
export function ClipboardDetailView({
  item,
  onDeleted,
  onPinToggled
}: {
  item: ClipboardItem;
  /** 由列表负责删除并刷新；返回 false 表示删除失败 */
  onDeleted?: (id: string) => Promise<boolean | void> | boolean | void;
  /** 由列表负责切换置顶并刷新；返回切换后的真实置顶状态，null 表示切换失败 */
  onPinToggled?: (id: string) => Promise<boolean | null | void> | boolean | null | void;
}) {
  useLocale();
  const { pop } = useNavigation();
  const [pinned, setPinned] = useState<boolean>(Boolean(item.pinned));
  const markdown = getClipboardMarkdown(item);
  const colorDetails = item.type === "color" ? parseColorDetails(item.content) : null;
  const sensitivity = maskSensitiveContent(item.content);
  const unavailable = isUnavailableFileItem(item);
  const revealPath = localFilePaths(item)?.[0];

  return (
    <Detail
      markdown={markdown}
      navigationTitle={t("detailNavTitle", { type: typeLabel(item.type) })}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title={t("metaContentType")} text={typeLabel(item.type)} icon={Icon.Document} />
          <Detail.Metadata.Label title={t("metaCopiedAt")} text={formatCopiedTime(item.copiedAt)} icon={Icon.Clock} />
          <Detail.Metadata.Label title={t("metaPinStatus")} text={pinned ? t("metaPinned") : t("metaUnpinned")} icon={Icon.Pin} />
          {item.sourceAppName ? (
            <Detail.Metadata.Label title={t("metaSourceApp")} text={item.sourceAppName} icon={Icon.AppWindow} />
          ) : null}
          {colorDetails ? (
            <>
              <Detail.Metadata.Label title="HEX" text={colorDetails.hex} icon={Icon.Eye} />
              <Detail.Metadata.Label title="RGB" text={colorDetails.rgb} icon={Icon.Eye} />
              <Detail.Metadata.Label title="HSL" text={colorDetails.hsl} icon={Icon.Eye} />
            </>
          ) : null}
          {item.charCount !== undefined && (
            <Detail.Metadata.Label title={t("metaCharCount")} text={t("metaCharCountVal", { count: item.charCount })} icon={Icon.Pencil} />
          )}
          {item.lineCount !== undefined && (
            <Detail.Metadata.Label title={t("metaLineCount")} text={t("metaLineCountVal", { count: item.lineCount })} icon={Icon.List} />
          )}
          {(sensitivity.isSensitive || item.isSensitive) ? (
            <Detail.Metadata.Label title={t("metaSensitiveLabel")} text={sensitivity.reason || t("metaMaskedDefault")} icon={Icon.Lock} />
          ) : null}
          {unavailable ? (
            <Detail.Metadata.Label title={t("metaFileStatus")} text={t("metaFileForeign")} icon={Icon.ExclamationMark} />
          ) : null}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title={t("panelItemActions")}>
          <ItemPrimaryActions item={item} />
          {item.type === "link" ? (
            <Action.OpenInBrowser
              title={t("actionOpenInBrowser")}
              url={item.content}
              icon={Icon.Globe}
              shortcut={{ modifiers: ["ctrl"], key: "o" }}
            />
          ) : null}
          {revealPath ? (
            <Action
              title={t("actionRevealFile", { manager: fileManagerName(revealPath) })}
              icon={Icon.Folder}
              shortcut={{ modifiers: ["ctrl", "shift"], key: "o" }}
              onAction={() => revealClipboardFile(revealPath)}
            />
          ) : null}
          <ClipboardColorActions color={colorDetails} />
          <Action
            title={pinned ? t("actionUnpin") : t("actionPin")}
            icon={Icon.Pin}
            shortcut={{ modifiers: ["ctrl"], key: "p" }}
            onAction={async () => {
              // 只切换一次：有列表回调时由列表切换并刷新，否则自己切换
              let next: boolean | null;
              if (onPinToggled) {
                const res = await onPinToggled(item.id);
                next = typeof res === "boolean" ? res : res === null ? null : !pinned;
              } else {
                next = (await toggleClipboardItemPin(item.id)) ? !pinned : null;
              }
              if (next === null) {
                await showToast(Toast.Style.Failure, pinned ? t("toastUnpinFailed") : t("toastPinFailed"), t("toastRecordDeletedHint"));
                return;
              }
              setPinned(next);
              await showToast(Toast.Style.Success, next ? t("toastPinned") : t("toastUnpinned"));
            }}
          />
          <Action
            title={t("actionDeleteRecord")}
            icon={Icon.Trash}
            shortcut={{ modifiers: ["ctrl"], key: "x" }}
            onAction={async () => {
              if (!(await confirmDeleteItem(item))) return;
              const res = onDeleted ? await onDeleted(item.id) : await deleteClipboardItem(item.id);
              if (res === false) {
                await showToast(Toast.Style.Failure, t("toastDeleteFailed"), t("toastRecordDeletedHint"));
                return;
              }
              await showToast(Toast.Style.Success, t("toastRecordDeleted"));
              pop();
            }}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * 新建或编辑剪贴板条目表单
 */
export function ClipboardItemForm({
  initialItem,
  onSaved
}: {
  initialItem?: ClipboardItem;
  /** 返回 persisted=false 时表单不关闭并提示失败原因 */
  onSaved?: (input: { content: string; pinned: boolean }) => Promise<{ persisted: boolean; message?: string } | void> | void;
}) {
  useLocale();
  const { pop } = useNavigation();
  const [content, setContent] = useState<string>(initialItem?.content || "");
  const [pinned, setPinned] = useState<boolean>(Boolean(initialItem?.pinned));

  return (
    <Form
      navigationTitle={initialItem ? t("formNavEdit") : t("formNavNew")}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={initialItem ? t("formSubmitEdit") : t("formSubmitNew")}
            icon={Icon.Checkmark}
            onSubmit={async (values: Record<string, unknown>) => {
              const text = typeof values?.content === "string" ? values.content : content;
              const pin = typeof values?.pinned === "boolean" ? values.pinned : pinned;
              if (!text.trim()) {
                await showToast(Toast.Style.Failure, t("errContentEmpty"));
                return;
              }
              try {
                await Clipboard.copy(text);
              } catch (err: unknown) {
                await showToast(Toast.Style.Failure, t("toastWriteClipboardFailed"), resolveErrorMessage(err, t("toastRetry")));
                return;
              }
              const result = await onSaved?.({ content: text, pinned: pin });
              if (result && result.persisted === false) {
                await showToast(Toast.Style.Failure, t("toastSavedLocalFailed"), resolveErrorMessage(result.message, t("toastRetry")));
                return;
              }
              await showToast(Toast.Style.Success, t("toastSavedSuccess"));
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="content"
        title={t("formContentLabel")}
        placeholder={t("formContentPlaceholder")}
        value={content}
        onChange={(v: string) => setContent(String(v ?? ""))}
      />
      <Form.Checkbox
        id="pinned"
        label={t("formPinLabel")}
        value={pinned}
        onChange={(v: boolean) => setPinned(Boolean(v))}
      />
    </Form>
  );
}

/**
 * 官方内置核心能力: 剪贴板历史管理器
 * 布局一标杆：左 48% 历史列表 + 右 52% 真实内容本体预览，零彩色 Emoji 污染
 */
export default function ClipboardHistoryCommand() {
  useLocale();
  const { push } = useNavigation();
  const inClient = isRealElectronHost();
  // 不在客户端里运行时列表保持为空并提示，不显示任何示例记录
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [loadError, setLoadError] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("all");
  const [searchText, setSearchText] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [isShowingDetail, setIsShowingDetail] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(inClient);
  // 宿主历史库读取失败时列表只剩插件自己存的记录，要在状态栏如实说明
  const [hostWarning, setHostWarning] = useState<string>("");

  useEffect(() => {
    if (!inClient) return;
    (async () => {
      setIsLoading(true);
      try {
        setItems(await getClipboardHistory());
        setLoadError("");
        setHostWarning(getLastHostHistoryError());
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const filteredItems = filterClipboardItems(items, {
    type: filterType as ClipboardContentType | "all" | "pinned",
    query: searchText
  });

  const pinnedCount = items.filter((item) => item.pinned).length;

  // 每次改动后都从存储重新读取，界面与宿主历史库保持一致
  const reloadItems = async () => {
    const data = await getClipboardHistory();
    setItems(data);
    setHostWarning(getLastHostHistoryError());
    return data;
  };

  const handleTogglePin = async (id: string): Promise<boolean | null> => {
    const ok = await toggleClipboardItemPin(id);
    const data = await reloadItems();
    if (!ok) {
      await showToast(Toast.Style.Failure, t("toastPinSaveFailed"), t("toastRecordMissing"));
      return null;
    }
    const current = data.find((item) => item.id === id);
    return current ? current.pinned : null;
  };

  const handleDelete = async (id: string): Promise<boolean> => {
    const ok = await deleteClipboardItem(id);
    await reloadItems();
    if (!ok) await showToast(Toast.Style.Failure, t("toastDeleteFailed"), t("toastRecordMissing"));
    return ok;
  };

  const handleClearUnpinned = async () => {
    const unpinned = items.filter((item) => !item.pinned).length;
    const confirmed = await confirmAlert({
      title: t("confirmClearTitle"),
      message: t("confirmClearMsg", { count: unpinned }),
      primaryAction: { title: t("actionClear"), style: "destructive" },
      dismissAction: { title: t("actionCancel") }
    });
    if (!confirmed) return;
    try {
      await clearUnpinnedClipboardHistory();
      const data = await reloadItems();
      await showToast(Toast.Style.Success, t("toastClearedTitle"), t("toastClearedMsg", { count: data.filter((i) => i.pinned).length }));
    } catch (error) {
      await reloadItems();
      await showToast(Toast.Style.Failure, t("toastClearFailed"), error instanceof Error ? error.message : String(error));
    }
  };

  const handleSyncSystemClipboard = async () => {
    try {
      const res = await syncCurrentSystemClipboard(items);
      setItems(res.items);
      setHostWarning(getLastHostHistoryError());
      await showToast(
        Toast.Style.Success,
        res.added ? t("toastSyncedNew") : t("toastSyncedUpToDate"),
        res.item ? getDisplayTitle(res.item) : t("toastClipboardEmpty")
      );
    } catch (error) {
      await showToast(
        Toast.Style.Failure,
        t("toastSyncFailed"),
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const saveFromForm = (original?: ClipboardItem) => async (input: { content: string; pinned: boolean }) => {
    const res = await saveEditedClipboardItem(input, original);
    if (res.items.length > 0 || res.persisted) setItems(res.items);
    return { persisted: res.persisted, message: res.message };
  };

  const handlePasteSequential = async () => {
    const res = await pasteSequentialClipboard(filteredItems, {
      addNewLine: true,
      timeoutSeconds: 60
    });
    if (res.success && res.item) {
      await showToast(
        Toast.Style.Success,
        t("toastSeqPasteTitle", { offset: res.offset }),
        t("toastSeqPasteRemaining", { count: res.remaining })
      );
    } else if (res.pasteFailed) {
      await showToast(Toast.Style.Failure, t("toastSeqPasteCantPaste"), resolveErrorMessage(res.message, t("toastSeqPasteManual")));
    } else {
      await showToast(Toast.Style.Failure, t("toastSeqPasteEnded"), resolveErrorMessage(res.message, t("toastSeqPasteNoItems")));
    }
  };

  const handleResetSequence = async () => {
    try {
      await resetPasteSequence();
      await showToast(Toast.Style.Success, t("toastSeqResetTitle"), t("toastSeqResetMsg"));
    } catch (error) {
      await showToast(Toast.Style.Failure, t("toastSeqResetFailed"), error instanceof Error ? error.message : String(error));
    }
  };

  const getItemIcon = (item: ClipboardItem) => {
    switch (item.type) {
      case "color": return Icon.Eye;
      case "json": return Icon.Code;
      case "code": return Icon.Terminal;
      case "image": return Icon.Image;
      case "link": return Icon.Globe;
      case "files": return Icon.Folder;
      default: return Icon.Document;
    }
  };

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={isShowingDetail}
      searchBarPlaceholder={t("searchPlaceholder")}
      onSearchTextChange={setSearchText}
      onSelectionChange={(id) => setSelectedId(id || "")}
      filterBar={{
        summaryText: !inClient
          ? t("notInClient")
          : loadError
            ? t("summaryLoadFailed", { error: loadError })
            : hostWarning
              ? t("summaryHostWarning", { error: hostWarning, count: items.length })
              : t("summaryNormal", { total: items.length, pinned: pinnedCount }),
        actions: [
          {
            id: "clear",
            label: t("btnClearUnpinned"),
            title: t("btnClearUnpinned"),
            style: "secondary",
            onAction: () => {
              void handleClearUnpinned();
            }
          },
          {
            id: "sync",
            label: t("btnSyncClipboard"),
            title: t("btnSyncClipboard"),
            style: "secondary",
            onAction: () => {
              void handleSyncSystemClipboard();
            }
          }
        ]
      }}
      actions={
        <ActionPanel title={t("panelGlobalActions")}>
          <Action
            title={t("actionSyncClipboard")}
            icon={Icon.Repeat}
            onAction={handleSyncSystemClipboard}
          />
          <Action.Push
            title={t("actionNewRecord")}
            icon={Icon.Plus}
            shortcut={{ modifiers: ["ctrl"], key: "n" }}
            target={<ClipboardItemForm onSaved={saveFromForm()} />}
          />
        </ActionPanel>
      }
      searchBarAccessory={
        <List.Dropdown
          tooltip={t("dropdownTooltip")}
          value={filterType}
          onChange={setFilterType}
        >
          <List.Dropdown.Item title={t("filterAll")} value="all" icon={Icon.List} />
          <List.Dropdown.Item title={t("filterPinned")} value="pinned" icon={Icon.Pin} />
          <List.Dropdown.Item title={t("filterColor")} value="color" icon={Icon.Eye} />
          <List.Dropdown.Item title={t("filterJson")} value="json" icon={Icon.Code} />
          <List.Dropdown.Item title={t("filterCode")} value="code" icon={Icon.Terminal} />
          <List.Dropdown.Item title={t("filterLink")} value="link" icon={Icon.Globe} />
          <List.Dropdown.Item title={t("filterFiles")} value="files" icon={Icon.Folder} />
          <List.Dropdown.Item title={t("filterImage")} value="image" icon={Icon.Image} />
          <List.Dropdown.Item title={t("filterText")} value="text" icon={Icon.Document} />
        </List.Dropdown>
      }
    >
      {(!inClient || loadError) && items.length === 0 ? (
        <List.Item
          id="load-error"
          title={!inClient ? t("notInClient") : t("loadErrorTitle")}
          subtitle={!inClient ? t("loadErrorClientSub") : loadError}
          icon={Icon.ExclamationMark}
        />
      ) : null}
      <List.Section title={t("sectionHistoryTitle", { count: filteredItems.length })}>
        {filteredItems.map(item => {
          const colorDetails = item.type === "color" ? parseColorDetails(item.content) : null;
          const sensitivity = maskSensitiveContent(item.content);
          const isItemSensitive = Boolean(item.isSensitive || sensitivity.isSensitive);
          const unavailable = isUnavailableFileItem(item);
          const revealPath = localFilePaths(item)?.[0];

          return (
            <List.Item
              key={item.id}
              id={item.id}
              title={getDisplayTitle(item)}
              subtitle={formatCopiedTime(item.copiedAt)}
              icon={getItemIcon(item)}
              accessories={[
                ...(item.pinned ? [{ tag: { value: t("tagPinned") }, tooltip: t("metaPinned") }] : []),
                ...(isItemSensitive ? [{ tag: { value: t("tagSensitive"), color: Color.Red } }] : []),
                ...(unavailable ? [{ tag: { value: t("tagUnavailable") }, tooltip: t("tagUnavailableTooltip") }] : []),
                { text: typeLabel(item.type) }
              ]}
              detail={
                <List.Item.Detail
                  markdown={getClipboardMarkdown(item)}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title={t("metaType")} text={typeLabel(item.type)} icon={Icon.Document} />
                      <List.Item.Detail.Metadata.Label title={t("metaCopiedAt")} text={formatCopiedTime(item.copiedAt)} icon={Icon.Clock} />
                      <List.Item.Detail.Metadata.Label title={t("metaPinShort")} text={item.pinned ? t("metaPinned") : t("metaPinNormal")} icon={Icon.Pin} />
                      {item.sourceAppName ? (
                        <List.Item.Detail.Metadata.Label title={t("metaSourceApp")} text={item.sourceAppName} icon={Icon.AppWindow} />
                      ) : null}
                      {colorDetails ? (
                        <>
                          <List.Item.Detail.Metadata.Label title="HEX" text={colorDetails.hex} icon={Icon.Eye} />
                          <List.Item.Detail.Metadata.Label title="RGB" text={colorDetails.rgb} icon={Icon.Eye} />
                        </>
                      ) : null}
                      {item.charCount !== undefined && (
                        <List.Item.Detail.Metadata.Label title={t("metaCharCountShort")} text={`${item.charCount}`} icon={Icon.Pencil} />
                      )}
                      {item.lineCount !== undefined && (
                        <List.Item.Detail.Metadata.Label title={t("metaLineCountShort")} text={`${item.lineCount}`} icon={Icon.List} />
                      )}
                      {isItemSensitive ? (
                        <List.Item.Detail.Metadata.Label title={t("metaSecurityStatus")} text={t("metaSecurityMasked")} icon={Icon.Lock} />
                      ) : null}
                      {unavailable ? (
                        <List.Item.Detail.Metadata.Label title={t("metaFileStatus")} text={t("metaFileForeign")} icon={Icon.ExclamationMark} />
                      ) : null}
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel title={t("panelClipboardActions")}>
                  <ItemPrimaryActions item={item} />

                  <Action.Push
                    title={t("actionFullDetail")}
                    target={
                      <ClipboardDetailView
                        item={item}
                        onDeleted={handleDelete}
                        onPinToggled={handleTogglePin}
                      />
                    }
                    icon={Icon.Eye}
                    shortcut={{ modifiers: ["ctrl"], key: "d" }}
                  />

                  <Action
                    title={t("actionSeqPasteNext")}
                    icon={Icon.ArrowRight}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "v" }}
                    onAction={handlePasteSequential}
                  />

                  <Action
                    title={t("actionResetSeq")}
                    icon={Icon.RotateClockwise}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "z" }}
                    onAction={handleResetSequence}
                  />

                  <Action
                    title={isShowingDetail ? t("actionHideDetail") : t("actionShowDetail")}
                    icon={Icon.SidebarRight}
                    shortcut={{ modifiers: ["ctrl"], key: "b" }}
                    onAction={() => setIsShowingDetail(!isShowingDetail)}
                  />

                  {revealPath ? (
                    <Action
                      title={t("actionRevealFile", { manager: fileManagerName(revealPath) })}
                      icon={Icon.Folder}
                      shortcut={{ modifiers: ["ctrl", "shift"], key: "o" }}
                      onAction={() => revealClipboardFile(revealPath)}
                    />
                  ) : null}

                  {item.type === "link" ? (
                    <Action.OpenInBrowser
                      title={t("actionOpenUrlInBrowser")}
                      url={item.content}
                      icon={Icon.Globe}
                      shortcut={{ modifiers: ["ctrl"], key: "o" }}
                    />
                  ) : null}

                  <ClipboardColorActions color={colorDetails} />

                  <Action.Push
                    title={t("actionEditRecord")}
                    icon={Icon.Pencil}
                    shortcut={{ modifiers: ["ctrl"], key: "e" }}
                    target={<ClipboardItemForm initialItem={item} onSaved={saveFromForm(item)} />}
                  />
                  <Action.Push
                    title={t("actionNewRecord")}
                    icon={Icon.Plus}
                    shortcut={{ modifiers: ["ctrl"], key: "n" }}
                    target={<ClipboardItemForm onSaved={saveFromForm()} />}
                  />
                  <Action
                    title={t("actionSyncClipboard")}
                    icon={Icon.Repeat}
                    shortcut={{ modifiers: ["ctrl"], key: "r" }}
                    onAction={handleSyncSystemClipboard}
                  />

                  <Action
                    title={item.pinned ? t("actionUnpin") : t("actionPin")}
                    icon={Icon.Pin}
                    shortcut={{ modifiers: ["ctrl"], key: "p" }}
                    onAction={async () => {
                      await handleTogglePin(item.id);
                    }}
                  />

                  <Action
                    title={t("actionDeleteRecord")}
                    icon={Icon.Trash}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                    onAction={async () => {
                      if (!(await confirmDeleteItem(item))) return;
                      await handleDelete(item.id);
                    }}
                  />

                  <Action
                    title={t("actionClearUnpinnedAll")}
                    icon={Icon.Trash}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "x" }}
                    onAction={handleClearUnpinned}
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}
