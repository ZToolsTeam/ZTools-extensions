import React from "../../index.js";
import { List, Detail, ActionPanel, Action, Icon, Color, showToast, Toast, Clipboard, useNavigation } from "../../index.js";
import { useState, useEffect } from "../../runtime/hooks.js";
import { formatBytes, truncatePath, getFileCategory, SAMPLE_FILES, sortAndFilterFiles, searchLocalFiles, getFileQuickLook, calculateFileSha256, calculateFileMd5, openFile, openWith, revealFile, moveToTrash, copyFileToClipboard } from "./search-service.js";
import { callHostTransport, isRealElectronHost } from "../shared/native-ipc.js";
export * from "./types.js";
export * from "./search-service.js";
/**
 * 空格即时预览视图 (Space Quick Look Detail View)
 * 选中文件后按空格即可快速预览
 */
export function FileQuickLookDetailView({ file, initialQuickLook }) {
    const [quickLook, setQuickLook] = useState(initialQuickLook || null);
    const [sha256, setSha256] = useState("");
    React.useEffect(() => {
        if (!initialQuickLook) {
            void getFileQuickLook(file).then(setQuickLook);
        }
        void calculateFileSha256(file.path).then(setSha256).catch(() => setSha256(""));
    }, [file.path]);
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const ql = quickLook;
    let markdown = `# 🔍 即时预览: ${file.name}\n\n> **路径**: \`${file.path}\`\n\n`;
    if (!ql) {
        markdown += `⏳ 正在抽取文件头部数据与语法分析...`;
    }
    else if (ql.previewType === "error") {
        markdown += `> ⚠️ **读取异常**: ${ql.error || "无法访问该文件"}\n\n可能原因：文件被独占占用、权限不足或路径不存在。`;
    }
    else if (ql.previewType === "empty") {
        markdown += `> ℹ️ **空文件**: 该文件长度为 0 字节。`;
    }
    else if (ql.previewType === "directory") {
        markdown += `### 📁 文件夹内容 (${ql.totalLines ?? 0} 项)\n\n`;
        if (ql.dirEntries && ql.dirEntries.length > 0) {
            markdown += ql.dirEntries
                .map((e) => `- ${e.isDir ? "📁" : "📄"} \`${e.name}\``)
                .join("\n");
            if (ql.truncated) {
                markdown += `\n\n*(仅显示前 25 项，已安全截断)*`;
            }
        }
        else {
            markdown += `*(空目录或暂无子项)*`;
        }
    }
    else if (ql.previewType === "image") {
        markdown += `![图片预览](${ql.content})\n\n> 分辨率/原图链接: \`${ql.content}\``;
    }
    else if (ql.previewType === "markdown") {
        markdown += `${ql.content}\n\n`;
        if (ql.truncated) {
            markdown += `\n\n*(内容超限，已截取前 200 行 / 64KB 防内存爆破)*`;
        }
    }
    else if (ql.previewType === "code") {
        markdown += `\`\`\`${ql.codeLanguage || ext}\n${ql.content}\n\`\`\`\n\n`;
        if (ql.truncated) {
            markdown += `*(代码超限，已截取前 200 行 / 64KB 防内存爆破)*`;
        }
    }
    else {
        markdown += `> ℹ️ ${ql.content || "该格式为二进制文件，请使用关联应用直接打开。"}`;
    }
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `Quick Look: ${file.name}`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u6587\u4EF6\u540D", text: file.name, icon: Icon.Document }),
            React.createElement(Detail.Metadata.Label, { title: "\u6240\u5728\u4F4D\u7F6E", text: file.path, icon: Icon.Folder }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.Label, { title: "\u5927\u5C0F", text: file.isDir ? "文件夹" : formatBytes(file.size), icon: Icon.HardDrive }),
            React.createElement(Detail.Metadata.Label, { title: "\u4FEE\u6539\u65F6\u95F4", text: new Date(file.mtime).toLocaleString("zh-CN"), icon: Icon.Calendar }),
            ql?.totalLines !== undefined && ql.previewType === "code" && (React.createElement(Detail.Metadata.Label, { title: "\u884C\u6570\u7EDF\u8BA1", text: `${ql.totalLines} 行${ql.truncated ? " (已截取前200行)" : ""}`, icon: Icon.List })),
            sha256 ? (React.createElement(Detail.Metadata.Label, { title: "SHA-256", text: `${sha256.slice(0, 16)}...`, icon: Icon.Lock })) : null,
            React.createElement(Detail.Metadata.TagList, { title: "\u5206\u7C7B" },
                React.createElement(Detail.Metadata.TagList.Item, { text: file.isDir ? "目录" : `.${ext.toUpperCase() || "FILE"}`, color: file.isDir ? Color.Orange : Color.Blue }))), actions: React.createElement(ActionPanel, { title: "\u6587\u4EF6\u64CD\u4F5C" },
            React.createElement(Action, { title: file.isDir ? "打开文件夹" : "打开文件", icon: file.isDir ? Icon.Folder : Icon.Document, onAction: async () => {
                    const res = await openFile(file.path);
                    await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                } }),
            React.createElement(Action, { title: "\u5728 Finder / \u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D (Show in Finder)", icon: Icon.Folder, shortcut: { modifiers: ["ctrl"], key: "enter" }, onAction: async () => {
                    const res = await revealFile(file.path);
                    await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                } }),
            React.createElement(Action, { title: "Quick Look \u5FEB\u901F\u9884\u89C8", icon: Icon.Eye, shortcut: { modifiers: ["ctrl"], key: "y" }, onAction: async () => {
                    const res = await callHostTransport("filesearch_quick_look", { path: file.path });
                    await showToast(Toast.Style.Success, res.ok ? `已调起 Quick Look 原生预览: ${file.name}` : `快速预览: ${file.name}`);
                } }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6587\u4EF6\u7EDD\u5BF9\u8DEF\u5F84", content: file.path, shortcut: { modifiers: ["ctrl", "shift"], key: "c" } }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6587\u4EF6\u540D", content: file.name, shortcut: { modifiers: ["ctrl"], key: "c" } }),
            sha256 ? (React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 SHA-256 \u54C8\u5E0C\u503C", content: sha256, shortcut: { modifiers: ["ctrl", "shift"], key: "h" } })) : null) }));
}
/**
 * 文件的详细信息视图 (独立卡片模式)
 */
