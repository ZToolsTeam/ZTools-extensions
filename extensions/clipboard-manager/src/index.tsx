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
  useNavigation
} from "@ztools/declarative-ui";
import { useState, useEffect } from "@ztools/declarative-ui";
import {
  isRealElectronHost,
  showRealItemInFolder
} from "./native-ipc.js";
import {
  ClipboardItem,
  ClipboardContentType
} from "./types.js";
import {
  NOT_IN_CLIENT_MESSAGE,
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
  resetPasteSequence
} from "./clipboard-storage.js";

export * from "./types.js";
export * from "./clipboard-storage.js";

function ClipboardColorActions({ color }: { color: ReturnType<typeof parseColorDetails> }) {
  return (<> {color ? (
            <>
              <Action.CopyToClipboard
                title="复制 RGB 颜色值"
                content={color.rgb}
                icon={Icon.Eye}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "r" }}
              />
              <Action.CopyToClipboard
                title="复制 HSL 颜色值"
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
  let markdown = `# 剪贴板内容详情\n\n`;

  const sensitivity = maskSensitiveContent(item.content);
  if (sensitivity.isSensitive) {
    // 敏感内容：所有类型都只展示遮罩后的文本，不渲染可点击链接或完整 JSON
    markdown += `> **安全防护提示**: 检测到敏感凭据 (${sensitivity.reason || "机密凭据"})，下方预览已遮罩；复制、粘贴仍使用原文。\n\n`;
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
    markdown += `### 调色盘与色彩代码\n\n`;
    if (details) {
      markdown += `\`\`\`css\n/* HEX 格式 */\ncolor: ${details.hex};\n\n/* RGB 格式 */\nbackground-color: ${details.rgb};\n\n/* HSL 格式 */\nborder-color: ${details.hsl};\n\`\`\`\n\n`;
      markdown += `> **HEX**: \`${details.hex}\` | **RGB**: \`${details.rgb}\` | **HSL**: \`${details.hsl}\``;
    } else {
      markdown += fencedBlock(item.content);
    }
  } else if (item.type === "json") {
    try {
      const parsed = JSON.parse(item.content);
      const formatted = JSON.stringify(parsed, null, 2);
      const keysCount = typeof parsed === "object" && parsed !== null ? Object.keys(parsed).length : 0;
      markdown += `### JSON 结构化数据预览 (${keysCount} 个顶层属性)\n\n${fencedBlock(formatted, "json")}`;
    } catch {
      markdown += fencedBlock(item.content, "json");
    }
  } else if (item.type === "code") {
    markdown += fencedBlock(item.content, "typescript");
  } else if (item.type === "link") {
    markdown += `### 网络链接\n\n[${item.content}](${item.content})\n\n> 协议: \`${item.content.startsWith("https") ? "HTTPS (安全加密)" : "HTTP"}\``;
  } else if (item.type === "image") {
    markdown += `![图片预览](${item.content})\n\n> 分辨率: ${item.imageDimensions?.width ?? 0} x ${item.imageDimensions?.height ?? 0}`;
  } else if (item.type === "files") {
    markdown += "### 包含的文件列表\n\n" + fencedBlock(item.filePaths?.length ? item.filePaths.join("\n") : item.content);
  } else {
    // 纯文本按原样展示：保留换行与所有字符，不当作 Markdown 解析
    markdown += fencedBlock(item.content);
  }
  return markdown;
}

/** 删除前请用户确认；取消或无法弹出确认框时不删除 */
async function confirmDeleteItem(item: ClipboardItem): Promise<boolean> {
  return confirmAlert({
    title: "删除这条剪贴板记录？",
    message: getDisplayTitle(item).slice(0, 120),
    primaryAction: { title: "删除", style: "destructive" },
    dismissAction: { title: "取消" }
  });
}

/** 在文件管理器中定位文件：以宿主返回结果为准，失败时如实提示 */
async function revealClipboardFile(filePath: string): Promise<void> {
  const ok = await showRealItemInFolder(filePath);
  if (ok) await showToast(Toast.Style.Success, "已在文件管理器中定位", filePath);
  else await showToast(Toast.Style.Failure, "定位失败", `${filePath}\n文件可能已被移动或删除`);
}

async function handleRestoreClipboardItem(item: ClipboardItem, paste: boolean): Promise<void> {
  try {
    await restoreClipboardItem(item, paste);
    await showToast(Toast.Style.Success, paste ? "已发送粘贴请求" : "已复制");
  } catch (error) {
    await showToast(Toast.Style.Failure, paste ? "粘贴失败" : "复制失败", error instanceof Error ? error.message : String(error));
  }
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
  const { pop } = useNavigation();
  const [pinned, setPinned] = useState<boolean>(Boolean(item.pinned));
  const markdown = getClipboardMarkdown(item);
  const colorDetails = item.type === "color" ? parseColorDetails(item.content) : null;
  const sensitivity = maskSensitiveContent(item.content);

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`详情: ${item.type.toUpperCase()}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="内容类型" text={item.type.toUpperCase()} icon={Icon.Document} />
          <Detail.Metadata.Label title="复制时间" text={formatCopiedTime(item.copiedAt)} icon={Icon.Clock} />
          <Detail.Metadata.Label title="置顶状态" text={pinned ? "已置顶" : "未置顶"} icon={Icon.Pin} />
          {item.sourceAppName ? (
            <Detail.Metadata.Label title="来源应用" text={item.sourceAppName} icon={Icon.AppWindow} />
          ) : null}
          {colorDetails ? (
            <>
              <Detail.Metadata.Label title="HEX" text={colorDetails.hex} icon={Icon.Eye} />
              <Detail.Metadata.Label title="RGB" text={colorDetails.rgb} icon={Icon.Eye} />
              <Detail.Metadata.Label title="HSL" text={colorDetails.hsl} icon={Icon.Eye} />
            </>
          ) : null}
          {item.charCount !== undefined && (
            <Detail.Metadata.Label title="字符总数" text={`${item.charCount} 字符`} icon={Icon.Pencil} />
          )}
          {item.lineCount !== undefined && (
            <Detail.Metadata.Label title="文本行数" text={`${item.lineCount} 行`} icon={Icon.List} />
          )}
          {(sensitivity.isSensitive || item.isSensitive) ? (
            <Detail.Metadata.Label title="敏感脱敏" text={sensitivity.reason || "已脱敏"} icon={Icon.Lock} />
          ) : null}
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title="分类标签">
            <Detail.Metadata.TagList.Item
              text={pinned ? "PINNED" : "STANDARD"}
              color={Color.SecondaryText}
            />
            {(sensitivity.isSensitive || item.isSensitive) ? (
              <Detail.Metadata.TagList.Item text="SENSITIVE" color={Color.Red} />
            ) : null}
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title="条目操作">
          <Action
            title="回车粘贴到前台应用 (Paste to Active)"
            onAction={() => handleRestoreClipboardItem(item, true)}
            icon={Icon.Checkmark}
          />
          <Action
            title="仅复制到剪贴板"
            onAction={() => handleRestoreClipboardItem(item, false)}
            icon={Icon.CopyClipboard}
            shortcut={{ modifiers: ["ctrl"], key: "c" }}
          />
          {item.type === "link" ? (
            <Action.OpenInBrowser
              title="在浏览器中打开链接"
              url={item.content}
              icon={Icon.Globe}
              shortcut={{ modifiers: ["ctrl"], key: "o" }}
            />
          ) : null}
          {item.type === "files" && item.filePaths && item.filePaths.length > 0 ? (
            <Action
              title="在文件管理器中定位文件"
              icon={Icon.Folder}
              shortcut={{ modifiers: ["ctrl"], key: "o" }}
              onAction={() => revealClipboardFile(item.filePaths![0])}
            />
          ) : null}
          <ClipboardColorActions color={colorDetails} />
          <Action
            title={pinned ? "取消置顶" : "置顶条目"}
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
                await showToast(Toast.Style.Failure, pinned ? "取消置顶失败" : "置顶失败", "历史记录可能已被删除，请返回列表刷新");
                return;
              }
              setPinned(next);
              await showToast(Toast.Style.Success, next ? "已置顶" : "已取消置顶");
            }}
          />
          <Action
            title="删除该记录"
            icon={Icon.Trash}
            shortcut={{ modifiers: ["ctrl"], key: "x" }}
            onAction={async () => {
              if (!(await confirmDeleteItem(item))) return;
              const res = onDeleted ? await onDeleted(item.id) : await deleteClipboardItem(item.id);
              if (res === false) {
                await showToast(Toast.Style.Failure, "删除失败", "历史记录可能已被删除，请返回列表刷新");
                return;
              }
              await showToast(Toast.Style.Success, "条目已删除");
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
  const { pop } = useNavigation();
  const [content, setContent] = useState<string>(initialItem?.content || "");
  const [pinned, setPinned] = useState<boolean>(Boolean(initialItem?.pinned));

  return (
    <Form
      navigationTitle={initialItem ? "编辑剪贴板内容" : "新建剪贴板内容"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={initialItem ? "保存并写入剪贴板" : "创建并写入剪贴板"}
            icon={Icon.Checkmark}
            onSubmit={async (values: Record<string, unknown>) => {
              const text = typeof values?.content === "string" ? values.content : content;
              const pin = typeof values?.pinned === "boolean" ? values.pinned : pinned;
              if (!text.trim()) {
                await showToast(Toast.Style.Failure, "内容不能为空");
                return;
              }
              try {
                await Clipboard.copy(text);
              } catch (err: unknown) {
                await showToast(Toast.Style.Failure, "写入系统剪贴板失败", err instanceof Error ? err.message : "请重试");
                return;
              }
              const result = await onSaved?.({ content: text, pinned: pin });
              if (result && result.persisted === false) {
                await showToast(Toast.Style.Failure, "已写入系统剪贴板，但未能保存到历史", result.message || "请重试");
                return;
              }
              await showToast(Toast.Style.Success, "已保存并同步至系统剪贴板");
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="content"
        title="剪贴板文本内容"
        placeholder="输入或编辑要写入剪贴板的文本、代码、JSON 或链接..."
        value={content}
        onChange={(v: string) => setContent(String(v ?? ""))}
      />
      <Form.Checkbox
        id="pinned"
        label="置顶保护该条目 (Pin Item)"
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
  const { push } = useNavigation();
  const inClient = isRealElectronHost();
  // 不在客户端里运行时列表保持为空并提示，不显示任何示例记录
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [loadError, setLoadError] = useState<string>(inClient ? "" : NOT_IN_CLIENT_MESSAGE);
  const [filterType, setFilterType] = useState<string>("all");
  const [searchText, setSearchText] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [isShowingDetail, setIsShowingDetail] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(inClient);

  useEffect(() => {
    if (!inClient) return;
    (async () => {
      setIsLoading(true);
      try {
        setItems(await getClipboardHistory());
        setLoadError("");
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
    return data;
  };

  const handleTogglePin = async (id: string): Promise<boolean | null> => {
    const ok = await toggleClipboardItemPin(id);
    const data = await reloadItems();
    if (!ok) {
      await showToast(Toast.Style.Failure, "置顶状态未能保存", "历史记录可能已被删除");
      return null;
    }
    const current = data.find((item) => item.id === id);
    return current ? current.pinned : null;
  };

  const handleDelete = async (id: string): Promise<boolean> => {
    const ok = await deleteClipboardItem(id);
    await reloadItems();
    if (!ok) await showToast(Toast.Style.Failure, "删除失败", "历史记录可能已被删除");
    return ok;
  };

  const handleClearUnpinned = async () => {
    const unpinned = items.filter((item) => !item.pinned).length;
    const confirmed = await confirmAlert({
      title: "清空所有未置顶的剪贴板记录？",
      message: `将删除全部未置顶记录（当前列表中有 ${unpinned} 条），置顶的记录会保留。删除后无法恢复。`,
      primaryAction: { title: "清空", style: "destructive" },
      dismissAction: { title: "取消" }
    });
    if (!confirmed) return;
    try {
      await clearUnpinnedClipboardHistory();
      const data = await reloadItems();
      await showToast(Toast.Style.Success, "已清空未置顶历史", `保留了 ${data.filter((i) => i.pinned).length} 条置顶条目`);
    } catch (error) {
      await reloadItems();
      await showToast(Toast.Style.Failure, "清空历史失败", error instanceof Error ? error.message : String(error));
    }
  };

  const handleSyncSystemClipboard = async () => {
    try {
      const res = await syncCurrentSystemClipboard(items);
      setItems(res.items);
      await showToast(
        Toast.Style.Success,
        res.added ? "已同步当前系统剪贴板" : "系统剪贴板已是最新记录",
        res.item ? getDisplayTitle(res.item) : "当前系统剪贴板为空"
      );
    } catch (error) {
      await showToast(
        Toast.Style.Failure,
        "同步系统剪贴板失败",
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
        `流水粘贴 [第 ${res.offset} 项]`,
        `剩余 ${res.remaining} 条记录`
      );
    } else if (res.pasteFailed) {
      await showToast(Toast.Style.Failure, "已复制，但无法粘贴", res.message || "请手动粘贴");
    } else {
      await showToast(Toast.Style.Failure, "连续流水粘贴已结束", res.message || "无可用条目");
    }
  };

  const handleResetSequence = async () => {
    await resetPasteSequence();
    await showToast(Toast.Style.Success, "流水粘贴指针已重置", "下一次粘贴将重新从首条开始");
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
      searchBarPlaceholder="搜索剪贴板历史 (支持拼音缩写、内容、代码、色彩、文件名)..."
      onSearchTextChange={setSearchText}
      onSelectionChange={(id) => setSelectedId(id || "")}
      filterBar={{
        summaryText: loadError ? (loadError === NOT_IN_CLIENT_MESSAGE ? NOT_IN_CLIENT_MESSAGE : `读取剪贴板历史失败：${loadError}`) : `历史共 ${items.length} 条 · 置顶 ${pinnedCount} 条`,
        actions: [
          {
            id: "clear",
            label: "清空非置顶",
            title: "清空非置顶",
            style: "secondary",
            onAction: () => {
              void handleClearUnpinned();
            }
          },
          {
            id: "sync",
            label: "同步剪贴板",
            title: "同步剪贴板",
            style: "secondary",
            onAction: () => {
              void handleSyncSystemClipboard();
            }
          }
        ]
      }}
      actions={
        <ActionPanel title="剪贴板全局操作">
          <Action
            title="读取并同步当前系统剪贴板"
            icon={Icon.Repeat}
            onAction={handleSyncSystemClipboard}
          />
          <Action.Push
            title="新建剪贴板记录..."
            icon={Icon.Plus}
            shortcut={{ modifiers: ["ctrl"], key: "n" }}
            target={<ClipboardItemForm onSaved={saveFromForm()} />}
          />
        </ActionPanel>
      }
      searchBarAccessory={
        <List.Dropdown
          tooltip="按类型筛选"
          value={filterType}
          onChange={setFilterType}
        >
          <List.Dropdown.Item title="全部格式 (All)" value="all" icon={Icon.List} />
          <List.Dropdown.Item title="已置顶 (Pinned)" value="pinned" icon={Icon.Pin} />
          <List.Dropdown.Item title="色彩代码 (Color)" value="color" icon={Icon.Eye} />
          <List.Dropdown.Item title="JSON 数据 (JSON)" value="json" icon={Icon.Code} />
          <List.Dropdown.Item title="代码片段 (Code)" value="code" icon={Icon.Terminal} />
          <List.Dropdown.Item title="链接网址 (Links)" value="link" icon={Icon.Globe} />
          <List.Dropdown.Item title="文件列表 (Files)" value="files" icon={Icon.Folder} />
          <List.Dropdown.Item title="图片 (Images)" value="image" icon={Icon.Image} />
          <List.Dropdown.Item title="纯文本 (Text)" value="text" icon={Icon.Document} />
        </List.Dropdown>
      }
    >
      {loadError && items.length === 0 ? (
        <List.Item
          id="load-error"
          title={loadError === NOT_IN_CLIENT_MESSAGE ? NOT_IN_CLIENT_MESSAGE : "无法读取剪贴板历史"}
          subtitle={loadError === NOT_IN_CLIENT_MESSAGE ? "在 ZTools 中打开「剪贴板历史」后查看" : loadError}
          icon={Icon.ExclamationMark}
        />
      ) : null}
      <List.Section title={`历史记录 (${filteredItems.length} 条)`}>
        {filteredItems.map(item => {
          const colorDetails = item.type === "color" ? parseColorDetails(item.content) : null;
          const sensitivity = maskSensitiveContent(item.content);
          const isItemSensitive = Boolean(item.isSensitive || sensitivity.isSensitive);

          return (
            <List.Item
              key={item.id}
              id={item.id}
              title={getDisplayTitle(item)}
              subtitle={formatCopiedTime(item.copiedAt)}
              icon={getItemIcon(item)}
              accessories={[
                ...(item.pinned ? [{ tag: { value: "置顶" }, tooltip: "已置顶" }] : []),
                ...(isItemSensitive ? [{ tag: { value: "敏感", color: Color.Red } }] : []),
                { text: item.type.toUpperCase() }
              ]}
              detail={
                <List.Item.Detail
                  markdown={getClipboardMarkdown(item)}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="类型" text={item.type.toUpperCase()} icon={Icon.Document} />
                      <List.Item.Detail.Metadata.Label title="复制时间" text={formatCopiedTime(item.copiedAt)} icon={Icon.Clock} />
                      <List.Item.Detail.Metadata.Label title="置顶" text={item.pinned ? "已置顶" : "普通"} icon={Icon.Pin} />
                      {item.sourceAppName ? (
                        <List.Item.Detail.Metadata.Label title="来源应用" text={item.sourceAppName} icon={Icon.AppWindow} />
                      ) : null}
                      {colorDetails ? (
                        <>
                          <List.Item.Detail.Metadata.Label title="HEX" text={colorDetails.hex} icon={Icon.Eye} />
                          <List.Item.Detail.Metadata.Label title="RGB" text={colorDetails.rgb} icon={Icon.Eye} />
                        </>
                      ) : null}
                      {item.charCount !== undefined && (
                        <List.Item.Detail.Metadata.Label title="字符数" text={`${item.charCount}`} icon={Icon.Pencil} />
                      )}
                      {item.lineCount !== undefined && (
                        <List.Item.Detail.Metadata.Label title="行数" text={`${item.lineCount}`} icon={Icon.List} />
                      )}
                      {isItemSensitive ? (
                        <List.Item.Detail.Metadata.Label title="安全状态" text="已脱敏遮罩" icon={Icon.Lock} />
                      ) : null}
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.TagList title="状态">
                        <List.Item.Detail.Metadata.TagList.Item
                          text={item.pinned ? "PINNED" : "STANDARD"}
                          color={Color.SecondaryText}
                        />
                        {isItemSensitive ? (
                          <List.Item.Detail.Metadata.TagList.Item text="PROTECTED" color={Color.Red} />
                        ) : null}
                      </List.Item.Detail.Metadata.TagList>
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel title="剪贴板动作">
                  <Action
                    title="回车粘贴到前台应用 (Paste to Active)"
                    onAction={() => handleRestoreClipboardItem(item, true)}
                    icon={Icon.Checkmark}
                  />

                  <Action
                    title="仅复制到剪贴板"
                    onAction={() => handleRestoreClipboardItem(item, false)}
                    icon={Icon.CopyClipboard}
                    shortcut={{ modifiers: ["ctrl"], key: "c" }}
                  />

                  <Action.Push
                    title="全屏查看详情"
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
                    title="连续流水粘贴下一个 (Paste Sequentially)"
                    icon={Icon.ArrowRight}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "v" }}
                    onAction={handlePasteSequential}
                  />

                  <Action
                    title="重置流水粘贴指针"
                    icon={Icon.RotateClockwise}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "z" }}
                    onAction={handleResetSequence}
                  />

                  <Action
                    title={isShowingDetail ? "关闭右侧详情分栏" : "展开右侧详情分栏"}
                    icon={Icon.SidebarRight}
                    shortcut={{ modifiers: ["ctrl"], key: "b" }}
                    onAction={() => setIsShowingDetail(!isShowingDetail)}
                  />

                  {item.type === "files" && item.filePaths && item.filePaths.length > 0 ? (
                    <Action
                      title="在文件管理器中定位文件"
                      icon={Icon.Folder}
                      shortcut={{ modifiers: ["ctrl"], key: "o" }}
                      onAction={() => revealClipboardFile(item.filePaths![0])}
                    />
                  ) : null}

                  {item.type === "link" ? (
                    <Action.OpenInBrowser
                      title="在浏览器中打开网址"
                      url={item.content}
                      icon={Icon.Globe}
                      shortcut={{ modifiers: ["ctrl"], key: "o" }}
                    />
                  ) : null}

                  <ClipboardColorActions color={colorDetails} />

                  <Action.Push
                    title="编辑该剪贴板内容..."
                    icon={Icon.Pencil}
                    shortcut={{ modifiers: ["ctrl"], key: "e" }}
                    target={<ClipboardItemForm initialItem={item} onSaved={saveFromForm(item)} />}
                  />
                  <Action.Push
                    title="新建剪贴板记录..."
                    icon={Icon.Plus}
                    shortcut={{ modifiers: ["ctrl"], key: "n" }}
                    target={<ClipboardItemForm onSaved={saveFromForm()} />}
                  />
                  <Action
                    title="读取并同步当前系统剪贴板"
                    icon={Icon.Repeat}
                    shortcut={{ modifiers: ["ctrl"], key: "r" }}
                    onAction={handleSyncSystemClipboard}
                  />

                  <Action
                    title={item.pinned ? "取消置顶" : "置顶条目"}
                    icon={Icon.Pin}
                    shortcut={{ modifiers: ["ctrl"], key: "p" }}
                    onAction={async () => {
                      await handleTogglePin(item.id);
                    }}
                  />

                  <Action
                    title="删除该记录"
                    icon={Icon.Trash}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                    onAction={async () => {
                      if (!(await confirmDeleteItem(item))) return;
                      await handleDelete(item.id);
                    }}
                  />

                  <Action
                    title="清空所有未置顶记录"
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
