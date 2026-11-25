import { isRealElectronHost } from '../shared/native-ipc.js';
import React from "../../index.js";
import { List, Detail, Form, ActionPanel, Action, Icon, Color, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useEffect } from "../../runtime/hooks.js";
import { SAMPLE_GITHUB_ITEMS, filterGithubItems, getGithubToken, setGithubToken, clearGithubToken } from "./data.js";
export * from "./types.js";
export * from "./data.js";
/**
 * GitHub Personal Access Token / BYOK 配置表单
 */
export function GithubTokenForm({ onSaved }) {
    const { pop } = useNavigation();
    const [token, setToken] = useState("");
    const [username, setUsername] = useState("octocat");
    useEffect(() => {
        getGithubToken().then((cfg) => {
            if (cfg) {
                setToken(cfg.token);
                if (cfg.username)
                    setUsername(cfg.username);
            }
        });
    }, []);
    const handleSubmit = async (values) => {
        const pat = values.token || token;
        const user = values.username || username;
        if (!pat || !pat.trim()) {
            await showToast(Toast.Style.Failure, "请输入有效的 Personal Access Token");
            return;
        }
        await setGithubToken(pat, user);
        await showToast(Toast.Style.Success, `GitHub 凭据已保存 (授权用户: @${user})`);
        onSaved?.();
        pop();
    };
    return (React.createElement(Form, { navigationTitle: "\u914D\u7F6E GitHub Personal Access Token (BYOK)", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u51ED\u636E\u5E76\u751F\u6548", onSubmit: handleSubmit, icon: Icon.Check }),
            React.createElement(Action, { title: "\u6E05\u9664\u5DF2\u4FDD\u5B58\u51ED\u636E", icon: Icon.Trash, onAction: async () => {
                    await clearGithubToken();
                    await showToast(Toast.Style.Success, "GitHub Token 已清除");
                    onSaved?.();
                    pop();
                } })) },
        React.createElement(Form.TextField, { id: "username", title: "GitHub \u7528\u6237\u540D", placeholder: "\u4F8B\u5982: octocat", value: username, onChange: (v) => setUsername(v) }),
        React.createElement(Form.TextField, { id: "token", title: "Personal Access Token", placeholder: "ghp_xxxx \u6216 github_pat_xxxx", value: token, onChange: (v) => setToken(v) })));
}
/**
 * GitHub 详情视图 (现代纯正 TSX 模式)
 */