export function FileDetailView({ file }) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const isCode = ["js", "ts", "vue", "html", "css", "json", "py", "cpp", "c", "h", "rs", "go", "java", "sql", "md"].includes(ext);
    const markdown = file.isDir
        ? `
# 📁 文件夹: ${file.name}

> **完整绝对路径**: \`${file.path}\`

### 目录概览
- **类型**: 本地文件系统目录
- **最后修改**: ${new Date(file.mtime).toLocaleString("zh-CN")}
- **快速操作**: 支持按 \`Enter\` 在 Finder / 资源管理器中打开该文件夹，或使用 \`Ctrl+Shift+C\` / \`Cmd+Shift+C\` 快速复制绝对路径。
`
        : `
# 📄 ${file.name}

> **文件路径**: \`${file.path}\`  
> **文件大小**: \`${formatBytes(file.size)}\` | **修改时间**: \`${new Date(file.mtime).toLocaleString("zh-CN")}\`

${isCode
            ? `### 源代码 / 文本预览
\`\`\`${ext === "ts" || ext === "js" ? "typescript" : ext}
// 文件路径: ${file.path}
// 状态: 已建立索引 (macOS Spotlight mdfind / Windows NTFS MFT)，就绪可用
\`\`\``
            : `### 文件信息
- **扩展名**: \`.${ext || "未知"}\`
- **归属分类**: \`${getFileCategory(file.name, file.isDir)}\`
- **系统关联**: 默认调用 macOS / Windows 关联应用秒级启动，支持 \`Cmd+Y\` / \`Ctrl+Y\` 原生 Quick Look 预览。`}
`;
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `${file.name} (${formatBytes(file.size)})`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u6587\u4EF6\u540D", text: file.name, icon: Icon.Document }),
            React.createElement(Detail.Metadata.Label, { title: "\u6240\u5728\u4F4D\u7F6E", text: file.path, icon: Icon.Folder }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.Label, { title: "\u5927\u5C0F", text: file.isDir ? "文件夹" : formatBytes(file.size), icon: Icon.HardDrive }),
            React.createElement(Detail.Metadata.Label, { title: "\u4FEE\u6539\u65F6\u95F4", text: new Date(file.mtime).toLocaleString("zh-CN"), icon: Icon.Calendar }),
            React.createElement(Detail.Metadata.TagList, { title: "\u7C7B\u578B" },
                React.createElement(Detail.Metadata.TagList.Item, { text: file.isDir ? "目录" : `.${ext.toUpperCase() || "FILE"}`, color: file.isDir ? Color.Orange : Color.Blue }))), actions: React.createElement(ActionPanel, { title: "\u6587\u4EF6\u64CD\u4F5C" },
            React.createElement(Action, { title: "\u5728 Finder / \u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D (Show in Finder)", icon: Icon.Folder, onAction: async () => {
                    const res = await revealFile(file.path);
                    await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
                } }),
            React.createElement(Action, { title: "Quick Look \u5FEB\u901F\u9884\u89C8", icon: Icon.Eye, shortcut: { modifiers: ["ctrl"], key: "y" }, onAction: async () => {
                    const res = await callHostTransport("filesearch_quick_look", { path: file.path });
                    await showToast(Toast.Style.Success, res.ok ? `已调起 Quick Look 原生预览: ${file.name}` : `快速预览: ${file.name}`);
                } }),
            React.createElement(Action.Push, { title: "\u5373\u65F6\u9884\u89C8 (Quick Look)", icon: Icon.Eye, shortcut: { modifiers: ["ctrl"], key: "y" }, target: () => React.createElement(FileQuickLookDetailView, { file: file }) }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6587\u4EF6\u7EDD\u5BF9\u8DEF\u5F84", content: file.path, shortcut: { modifiers: ["ctrl", "shift"], key: "c" } }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6587\u4EF6\u540D", content: file.name, shortcut: { modifiers: ["ctrl"], key: "c" } })) }));
}
/**
 * 根命令：Everything 文件搜索 (左列表 + 右详情双栏，附常用文件动作)
 */
export default function EverythingFileSearchCommand() {
    const [query, setQuery] = useState("");
    const [sortOption, setSortOption] = useState("name-asc");
    const [typeFilter, setTypeFilter] = useState("all");
    const [allFiles, setAllFiles] = useState(() => isRealElectronHost() ? [] : SAMPLE_FILES);
    const [isLoading, setIsLoading] = useState(() => isRealElectronHost());
    const [isShowingDetail, setIsShowingDetail] = useState(true);
    const [selectedId, setSelectedId] = useState(null);
    const { push } = useNavigation();
    // 触发搜索
    const handleSearchTextChange = async (text) => {
        setQuery(text);
        setIsLoading(true);
        try {
            const results = await searchLocalFiles(text, 50);
            setAllFiles(results);
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        if (isRealElectronHost()) {
            void handleSearchTextChange("");
        }
    }, []);
    // 排序与筛选后的展示列表
    const displayedFiles = sortAndFilterFiles(allFiles, sortOption, typeFilter);
    const activeFile = displayedFiles.find((f) => f.path === selectedId) || displayedFiles[0];
    const totalSizeBytes = displayedFiles.reduce((acc, f) => acc + (f.isDir ? 0 : f.size || 0), 0);
    const handleOpenFile = async (file) => {
        const res = await openFile(file.path);
        await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
    };
    const handleOpenWith = async (file) => {
        const res = await openWith(file.path);
        await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
    };
    const handleShowInFolder = async (file) => {
        const res = await revealFile(file.path);
        await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
    };
    const handleMoveToTrash = async (file) => {
        const res = await moveToTrash(file.path);
        if (res.success) {
            setAllFiles((prev) => prev.filter((f) => f.path !== file.path));
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleCopyFile = async (file) => {
        const res = await copyFileToClipboard(file.path);
        await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.message);
    };
    const handleCalculateSha256 = async (file) => {
        try {
            const hash = await calculateFileSha256(file.path);
            await Clipboard.copy(hash);
            await showToast(Toast.Style.Success, `已复制 SHA-256: ${hash.slice(0, 16)}...`);
        }
        catch (err) {
            await showToast(Toast.Style.Failure, `计算 SHA-256 失败: ${err.message || String(err)}`);
        }
    };
    const handleCalculateMd5 = async (file) => {
        try {
            const hash = await calculateFileMd5(file.path);
            await Clipboard.copy(hash);
            await showToast(Toast.Style.Success, `已复制 MD5: ${hash}`);
        }
        catch (err) {
            await showToast(Toast.Style.Failure, `计算 MD5 失败: ${err.message || String(err)}`);
        }
    };
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: isShowingDetail, searchBarPlaceholder: "Everything\u6587\u4EF6\u641C\u7D22 (\u652F\u6301\u62FC\u97F3\u3001\u6269\u5C55\u540D\u4E0E\u53CC\u680F\u9884\u89C8)...", onSearchTextChange: handleSearchTextChange, onSelectionChange: setSelectedId, filterBar: {
            summaryText: `当前匹配 ${displayedFiles.length} 个文件/目录 · 总大小 ${formatBytes(totalSizeBytes)}${query ? ` · 检索词 "${query}"` : ""}`
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u7C7B\u578B\u7B5B\u9009\u4E0E\u6392\u5E8F", onChange: (val) => {
                if (val.startsWith("sort:")) {
                    setSortOption(val.replace("sort:", ""));
                }
                else if (val.startsWith("type:")) {
                    setTypeFilter(val.replace("type:", ""));
                }
            } },
            React.createElement(List.Dropdown.Section, { title: "\u7C7B\u578B\u7B5B\u9009" },
                React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u6587\u4EF6\u4E0E\u6587\u4EF6\u5939 (All)", value: "type:all" }),
                React.createElement(List.Dropdown.Item, { title: "\uD83D\uDCC4 \u6587\u6863\u4E0E\u8868\u683C (Documents)", value: "type:document" }),
                React.createElement(List.Dropdown.Item, { title: "\uD83D\uDDBC\uFE0F \u56FE\u7247\u4E0E\u7167\u7247 (Images)", value: "type:image" }),
                React.createElement(List.Dropdown.Item, { title: "\uD83C\uDFAC \u89C6\u9891\u4E0E\u5F71\u7247 (Videos)", value: "type:video" }),
                React.createElement(List.Dropdown.Item, { title: "\uD83C\uDFB5 \u97F3\u9891\u4E0E\u97F3\u4E50 (Audio)", value: "type:audio" }),
                React.createElement(List.Dropdown.Item, { title: "\uD83D\uDCE6 \u538B\u7F29\u6587\u4EF6 (Archives)", value: "type:archive" }),
                React.createElement(List.Dropdown.Item, { title: "\uD83D\uDCBB \u6E90\u4EE3\u7801\u4E0E\u914D\u7F6E (Code)", value: "type:code" }),
                React.createElement(List.Dropdown.Item, { title: "\uD83D\uDCC1 \u6587\u4EF6\u5939\u76EE\u5F55 (Folders)", value: "type:folder" })),
            React.createElement(List.Dropdown.Section, { title: "\u6392\u5E8F\u65B9\u5F0F" },
                React.createElement(List.Dropdown.Item, { title: "\u6309\u540D\u79F0\u5347\u5E8F (A-Z)", value: "sort:name-asc" }),
                React.createElement(List.Dropdown.Item, { title: "\u6309\u540D\u79F0\u964D\u5E8F (Z-A)", value: "sort:name-desc" }),
                React.createElement(List.Dropdown.Item, { title: "\u6309\u6587\u4EF6\u5927\u5C0F (\u4ECE\u5927\u5230\u5C0F)", value: "sort:size-desc" }),
                React.createElement(List.Dropdown.Item, { title: "\u6309\u6587\u4EF6\u5927\u5C0F (\u4ECE\u5C0F\u5230\u5927)", value: "sort:size-asc" }),
                React.createElement(List.Dropdown.Item, { title: "\u6309\u4FEE\u6539\u65F6\u95F4 (\u6700\u65B0\u4F18\u5148)", value: "sort:mtime-desc" }),
                React.createElement(List.Dropdown.Item, { title: "\u6309\u4FEE\u6539\u65F6\u95F4 (\u6700\u65E9\u4F18\u5148)", value: "sort:mtime-asc" }))) }, displayedFiles.map((file) => {
        const isDir = file.isDir;
        const category = getFileCategory(file.name, isDir);
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        let fileIcon = Icon.Document;
        if (isDir)
            fileIcon = Icon.Folder;
        else if (category === "image")
            fileIcon = Icon.Image;
        else if (category === "video")
            fileIcon = Icon.Video;
        else if (category === "audio")
            fileIcon = Icon.Play;
        else if (category === "code")
            fileIcon = Icon.Code;
        else if (category === "archive")
            fileIcon = Icon.HardDrive;
        else if (category === "app")
            fileIcon = Icon.Terminal;
        const detailMarkdown = `
