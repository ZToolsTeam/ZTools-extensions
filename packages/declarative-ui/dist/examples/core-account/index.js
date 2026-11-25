import React from "../../index.js";
import { List, ActionPanel, Action, Icon, Color, showToast, Toast, Clipboard } from "../../index.js";
import { useState, useEffect } from "../../runtime/hooks.js";
import { CURRENT_APP_VERSION, getReleaseNotes, checkForUpdates, getActiveAnnouncements, dismissAnnouncement } from "./core-service.js";
export * from "./types.js";
export * from "./core-service.js";
/**
 * M1.5-27: Raycast Core 核心系统状态与更新中心
 */
export default function RaycastCoreCommand() {
    const [releaseNotes, setReleaseNotes] = useState([]);
    const [announcements, setAnnouncements] = useState([]);
    const [updateInfo, setUpdateInfo] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const notes = getReleaseNotes();
                const anns = await getActiveAnnouncements();
                if (isMounted) {
                    setReleaseNotes(notes);
                    setAnnouncements(anns);
                    setIsLoading(false);
                }
            }
            catch {
                if (isMounted)
                    setIsLoading(false);
            }
        })();
        return () => {
            isMounted = false;
        };
    }, []);
    const handleCheckUpdate = async () => {
        setIsCheckingUpdate(true);
        await showToast(Toast.Style.Animated, "正在检查 ZTools 最新版本...");
        try {
            const res = await checkForUpdates();
            setUpdateInfo(res);
            if (res.hasUpdate) {
                await showToast(Toast.Style.Success, `发现新版本 v${res.latestVersion}!`, "可立即下载或安装更新");
            }
            else {
                await showToast(Toast.Style.Success, `已是最新版本 (v${res.currentVersion})`);
            }
        }
        catch (err) {
            await showToast(Toast.Style.Failure, `更新检查失败: ${err.message}`);
        }
        finally {
            setIsCheckingUpdate(false);
        }
    };
    const handleDismissAnnouncement = async (id) => {
        await dismissAnnouncement(id);
        setAnnouncements((prev) => prev.filter((a) => a.id !== id));
        await showToast(Toast.Style.Success, "公告已标记已读并隐藏");
    };
    return (React.createElement(List, { isLoading: isLoading || isCheckingUpdate, isShowingDetail: true, searchBarPlaceholder: "\u641C\u7D22\u7248\u672C\u7279\u6027\u4E0E\u7CFB\u7EDF\u516C\u544A (Release Notes, Announcements)..." },
        React.createElement(List.Section, { title: "\u7CFB\u7EDF\u66F4\u65B0 (Software Updates)" },
            React.createElement(List.Item, { id: "item_check_update", title: "\u68C0\u67E5 ZTools \u5BA2\u6237\u7AEF\u66F4\u65B0", subtitle: `当前版本: v${CURRENT_APP_VERSION} (最新稳定版)`, icon: Icon.Repeat, accessories: [{ text: "检查更新" }], detail: React.createElement(List.Item.Detail, { markdown: `### 🔄 ZTools 客户端更新中心\n\n- **当前已安装版本**: \`v${CURRENT_APP_VERSION}\`\n- **更新服务状态**: 正常运行 (GitHub Releases + 阿里云 CDN)\n- **SHA-256 完整性校验**: 开启强制校验\n\n> 按 **Enter** 立即检查是否有新版本发布。`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5F53\u524D\u7248\u672C", text: `v${CURRENT_APP_VERSION}`, icon: Icon.Document }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u66F4\u65B0\u901A\u9053", text: "Stable \u7A33\u5B9A\u901A\u9053", icon: Icon.Check }),
                        React.createElement(List.Item.Detail.Metadata.Separator, null),
                        React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                            React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: "\u5C31\u7EEA", color: Color.Green }))) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: "\u7ACB\u5373\u68C0\u67E5\u66F4\u65B0", icon: Icon.Repeat, onAction: handleCheckUpdate })) })),
        announcements.length > 0 && (React.createElement(List.Section, { title: `官方公告与广播 (${announcements.length})` }, announcements.map((ann) => (React.createElement(List.Item, { key: ann.id, id: ann.id, title: ann.title, subtitle: ann.date, icon: Icon.ExclamationMark, accessories: [{ text: ann.severity.toUpperCase() }], detail: React.createElement(List.Item.Detail, { markdown: `### 📢 ${ann.title}\n\n*发布日期: ${ann.date}*\n\n${ann.content}\n\n${ann.linkUrl ? `[访问官方链接](${ann.linkUrl})` : ""}` }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u5FFD\u7565\u6B64\u516C\u544A", icon: Icon.XMarkCircle, onAction: () => handleDismissAnnouncement(ann.id) }),
                ann.linkUrl && (React.createElement(Action.OpenInBrowser, { url: ann.linkUrl }))) }))))),
        React.createElement(List.Section, { title: `版本更新日志 (${releaseNotes.length})` }, releaseNotes.map((note) => (React.createElement(List.Item, { key: note.version, id: `note_${note.version}`, title: `v${note.version} - ${note.title}`, subtitle: note.releaseDate, icon: Icon.Document, accessories: note.isCurrentVersion ? [{ text: "当前版本" }] : [], detail: React.createElement(List.Item.Detail, { markdown: note.markdownNotes, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7248\u672C\u53F7", text: `v${note.version}`, icon: Icon.Key }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u53D1\u5E03\u65E5\u671F", text: note.releaseDate, icon: Icon.Calendar }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u6838\u5FC3\u5347\u7EA7" }, note.highlights.slice(0, 3).map((h, i) => (React.createElement(List.Item.Detail.Metadata.TagList.Item, { key: i, text: h.slice(0, 16), color: Color.Blue }))))) }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u590D\u5236\u7248\u672C\u65E5\u5FD7", icon: Icon.Clipboard, onAction: async () => {
                        await Clipboard.copy(note.markdownNotes);
                        await showToast(Toast.Style.Success, `v${note.version} 日志已复制`);
                    } })) }))))));
}