export function GithubDetailView({ item, onUpdate }) {
    if (item.type === "pr") {
        const markdown = `
# [#${item.number}] ${item.title}

> **仓库**: \`${item.repo}\` | **作者**: \`@${item.author}\` | **分支**: \`${item.branch}\` ➔ \`${item.targetBranch}\`

### 说明
${item.body}

---
- **变更统计**: +${item.additions} / -${item.deletions}
- **评审状态**: \`${item.reviewStatus || "PENDING"}\`
- **评论数**: ${item.commentsCount}
- **更新时间**: ${item.updatedAt}
    `;
        return (React.createElement(Detail, { markdown: markdown, navigationTitle: `PR #${item.number}`, metadata: React.createElement(Detail.Metadata, null,
                React.createElement(Detail.Metadata.Label, { title: "\u4ED3\u5E93", text: item.repo, icon: Icon.Document }),
                React.createElement(Detail.Metadata.Label, { title: "\u4F5C\u8005", text: `@${item.author}`, icon: Icon.Pencil }),
                React.createElement(Detail.Metadata.Label, { title: "\u6E90\u5206\u652F", text: item.branch, icon: Icon.Code }),
                React.createElement(Detail.Metadata.Label, { title: "\u76EE\u6807\u5206\u652F", text: item.targetBranch, icon: Icon.ArrowRight }),
                React.createElement(Detail.Metadata.Separator, null),
                React.createElement(Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                    React.createElement(Detail.Metadata.TagList.Item, { text: item.status.toUpperCase(), color: item.status === "open"
                            ? Color.Green
                            : item.status === "merged"
                                ? Color.Purple
                                : item.status === "draft"
                                    ? Color.SecondaryText
                                    : Color.Red }),
                    item.reviewStatus && (React.createElement(Detail.Metadata.TagList.Item, { text: item.reviewStatus, color: item.reviewStatus === "APPROVED"
                            ? Color.Green
                            : item.reviewStatus === "CHANGES_REQUESTED"
                                ? Color.Red
                                : Color.Yellow })))), actions: React.createElement(ActionPanel, { title: "PR \u64CD\u4F5C" },
                React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u6253\u5F00 PR", url: item.url, icon: Icon.Globe }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 PR \u94FE\u63A5", content: item.url, icon: Icon.Link }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5206\u652F\u68C0\u51FA\u547D\u4EE4", content: `git fetch origin ${item.branch} && git checkout ${item.branch}`, icon: Icon.Terminal }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6E90\u5206\u652F\u540D\u79F0", content: item.branch, icon: Icon.Code }),
                React.createElement(Action, { title: "\u6279\u51C6\u6B64 PR (Approve)", icon: Icon.Checkmark, onAction: async () => {
                        const updated = { ...item, reviewStatus: "APPROVED" };
                        onUpdate?.(updated);
                        await showToast(Toast.Style.Success, `PR #${item.number} 已批准 (Approved)`);
                    } }),
                React.createElement(Action, { title: "\u5408\u5E76\u6B64 PR (Merge)", icon: Icon.Check, onAction: async () => {
                        const updated = { ...item, status: "merged" };
                        onUpdate?.(updated);
                        await showToast(Toast.Style.Success, `PR #${item.number} 已成功合并 (Merged)`);
                    } })) }));
    }
    if (item.type === "issue") {
        const markdown = `
# [#${item.number}] ${item.title}

> **仓库**: \`${item.repo}\` | **提问者**: \`@${item.author}\`

### 问题内容
${item.body}

---
- **标签**: ${item.labels.map((l) => `\`${l}\``).join(" ")}
- **评论数**: ${item.commentsCount}
- **最后更新**: ${item.updatedAt}
    `;
        return (React.createElement(Detail, { markdown: markdown, navigationTitle: `Issue #${item.number}`, metadata: React.createElement(Detail.Metadata, null,
                React.createElement(Detail.Metadata.Label, { title: "\u4ED3\u5E93", text: item.repo, icon: Icon.Document }),
                React.createElement(Detail.Metadata.Label, { title: "\u63D0\u95EE\u8005", text: `@${item.author}`, icon: Icon.Pencil }),
                React.createElement(Detail.Metadata.Separator, null),
                React.createElement(Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                    React.createElement(Detail.Metadata.TagList.Item, { text: item.status === "open" ? "OPEN" : "CLOSED", color: item.status === "open" ? Color.Green : Color.SecondaryText })),
                React.createElement(Detail.Metadata.TagList, { title: "\u6807\u7B7E" }, item.labels.map((l) => (React.createElement(Detail.Metadata.TagList.Item, { key: l, text: l, color: Color.Blue }))))), actions: React.createElement(ActionPanel, { title: "Issue \u64CD\u4F5C" },
                React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u6253\u5F00 Issue", url: item.url, icon: Icon.Globe }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Issue \u94FE\u63A5", content: item.url, icon: Icon.Link }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Issue \u7F16\u53F7\u4E0E\u6807\u9898", content: `#${item.number} ${item.title}`, icon: Icon.CopyClipboard }),
                React.createElement(Action, { title: item.status === "open" ? "关闭此 Issue" : "重新开启此 Issue", icon: item.status === "open" ? Icon.XMarkCircle : Icon.Checkmark, onAction: async () => {
                        const nextStatus = item.status === "open" ? "closed" : "open";
                        const updated = { ...item, status: nextStatus };
                        onUpdate?.(updated);
                        await showToast(Toast.Style.Success, `Issue #${item.number} 已${nextStatus === "open" ? "开启" : "关闭"}`);
                    } })) }));
    }
    if (item.type === "notification") {
        const markdown = `
# ${item.title}

> **仓库**: \`${item.repo}\` | **原因**: \`${item.reason}\`

### 通知详情
- **关联类型**: \`${item.itemType.toUpperCase()}\`
- **读取状态**: \`${item.unread ? "未读 (Unread)" : "已读 (Read)"}\`
- **更新时间**: \`${item.updatedAt}\`
    `;
        return (React.createElement(Detail, { markdown: markdown, navigationTitle: "\u901A\u77E5\u8BE6\u60C5", metadata: React.createElement(Detail.Metadata, null,
                React.createElement(Detail.Metadata.Label, { title: "\u4ED3\u5E93", text: item.repo, icon: Icon.Document }),
                React.createElement(Detail.Metadata.Label, { title: "\u901A\u77E5\u539F\u56E0", text: item.reason, icon: Icon.Bell }),
                React.createElement(Detail.Metadata.Label, { title: "\u66F4\u65B0\u65F6\u95F4", text: item.updatedAt, icon: Icon.Clock }),
                React.createElement(Detail.Metadata.Separator, null),
                React.createElement(Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                    React.createElement(Detail.Metadata.TagList.Item, { text: item.unread ? "UNREAD" : "READ", color: item.unread ? Color.Blue : Color.SecondaryText }))), actions: React.createElement(ActionPanel, { title: "\u901A\u77E5\u64CD\u4F5C" },
                React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u5173\u8054\u9875\u9762", url: item.url, icon: Icon.Globe }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u901A\u77E5\u94FE\u63A5", content: item.url, icon: Icon.Link }),
                React.createElement(Action, { title: "\u6807\u4E3A\u5DF2\u8BFB", icon: Icon.Check, onAction: async () => {
                        const updated = { ...item, unread: false };
                        onUpdate?.(updated);
                        await showToast(Toast.Style.Success, "通知已标为已读");
                    } })) }));
    }
    if (item.type === "workflow") {
        const markdown = `
# ${item.name}

> **仓库**: \`${item.repo}\` | **分支**: \`${item.branch}\` | **提交**: \`${item.commitHash}\`

### 运行状态
- **触发事件**: \`${item.event}\`
- **执行时长**: \`${item.duration}\`
- **运行时间**: \`${item.runAt}\`
- **构建结果**: \`${item.status.toUpperCase()}\`
    `;
        return (React.createElement(Detail, { markdown: markdown, navigationTitle: item.name, metadata: React.createElement(Detail.Metadata, null,
                React.createElement(Detail.Metadata.Label, { title: "\u4ED3\u5E93", text: item.repo, icon: Icon.Document }),
                React.createElement(Detail.Metadata.Label, { title: "\u5206\u652F", text: item.branch, icon: Icon.Code }),
                React.createElement(Detail.Metadata.Label, { title: "Commit", text: item.commitHash, icon: Icon.Pin }),
                React.createElement(Detail.Metadata.Label, { title: "\u8017\u65F6", text: item.duration, icon: Icon.Clock }),
                React.createElement(Detail.Metadata.Separator, null),
                React.createElement(Detail.Metadata.TagList, { title: "\u7ED3\u679C" },
                    React.createElement(Detail.Metadata.TagList.Item, { text: item.status.toUpperCase(), color: item.status === "success"
                            ? Color.Green
                            : item.status === "in_progress"
                                ? Color.Yellow
                                : Color.Red }))), actions: React.createElement(ActionPanel, { title: "Workflow \u64CD\u4F5C" },
                React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u6253\u5F00 CI \u8BE6\u60C5", url: item.url, icon: Icon.Globe }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Workflow \u94FE\u63A5", content: item.url, icon: Icon.Link }),
                React.createElement(Action, { title: "\u91CD\u65B0\u8FD0\u884C CI \u6D41\u6C34\u7EBF (Re-run)", icon: Icon.Repeat, onAction: async () => {
                        const updated = {
                            ...item,
                            status: "in_progress",
                            runAt: "刚刚"
                        };
                        onUpdate?.(updated);
                        await showToast(Toast.Style.Success, "Workflow CI 已重新触发运行 (Re-run triggered)");
                    } })) }));
    }
    // Starred Repo
    const repo = item;
    const markdown = `
# ${repo.owner}/${repo.name}

> ${repo.description}

### 仓库指标
- **主要语言**: \`${repo.primaryLanguage}\`
- **Stars**: \`${repo.stars.toLocaleString()}\`
- **Forks**: \`${repo.forks.toLocaleString()}\`
- **最近活跃**: \`${repo.updatedAt}\`
  `;
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `${repo.owner}/${repo.name}`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u6240\u6709\u8005", text: repo.owner, icon: Icon.Pencil }),
            React.createElement(Detail.Metadata.Label, { title: "\u4E3B\u8981\u8BED\u8A00", text: repo.primaryLanguage, icon: Icon.Code }),
            React.createElement(Detail.Metadata.Label, { title: "Stars", text: String(repo.stars), icon: Icon.Star }),
            React.createElement(Detail.Metadata.Label, { title: "Forks", text: String(repo.forks), icon: Icon.Repeat })), actions: React.createElement(ActionPanel, { title: "\u4ED3\u5E93\u64CD\u4F5C" },
            React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u4ED3\u5E93", url: repo.url, icon: Icon.Globe }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u4ED3\u5E93\u94FE\u63A5", content: repo.url, icon: Icon.Link }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u514B\u9686\u547D\u4EE4", content: `git clone ${repo.url}.git`, icon: Icon.Terminal })) }));
}
/**
 * GitHub 仪表盘主命令 (现代纯正 TSX 模式)
 */
