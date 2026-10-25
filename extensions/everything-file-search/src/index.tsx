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
import { useState, useEffect, useRef } from "@ztools/declarative-ui";
import { FileRecord, SortOption, TypeFilter, FileQuickLookResult, FileActionResult } from "./types.js";
import {
  formatBytes,
  truncatePath,
  getFileCategory,
  SAMPLE_FILES,
  sortAndFilterFiles,
  searchLocalFiles,
  getFileQuickLook,
  calculateFileSha256,
  openFile,
  revealFile,
  moveToTrash,
  copyFileToClipboard,
  quickLookFile
} from "./search-service.js";
import { isRealElectronHost } from "./native-ipc.js";

/** 输入停顿多久后才发起检索；同时用递增序号只采用最新一次检索的结果 */
export const SEARCH_DEBOUNCE_MS = 150;

async function toastResult(res: FileActionResult) {
  await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
}

export * from "./types.js";
export * from "./search-service.js";

/**
 * 空格即时预览视图 (Space Quick Look Detail View)
 * 100% 对齐 Raycast quickLookSelection 原生手感
 */
export function FileQuickLookDetailView({
  file,
  initialQuickLook
}: {
  file: FileRecord;
  initialQuickLook?: FileQuickLookResult;
}) {
  const [quickLook, setQuickLook] = useState<FileQuickLookResult | null>(initialQuickLook || null);
  const [sha256, setSha256] = useState<string>("");

  React.useEffect(() => {
    if (!initialQuickLook) {
      void getFileQuickLook(file).then(setQuickLook);
    }
    void calculateFileSha256(file.path).then(setSha256).catch(() => setSha256(""));
  }, [file.path]);

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const ql = quickLook;

  // 路径与大小等信息已在右侧元数据中，正文只放文件的真实内容
  let markdown = `# ${file.name}\n\n`;

  if (!ql) {
    markdown += `⏳ 正在抽取文件头部数据与语法分析...`;
  } else if (ql.previewType === "error") {
    markdown += `> **读取异常**: ${ql.error || "无法访问该文件"}\n\n可能原因：文件已被删除、权限不足或宿主未授权读取该路径。可在动作面板中使用「Quick Look 快速预览」由系统预览。`;
  } else if (ql.previewType === "empty") {
    markdown += `> **空文件**: 该文件长度为 0 字节。`;
  } else if (ql.previewType === "directory") {
    markdown += `### 文件夹内容 (${ql.totalLines ?? 0}${ql.partial ? "+" : ""} 项)\n\n`;
    if (ql.dirEntries && ql.dirEntries.length > 0) {
      markdown += ql.dirEntries
        .map((e) => `- \`${e.name}${e.isDir ? "/" : ""}\`${e.isDir ? " · 文件夹" : ""}`)
        .join("\n");
      if (ql.truncated) {
        markdown += `\n\n*(仅显示前 25 项，已安全截断)*`;
      }
      if (ql.partial) {
        markdown += `\n\n*(文件夹条目较多，仅显示部分直接子项)*`;
      }
    } else {
      markdown += `*(空目录或暂无子项)*`;
    }
  } else if (ql.previewType === "image") {
    markdown += `![图片预览](${ql.content})`;
  } else if (ql.previewType === "markdown") {
    markdown += `${ql.content}\n\n`;
    if (ql.truncated) {
      markdown += `\n\n*(内容超限，已截取前 200 行 / 64KB 防内存爆破)*`;
    }
  } else if (ql.previewType === "code") {
    markdown += `\`\`\`${ql.codeLanguage || ext}\n${ql.content}\n\`\`\`\n\n`;
    if (ql.truncated) {
      markdown += `*(代码超限，已截取前 200 行 / 64KB 防内存爆破)*`;
    }
  } else {
    markdown += `> ${ql.content || "该格式为二进制文件，请使用关联应用直接打开。"}`;
  }

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`Quick Look: ${file.name}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="文件名" text={file.name} icon={Icon.Document} />
          <Detail.Metadata.Label title="所在位置" text={file.path} icon={Icon.Folder} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="大小"
            text={file.isDir ? "文件夹" : formatBytes(file.size)}
            icon={Icon.HardDrive}
          />
          <Detail.Metadata.Label
            title="修改时间"
            text={new Date(file.mtime).toLocaleString("zh-CN")}
            icon={Icon.Calendar}
          />
          {ql?.totalLines !== undefined && ql.previewType === "code" && (
            <Detail.Metadata.Label
              title="行数统计"
              text={`${ql.totalLines} 行${ql.truncated ? " (已截取前200行)" : ""}`}
              icon={Icon.List}
            />
          )}
          {sha256 ? (
            <Detail.Metadata.Label
              title="SHA-256"
              text={`${sha256.slice(0, 16)}...`}
              icon={Icon.Lock}
            />
          ) : null}
          <Detail.Metadata.TagList title="分类">
            <Detail.Metadata.TagList.Item
              text={file.isDir ? "目录" : `.${ext.toUpperCase() || "FILE"}`}
              color={file.isDir ? Color.Orange : Color.Blue}
            />
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title="文件操作">
          <Action
            title={file.isDir ? "打开文件夹" : "打开文件"}
            icon={file.isDir ? Icon.Folder : Icon.Document}
            onAction={async () => toastResult(await openFile(file.path))}
          />
          <Action
            title="在 Finder / 资源管理器中定位 (Show in Finder)"
            icon={Icon.Folder}
            shortcut={{ modifiers: ["ctrl"], key: "enter" }}
            onAction={async () => toastResult(await revealFile(file.path))}
          />
          <Action
            title="Quick Look 快速预览"
            icon={Icon.Eye}
            shortcut={{ modifiers: ["ctrl"], key: "y" }}
            onAction={async () => toastResult(await quickLookFile(file.path))}
          />
          <Action.CopyToClipboard
            title="复制文件绝对路径"
            content={file.path}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
          />
          <Action.CopyToClipboard
            title="复制文件名"
            content={file.name}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "n" }}
          />
          {sha256 ? (
            <Action.CopyToClipboard
              title="复制 SHA-256 哈希值"
              content={sha256}
              shortcut={{ modifiers: ["ctrl", "shift"], key: "h" }}
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}

/**
 * 根命令：Everything 文件搜索（布局一：100% 全宽单列表 + 底部黄金三键）
 * 每行的标题 / 路径 / 大小在单行内即可表达完整，不开右侧详情栏；文件真实内容通过「即时预览」查看。
 */
export default function EverythingFileSearchCommand() {
  const [query, setQuery] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("name-asc");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [allFiles, setAllFiles] = useState<FileRecord[]>(() =>
    isRealElectronHost() ? [] : SAMPLE_FILES
  );
  const [isLoading, setIsLoading] = useState<boolean>(() => isRealElectronHost());
  const [searchError, setSearchError] = useState("");
  // 每次检索递增；慢的旧请求晚返回时序号已过期，结果直接丢弃，不能覆盖新关键词的结果
  const searchSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = (text: string, delayMs: number) => {
    const seq = ++searchSeqRef.current;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    setIsLoading(true);
    debounceTimerRef.current = setTimeout(async () => {
      debounceTimerRef.current = null;
      let results: FileRecord[] = [];
      let failure = "";
      try {
        results = await searchLocalFiles(text, 50);
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
      }
      if (seq !== searchSeqRef.current) return;
      setSearchError(failure);
      setAllFiles(results);
      setIsLoading(false);
    }, delayMs);
  };

  const handleSearchTextChange = (text: string) => {
    setQuery(text);
    runSearch(text, SEARCH_DEBOUNCE_MS);
  };

  useEffect(() => {
    if (isRealElectronHost()) {
      runSearch("", 0);
    }
    return () => {
      // 视图卸载：作废所有在途检索，清掉防抖定时器
      searchSeqRef.current++;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    };
  }, []);

  // 排序与筛选后的展示列表
  const displayedFiles = sortAndFilterFiles(allFiles, sortOption, typeFilter);
  const totalSizeBytes = displayedFiles.reduce((acc, f) => acc + (f.isDir ? 0 : f.size || 0), 0);

  const handleMoveToTrash = async (file: FileRecord) => {
    const confirmed = await confirmAlert({
      title: `将「${file.name}」移入废纸篓 / 回收站？`,
      message: file.path,
      primaryAction: { title: "移入废纸篓", style: "destructive" },
      dismissAction: { title: "取消" }
    });
    if (!confirmed) return;
    const res = await moveToTrash(file.path, undefined, file.isDir);
    if (res.success) {
      setAllFiles((prev) => prev.filter((f) => f.path !== file.path));
    }
    await toastResult(res);
  };

  const handleCopyFile = async (file: FileRecord) => toastResult(await copyFileToClipboard(file.path));

  const handleCalculateSha256 = async (file: FileRecord) => {
    try {
      const hash = await calculateFileSha256(file.path);
      await Clipboard.copy(hash);
      await showToast(Toast.Style.Success, `已复制 SHA-256: ${hash.slice(0, 16)}...`);
    } catch (err: any) {
      await showToast(Toast.Style.Failure, `计算 SHA-256 失败: ${err.message || String(err)}`);
    }
  };

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={false}
      searchBarPlaceholder="搜索文件名、拼音或扩展名..."
      onSearchTextChange={handleSearchTextChange}
      filterBar={{
        summaryText: searchError ? `搜索失败：${searchError}` : `当前匹配 ${displayedFiles.length} 个文件/目录 · 总大小 ${formatBytes(totalSizeBytes)}${query ? ` · 检索词 "${query}"` : ""}`
      }}
      searchBarAccessory={
        <List.Dropdown
          tooltip="类型筛选与排序"
          onChange={(val: string) => {
            if (val.startsWith("sort:")) {
              setSortOption(val.replace("sort:", "") as SortOption);
            } else if (val.startsWith("type:")) {
              setTypeFilter(val.replace("type:", "") as TypeFilter);
            }
          }}
        >
          <List.Dropdown.Section title="类型筛选">
            <List.Dropdown.Item title="全部文件与文件夹 (All)" value="type:all" />
            <List.Dropdown.Item title="文档与表格 (Documents)" value="type:document" />
            <List.Dropdown.Item title="图片与照片 (Images)" value="type:image" />
            <List.Dropdown.Item title="视频与影片 (Videos)" value="type:video" />
            <List.Dropdown.Item title="音频与音乐 (Audio)" value="type:audio" />
            <List.Dropdown.Item title="压缩文件 (Archives)" value="type:archive" />
            <List.Dropdown.Item title="源代码与配置 (Code)" value="type:code" />
            <List.Dropdown.Item title="文件夹目录 (Folders)" value="type:folder" />
          </List.Dropdown.Section>
          <List.Dropdown.Section title="排序方式">
            <List.Dropdown.Item title="按名称升序 (A-Z)" value="sort:name-asc" />
            <List.Dropdown.Item title="按名称降序 (Z-A)" value="sort:name-desc" />
            <List.Dropdown.Item title="按文件大小 (从大到小)" value="sort:size-desc" />
            <List.Dropdown.Item title="按文件大小 (从小到大)" value="sort:size-asc" />
            <List.Dropdown.Item title="按修改时间 (最新优先)" value="sort:mtime-desc" />
            <List.Dropdown.Item title="按修改时间 (最早优先)" value="sort:mtime-asc" />
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {searchError && <List.Item id="search-error" title="读取文件索引失败" subtitle={searchError} icon={Icon.ExclamationMark} actions={<ActionPanel><Action title="重新搜索" onAction={() => runSearch(query, 0)} /></ActionPanel>} />}
      {displayedFiles.map((file) => {
        const isDir = file.isDir;
        const category = getFileCategory(file.name, isDir);

        let fileIcon = Icon.Document;
        if (isDir) fileIcon = Icon.Folder;
        else if (category === "image") fileIcon = Icon.Image;
        else if (category === "video") fileIcon = Icon.Video;
        else if (category === "audio") fileIcon = Icon.Play;
        else if (category === "code") fileIcon = Icon.Code;
        else if (category === "archive") fileIcon = Icon.HardDrive;
        else if (category === "app") fileIcon = Icon.Terminal;

        return (
          <List.Item
            key={file.path}
            id={file.path}
            title={file.name}
            subtitle={truncatePath(file.path)}
            icon={fileIcon}
            accessories={[{ text: isDir ? "文件夹" : formatBytes(file.size) }]}
            actions={
              <ActionPanel title={file.name}>
                <ActionPanel.Section title="核心动作">
                  <Action
                    title={isDir ? "打开文件夹" : "打开文件"}
                    icon={isDir ? Icon.Folder : Icon.Document}
                    onAction={async () => toastResult(await openFile(file.path))}
                  />
                  <Action
                    title="在 Finder / 资源管理器中定位 (Show in Finder)"
                    icon={Icon.Folder}
                    shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                    onAction={async () => toastResult(await revealFile(file.path))}
                  />
                  <Action
                    title="Quick Look 快速预览"
                    icon={Icon.Eye}
                    shortcut={{ modifiers: ["ctrl"], key: "y" }}
                    onAction={async () => toastResult(await quickLookFile(file.path))}
                  />
                  <Action.Push
                    title="即时预览 (Quick Look)"
                    icon={Icon.Eye}
                    shortcut={{ modifiers: ["ctrl"], key: "y" }}
                    target={() => <FileQuickLookDetailView file={file} />}
                  />
                </ActionPanel.Section>

                <ActionPanel.Section title="快捷复制 (Clipboard)">
                  <Action.CopyToClipboard
                    title="复制文件绝对路径"
                    content={file.path}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
                  />
                  <Action.CopyToClipboard
                    title="复制文件名"
                    content={file.name}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "n" }}
                  />
                  <Action
                    title="复制文件本身到剪贴板"
                    icon={Icon.Clipboard}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "v" }}
                    onAction={() => handleCopyFile(file)}
                  />
                  <Action
                    title="计算并复制 SHA-256"
                    icon={Icon.Lock}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "h" }}
                    onAction={() => handleCalculateSha256(file)}
                  />
                </ActionPanel.Section>

                {/* 宿主不允许回收文件夹（误删整个目录后果太大），文件夹结果不提供该动作 */}
                {isDir ? null : (
                  <ActionPanel.Section title="文件治理 (Operations)">
                    <Action
                      title="移入回收站 (Move to Trash)"
                      icon={Icon.Trash}
                      style="destructive"
                      shortcut={{ modifiers: ["ctrl", "shift"], key: "backspace" }}
                      onAction={() => handleMoveToTrash(file)}
                    />
                  </ActionPanel.Section>
                )}
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
