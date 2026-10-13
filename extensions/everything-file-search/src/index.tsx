import React from "@ztools/raycast-compat";
import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard
} from "@ztools/raycast-compat";
import { useState } from "@ztools/raycast-compat";
import {
  FileRecord,
  SortOption,
  TypeFilter
} from "./types.js";
import {
  formatBytes,
  truncatePath,
  getFileCategory,
  SAMPLE_FILES,
  sortAndFilterFiles,
  searchLocalFiles
} from "./search-service.js";

export * from "./types.js";
export * from "./search-service.js";

/**
 * 文件的详细信息视图 (现代纯正 TSX 模式)
 */
export function FileDetailView({ file }: { file: FileRecord }) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const isCode = ["js", "ts", "vue", "html", "css", "json", "py", "cpp", "c", "h", "rs", "go", "java", "sql", "md"].includes(ext);

  const markdown = file.isDir
    ? `
# 📁 文件夹: ${file.name}

> **完整绝对路径**: \`${file.path}\`

### 目录概览
- **类型**: 本地文件系统目录
- **最后修改**: ${new Date(file.mtime).toLocaleString("zh-CN")}
- **快速操作**: 支持按 \`Enter\` 在资源管理器中打开该文件夹，或使用 \`Ctrl+Shift+C\` 快速复制绝对路径。
`
    : `
# 📄 ${file.name}

> **文件路径**: \`${file.path}\`  
> **文件大小**: \`${formatBytes(file.size)}\` | **修改时间**: \`${new Date(file.mtime).toLocaleString("zh-CN")}\`

${
  isCode
    ? `### 源代码 / 文本预览
\`\`\`${ext === "ts" || ext === "js" ? "typescript" : ext}
// 文件路径: ${file.path}
// 状态: 已建立索引，就绪可用
\`\`\``
    : `### 文件信息
- **扩展名**: \`.${ext || "未知"}\`
- **归属分类**: \`${getFileCategory(file.name, file.isDir)}\`
- **系统关联**: 默认调用 Windows 关联应用秒级启动。`
}
`;

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`${file.name} (${formatBytes(file.size)})`}
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
          <Detail.Metadata.TagList title="类型">
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
            title="在资源管理器中定位"
            icon={Icon.Folder}
            onAction={async () => {
              try {
                const launcher = (globalThis as any).__ztoolsLauncher;
                if (launcher?.showItemInFolder) {
                  await launcher.showItemInFolder(file.path);
                }
                await showToast({ style: Toast.Style.Success, title: "已在资源管理器中定位", message: file.name });
              } catch (err) {
                console.error(err);
              }
            }}
          />
          <Action.CopyToClipboard
            title="复制文件完整路径"
            content={file.path}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
          />
          <Action.CopyToClipboard
            title="复制文件名"
            content={file.name}
            shortcut={{ modifiers: ["ctrl"], key: "c" }}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * 根命令：Everything文件搜索 (现代纯正 TSX 模式)
 */
export default function EverythingFileSearchCommand() {
  const [query, setQuery] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("name-asc");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [allFiles, setAllFiles] = useState<FileRecord[]>(SAMPLE_FILES);
  const [isLoading, setIsLoading] = useState(false);

  // 触发搜索
  const handleSearchTextChange = async (text: string) => {
    setQuery(text);
    setIsLoading(true);
    try {
      const results = await searchLocalFiles(text, 50);
      setAllFiles(results);
    } finally {
      setIsLoading(false);
    }
  };

  // 排序与筛选后的展示列表
  const displayedFiles = sortAndFilterFiles(allFiles, sortOption, typeFilter);

  // 打开文件
  const handleOpenFile = async (file: FileRecord) => {
    try {
      const launcher = (globalThis as any).__ztoolsLauncher;
      if (launcher?.openPath) {
        await launcher.openPath(file.path);
      }
      await showToast({ style: Toast.Style.Success, title: "正在打开", message: file.name });
    } catch {
      await showToast({ style: Toast.Style.Failure, title: "打开失败", message: file.path });
    }
  };

  // 在文件夹中显示
  const handleShowInFolder = async (file: FileRecord) => {
    try {
      const launcher = (globalThis as any).__ztoolsLauncher;
      if (launcher?.showItemInFolder) {
        await launcher.showItemInFolder(file.path);
      }
      await showToast({ style: Toast.Style.Success, title: "已定位文件", message: file.name });
    } catch {
      await showToast({ style: Toast.Style.Failure, title: "定位失败", message: file.path });
    }
  };

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Everything文件搜索 (输入文件名或拼音即刻秒搜)..."
      onSearchTextChange={handleSearchTextChange}
      searchBarAccessory={
        <List.Dropdown
          tooltip="筛选与排序"
          onChange={(val: string) => {
            if (val.startsWith("sort:")) {
              setSortOption(val.replace("sort:", "") as SortOption);
            } else if (val.startsWith("type:")) {
              setTypeFilter(val.replace("type:", "") as TypeFilter);
            }
          }}
        >
          <List.Dropdown.Section title="类型筛选">
            <List.Dropdown.Item title="全部文件与目录" value="type:all" />
            <List.Dropdown.Item title="📁 文件夹" value="type:folder" />
            <List.Dropdown.Item title="📄 文档与表格" value="type:document" />
            <List.Dropdown.Item title="🖼️ 图片与素材" value="type:image" />
            <List.Dropdown.Item title="🎵 影音多媒体" value="type:media" />
            <List.Dropdown.Item title="💻 代码与配置" value="type:code" />
            <List.Dropdown.Item title="📦 压缩包" value="type:archive" />
            <List.Dropdown.Item title="⚡ 应用程序与脚本" value="type:app" />
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
      {displayedFiles.map((file) => {
        const isDir = file.isDir;
        const category = getFileCategory(file.name, isDir);
        let fileIcon = Icon.Document;
        if (isDir) fileIcon = Icon.Folder;
        else if (category === "image") fileIcon = Icon.Image;
        else if (category === "media") fileIcon = Icon.Video;
        else if (category === "code") fileIcon = Icon.Code;
        else if (category === "app") fileIcon = Icon.Terminal;

        return (
          <List.Item
            key={file.path}
            id={file.path}
            title={file.name}
            subtitle={truncatePath(file.path)}
            icon={fileIcon}
            accessories={[
              {
                text: isDir ? "文件夹" : formatBytes(file.size),
                icon: isDir ? Icon.Folder : Icon.HardDrive
              }
            ]}
            actions={
              <ActionPanel title={file.name}>
                <ActionPanel.Section>
                  <Action
                    title={isDir ? "打开文件夹" : "打开文件"}
                    icon={isDir ? Icon.Folder : Icon.Document}
                    onAction={() => handleOpenFile(file)}
                  />
                  <Action
                    title="在资源管理器中定位"
                    icon={Icon.Folder}
                    shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                    onAction={() => handleShowInFolder(file)}
                  />
                  <Action.Push
                    title="查看详情卡片"
                    icon={Icon.Eye}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "i" }}
                    target={() => <FileDetailView file={file} />}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section title="快捷复制">
                  <Action.CopyToClipboard
                    title="复制文件完整路径"
                    content={file.path}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
                  />
                  <Action.CopyToClipboard
                    title="复制文件名"
                    content={file.name}
                    shortcut={{ modifiers: ["ctrl"], key: "c" }}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
