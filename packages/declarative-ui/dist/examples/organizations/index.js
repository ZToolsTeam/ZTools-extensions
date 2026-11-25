import React from "../../index.js";
import { List, ActionPanel, Action, Icon, Color, showToast, Toast, Clipboard } from "../../index.js";
import { useState, useEffect, useMemo } from "../../runtime/hooks.js";
import { INITIAL_ORGANIZATION, getOrganizationData, saveOrganizationData, generateInviteLink, removeOrgMember, testTriggerWebhook, getAvailableWorkspaces, switchWorkspace, syncTeamAssets } from "./organizations-storage.js";
export * from "./types.js";
export * from "./organizations-storage.js";
/**
 * M1.5-28: Raycast for Teams / Organizations 商业与团队协同工作台
 */
export default function OrganizationsCommand() {
    const [org, setOrg] = useState(INITIAL_ORGANIZATION);
    const [isLoading, setIsLoading] = useState(true);
    const [filterType, setFilterType] = useState("all");
    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const loaded = await getOrganizationData();
                if (isMounted) {
                    setOrg(loaded);
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
    const handleCopyInvite = async () => {
        const link = generateInviteLink(org);
        await Clipboard.copy(link);
        await showToast(Toast.Style.Success, "邀请链接已复制", link);
    };
    const handleSwitchWorkspace = async (mode) => {
        await showToast(Toast.Style.Animated, `正在切换工作区至: ${mode === "personal" ? "个人工作区" : "团队企业空间"}...`);
        const updated = await switchWorkspace(mode);
        setOrg({ ...updated });
        await showToast(Toast.Style.Success, `已进入 ${mode === "personal" ? "个人本地空间" : org.name}`);
    };
    const handleSyncAssets = async () => {
        await showToast(Toast.Style.Animated, "正在通过 E2EE 通道同步团队资产...");
        const res = await syncTeamAssets();
        await showToast(Toast.Style.Success, "同步完成", res.message);
    };
    const handleTestWebhook = async (wh) => {
        await showToast(Toast.Style.Animated, `正在测试触发 Webhook: ${wh.name}...`);
        const res = await testTriggerWebhook(wh);
        if (res.success) {
            await showToast(Toast.Style.Success, res.message);
        }
        else {
            await showToast(Toast.Style.Failure, res.message);
        }
    };
    const handleRemoveMember = async (mem) => {
        if (mem.role === "owner") {
            await showToast(Toast.Style.Failure, "无法移除组织所有者 (Owner 保护机制生效)");
            return;
        }
        const updated = await removeOrgMember(mem.id);
        setOrg({ ...updated });
        await showToast(Toast.Style.Success, `已移除成员: ${mem.name}`);
    };
    const workspaces = useMemo(() => {
        return getAvailableWorkspaces();
    }, [org.activeWorkspace]);
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchBarPlaceholder: "\u641C\u7D22\u5DE5\u4F5C\u533A\u3001\u56E2\u961F\u5171\u4EAB\u77ED\u8BED\u3001\u5FEB\u6377\u6307\u4EE4\u3001\u79C1\u6709\u63D2\u4EF6\u4E0E\u5408\u89C4\u5BA1\u8BA1...", searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u7B5B\u9009\u89C6\u56FE", value: filterType, onChange: setFilterType },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u666F\u534F\u540C\u5927\u76D8 (Overview)", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u5DE5\u4F5C\u533A\u5207\u6362\u5668 (Workspaces)", value: "workspaces", icon: Icon.AppWindow }),
            React.createElement(List.Dropdown.Item, { title: "\u56E2\u961F\u5171\u4EAB\u6307\u4EE4 (Quicklinks)", value: "quicklinks", icon: Icon.Link }),
            React.createElement(List.Dropdown.Item, { title: "\u56E2\u961F\u5171\u4EAB\u77ED\u8BED (Snippets)", value: "snippets", icon: Icon.Document }),
            React.createElement(List.Dropdown.Item, { title: "\u4F01\u4E1A\u79C1\u6709\u6269\u5C55 (Extensions)", value: "extensions", icon: Icon.Folder }),
            React.createElement(List.Dropdown.Item, { title: "\u5408\u89C4\u5BA1\u8BA1\u4E0E\u6743\u9650 (Compliance)", value: "compliance", icon: Icon.Shield }),
            React.createElement(List.Dropdown.Item, { title: "\u56E2\u961F\u67B6\u6784\u6210\u5458 (Members)", value: "members", icon: Icon.Star }),
            React.createElement(List.Dropdown.Item, { title: "Webhooks \u5BA1\u8BA1\u901A\u77E5", value: "webhooks", icon: Icon.ExclamationMark })) },
        (filterType === "all" || filterType === "workspaces") && (React.createElement(List.Section, { title: "\u5DE5\u4F5C\u533A\u534F\u540C\u73AF\u5883 (Workspaces)" }, workspaces.map((ws) => (React.createElement(List.Item, { key: ws.id, id: ws.id, title: ws.name, subtitle: ws.description, icon: ws.isActive ? Icon.Checkmark : Icon.AppWindow, accessories: [
                { text: ws.badge },
                { text: ws.isActive ? "当前活跃" : "点击切换" }
            ], detail: React.createElement(List.Item.Detail, { markdown: `### 🏢 ${ws.name}\n\n${ws.description}\n\n- **工作区模式**: \`${ws.mode}\`\n- **活跃状态**: ${ws.isActive ? "🟢 正在使用" : "⚪ 未激活"}\n- **协作成员**: ${ws.memberCount} 人\n- **端到端加密**: ${ws.isE2eeEncrypted ? "✅ Argon2id + AES-256-GCM 本地加密隔离" : "未加密"}\n\n> **说明**: 切换工作区后，命令面板与搜索结果将仅展示当前工作区授权的资产与私有插件。`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5DE5\u4F5C\u533A\u540D\u79F0", text: ws.name, icon: Icon.AppWindow }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7A7A\u95F4\u6A21\u5F0F", text: ws.mode, icon: Icon.Key }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6210\u5458\u6570\u91CF", text: `${ws.memberCount} 人`, icon: Icon.Shield }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                        React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: ws.isActive ? "活跃工作区" : "可切换", color: ws.isActive ? Color.Green : Color.SecondaryText }))) }), actions: React.createElement(ActionPanel, null,
                !ws.isActive && (React.createElement(Action, { title: `切换至「${ws.name}」`, icon: Icon.Check, onAction: () => handleSwitchWorkspace(ws.mode) })),
                React.createElement(Action, { title: "\u89E6\u53D1\u56E2\u961F\u8D44\u4EA7\u540C\u6B65", icon: Icon.Repeat, onAction: handleSyncAssets }),
                React.createElement(Action, { title: "\u590D\u5236\u56E2\u961F\u9080\u8BF7\u94FE\u63A5", icon: Icon.Link, onAction: handleCopyInvite })) }))))),
        filterType === "all" && (React.createElement(List.Section, { title: "\u7EC4\u7EC7\u4FE1\u606F\u6982\u89C8 (Organization Overview)" },
            React.createElement(List.Item, { id: "org_header", title: org.name, subtitle: org.description, icon: Icon.List, accessories: [{ text: `SLUG: ${org.slug}` }], detail: React.createElement(List.Item.Detail, { markdown: `### 🏢 ${org.name} (ZTools for Teams)\n\n${org.description || "无详细描述"}\n\n- **组织标识 (Slug)**: \`${org.slug}\`\n- **当前空间**: \`${org.activeWorkspace === "personal" ? "个人工作区" : "企业团队空间"}\`\n- **团队成员**: ${org.members.length} 人\n- **共享指令**: ${(org.sharedQuicklinks || []).length} 条\n- **共享短语**: ${(org.sharedSnippets || []).length} 条\n- **私有扩展**: ${(org.privateExtensions || []).length} 款\n- **生效 Webhooks**: ${(org.webhooks || []).filter((w) => w.active).length} 个\n\n> 团队私有扩展与短语全部采用端到端密文通道同步，杜绝企业核心数据上报。` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: "\u590D\u5236\u56E2\u961F\u52A0\u5165\u9080\u8BF7\u94FE\u63A5", icon: Icon.Link, onAction: handleCopyInvite }),
                    React.createElement(Action, { title: "\u540C\u6B65\u56E2\u961F\u5171\u4EAB\u8D44\u4EA7", icon: Icon.Repeat, onAction: handleSyncAssets })) }))),
        (filterType === "all" || filterType === "quicklinks") && (React.createElement(List.Section, { title: `团队共享快捷指令 (${(org.sharedQuicklinks || []).length})` }, (org.sharedQuicklinks || []).map((ql) => (React.createElement(List.Item, { key: ql.id, id: ql.id, title: ql.name, subtitle: ql.url, icon: Icon.Link, accessories: [
                { text: `别名: ${ql.alias || "无"}` },
                { text: ql.category }
            ], detail: React.createElement(List.Item.Detail, { markdown: `### 🔗 ${ql.name}\n\n- **目标 URL**: \`${ql.url}\`\n- **快捷别名**: \`${ql.alias || "未配置"}\`\n- **分类**: \`${ql.category}\`\n- **维护者**: \`${ql.author}\`\n- **更新时间**: \`${ql.updatedAt}\`\n\n> 团队指令会自动同步至全员启动器，在搜索栏输入别名即可毫秒直达。`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6307\u4EE4\u540D\u79F0", text: ql.name, icon: Icon.Link }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u522B\u540D", text: ql.alias || "无", icon: Icon.Terminal }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u4F5C\u8005", text: ql.author, icon: Icon.Shield }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u5206\u7C7B" },
                        React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: ql.category, color: Color.Blue }))) }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action.OpenInBrowser, { url: ql.url, title: "\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00\u6307\u4EE4" }),
                React.createElement(Action, { title: "\u590D\u5236\u76EE\u6807\u94FE\u63A5", icon: Icon.Clipboard, onAction: async () => {
                        await Clipboard.copy(ql.url);
                        await showToast(Toast.Style.Success, `已复制链接: ${ql.url}`);
                    } }),
                ql.alias && (React.createElement(Action, { title: "\u590D\u5236\u5FEB\u6377\u522B\u540D", icon: Icon.Terminal, onAction: async () => {
                        await Clipboard.copy(ql.alias);
                        await showToast(Toast.Style.Success, `已复制别名: ${ql.alias}`);
                    } }))) }))))),
        (filterType === "all" || filterType === "snippets") && (React.createElement(List.Section, { title: `团队共享快捷短语 (${(org.sharedSnippets || []).length})` }, (org.sharedSnippets || []).map((snip) => (React.createElement(List.Item, { key: snip.id, id: snip.id, title: snip.name, subtitle: `触发词: :${snip.keyword}`, icon: Icon.Document, accessories: [{ text: `作者: ${snip.author}` }], detail: React.createElement(List.Item.Detail, { markdown: `### 📝 ${snip.name}\n\n**触发词**: \`:${snip.keyword}\`\n\n\`\`\`\n${snip.content}\n\`\`\`\n\n- **作者**: \`${snip.author}\`\n- **标签**: \`${(snip.tags || []).join(", ") || "无"}\`\n- **更新时间**: \`${snip.updatedAt}\`` }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u590D\u5236\u77ED\u8BED\u5185\u5BB9", icon: Icon.Clipboard, onAction: async () => {
                        await Clipboard.copy(snip.content);
                        await showToast(Toast.Style.Success, `短语「${snip.name}」已复制`);
                    } })) }))))),
        (filterType === "all" || filterType === "extensions") && (React.createElement(List.Section, { title: `企业私有扩展目录 (${(org.privateExtensions || []).length})` }, (org.privateExtensions || []).map((ext) => (React.createElement(List.Item, { key: ext.id, id: ext.id, title: ext.name, subtitle: ext.description, icon: Icon.Folder, accessories: [
                { text: ext.installed ? "已部署" : "未部署" },
                { text: `v${ext.version}` }
            ], detail: React.createElement(List.Item.Detail, { markdown: `### 📦 ${ext.name} (v${ext.version})\n\n${ext.description}\n\n- **内部插件标识**: \`${ext.id}\`\n- **维护作者**: \`${ext.author}\`\n- **申请权限**: \`${(ext.permissions || ["basic"]).join(", ")}\`\n- **安全状态**: ${ext.securityAuditPassed ? "✅ 组织 CI AST 预检通过，具备内部专属签名" : "待审计"}\n\n> 私有扩展仅向组织内成员分发，支持 GitOps 内部流水线自动化部署。` }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: ext.installed ? "已安装到本地工作区" : "一键部署此私有扩展", icon: Icon.Check, onAction: async () => {
                        ext.installed = !ext.installed;
                        await saveOrganizationData({ ...org });
                        await showToast(Toast.Style.Success, ext.installed ? `私有扩展「${ext.name}」已部署就绪` : `已卸载「${ext.name}」`);
                    } })) }))))),
        (filterType === "all" || filterType === "compliance") && (React.createElement(List.Section, { title: `组织级合规审计与策略 (${(org.complianceAuditLogs || []).length})` }, (org.complianceAuditLogs || []).map((aud) => (React.createElement(List.Item, { key: aud.id, id: aud.id, title: aud.action, subtitle: `${aud.actor} • ${aud.resource}`, icon: aud.status === "allowed" ? Icon.Shield : Icon.ExclamationMark, accessories: [
                { text: aud.status.toUpperCase() },
                { text: aud.timestamp.slice(11, 16) }
            ], detail: React.createElement(List.Item.Detail, { markdown: `### 🛡️ 审计事件: ${aud.action}\n\n- **状态**: \`${aud.status.toUpperCase()}\` (${aud.status === "allowed" ? "通过" : "拦截"})\n- **操作主体 (Actor)**: \`${aud.actor}\`\n- **受控资源 (Resource)**: \`${aud.resource}\`\n- **发生时间**: \`${aud.timestamp}\`\n- **来源 IP**: \`${aud.ipAddress}\`\n\n#### 审计详情记录\n\`\`\`\n${aud.details}\n\`\`\`\n\n> **企业安全策略**: 严禁向外部公有云泄露代码，私有扩展强制 AST 安全扫描，E2EE 密文校验和审计留存 180 天。` }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u590D\u5236\u5BA1\u8BA1\u8BE6\u60C5", icon: Icon.Clipboard, onAction: async () => {
                        await Clipboard.copy(JSON.stringify(aud, null, 2));
                        await showToast(Toast.Style.Success, "审计日志详情已复制");
                    } })) }))))),
        (filterType === "all" || filterType === "members") && (React.createElement(List.Section, { title: `团队成员架构 (${org.members.length})` }, org.members.map((mem) => (React.createElement(List.Item, { key: mem.id, id: mem.id, title: mem.name, subtitle: mem.email, icon: mem.role === "owner" ? Icon.Star : Icon.Shield, accessories: [{ text: mem.role.toUpperCase() }], detail: React.createElement(List.Item.Detail, { markdown: `### 👤 ${mem.name}\n\n- **邮箱**: \`${mem.email}\`\n- **组织角色**: \`${mem.role.toUpperCase()}\`\n- **加入时间**: \`${mem.joinedAt}\`\n\n> **权限管控**: ${mem.role === "owner" ? "组织所有者 (具备 Owner 安全保护)" : mem.role === "admin" ? "组织管理员 (具备扩展审核与成员管理权)" : "研发协作者"}` }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u590D\u5236\u56E2\u961F\u52A0\u5165\u9080\u8BF7\u94FE\u63A5", icon: Icon.Link, onAction: handleCopyInvite }),
                mem.role !== "owner" && (React.createElement(Action, { title: "\u79FB\u9664\u6210\u5458", icon: Icon.Trash, onAction: () => handleRemoveMember(mem) }))) }))))),
        (filterType === "all" || filterType === "webhooks") && (React.createElement(List.Section, { title: `Webhooks 审计通知 (${(org.webhooks || []).length})` }, (org.webhooks || []).map((wh) => (React.createElement(List.Item, { key: wh.id, id: wh.id, title: wh.name, subtitle: wh.url, icon: wh.active ? Icon.ExclamationMark : Icon.Circle, accessories: [{ text: wh.active ? "活跃" : "已暂停" }], detail: React.createElement(List.Item.Detail, { markdown: `### 🔔 ${wh.name}\n\n- **目标 Webhook URL**: \`${wh.url}\`\n- **监听事件**: \`${(wh.eventTypes || []).join(", ")}\`\n- **创建日期**: \`${wh.createdAt}\`\n- **最后触发状态**: \`${wh.lastStatus || "未触发"}\`${wh.lastError ? `\n- **异常原因**: \`${wh.lastError}\`` : ""}\n\n> 支持发送钉钉、飞书、企业微信群机器人或标准 HTTP JSON Webhook。` }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: "\u6D4B\u8BD5\u89E6\u53D1 Webhook (Test Ping)", icon: Icon.Play, onAction: () => handleTestWebhook(wh) })) })))))));
}
