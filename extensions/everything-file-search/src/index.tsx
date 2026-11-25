import React from "@ztools/declarative-ui";
import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  Clipboard,
  confirmAlert
} from "@ztools/declarative-ui";
import { useState, useEffect, useRef, useLocale, getLocale } from "@ztools/declarative-ui";
import { t } from "./i18n.js";
import { FileRecord, SortOption, TypeFilter, FileQuickLookResult, FileActionResult } from "./types.js";
import {
  formatBytes,
  truncatePath,
  getFileCategory,
  getNotInClientMessage,
  supportsSystemQuickLook,
  sortAndFilterFiles,
  searchLocalFilesDetailed,
  getFileQuickLook,
  calculateFileSha256,
  openFile,
  revealFile,
  moveToTrash,
  copyFileToClipboard,
  quickLookFile
} from "./search-service.js";
import { isRealElectronHost } from "./native-ipc.js";
import { resolveErrorMessage } from './error-i18n.js'

/** 文件管理器与回收站的系统叫法：macOS 为「访达」「废纸篓」，Windows 为「资源管理器」「回收站」 */
const platformNames = () => supportsSystemQuickLook()
  ? { manager: t("fmMac"), trash: t("trashMac") }
  : { manager: t("fmWin"), trash: t("trashWin") };

/** 预览页自动计算 SHA-256 的体积上限；更大的文件按需在列表动作里计算，不在打开预览时读完整个大文件 */
const AUTO_SHA256_MAX_BYTES = 64 * 1024 * 1024;

/** 输入停顿多久后才发起检索；同时用递增序号只采用最新一次检索的结果 */
export const SEARCH_DEBOUNCE_MS = 150;

async function toastResult(res: FileActionResult) {
  await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
}

export * from "./types.js";
export * from "./search-service.js";

/**
 * 即时预览视图（从动作面板进入）
 * 显示选中文件的内容预览，或文件夹的直接子项
 */
