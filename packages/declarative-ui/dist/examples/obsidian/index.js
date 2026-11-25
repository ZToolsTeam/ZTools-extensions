import { isRealElectronHost } from '../shared/native-ipc.js';
import React from "../../index.js";
import { List, Detail, Form, ActionPanel, Action, Icon, Color, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useEffect } from "../../runtime/hooks.js";
import { DEFAULT_VAULTS, SAMPLE_OBSIDIAN_NOTES, sniffObsidianVaults, getVaultNotes, saveVaultNote, deleteVaultNote, appendToDailyNote, searchVaultNotes } from "./vault.js";
export * from "./types.js";
export * from "./vault.js";
/**
 * 查看 Obsidian Markdown 笔记详情视图 (现代纯正 TSX 模式)
 */
export function ObsidianNoteDetailView({ note, onDeleted }) {
    const { pop } = useNavigation();
    const filePath = note.folder ? `${note.folder}/${note.title}` : note.title;
    const obsidianUri = `obsidian://open?vault=${encodeURIComponent(note.vault)}&file=${encodeURIComponent(filePath)}`;
    const markdown = `
# ${note.title}

> **Vault**: \`${note.vault}\` | **目录**: \`${note.folder}\` | **字数**: \`${note.wordCount} 字\`

---

${note.content}
  `;
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: note.title, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u6240\u5C5E\u77E5\u8BC6\u5E93", text: note.vault, icon: Icon.Folder }),
            React.createElement(Detail.Metadata.Label, { title: "\u76EE\u5F55\u8DEF\u5F84", text: note.folder, icon: Icon.Pin }),
            React.createElement(Detail.Metadata.Label, { title: "\u5B57\u6570\u7EDF\u8BA1", text: `${note.wordCount} 字`, icon: Icon.Document }),
            React.createElement(Detail.Metadata.Label, { title: "\u66F4\u65B0\u65F6\u95F4", text: note.updatedAt, icon: Icon.Clock }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.TagList, { title: "\u5173\u8054\u6807\u7B7E" }, note.tags.map((t) => (React.createElement(Detail.Metadata.TagList.Item, { key: t, text: `#${t}`, color: Color.Blue }))))), actions: React.createElement(ActionPanel, { title: "\u7B14\u8BB0\u64CD\u4F5C" },
            React.createElement(Action.OpenInBrowser, { title: "\u5728 Obsidian \u5BA2\u6237\u7AEF\u6253\u5F00", url: obsidianUri, icon: Icon.Globe }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Markdown \u6B63\u6587", content: note.content, icon: Icon.CopyClipboard }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u53CC\u5411\u94FE\u5F15\u7528\u8BED\u6CD5", content: `[[${note.title}]]`, icon: Icon.Link }),
            React.createElement(Action, { title: "\u5220\u9664\u6B64\u7B14\u8BB0", icon: Icon.Trash, onAction: async () => {
                    await deleteVaultNote(note.id);
                    await showToast(Toast.Style.Success, "笔记已删除");
                    onDeleted?.();
                    pop();
                } })) }));
}
/**
 * 追加至今日 Daily Note 表单视图
 */
