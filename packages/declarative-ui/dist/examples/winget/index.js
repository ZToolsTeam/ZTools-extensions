import { isRealElectronHost } from '../shared/native-ipc.js';
import React from "../../index.js";
import { List, Detail, ActionPanel, Action, Icon, Color, showToast, Toast, useNavigation } from "../../index.js";
import { useState } from "../../runtime/hooks.js";
import { SAMPLE_WINGET_PACKAGES, filterWingetPackages, installWingetPackage, upgradeWingetPackage, uninstallWingetPackage } from "./packages.js";
export * from "./packages.js";
/**
 * 查看软件包详情视图 (现代纯正 TSX 模式)
 */
export function WingetDetailView({ pkg, onPackageUpdated }) {
    const installCmd = `winget install --id ${pkg.id} -e --accept-package-agreements --accept-source-agreements`;
    const upgradeCmd = `winget upgrade --id ${pkg.id}`;
    const uninstallCmd = `winget uninstall --id ${pkg.id}`;
    const markdown = `
# ${pkg.name}

> **包标识 ID**: \`${pkg.id}\` | **开发商**: \`${pkg.publisher}\`

### 软件简介
${pkg.description}

---

### 终端安装与管理命令
\`\`\`powershell
# 一键安装
${installCmd}

# 升级最新版本
${upgradeCmd}

# 卸载清理
${uninstallCmd}
\`\`\`

---

### 分类与标签
${pkg.tags.map((t) => `\`#${t}\``).join(" ")}
  `;
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `${pkg.name} (${pkg.id})`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u5305 ID", text: pkg.id, icon: Icon.Key }),
            React.createElement(Detail.Metadata.Label, { title: "\u5F00\u53D1\u5546", text: pkg.publisher, icon: Icon.Document }),
            React.createElement(Detail.Metadata.Label, { title: "\u5DF2\u5B89\u88C5\u7248\u672C", text: pkg.installedVersion || "未安装", icon: Icon.Pin }),
            React.createElement(Detail.Metadata.Label, { title: "\u6700\u65B0\u53EF\u7528\u7248\u672C", text: pkg.latestVersion, icon: Icon.Upload }),
            React.createElement(Detail.Metadata.Label, { title: "\u5F00\u6E90\u534F\u8BAE", text: pkg.license, icon: Icon.Document }),
            React.createElement(Detail.Metadata.Label, { title: "\u5206\u53D1\u6E90", text: pkg.source || "winget", icon: Icon.Globe }),
            React.createElement(Detail.Metadata.Label, { title: "\u67B6\u6784\u652F\u6301", text: pkg.architecture, icon: Icon.Terminal }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                React.createElement(Detail.Metadata.TagList.Item, { text: pkg.status === "installed"
                        ? "已是最新版本"
                        : pkg.status === "upgradable"
                            ? `可升级至 v${pkg.latestVersion}`
                            : "未安装", color: pkg.status === "installed"
                        ? Color.Green
                        : pkg.status === "upgradable"
                            ? Color.Yellow
                            : Color.SecondaryText }))), actions: React.createElement(ActionPanel, { title: "\u8F6F\u4EF6\u5305\u64CD\u4F5C" },
            pkg.status === "upgradable" && (React.createElement(Action, { title: "\u4E00\u952E\u5347\u7EA7\u5230\u6700\u65B0\u7248", icon: Icon.Upload, onAction: async () => {
                    const updated = {
                        ...pkg,
                        installedVersion: pkg.latestVersion,
                        status: "installed"
                    };
                    onPackageUpdated?.(updated);
                    await showToast(Toast.Style.Success, `已升级 ${pkg.name}`, `版本升级至 ${pkg.latestVersion}`);
                } })),
            pkg.status === "available" && (React.createElement(Action, { title: "\u4E00\u952E\u5B89\u88C5\u6B64\u8F6F\u4EF6", icon: Icon.Download, onAction: async () => {
                    const updated = {
                        ...pkg,
                        installedVersion: pkg.latestVersion,
                        status: "installed"
                    };
                    onPackageUpdated?.(updated);
                    await showToast(Toast.Style.Success, `已安装 ${pkg.name}`, `成功安装版本 ${pkg.latestVersion}`);
                } })),
            pkg.status !== "available" && (React.createElement(Action, { title: "\u5378\u8F7D\u6B64\u8F6F\u4EF6", icon: Icon.Trash, onAction: async () => {
                    const updated = {
                        ...pkg,
                        installedVersion: null,
                        status: "available"
                    };
                    onPackageUpdated?.(updated);
                    await showToast(Toast.Style.Success, `已卸载 ${pkg.name}`);
                } })),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Winget \u5B89\u88C5\u547D\u4EE4", content: installCmd, icon: Icon.CopyClipboard }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Winget \u5347\u7EA7\u547D\u4EE4", content: upgradeCmd, icon: Icon.Upload }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8F6F\u4EF6\u5305 ID", content: pkg.id, icon: Icon.Key }),
            React.createElement(Action.OpenInBrowser, { title: "\u8BBF\u95EE\u8F6F\u4EF6\u5B98\u65B9\u7F51\u7AD9", url: pkg.homepage, icon: Icon.Globe })) }));
}
/**
 * Winget 包管理器前端主命令 (现代纯正 TSX 模式)
 */
export default function WingetCommand() {
    const [packages, setPackages] = useState(isRealElectronHost() ? [] : SAMPLE_WINGET_PACKAGES);
    const [filterType, setFilterType] = useState("all");
    const [searchText, setSearchText] = useState("");
    const [isShowingDetail, setIsShowingDetail] = useState(true);
    const { push } = useNavigation();
    const filtered = filterWingetPackages(packages, searchText, filterType);
    const handleInstall = async (pkg) => {
        setPackages((prev) => installWingetPackage(prev, pkg.id));
        await showToast(Toast.Style.Success, `正在安装 ${pkg.name}`, `已执行 winget install --id ${pkg.id} -e`);
    };
    const handleUpgrade = async (pkg) => {
        setPackages((prev) => upgradeWingetPackage(prev, pkg.id));
        await showToast(Toast.Style.Success, `正在升级 ${pkg.name}`, `已升级到最新版 ${pkg.latestVersion}`);
    };
    const handleUninstall = async (pkg) => {
        setPackages((prev) => uninstallWingetPackage(prev, pkg.id));
        await showToast(Toast.Style.Success, `正在卸载 ${pkg.name}`, `已从系统移除该应用`);
    };
    return (React.createElement(List, { navigationTitle: "Windows \u5305\u7BA1\u7406\u5668 (Winget)", searchBarPlaceholder: "\u641C\u7D22\u5168\u7F51\u8F6F\u4EF6\u5305 (\u4F8B\u5982: VS Code, Git, Chrome, Node, Bun)...", searchText: searchText, isShowingDetail: isShowingDetail, onSearchTextChange: (val) => setSearchText(val), searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u7B5B\u9009\u8F6F\u4EF6\u5305\u72B6\u6001", value: filterType, onChange: (newVal) => setFilterType(newVal) },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u8F6F\u4EF6\u5305 (All Packages)", value: "all" }),
            React.createElement(List.Dropdown.Item, { title: "\u53EF\u66F4\u65B0 (Upgradable)", value: "upgradable" }),
            React.createElement(List.Dropdown.Item, { title: "\u5DF2\u5B89\u88C5 (Installed)", value: "installed" }),
            React.createElement(List.Dropdown.Item, { title: "\u672A\u5B89\u88C5 (Available)", value: "available" })), actions: React.createElement(ActionPanel, { title: "\u5168\u5C40\u64CD\u4F5C" },
            React.createElement(Action, { title: "\u5237\u65B0\u8F6F\u4EF6\u5305\u6E05\u5355", icon: Icon.Repeat, onAction: async () => {
                    await showToast(Toast.Style.Success, "已刷新 Winget 本地源清单");
                } }),
            React.createElement(Action, { title: isShowingDetail ? "隐藏详情侧边栏" : "显示详情侧边栏", icon: Icon.Sidebar, onAction: () => setIsShowingDetail((prev) => !prev) })) },
        React.createElement(List.Section, { title: `软件包列表 (${filtered.length})` }, filtered.map((pkg) => {
            const isUpgradable = pkg.status === "upgradable";
            const isInstalled = pkg.status === "installed";
            return (React.createElement(List.Item, { key: pkg.id, id: pkg.id, title: pkg.name, subtitle: `${pkg.id} (${pkg.publisher})`, icon: isInstalled ? Icon.Checkmark : isUpgradable ? Icon.Upload : Icon.Download, accessories: [
                    ...(isUpgradable
                        ? [
                            { text: `v${pkg.installedVersion} ➔ v${pkg.latestVersion}` },
                            { text: "可升级", tag: "upgradable" }
                        ]
                        : isInstalled
                            ? [{ text: `v${pkg.installedVersion}` }, { text: "已安装", tag: "installed" }]
                            : [{ text: `v${pkg.latestVersion}` }, { text: "未安装" }])
                ], detail: React.createElement(List.Item.Detail, { markdown: `# ${pkg.name}\n\n> ${pkg.description}\n\n---\n\n### 终端命令参考\n\`\`\`powershell\n# 一键安装\nwinget install --id ${pkg.id} -e\n\n# 升级最新版\nwinget upgrade --id ${pkg.id} -e\n\n# 卸载清理\nwinget uninstall --id ${pkg.id} -e\n\`\`\`\n\n### 官方网站\n[${pkg.homepage}](${pkg.homepage})`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8F6F\u4EF6\u5305 ID", text: pkg.id, icon: Icon.Key }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u53D1\u5E03\u8005", text: pkg.publisher, icon: Icon.Pencil }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6700\u65B0\u7248\u672C", text: pkg.latestVersion, icon: Icon.Check }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5DF2\u5B89\u88C5\u7248\u672C", text: pkg.installedVersion || "未安装", icon: Icon.Clock }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5F00\u6E90\u8BB8\u53EF\u8BC1", text: pkg.license, icon: Icon.Document }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5206\u53D1\u6E90", text: pkg.source || "winget", icon: Icon.Globe }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7CFB\u7EDF\u67B6\u6784", text: pkg.architecture, icon: Icon.Terminal }),
                        React.createElement(List.Item.Detail.Metadata.Separator, null),
                        React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                            React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: pkg.status === "installed"
                                    ? "已安装 (Installed)"
                                    : pkg.status === "upgradable"
                                        ? `可升级至 v${pkg.latestVersion}`
                                        : "可安装 (Available)", color: pkg.status === "installed"
                                    ? Color.Green
                                    : pkg.status === "upgradable"
                                        ? Color.Yellow
                                        : Color.SecondaryText }))) }), actions: React.createElement(ActionPanel, { title: pkg.name },
                    isUpgradable && (React.createElement(Action, { title: "\u4E00\u952E\u5347\u7EA7\u5230\u6700\u65B0\u7248", icon: Icon.Upload, onAction: () => handleUpgrade(pkg) })),
                    !isInstalled && !isUpgradable && (React.createElement(Action, { title: "\u4E00\u952E\u5B89\u88C5\u6B64\u8F6F\u4EF6", icon: Icon.Download, onAction: () => handleInstall(pkg) })),
                    (isInstalled || isUpgradable) && (React.createElement(Action, { title: "\u5378\u8F7D\u6B64\u8F6F\u4EF6", icon: Icon.Trash, onAction: () => handleUninstall(pkg) })),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Winget \u5B89\u88C5\u547D\u4EE4", content: `winget install --id ${pkg.id} -e`, icon: Icon.CopyClipboard }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Winget \u5347\u7EA7\u547D\u4EE4", content: `winget upgrade --id ${pkg.id} -e`, icon: Icon.Upload }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8F6F\u4EF6\u5305 ID", content: pkg.id, icon: Icon.Key }),
                    React.createElement(Action.OpenInBrowser, { title: "\u8BBF\u95EE\u8F6F\u4EF6\u5B98\u65B9\u7F51\u7AD9", url: pkg.homepage, icon: Icon.Globe }),
                    React.createElement(Action.Push, { title: "\u67E5\u770B\u5305\u8BE6\u7EC6\u7248\u672C\u63CF\u8FF0", icon: Icon.Eye, target: () => (React.createElement(WingetDetailView, { pkg: pkg, onPackageUpdated: (u) => setPackages((prev) => prev.map((p) => (p.id === u.id ? u : p))) })) })) }));
        }))));
}