# ${isDir ? "📁" : "📄"} ${file.name}

> **绝对路径**: \`${file.path}\`  
> **文件大小**: \`${isDir ? "文件夹" : formatBytes(file.size)}\` | **修改时间**: \`${new Date(file.mtime).toLocaleString("zh-CN")}\`

---

${isDir
            ? `### 文件夹属性\n- 本地目录，包含子项目与文件\n- 支持按 \`Enter\` 在 Finder / 资源管理器中打开`
            : `### 文件属性\n- **扩展名**: \`.${ext.toUpperCase() || "未知"}\`\n- **分类**: \`${category.toUpperCase()}\`\n- **系统关联**: 默认调用 macOS Spotlight / Windows NTFS MFT 关联应用秒级启动`}
`;
        return (React.createElement(List.Item, { key: file.path, id: file.path, title: file.name, subtitle: isShowingDetail ? undefined : truncatePath(file.path), icon: fileIcon, accessories: isShowingDetail
                ? undefined
                : [
                    {
                        text: isDir ? "文件夹" : formatBytes(file.size),
                        icon: isDir ? Icon.Folder : Icon.HardDrive
                    }
                ], detail: React.createElement(List.Item.Detail, { markdown: detailMarkdown, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5B8C\u6574\u8DEF\u5F84", text: file.path, icon: Icon.Folder }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6587\u4EF6\u540D", text: file.name, icon: Icon.Document }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6587\u4EF6\u5927\u5C0F", text: isDir ? "文件夹" : formatBytes(file.size), icon: Icon.HardDrive }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u4FEE\u6539\u65F6\u95F4", text: new Date(file.mtime).toLocaleString("zh-CN"), icon: Icon.Calendar }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6269\u5C55\u540D\u5C5E\u6027", text: isDir ? "文件夹 (Directory)" : `.${ext.toUpperCase()} 文件`, icon: Icon.Document }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u5206\u7C7B\u5F52\u5C5E" },
                        React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: category.toUpperCase(), color: isDir ? Color.Orange : Color.Blue }))) }), actions: React.createElement(ActionPanel, { title: file.name },
                React.createElement(ActionPanel.Section, { title: "\u6838\u5FC3\u52A8\u4F5C" },
                    React.createElement(Action, { title: isDir ? "打开文件夹" : "打开文件", icon: isDir ? Icon.Folder : Icon.Document, onAction: () => handleOpenFile(file) }),
                    React.createElement(Action, { title: "\u9009\u62E9\u5173\u8054\u6253\u5F00\u7A0B\u5E8F (Open With...)", icon: Icon.Upload, shortcut: { modifiers: ["ctrl"], key: "o" }, onAction: () => handleOpenWith(file) }),
                    React.createElement(Action, { title: "\u5728 Finder / \u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D (Show in Finder)", icon: Icon.Folder, shortcut: { modifiers: ["ctrl"], key: "enter" }, onAction: () => handleShowInFolder(file) }),
                    React.createElement(Action, { title: "Quick Look \u5FEB\u901F\u9884\u89C8", icon: Icon.Eye, shortcut: { modifiers: ["ctrl"], key: "y" }, onAction: async () => {
                            const res = await callHostTransport("filesearch_quick_look", { path: file.path });
                            await showToast(Toast.Style.Success, res.ok ? `已调起 Quick Look 原生预览: ${file.name}` : `快速预览: ${file.name}`);
                        } }),
                    React.createElement(Action, { title: isShowingDetail ? "隐藏详情分栏" : "展开详情分栏", icon: Icon.SidebarRight, shortcut: { modifiers: ["ctrl"], key: "d" }, onAction: () => setIsShowingDetail((prev) => !prev) }),
                    React.createElement(Action.Push, { title: "\u5373\u65F6\u9884\u89C8 (Quick Look)", icon: Icon.Eye, shortcut: { modifiers: ["ctrl"], key: "y" }, target: () => React.createElement(FileQuickLookDetailView, { file: file }) }),
                    React.createElement(Action.Push, { title: "\u67E5\u770B\u5B8C\u6574\u8BE6\u60C5\u5361\u7247", icon: Icon.Eye, shortcut: { modifiers: ["ctrl", "shift"], key: "i" }, target: () => React.createElement(FileDetailView, { file: file }) })),
                React.createElement(ActionPanel.Section, { title: "\u5FEB\u6377\u590D\u5236 (Clipboard)" },
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6587\u4EF6\u7EDD\u5BF9\u8DEF\u5F84", content: file.path, shortcut: { modifiers: ["ctrl", "shift"], key: "c" } }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6587\u4EF6\u540D", content: file.name, shortcut: { modifiers: ["ctrl"], key: "c" } }),
                    React.createElement(Action, { title: "\u590D\u5236\u6587\u4EF6\u672C\u8EAB\u5230\u526A\u8D34\u677F", icon: Icon.Clipboard, shortcut: { modifiers: ["ctrl", "shift"], key: "v" }, onAction: () => handleCopyFile(file) }),
                    React.createElement(Action, { title: "\u8BA1\u7B97\u5E76\u590D\u5236 SHA-256", icon: Icon.Lock, shortcut: { modifiers: ["ctrl", "shift"], key: "h" }, onAction: () => handleCalculateSha256(file) }),
                    React.createElement(Action, { title: "\u8BA1\u7B97\u5E76\u590D\u5236 MD5", icon: Icon.Lock, onAction: () => handleCalculateMd5(file) })),
                React.createElement(ActionPanel.Section, { title: "\u6587\u4EF6\u6CBB\u7406 (Operations)" },
                    React.createElement(Action, { title: "\u79FB\u5165\u56DE\u6536\u7AD9 (Move to Trash)", icon: Icon.Trash, style: "destructive", shortcut: { modifiers: ["ctrl"], key: "backspace" }, onAction: () => handleMoveToTrash(file) }))) }));
    })));
}