export function ObsidianDailyNoteForm({ onAppended }) {
    const { pop } = useNavigation();
    const [vaults, setVaults] = useState(DEFAULT_VAULTS);
    const [vault, setVault] = useState("Engineering");
    const [content, setContent] = useState("");
    useEffect(() => {
        sniffObsidianVaults().then((vs) => {
            setVaults(vs);
            if (vs.length > 0)
                setVault(vs[0].name);
        });
    }, []);
    const handleSubmit = async (values) => {
        const targetVault = values.vault || vault;
        const text = values.content || content;
        if (!text || !text.trim()) {
            await showToast(Toast.Style.Failure, "日记内容不能为空");
            return;
        }
        const { note } = await appendToDailyNote({
            vault: targetVault,
            content: text,
            timestamp: true
        });
        await showToast(Toast.Style.Success, `已追加到今日 Daily Note [${targetVault}]`);
        onAppended?.(note);
        pop();
    };
    return (React.createElement(Form, { navigationTitle: "\u8FFD\u52A0\u5230\u4ECA\u65E5\u65E5\u8BB0 (Daily Note)", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u8FFD\u52A0\u65E5\u8BB0\u6761\u76EE", onSubmit: handleSubmit, icon: Icon.Check })) },
        React.createElement(Form.Dropdown, { id: "vault", title: "\u76EE\u6807\u77E5\u8BC6\u5E93 (Vault)", value: vault, onChange: (v) => setVault(v) }, vaults.map((v) => (React.createElement(Form.Dropdown.Item, { key: v.name, title: `${v.name} (${v.path})`, value: v.name })))),
        React.createElement(Form.TextArea, { id: "content", title: "\u65E5\u8BB0\u5185\u5BB9", placeholder: "\u8BB0\u5F55\u7075\u611F\u3001\u4ECA\u65E5\u5F85\u529E\u6216\u7AD9\u4F1A\u7EAA\u8981...", value: content, onChange: (v) => setContent(v) })));
}
/**
 * 追加 Obsidian 随手记表单视图 (现代纯正 TSX 模式)
 */
export function ObsidianQuickNoteForm({ onCreated }) {
    const { pop } = useNavigation();
    const [vaults, setVaults] = useState(DEFAULT_VAULTS);
    const [title, setTitle] = useState("");
    const [vault, setVault] = useState("Engineering");
    const [folder, setFolder] = useState("Inbox");
    const [tags, setTags] = useState("");
    const [content, setContent] = useState("");
    const [isDaily, setIsDaily] = useState(false);
    useEffect(() => {
        sniffObsidianVaults().then((vs) => {
            setVaults(vs);
            if (vs.length > 0)
                setVault(vs[0].name);
        });
    }, []);
    const handleSubmit = async (values) => {
        const finalTitle = values.title || title;
        const finalVault = values.vault || vault;
        const finalFolder = values.folder || folder;
        const finalTags = (values.tags || tags)
            .split(/[\s,]+/)
            .map((t) => t.replace(/^#/, "").trim())
            .filter(Boolean);
        const finalContent = values.content || content;
        if (!finalTitle.trim() && !isDaily) {
            await showToast(Toast.Style.Failure, "笔记标题不能为空");
            return;
        }
        if (isDaily) {
            const { allNotes } = await appendToDailyNote({
                vault: finalVault,
                content: finalContent || finalTitle,
                timestamp: true
            });
            await showToast(Toast.Style.Success, `已追加到今日 Daily Note [${finalVault}]`);
            onCreated(allNotes);
            pop();
            return;
        }
        const updated = await saveVaultNote({
            title: finalTitle.trim(),
            vault: finalVault,
            folder: finalFolder.trim() || "Inbox",
            tags: finalTags.length > 0 ? finalTags : ["quick-capture"],
            content: finalContent.trim()
        });
        await showToast(Toast.Style.Success, `随手记已保存至 [${finalVault}/${finalFolder}]`);
        onCreated(updated);
        pop();
    };
    return (React.createElement(Form, { navigationTitle: "\u65B0\u5EFA\u968F\u624B\u8BB0 / \u77E5\u8BC6\u6C89\u6DC0", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u7B14\u8BB0", onSubmit: handleSubmit, icon: Icon.Check })) },
        React.createElement(Form.Dropdown, { id: "vault", title: "\u6240\u5C5E\u77E5\u8BC6\u5E93 (Vault)", value: vault, onChange: (v) => setVault(v) }, vaults.map((v) => (React.createElement(Form.Dropdown.Item, { key: v.name, title: `${v.name} (${v.path})`, value: v.name })))),
        React.createElement(Form.TextField, { id: "title", title: "\u7B14\u8BB0\u6807\u9898", placeholder: "\u4F8B\u5982: \u58F0\u660E\u5F0F\u67B6\u6784\u8BBE\u8BA1\u8349\u6848", value: title, onChange: (v) => setTitle(v) }),
        React.createElement(Form.TextField, { id: "folder", title: "\u77E5\u8BC6\u5E93\u76EE\u5F55 (Folder)", placeholder: "Inbox", value: folder, onChange: (v) => setFolder(v) }),
        React.createElement(Form.TextField, { id: "tags", title: "\u6807\u7B7E (\u7A7A\u683C\u5206\u9694)", placeholder: "architecture design ztools", value: tags, onChange: (v) => setTags(v) }),
        React.createElement(Form.TextArea, { id: "content", title: "Markdown \u6B63\u6587", placeholder: "\u8F93\u5165\u968F\u60F3\u3001\u4EE3\u7801\u7247\u6BB5\u6216\u5DE5\u4F5C\u7EAA\u8981...", value: content, onChange: (v) => setContent(v) }),
        React.createElement(Form.Checkbox, { id: "isDaily", label: "\u76F4\u63A5\u4F5C\u4E3A\u4ECA\u65E5 Daily Note (\u6BCF\u65E5\u7B14\u8BB0) \u8BB0\u5F55", value: isDaily, onChange: (v) => setIsDaily(v) })));
}
/**
 * Obsidian 知识库管理主命令 (现代纯正 TSX 模式)
 */
export default function ObsidianCommand() {
    const [notes, setNotes] = useState(isRealElectronHost() ? [] : SAMPLE_OBSIDIAN_NOTES);
    const [vaults, setVaults] = useState(DEFAULT_VAULTS);
    const [selectedVault, setSelectedVault] = useState("all");
    const [searchText, setSearchText] = useState("");
    const { push } = useNavigation();
    useEffect(() => {
        sniffObsidianVaults().then((vs) => setVaults(vs));
        getVaultNotes().then((list) => setNotes(list));
    }, []);
    const refreshNotes = async () => {
        const list = await getVaultNotes(selectedVault);
        setNotes(list);
        await showToast(Toast.Style.Success, "知识库笔记已同步刷新");
    };
    const filteredNotes = searchVaultNotes(notes, searchText, selectedVault);
    return (React.createElement(List, { navigationTitle: "Obsidian \u7B14\u8BB0\u77E5\u8BC6\u5E93", searchBarPlaceholder: "\u5168\u6587\u641C\u7D22\u7B14\u8BB0\u6807\u9898\u3001\u6B63\u6587\u3001\u6807\u7B7E\u3001\u76EE\u5F55...", searchText: searchText, onSearchTextChange: (val) => setSearchText(val), searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u7B5B\u9009\u77E5\u8BC6\u5E93", value: selectedVault, onChange: (newVal) => setSelectedVault(newVal) },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u77E5\u8BC6\u5E93 (All Vaults)", value: "all" }),
            vaults.map((v) => (React.createElement(List.Dropdown.Item, { key: v.name, title: `Vault: ${v.name}`, value: v.name })))), actions: React.createElement(ActionPanel, { title: "\u5168\u5C40\u64CD\u4F5C" },
            React.createElement(Action.Push, { title: "\u65B0\u5EFA\u968F\u624B\u8BB0 (Quick Capture)", icon: Icon.Plus, target: () => (React.createElement(ObsidianQuickNoteForm, { onCreated: (updatedList) => {
                        setNotes(updatedList);
                    } })) }),
            React.createElement(Action.Push, { title: "\u8FFD\u52A0\u5230\u4ECA\u65E5\u65E5\u8BB0 (Daily Note)", icon: Icon.Calendar, target: () => (React.createElement(ObsidianDailyNoteForm, { onAppended: (note) => {
                        setNotes((prev) => [note, ...prev.filter((n) => n.id !== note.id)]);
                    } })) }),
            React.createElement(Action, { title: "\u5237\u65B0\u77E5\u8BC6\u5E93", icon: Icon.Repeat, onAction: refreshNotes })) },
        React.createElement(List.Section, { title: `笔记清单 (${filteredNotes.length})` }, filteredNotes.map((note) => {
            const filePath = note.folder ? `${note.folder}/${note.title}` : note.title;
            const obsidianUri = `obsidian://open?vault=${encodeURIComponent(note.vault)}&file=${encodeURIComponent(filePath)}`;
            return (React.createElement(List.Item, { key: note.id, id: note.id, title: note.title, subtitle: `${note.vault} / ${note.folder}`, icon: note.isDaily ? Icon.Calendar : Icon.Document, accessories: [
                    { text: `${note.wordCount} 字` },
                    { text: note.tags.slice(0, 2).map((t) => `#${t}`).join(" ") },
                    { text: note.updatedAt }
                ], actions: React.createElement(ActionPanel, { title: note.title },
                    React.createElement(Action.Push, { title: "\u67E5\u770B\u7B14\u8BB0\u8BE6\u60C5", icon: Icon.Eye, target: () => (React.createElement(ObsidianNoteDetailView, { note: note, onDeleted: () => {
                                setNotes((prev) => prev.filter((n) => n.id !== note.id));
                            } })) }),
                    React.createElement(Action.OpenInBrowser, { title: "\u5728 Obsidian \u4E2D\u6253\u5F00", url: obsidianUri, icon: Icon.Globe }),
                    React.createElement(Action.Push, { title: "\u8FFD\u52A0\u5230\u4ECA\u65E5\u65E5\u8BB0", icon: Icon.Calendar, target: () => (React.createElement(ObsidianDailyNoteForm, { onAppended: (updatedDaily) => {
                                setNotes((prev) => [
                                    updatedDaily,
                                    ...prev.filter((n) => n.id !== updatedDaily.id)
                                ]);
                            } })) }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Markdown \u6B63\u6587", content: note.content, icon: Icon.CopyClipboard }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u53CC\u94FE\u5F15\u7528\u8BED\u6CD5", content: `[[${note.title}]]`, icon: Icon.Link }),
                    React.createElement(Action, { title: "\u5220\u9664\u7B14\u8BB0", icon: Icon.Trash, onAction: async () => {
                            const updated = await deleteVaultNote(note.id);
                            setNotes(updated);
                            await showToast(Toast.Style.Success, "笔记已删除");
                        } })) }));
        }))));
}