export default function GithubDashboardCommand() {
    const [items, setItems] = useState(isRealElectronHost() ? [] : SAMPLE_GITHUB_ITEMS);
    const [category, setCategory] = useState("all");
    const [subFilter, setSubFilter] = useState("all");
    const [searchText, setSearchText] = useState("");
    const [tokenConfig, setTokenConfig] = useState(null);
    const { push } = useNavigation();
    useEffect(() => {
        getGithubToken().then((cfg) => setTokenConfig(cfg));
    }, []);
    const handleItemUpdate = (updated) => {
        setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    };
    const handleRefresh = async () => {
        const cfg = await getGithubToken();
        setTokenConfig(cfg);
        await showToast(Toast.Style.Success, "GitHub 数据与凭据状态已刷新");
    };
    const filtered = filterGithubItems(items, searchText, category, subFilter);
    const prs = filtered.filter((i) => i.type === "pr");
    const issues = filtered.filter((i) => i.type === "issue");
    const notifications = filtered.filter((i) => i.type === "notification");
    const workflows = filtered.filter((i) => i.type === "workflow");
    const repos = filtered.filter((i) => i.type === "repo");
    const unreadNotifsCount = items.filter((i) => i.type === "notification" && i.unread).length;
    return (React.createElement(List, { navigationTitle: "GitHub \u4EEA\u8868\u76D8", searchBarPlaceholder: "\u641C\u7D22 Pull Requests\u3001Issues\u3001\u901A\u77E5\u3001Workflows\u3001Starred...", searchText: searchText, onSearchTextChange: (val) => setSearchText(val), searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u7B5B\u9009\u7C7B\u522B", value: category, onChange: (newVal) => {
                setCategory(newVal);
                setSubFilter("all");
            } },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u52A8\u6001", value: "all" }),
            React.createElement(List.Dropdown.Item, { title: "Pull Requests (\u62C9\u53D6\u8BF7\u6C42)", value: "pr" }),
            React.createElement(List.Dropdown.Item, { title: "Issues (\u95EE\u9898\u8FFD\u8E2A)", value: "issue" }),
            React.createElement(List.Dropdown.Item, { title: unreadNotifsCount > 0 ? `Notifications (${unreadNotifsCount} 条未读)` : "Notifications (通知)", value: "notification" }),
            React.createElement(List.Dropdown.Item, { title: "Workflow Runs (CI \u6D41\u6C34\u7EBF)", value: "workflow" }),
            React.createElement(List.Dropdown.Item, { title: "Starred Repos (\u6807\u661F\u9879\u76EE)", value: "repo" })), actions: React.createElement(ActionPanel, { title: "\u5168\u5C40\u64CD\u4F5C" },
            React.createElement(Action, { title: "\u5237\u65B0\u6570\u636E", icon: Icon.Repeat, onAction: handleRefresh }),
            React.createElement(Action.Push, { title: "\u914D\u7F6E Personal Access Token (BYOK)", icon: Icon.Key, target: () => React.createElement(GithubTokenForm, { onSaved: handleRefresh }) }),
            unreadNotifsCount > 0 && (React.createElement(Action, { title: "\u5168\u90E8\u901A\u77E5\u6807\u4E3A\u5DF2\u8BFB", icon: Icon.Check, onAction: async () => {
                    setItems((prev) => prev.map((it) => (it.type === "notification" ? { ...it, unread: false } : it)));
                    await showToast(Toast.Style.Success, "所有通知已全部标为已读");
                } }))) },
        prs.length > 0 && (React.createElement(List.Section, { title: `Pull Requests (${prs.length})` }, prs.map((pr) => (React.createElement(List.Item, { key: pr.id, id: pr.id, title: `#${pr.number} ${pr.title}`, subtitle: `${pr.repo} (${pr.branch})`, icon: pr.status === "open"
                ? Icon.Checkmark
                : pr.status === "merged"
                    ? Icon.Check
                    : pr.status === "draft"
                        ? Icon.Document
                        : Icon.XMarkCircle, accessories: [
                { text: `@${pr.author}` },
                {
                    text: pr.reviewStatus ? `${pr.status.toUpperCase()} [${pr.reviewStatus}]` : pr.status.toUpperCase(),
                    tag: pr.status
                },
                { text: pr.updatedAt }
            ], actions: React.createElement(ActionPanel, { title: pr.title },
                React.createElement(Action.Push, { title: "\u67E5\u770B PR \u8BE6\u60C5", icon: Icon.Eye, target: () => React.createElement(GithubDetailView, { item: pr, onUpdate: handleItemUpdate }) }),
                React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00", url: pr.url, icon: Icon.Globe }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 PR URL", content: pr.url, icon: Icon.Link }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5206\u652F\u540D\u79F0", content: pr.branch, icon: Icon.Code }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u68C0\u51FA\u547D\u4EE4", content: `git checkout ${pr.branch}`, icon: Icon.Terminal }),
                React.createElement(Action, { title: "\u6279\u51C6\u6B64 PR (Approve)", icon: Icon.Checkmark, onAction: async () => {
                        handleItemUpdate({ ...pr, reviewStatus: "APPROVED" });
                        await showToast(Toast.Style.Success, `PR #${pr.number} 已批准 (Approved)`);
                    } }),
                React.createElement(Action, { title: "\u5408\u5E76\u6B64 PR (Merge)", icon: Icon.Check, onAction: async () => {
                        handleItemUpdate({ ...pr, status: "merged" });
                        await showToast(Toast.Style.Success, `PR #${pr.number} 已成功合并 (Merged)`);
                    } }),
                React.createElement(Action.Push, { title: "\u914D\u7F6E Personal Access Token", icon: Icon.Key, target: () => React.createElement(GithubTokenForm, { onSaved: handleRefresh }) })) }))))),
        issues.length > 0 && (React.createElement(List.Section, { title: `Issues (${issues.length})` }, issues.map((issue) => (React.createElement(List.Item, { key: issue.id, id: issue.id, title: `#${issue.number} ${issue.title}`, subtitle: issue.repo, icon: issue.status === "open" ? Icon.ExclamationMark : Icon.Checkmark, accessories: [
                { text: `@${issue.author}` },
                { text: `${issue.commentsCount} 条回复` },
                { text: issue.updatedAt }
            ], actions: React.createElement(ActionPanel, { title: issue.title },
                React.createElement(Action.Push, { title: "\u67E5\u770B Issue \u8BE6\u60C5", icon: Icon.Eye, target: () => React.createElement(GithubDetailView, { item: issue, onUpdate: handleItemUpdate }) }),
                React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00", url: issue.url, icon: Icon.Globe }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Issue \u94FE\u63A5", content: issue.url, icon: Icon.Link }),
                React.createElement(Action, { title: issue.status === "open" ? "关闭此 Issue" : "重新开启此 Issue", icon: Icon.Checkmark, onAction: async () => {
                        const next = issue.status === "open" ? "closed" : "open";
                        handleItemUpdate({ ...issue, status: next });
                        await showToast(Toast.Style.Success, `Issue #${issue.number} 已${next === "open" ? "开启" : "关闭"}`);
                    } }),
                React.createElement(Action.Push, { title: "\u914D\u7F6E Personal Access Token", icon: Icon.Key, target: () => React.createElement(GithubTokenForm, { onSaved: handleRefresh }) })) }))))),
        notifications.length > 0 && (React.createElement(List.Section, { title: `Notifications (${notifications.length})` }, notifications.map((notif) => (React.createElement(List.Item, { key: notif.id, id: notif.id, title: notif.title, subtitle: `${notif.repo} · ${notif.reason}`, icon: notif.unread ? Icon.Bell : Icon.Check, accessories: [
                { text: notif.itemType.toUpperCase() },
                { text: notif.unread ? "未读" : "已读", tag: notif.unread ? "unread" : "read" },
                { text: notif.updatedAt }
            ], actions: React.createElement(ActionPanel, { title: notif.title },
                React.createElement(Action.Push, { title: "\u67E5\u770B\u901A\u77E5\u8BE6\u60C5", icon: Icon.Eye, target: () => React.createElement(GithubDetailView, { item: notif, onUpdate: handleItemUpdate }) }),
                React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00", url: notif.url, icon: Icon.Globe }),
                notif.unread && (React.createElement(Action, { title: "\u6807\u4E3A\u5DF2\u8BFB", icon: Icon.Check, onAction: async () => {
                        handleItemUpdate({ ...notif, unread: false });
                        await showToast(Toast.Style.Success, "该通知已标为已读");
                    } })),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u901A\u77E5\u94FE\u63A5", content: notif.url, icon: Icon.Link }),
                React.createElement(Action.Push, { title: "\u914D\u7F6E Personal Access Token", icon: Icon.Key, target: () => React.createElement(GithubTokenForm, { onSaved: handleRefresh }) })) }))))),
        workflows.length > 0 && (React.createElement(List.Section, { title: `Workflow Runs (${workflows.length})` }, workflows.map((wf) => (React.createElement(List.Item, { key: wf.id, id: wf.id, title: wf.name, subtitle: `${wf.repo} (${wf.branch} @ ${wf.commitHash})`, icon: wf.status === "success"
                ? Icon.Check
                : wf.status === "in_progress"
                    ? Icon.Clock
                    : Icon.XMarkCircle, accessories: [
                { text: wf.status.toUpperCase() },
                { text: wf.duration },
                { text: wf.runAt }
            ], actions: React.createElement(ActionPanel, { title: wf.name },
                React.createElement(Action.Push, { title: "\u67E5\u770B\u8FD0\u884C\u8BE6\u60C5", icon: Icon.Eye, target: () => React.createElement(GithubDetailView, { item: wf, onUpdate: handleItemUpdate }) }),
                React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00", url: wf.url, icon: Icon.Globe }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8FD0\u884C\u94FE\u63A5", content: wf.url, icon: Icon.Link }),
                React.createElement(Action, { title: "\u91CD\u65B0\u8FD0\u884C CI \u6D41\u6C34\u7EBF (Re-run)", icon: Icon.Repeat, onAction: async () => {
                        handleItemUpdate({ ...wf, status: "in_progress", runAt: "刚刚" });
                        await showToast(Toast.Style.Success, "Workflow CI 已重新触发运行 (Re-run triggered)");
                    } })) }))))),
        repos.length > 0 && (React.createElement(List.Section, { title: `Starred Repositories (${repos.length})` }, repos.map((repo) => (React.createElement(List.Item, { key: repo.id, id: repo.id, title: `${repo.owner}/${repo.name}`, subtitle: repo.description, icon: Icon.Star, accessories: [
                { text: repo.primaryLanguage },
                { text: `★ ${repo.stars.toLocaleString()}` }
            ], actions: React.createElement(ActionPanel, { title: repo.name },
                React.createElement(Action.Push, { title: "\u67E5\u770B\u4ED3\u5E93\u8BE6\u60C5", icon: Icon.Eye, target: () => React.createElement(GithubDetailView, { item: repo }) }),
                React.createElement(Action.OpenInBrowser, { title: "\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00", url: repo.url, icon: Icon.Globe }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u4ED3\u5E93\u94FE\u63A5", content: repo.url, icon: Icon.Link }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Clone \u547D\u4EE4", content: `git clone ${repo.url}.git`, icon: Icon.Terminal })) })))))));
}