export function FileQuickLookDetailView({
  file,
  initialQuickLook
}: {
  file: FileRecord;
  initialQuickLook?: FileQuickLookResult;
}) {
  useLocale();
  const [quickLook, setQuickLook] = useState<FileQuickLookResult | null>(initialQuickLook || null);
  const [sha256, setSha256] = useState<string>("");

  const [sha256Note, setSha256Note] = useState<string>("");

  React.useEffect(() => {
    let alive = true;
    if (!initialQuickLook) {
      void getFileQuickLook(file).then((value) => { if (alive) setQuickLook(value); });
    }
    // 文件夹没有哈希；大文件不在打开预览时自动读完整个文件
    if (file.isDir) {
      setSha256Note("");
    } else if (file.size > AUTO_SHA256_MAX_BYTES) {
      setSha256Note(t("sha256LargeFileNote"));
    } else {
      void calculateFileSha256(file.path).then(
        (hash) => { if (alive) { setSha256(hash); setSha256Note(""); } },
        (err) => { if (alive) { setSha256(""); setSha256Note(t("sha256CalcFailedNote", { error: err instanceof Error ? err.message : String(err) })); } }
      );
    }
    return () => { alive = false; };
  }, [file.path]);

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const ql = quickLook;

  // 路径与大小等信息已在右侧元数据中，正文只放文件的真实内容
  let markdown = `# ${file.name}\n\n`;

  if (!ql) {
    markdown += t("qlReading");
  } else if (ql.previewType === "error") {
    markdown += t("qlReadErrTitle", {
      error: resolveErrorMessage(ql, t("qlReadErrDefault")),
      hint: supportsSystemQuickLook() ? t("qlReadErrHintMac") : t("qlReadErrHintOther")
    });
  } else if (ql.previewType === "empty") {
    markdown += t("qlEmptyFileMd");
  } else if (ql.previewType === "directory") {
    markdown += t("qlDirHeading", { count: ql.totalLines ?? 0, plus: ql.partial ? "+" : "" });
    if (ql.dirEntries && ql.dirEntries.length > 0) {
      markdown += ql.dirEntries
        .map((e) => `- \`${e.name}${e.isDir ? "/" : ""}\`${e.isDir ? t("qlDirSuffix") : ""}`)
        .join("\n");
      if (ql.truncated) {
        markdown += t("qlDirTruncated");
      }
      if (ql.partial) {
        markdown += t("qlDirPartial");
      }
    } else {
      markdown += ql.partial ? t("qlDirEmptyPartial") : t("qlDirEmpty");
    }
  } else if (ql.previewType === "image") {
    markdown += `![${t("qlImageAlt")}](${ql.content})`;
  } else if (ql.previewType === "markdown") {
    markdown += `${ql.content}\n\n`;
    if (ql.truncated) {
      markdown += t("qlTextTruncated");
    }
  } else if (ql.previewType === "code") {
    markdown += `\`\`\`${ql.codeLanguage || ext}\n${ql.content}\n\`\`\`\n\n`;
    if (ql.truncated) {
      markdown += t("qlCodeTruncated");
    }
  } else {
    markdown += `> ${ql.content || t("qlBinaryFallback")}`;
  }

  return (
    <Detail
      markdown={markdown}
      navigationTitle={t("qlNavTitle", { name: file.name })}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title={t("metaName")} text={file.name} icon={Icon.Document} />
          <Detail.Metadata.Label title={t("metaLocation")} text={file.path} icon={Icon.Folder} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title={t("metaSize")}
            text={file.isDir ? t("folderLabel") : formatBytes(file.size)}
            icon={Icon.HardDrive}
          />
          <Detail.Metadata.Label
            title={t("metaModified")}
            text={file.mtime > 0 ? new Date(file.mtime).toLocaleString(getLocale()) : t("unknownTime")}
            icon={Icon.Calendar}
          />
          {ql?.totalLines !== undefined && ql.previewType === "code" && (
            <Detail.Metadata.Label
              title={t("metaLines")}
              text={t("metaLinesText", { count: ql.totalLines, trunc: ql.truncated ? t("metaLinesTruncated") : "" })}
              icon={Icon.List}
            />
          )}
          {sha256 || sha256Note ? (
            <Detail.Metadata.Label
              title="SHA-256"
              text={sha256 ? `${sha256.slice(0, 16)}...` : sha256Note}
              icon={Icon.Lock}
            />
          ) : null}
          <Detail.Metadata.TagList title={t("metaCategory")}>
            <Detail.Metadata.TagList.Item
              text={file.isDir ? t("metaDirTag") : `.${ext.toUpperCase() || "FILE"}`}
            />
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title={t("actionPanelOps")}>
          <Action
            title={file.isDir ? t("actionOpenFolder") : t("actionOpenFile")}
            icon={file.isDir ? Icon.Folder : Icon.Document}
            onAction={async () => toastResult(await openFile(file.path))}
          />
          <Action
            title={t("actionRevealInFm", { fm: platformNames().manager })}
            icon={Icon.Folder}
            shortcut={{ modifiers: ["ctrl"], key: "enter" }}
            onAction={async () => toastResult(await revealFile(file.path))}
          />
          {supportsSystemQuickLook() ? (
            <Action
              title={t("actionQuickLookSys")}
              icon={Icon.Eye}
              shortcut={{ modifiers: ["ctrl"], key: "y" }}
              onAction={async () => toastResult(await quickLookFile(file.path))}
            />
          ) : null}
          <Action.CopyToClipboard
            title={t("actionCopyAbsPath")}
            content={file.path}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
          />
          <Action.CopyToClipboard
            title={t("actionCopyName")}
            content={file.name}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "n" }}
          />
          {sha256 ? (
            <Action.CopyToClipboard
              title={t("actionCopySha256")}
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
  useLocale();
  const [query, setQuery] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("name-asc");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  // 不在客户端里运行时直接显示提示，不显示任何示例文件
  const [allFiles, setAllFiles] = useState<FileRecord[]>([]);
  const inClient = isRealElectronHost();
  const [isLoading, setIsLoading] = useState<boolean>(() => inClient);
  const [searchError, setSearchError] = useState("");
  // 宿主报告搜索范围受限（全盘索引不可用 / Spotlight 失败）时的真实说明
  const [scopeNotice, setScopeNotice] = useState("");
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
      let notice = "";
      let failure = "";
      try {
        const outcome = await searchLocalFilesDetailed(text, 50);
        results = outcome.files;
        notice = outcome.scopeNotice;
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
      }
      if (seq !== searchSeqRef.current) return;
      setSearchError(failure);
      setScopeNotice(notice);
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
      title: t("confirmTrashTitle", { name: file.name, trash: platformNames().trash }),
      message: file.path,
      primaryAction: { title: t("actionMoveToTrash", { trash: platformNames().trash }), style: "destructive" },
      dismissAction: { title: t("actionCancel") }
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
      await showToast(Toast.Style.Success, t("toastCopiedSha256", { prefix: hash.slice(0, 16) }));
    } catch (err: unknown) {
      const message = typeof err === "object" && err !== null ? (err as { message?: unknown }).message : undefined;
      await showToast(Toast.Style.Failure, t("toastCalcSha256Failed", { error: message ? String(message) : String(err) }));
    }
  };

  const notInClientMsg = getNotInClientMessage();

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={false}
      searchBarPlaceholder={t("searchPlaceholder")}
      onSearchTextChange={handleSearchTextChange}
      filterBar={{
        summaryText: !inClient
          ? t("summarySearchFailed", { error: notInClientMsg })
          : searchError
            ? t("summarySearchFailed", { error: searchError })
            : t("summaryMatched", {
                scope: scopeNotice ? `${scopeNotice} · ` : "",
                count: displayedFiles.length,
                size: formatBytes(totalSizeBytes),
                queryPart: query ? t("summaryQueryPart", { query }) : ""
              })
      }}
      searchBarAccessory={
        <List.Dropdown
          tooltip={t("dropdownTooltip")}
          onChange={(val: string) => {
            if (val.startsWith("sort:")) {
              setSortOption(val.replace("sort:", "") as SortOption);
            } else if (val.startsWith("type:")) {
              setTypeFilter(val.replace("type:", "") as TypeFilter);
            }
          }}
        >
          <List.Dropdown.Section title={t("secTypeFilter")}>
            <List.Dropdown.Item title={t("typeAll")} value="type:all" />
            <List.Dropdown.Item title={t("typeDocument")} value="type:document" />
            <List.Dropdown.Item title={t("typeImage")} value="type:image" />
            <List.Dropdown.Item title={t("typeVideo")} value="type:video" />
            <List.Dropdown.Item title={t("typeAudio")} value="type:audio" />
            <List.Dropdown.Item title={t("typeArchive")} value="type:archive" />
            <List.Dropdown.Item title={t("typeCode")} value="type:code" />
            <List.Dropdown.Item title={t("typeFolder")} value="type:folder" />
          </List.Dropdown.Section>
          <List.Dropdown.Section title={t("secSortOption")}>
            <List.Dropdown.Item title={t("sortNameAsc")} value="sort:name-asc" />
            <List.Dropdown.Item title={t("sortNameDesc")} value="sort:name-desc" />
            <List.Dropdown.Item title={t("sortSizeDesc")} value="sort:size-desc" />
            <List.Dropdown.Item title={t("sortSizeAsc")} value="sort:size-asc" />
            <List.Dropdown.Item title={t("sortMtimeDesc")} value="sort:mtime-desc" />
            <List.Dropdown.Item title={t("sortMtimeAsc")} value="sort:mtime-asc" />
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {!inClient ? (
        <List.Item id="search-error" title={notInClientMsg} subtitle={t("notInClientSub")} icon={Icon.ExclamationMark} />
      ) : searchError ? (
        <List.Item id="search-error" title={t("searchErrTitle")} subtitle={searchError} icon={Icon.ExclamationMark} actions={<ActionPanel><Action title={t("actionRetrySearch")} onAction={() => runSearch(query, 0)} /></ActionPanel>} />
      ) : null}
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
            accessories={[{ text: isDir ? t("folderLabel") : formatBytes(file.size) }]}
            actions={
              <ActionPanel title={file.name}>
                <ActionPanel.Section title={t("secCoreActions")}>
                  <Action
                    title={isDir ? t("actionOpenFolder") : t("actionOpenFile")}
                    icon={isDir ? Icon.Folder : Icon.Document}
                    onAction={async () => toastResult(await openFile(file.path))}
                  />
                  <Action
                    title={t("actionRevealInFm", { fm: platformNames().manager })}
                    icon={Icon.Folder}
                    shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                    onAction={async () => toastResult(await revealFile(file.path))}
                  />
                  {/* 系统快速预览只在 macOS 上有；Windows 上不提供，避免把「在资源管理器中定位」当成预览成功 */}
                  {supportsSystemQuickLook() ? (
                    <Action
                      title={t("actionQuickLookSys")}
                      icon={Icon.Eye}
                      shortcut={{ modifiers: ["ctrl"], key: "y" }}
                      onAction={async () => toastResult(await quickLookFile(file.path))}
                    />
                  ) : null}
                  <Action.Push
                    title={t("actionInstantPreview")}
                    icon={Icon.Eye}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "y" }}
                    target={() => <FileQuickLookDetailView file={file} />}
                  />
                </ActionPanel.Section>

                <ActionPanel.Section title={t("secQuickCopy")}>
                  <Action.CopyToClipboard
                    title={t("actionCopyAbsPath")}
                    content={file.path}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
                  />
                  <Action.CopyToClipboard
                    title={t("actionCopyName")}
                    content={file.name}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "n" }}
                  />
                  <Action
                    title={t("actionCopyFileObj")}
                    icon={Icon.Clipboard}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "v" }}
                    onAction={() => handleCopyFile(file)}
                  />
                  <Action
                    title={t("actionCalcCopySha256")}
                    icon={Icon.Lock}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "h" }}
                    onAction={() => handleCalculateSha256(file)}
                  />
                </ActionPanel.Section>

                {/* 宿主不允许回收文件夹（误删整个目录后果太大），文件夹结果不提供该动作 */}
                {isDir ? null : (
                  <ActionPanel.Section title={t("secFileManage")}>
                    <Action
                      title={t("actionMoveToTrash", { trash: platformNames().trash })}
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
