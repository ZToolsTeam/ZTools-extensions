/**
 * Homebrew (macOS Formulae & Casks 极客包管理工作台)
 *
 * 深度对齐 Raycast 官方 `brew` 套件（对标 Windows 端 `winget`）：
 * - 支持检索、安装、升级、卸载 Homebrew Formulae (CLI) 与 Casks (GUI 应用)
 * - 顶部 <List.Dropdown> 筛选：all / installed / outdated / formula / cask
 * - 对接主进程 `brew_exec` 安全受控通道（action: list | search | info | outdated | install | upgrade | uninstall | cleanup）
 */
import React from "../../index.js";
import { List, Detail, ActionPanel, Action, Icon, Color, Clipboard, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useEffect, useMemo } from "../../runtime/hooks.js";
import { callHostTransport, isRealElectronHost } from "../shared/native-ipc.js";
export const SAMPLE_HOMEBREW_PACKAGES = Object.freeze([
    {
        name: "ripgrep",
        fullName: "ripgrep",
        type: "formula",
        installedVersion: "14.1.0",
        latestVersion: "14.1.1",
        outdated: true,
        description: "Line-oriented search tool that recursively searches the current directory for a regex pattern",
        homepage: "https://github.com/BurntSushi/ripgrep",
        license: "MIT / Unlicense",
        tap: "homebrew/core",
        dependencies: ["pcre2"]
    },
    {
        name: "node",
        fullName: "node",
        type: "formula",
        installedVersion: "22.9.0",
        latestVersion: "22.9.0",
        outdated: false,
        description: "Platform built on V8 to build network applications",
        homepage: "https://nodejs.org/",
        license: "MIT",
        tap: "homebrew/core",
        dependencies: ["brotli", "c-ares", "icu4c", "libnghttp2", "libuv", "openssl@3"]
    },
    {
        name: "jq",
        fullName: "jq",
        type: "formula",
        installedVersion: "1.7.1",
        latestVersion: "1.7.1",
        outdated: false,
        description: "Lightweight and flexible command-line JSON processor",
        homepage: "https://jqlang.github.io/jq/",
        license: "MIT",
        tap: "homebrew/core",
        dependencies: ["oniguruma"]
    },
    {
        name: "visual-studio-code",
        fullName: "visual-studio-code",
        type: "cask",
        installedVersion: "1.94.0",
        latestVersion: "1.95.1",
        outdated: true,
        description: "Open-source code editor by Microsoft",
        homepage: "https://code.visualstudio.com/",
        license: "MIT",
        tap: "homebrew/cask",
        dependencies: []
    },
    {
        name: "iterm2",
        fullName: "iterm2",
        type: "cask",
        installedVersion: "3.5.5",
        latestVersion: "3.5.5",
        outdated: false,
        description: "Terminal emulator as alternative to Apple's Terminal app",
        homepage: "https://iterm2.com/",
        license: "GPL-2.0-or-later",
        tap: "homebrew/cask",
        dependencies: []
    },
    {
        name: "orbstack",
        fullName: "orbstack",
        type: "cask",
        latestVersion: "1.7.5",
        outdated: false,
        description: "Drop-in replacement for Docker Desktop on macOS (fast, light, native)",
        homepage: "https://orbstack.dev/",
        license: "Proprietary",
        tap: "homebrew/cask",
        dependencies: []
    },
    {
        name: "ffmpeg",
        fullName: "ffmpeg",
        type: "formula",
        latestVersion: "7.1",
        outdated: false,
        description: "Play, record, convert, and stream audio and video",
        homepage: "https://ffmpeg.org/",
        license: "GPL-2.0-or-later",
        tap: "homebrew/core",
        dependencies: ["dav1d", "flac", "lame", "libass", "libvorbis", "libvpx", "opus", "x264", "x265"]
    },
    {
        name: "SwitchAudioSource",
        fullName: "switchaudio-osx",
        type: "formula",
        installedVersion: "1.2.2",
        latestVersion: "1.2.2",
        outdated: false,
        description: "Change macOS audio source from the command-line",
        homepage: "https://github.com/deweller/switchaudio-osx",
        license: "MIT",
        tap: "homebrew/core",
        dependencies: []
    }
]);
export function getBrewCliCommand(action, pkg) {
    if (action === "cleanup") {
        return "brew cleanup --prune=all";
    }
    const pkgName = pkg?.name || "";
    const caskFlag = pkg?.type === "cask" ? " --cask" : "";
    return `brew ${action}${caskFlag} ${pkgName}`.trim();
}
export function filterHomebrewPackages(packages, query = "", category = "all") {
    const q = (query || "").trim().toLowerCase();
    return packages.filter((p) => {
        if (category === "installed" && !p.installedVersion)
            return false;
        if (category === "outdated" && !p.outdated)
            return false;
        if (category === "formula" && p.type !== "formula")
            return false;
        if (category === "cask" && p.type !== "cask")
            return false;
        if (!q)
            return true;
        return (p.name.toLowerCase().includes(q) ||
            p.fullName.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.tap.toLowerCase().includes(q));
    });
}
function parseBrewStdoutToPackages(stdout, action) {
    const lines = String(stdout || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !/^[-=]+$/.test(l) && !/^Name\s+Id\s+Version/i.test(l) && !/^==>/.test(l));
    const results = [];
    for (const line of lines) {
        const parts = line.split(/\s{2,}|\t+/).filter(Boolean);
        if (parts.length >= 2) {
            const name = parts[0].trim();
            const idOrVer = parts[1].trim();
            const ver = parts[2] ? parts[2].trim() : idOrVer;
            const availVer = parts[3] ? parts[3].trim() : ver;
            if (!name || name.length > 80)
                continue;
            results.push({
                name,
                fullName: parts.length >= 3 ? idOrVer : name,
                type: "formula",
                installedVersion: action === "search" ? undefined : ver,
                latestVersion: availVer || ver || "latest",
                outdated: Boolean(parts[3] && parts[3] !== ver && parts[3] !== "winget"),
                description: parts.length >= 3 ? `${name} (${idOrVer})` : `${name} — System Package`,
                homepage: "https://brew.sh",
                license: "System / Open Source",
                tap: parts[parts.length - 1] === "winget" ? "winget" : "system/packages",
                dependencies: []
            });
        }
        else {
            const tokens = line.split(/\s+/).filter(Boolean);
            const pkgName = tokens[0] || "";
            const version = tokens[1] || "latest";
            if (!pkgName || pkgName.length > 80)
                continue;
            results.push({
                name: pkgName,
                fullName: pkgName,
                type: "formula",
                installedVersion: action === "search" ? undefined : version,
                latestVersion: tokens[2] || version,
                outdated: Boolean(tokens[2] && tokens[2] !== version),
                description: `Installed package: ${pkgName}`,
                homepage: "https://brew.sh",
                license: "Open Source",
                tap: "homebrew/core",
                dependencies: []
            });
        }
    }
    return results;
}
/**
 * 调用主进程 `brew_exec` 安全受控通道执行 Homebrew / 本机包管理器操作
 */
export async function executeHomebrewAction(action, options = {}, hostOverride) {
    const pkgName = (options.pkg || options.query || "").trim();
    const isCask = Boolean(options.cask);
    if (["install", "upgrade", "uninstall", "info"].includes(action) &&
        (!pkgName || /[;&|`$<>]/.test(pkgName))) {
        return {
            ok: false,
            message: "INVALID_PACKAGE_NAME: 非法或空的软件包名称"
        };
    }
    const realHost = isRealElectronHost(hostOverride);
    if (hostOverride || realHost) {
        const brewParams = {
            action,
            cask: isCask
        };
        if (pkgName) {
            brewParams.pkg = pkgName;
        }
        if (options.query) {
            brewParams.query = options.query;
        }
        const res = await callHostTransport("brew_exec", brewParams, hostOverride);
        if (res.ok && res.data !== undefined) {
            const d = res.data;
            const rawList = Array.isArray(d)
                ? d
                : Array.isArray(d?.items)
                    ? d.items
                    : Array.isArray(d?.packages)
                        ? d.packages
                        : Array.isArray(d?.formulae)
                            ? d.formulae
                            : null;
            const stdoutStr = typeof d === "string"
                ? d
                : typeof d?.stdout === "string"
                    ? d.stdout
                    : typeof d?.output === "string"
                        ? d.output
                        : undefined;
            let mappedPackages = rawList
                ? rawList.map((item) => {
                    const nameStr = String(item.name || item.id || item.token || "package");
                    const installedVer = item.installedVersion ||
                        item.installed_version ||
                        (action !== "search" ? item.version : undefined) ||
                        undefined;
                    const latestVer = String(item.latestVersion ||
                        item.availableVersion ||
                        item.version ||
                        installedVer ||
                        "latest");
                    return {
                        name: nameStr,
                        fullName: String(item.fullName || item.full_name || item.id || nameStr),
                        type: item.type === "cask" || item.cask || item.isCask ? "cask" : "formula",
                        installedVersion: installedVer ? String(installedVer) : undefined,
                        latestVersion: latestVer,
                        outdated: Boolean(item.outdated ||
                            (installedVer &&
                                item.availableVersion &&
                                String(item.availableVersion) !== String(installedVer))),
                        description: String(item.description ||
                            item.desc ||
                            item.publisher ||
                            `${nameStr} (${item.id || item.source || "System Package"})`),
                        homepage: String(item.homepage || "https://brew.sh"),
                        license: String(item.license || "OSI Approved"),
                        tap: String(item.tap ||
                            item.source ||
                            (item.type === "cask" ? "homebrew/cask" : "homebrew/core")),
                        dependencies: Array.isArray(item.dependencies)
                            ? item.dependencies.map(String)
                            : []
                    };
                })
                : undefined;
            // 只有宿主没给结构化列表时才解析纯文本输出；空数组表示确实没有软件包。
            // JSON 文本（list 走 brew info --json）不能按行解析，否则会把 "{"、"formulae": 当成软件包。
            if (!rawList && stdoutStr && !/^\s*[[{]/.test(stdoutStr)) {
                const parsedFromStdout = parseBrewStdoutToPackages(stdoutStr, action);
                if (parsedFromStdout.length > 0) {
                    mappedPackages = parsedFromStdout;
                }
            }
            return {
                ok: true,
                message: String(d?.message || `brew ${action} 执行成功`),
                packages: mappedPackages ?? (realHost ? [] : undefined),
                output: stdoutStr
            };
        }
        if (!res.ok) {
            // brew search 搜不到时以退出码 1 结束（"No formulae or casks found"），这是空结果而不是失败
            if (action === "search" && /No (?:formulae|casks|formulae or casks) found/i.test(res.error || "")) {
                return { ok: true, message: "没有找到匹配的软件包", packages: [] };
            }
            return {
                ok: false,
                message: res.error || `brew ${action} 执行失败`,
                packages: realHost ? [] : undefined
            };
        }
    }
    if (action === "list" || action === "search" || action === "outdated") {
        return {
            ok: true,
            message: `已获取 Homebrew 列表 (${action})`,
            packages: filterHomebrewPackages(SAMPLE_HOMEBREW_PACKAGES, pkgName, action === "outdated" ? "outdated" : "all")
        };
    }
    if (action === "cleanup") {
        return {
            ok: true,
            message: "已清理 Homebrew 旧版本缓存与残留包 (brew cleanup)"
        };
    }
    return {
        ok: true,
        message: `已完成 brew ${action}${isCask ? " --cask" : ""} ${pkgName}`
    };
}
export async function searchBrewPackages(query = "", category = "all", hostOverride) {
    const action = category === "outdated" ? "outdated" : query.trim() ? "search" : "list";
    const res = await executeHomebrewAction(action, { query: query.trim(), pkg: query.trim() }, hostOverride);
    if (res.packages) {
        return filterHomebrewPackages(res.packages, query, category);
    }
    if (isRealElectronHost(hostOverride)) {
        return [];
    }
    return filterHomebrewPackages(SAMPLE_HOMEBREW_PACKAGES, query, category);
}
export const installBrewPackage = (pkg, cask = false, hostOverride) => executeHomebrewAction("install", { pkg, cask }, hostOverride);
export const upgradeBrewPackage = (pkg, cask = false, hostOverride) => executeHomebrewAction("upgrade", { pkg, cask }, hostOverride);
export const uninstallBrewPackage = (pkg, cask = false, hostOverride) => executeHomebrewAction("uninstall", { pkg, cask }, hostOverride);
export const runBrewCleanup = (hostOverride) => executeHomebrewAction("cleanup", {}, hostOverride);
export const runBrewDoctor = (hostOverride) => executeHomebrewAction("doctor", {}, hostOverride);
export function HomebrewDetailView({ pkg, onPackageMutated }) {
    const installCmd = getBrewCliCommand("install", pkg);
    const upgradeCmd = getBrewCliCommand("upgrade", pkg);
    const uninstallCmd = getBrewCliCommand("uninstall", pkg);
    const markdown = [
        `# 🍺 ${pkg.name} ${pkg.type === "cask" ? "`Cask (GUI)`" : "`Formula (CLI)`"}`,
        `> **Tap 源**: \`${pkg.tap}\` &nbsp;|&nbsp; **开源协议**: \`${pkg.license}\``,
        `---`,
        `### 软件包简介`,
        pkg.description,
        `### 终端命令 (Terminal CLI)`,
        `\`\`\`zsh\n# 安装\n${installCmd}\n\n# 升级\n${upgradeCmd}\n\n# 卸载\n${uninstallCmd}\n\`\`\``,
        pkg.dependencies.length > 0
            ? `### 依赖树 (Dependencies)\n` + pkg.dependencies.map((d) => `\`${d}\``).join(" • ")
            : ""
    ]
        .filter(Boolean)
        .join("\n\n");
    return (React.createElement(Detail, { navigationTitle: `${pkg.name} — Homebrew`, markdown: markdown, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u540D\u79F0", text: pkg.fullName, icon: Icon.Terminal }),
            React.createElement(Detail.Metadata.Label, { title: "\u5305\u7C7B\u578B", text: pkg.type === "cask" ? "Cask (macOS App)" : "Formula (CLI)", icon: pkg.type === "cask" ? Icon.AppWindow : Icon.Code }),
            React.createElement(Detail.Metadata.Label, { title: "\u5DF2\u88C5\u7248\u672C", text: pkg.installedVersion || "未安装", icon: Icon.Pin }),
            React.createElement(Detail.Metadata.Label, { title: "\u6700\u65B0\u7248\u672C", text: pkg.latestVersion, icon: Icon.Upload }),
            React.createElement(Detail.Metadata.Label, { title: "Tap \u4ED3\u5E93", text: pkg.tap, icon: Icon.Folder }),
            React.createElement(Detail.Metadata.Label, { title: "\u8BB8\u53EF\u8BC1", text: pkg.license, icon: Icon.Document }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                React.createElement(Detail.Metadata.TagList.Item, { text: pkg.outdated
                        ? `可升级 -> ${pkg.latestVersion}`
                        : pkg.installedVersion
                            ? "已安装最新"
                            : "未安装", color: pkg.outdated
                        ? Color.Yellow
                        : pkg.installedVersion
                            ? Color.Green
                            : Color.SecondaryText }))), actions: React.createElement(ActionPanel, { title: `Homebrew: ${pkg.name}` },
            !pkg.installedVersion && (React.createElement(Action, { title: `安装 ${pkg.name} (${installCmd})`, icon: Icon.Download, onAction: async () => {
                    const res = await executeHomebrewAction("install", {
                        pkg: pkg.name,
                        cask: pkg.type === "cask"
                    });
                    if (res.ok) {
                        onPackageMutated?.({
                            ...pkg,
                            installedVersion: pkg.latestVersion,
                            outdated: false
                        });
                    }
                    await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.message);
                } })),
            pkg.outdated && (React.createElement(Action, { title: `升级至 v${pkg.latestVersion} (${upgradeCmd})`, icon: Icon.Upload, onAction: async () => {
                    const res = await executeHomebrewAction("upgrade", {
                        pkg: pkg.name,
                        cask: pkg.type === "cask"
                    });
                    if (res.ok) {
                        onPackageMutated?.({
                            ...pkg,
                            installedVersion: pkg.latestVersion,
                            outdated: false
                        });
                    }
                    await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.message);
                } })),
            React.createElement(Action, { title: "\u590D\u5236\u5B89\u88C5\u547D\u4EE4", icon: Icon.CopyClipboard, onAction: async () => {
                    await Clipboard.copy(installCmd);
                    await showToast(Toast.Style.Success, "已复制命令", installCmd);
                } }),
            React.createElement(Action.OpenInBrowser, { title: "\u6253\u5F00\u5B98\u65B9\u4E3B\u9875", url: pkg.homepage })) }));
}
export function HomebrewCommand() {
    const realHost = isRealElectronHost();
    const [packages, setPackages] = useState(() => realHost ? [] : [...SAMPLE_HOMEBREW_PACKAGES]);
    const [remoteSearchResults, setRemoteSearchResults] = useState([]);
    const [searchText, setSearchText] = useState("");
    const [category, setCategory] = useState("all");
    const [isLoading, setIsLoading] = useState(realHost);
    const [refreshTick, setRefreshTick] = useState(0);
    const { push } = useNavigation();
    useEffect(() => {
        let active = true;
        if (!realHost)
            return;
        setIsLoading(true);
        executeHomebrewAction("list")
            .then((res) => {
            if (!active)
                return;
            if (!res.ok)
                throw new Error(res.message || "无法读取 Homebrew 软件包");
            setPackages(res.packages || []);
            setIsLoading(false);
        })
            .catch((error) => {
            if (!active)
                return;
            setIsLoading(false);
            void showToast({ style: Toast.Style.Failure, title: "无法读取 Homebrew 软件包", message: error instanceof Error ? error.message : String(error) });
        });
        return () => {
            active = false;
        };
    }, [realHost, refreshTick]);
    // 当用户在搜索框输入关键词时，触发真实远程搜索 (brew_exec action: 'search')
    useEffect(() => {
        let active = true;
        const q = searchText.trim();
        if (!realHost || q.length < 2) {
            setRemoteSearchResults([]);
            return;
        }
        const timer = setTimeout(() => {
            setIsLoading(true);
            executeHomebrewAction("search", { query: q, pkg: q })
                .then((res) => {
                if (!active)
                    return;
                if (!res.ok)
                    throw new Error(res.message || "Homebrew 搜索失败");
                setRemoteSearchResults(res.packages || []);
                setIsLoading(false);
            })
                .catch((error) => {
                if (!active)
                    return;
                setIsLoading(false);
                setRemoteSearchResults([]);
                void showToast({ style: Toast.Style.Failure, title: "Homebrew 搜索失败", message: error instanceof Error ? error.message : String(error) });
            });
        }, 260);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [searchText, realHost]);
    const displayedPackages = useMemo(() => {
        const localFiltered = filterHomebrewPackages(packages, searchText, category);
        if (remoteSearchResults.length === 0)
            return localFiltered;
        const seen = new Set(localFiltered.map((p) => p.name.toLowerCase()));
        const merged = [...localFiltered];
        for (const remotePkg of filterHomebrewPackages(remoteSearchResults, searchText, category)) {
            if (!seen.has(remotePkg.name.toLowerCase())) {
                seen.add(remotePkg.name.toLowerCase());
                merged.push(remotePkg);
            }
        }
        return merged;
    }, [packages, remoteSearchResults, searchText, category]);
    const updatePackageState = (updated) => {
        setPackages((prev) => {
            const exists = prev.some((p) => p.name === updated.name);
            return exists ? prev.map((p) => (p.name === updated.name ? updated : p)) : [updated, ...prev];
        });
        setRemoteSearchResults((prev) => prev.map((p) => (p.name === updated.name ? updated : p)));
    };
    const handleInstall = async (pkg) => {
        await showToast(Toast.Style.Animated, `正在安装 ${pkg.name}...`);
        const res = await executeHomebrewAction("install", {
            pkg: pkg.name,
            cask: pkg.type === "cask"
        });
        if (res.ok) {
            updatePackageState({
                ...pkg,
                installedVersion: pkg.latestVersion,
                outdated: false
            });
        }
        await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.ok ? `已安装 ${pkg.name}` : "安装失败", res.message);
    };
    const handleUpgrade = async (pkg) => {
        await showToast(Toast.Style.Animated, `正在升级 ${pkg.name} 至 v${pkg.latestVersion}...`);
        const res = await executeHomebrewAction("upgrade", {
            pkg: pkg.name,
            cask: pkg.type === "cask"
        });
        if (res.ok) {
            updatePackageState({
                ...pkg,
                installedVersion: pkg.latestVersion,
                outdated: false
            });
        }
        await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.ok ? `已升级 ${pkg.name}` : "升级失败", res.message);
    };
    const handleUninstall = async (pkg) => {
        await showToast(Toast.Style.Animated, `正在卸载 ${pkg.name}...`);
        const res = await executeHomebrewAction("uninstall", {
            pkg: pkg.name,
            cask: pkg.type === "cask"
        });
        if (res.ok) {
            updatePackageState({
                ...pkg,
                installedVersion: undefined,
                outdated: false
            });
        }
        await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.ok ? `已卸载 ${pkg.name}` : "卸载失败", res.message);
    };
    const handleCleanup = async () => {
        await showToast(Toast.Style.Animated, "正在执行 brew cleanup 清理旧版本缓存...");
        const res = await executeHomebrewAction("cleanup");
        await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.message);
    };
    const [selectedPkgName, setSelectedPkgName] = useState("");
    const installedCount = packages.filter((p) => Boolean(p.installedVersion)).length;
    const outdatedCount = packages.filter((p) => p.outdated).length;
    const activePkg = displayedPackages.find((p) => p.name === selectedPkgName) || displayedPackages[0] || null;
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchBarPlaceholder: "\u641C\u7D22\u672C\u673A\u5DF2\u5B89\u88C5\u8F6F\u4EF6\u5305\u6216\u8FDC\u7A0B\u68C0\u7D22 (Homebrew / Winget)...", onSearchTextChange: setSearchText, onSelectionChange: (id) => setSelectedPkgName(id || ""), filterBar: {
            summaryText: `本机已安装软件包 ${installedCount} 个 · 可升级 ${outdatedCount} 个 · 当前匹配 ${displayedPackages.length} 个`,
            actions: [
                {
                    id: "brew-act-cleanup",
                    label: "清理缓存 (cleanup)",
                    title: "清理缓存 (cleanup)",
                    style: "secondary",
                    onAction: () => {
                        void handleCleanup();
                    }
                },
                {
                    id: "brew-act-refresh",
                    label: "刷新列表",
                    title: "刷新列表",
                    style: "secondary",
                    onAction: () => {
                        setRefreshTick((t) => t + 1);
                    }
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6309\u72B6\u6001\u6216\u7C7B\u578B\u7B5B\u9009\u8F6F\u4EF6\u5305", value: category, onChange: (val) => setCategory(val) },
            React.createElement(List.Dropdown.Item, { title: `全部软件包 (All · ${displayedPackages.length})`, value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: `已安装 (Installed · ${installedCount})`, value: "installed", icon: Icon.CheckCircle }),
            React.createElement(List.Dropdown.Item, { title: `可升级 (Outdated · ${outdatedCount})`, value: "outdated", icon: Icon.Upload }),
            React.createElement(List.Dropdown.Item, { title: "\u547D\u4EE4\u884C\u5DE5\u5177 (Formulae)", value: "formula", icon: Icon.Terminal }),
            React.createElement(List.Dropdown.Item, { title: "\u56FE\u5F62\u754C\u9762\u5E94\u7528 (Casks)", value: "cask", icon: Icon.AppWindow })) },
        React.createElement(List.Section, { title: `软件包列表 (Packages · ${displayedPackages.length})` }, displayedPackages.map((pkg) => {
            const installCmd = getBrewCliCommand("install", pkg);
            const upgradeCmd = getBrewCliCommand("upgrade", pkg);
            const uninstallCmd = getBrewCliCommand("uninstall", pkg);
            const statusLabel = pkg.outdated
                ? `${pkg.installedVersion} → ${pkg.latestVersion}`
                : pkg.installedVersion
                    ? `v${pkg.installedVersion}`
                    : `最新 v${pkg.latestVersion}`;
            return (React.createElement(List.Item, { key: `${pkg.tap}-${pkg.fullName}-${pkg.name}`, id: pkg.name, title: pkg.name, subtitle: pkg.description, icon: pkg.type === "cask" ? Icon.AppWindow : Icon.Terminal, accessories: [
                    { text: pkg.type === "cask" ? "Cask" : "Formula" },
                    {
                        text: statusLabel,
                        icon: pkg.outdated
                            ? Icon.Upload
                            : pkg.installedVersion
                                ? Icon.Checkmark
                                : Icon.Download
                    }
                ], detail: React.createElement(List.Item.Detail, { markdown: [
                        `# 🍺 ${pkg.name}`,
                        `> \`${pkg.tap}\` • **${pkg.type === "cask" ? "Cask (GUI App)" : "Formula (CLI Tool)"}**`,
                        `---`,
                        `${pkg.description}`,
                        `### 终端命令`,
                        `\`\`\`zsh\n# 安装\n${installCmd}\n\n# 升级\n${upgradeCmd}\n\n# 卸载\n${uninstallCmd}\n\`\`\``,
                        pkg.dependencies.length > 0
                            ? `**依赖项**: ${pkg.dependencies.map((d) => `\`${d}\``).join(", ")}`
                            : ""
                    ]
                        .filter(Boolean)
                        .join("\n\n"), metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8F6F\u4EF6\u5305\u540D", text: pkg.fullName, icon: Icon.Terminal }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7C7B\u578B", text: pkg.type === "cask" ? "Cask (GUI)" : "Formula (CLI)" }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5DF2\u5B89\u88C5\u7248\u672C", text: pkg.installedVersion || "未安装" }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6700\u65B0\u53EF\u7528\u7248\u672C", text: pkg.latestVersion }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6765\u6E90\u4ED3\u5E93", text: pkg.tap }),
                        React.createElement(List.Item.Detail.Metadata.Separator, null),
                        React.createElement(List.Item.Detail.Metadata.TagList, { title: "\u72B6\u6001" },
                            React.createElement(List.Item.Detail.Metadata.TagList.Item, { text: pkg.outdated
                                    ? "可升级 (Outdated)"
                                    : pkg.installedVersion
                                        ? "已安装 (Installed)"
                                        : "可安装 (Available)", color: pkg.outdated
                                    ? Color.Yellow
                                    : pkg.installedVersion
                                        ? Color.Green
                                        : Color.Blue }))) }), actions: React.createElement(ActionPanel, { title: `Homebrew: ${pkg.name}` },
                    pkg.outdated ? (React.createElement(Action, { title: `升级 ${pkg.name} 至 v${pkg.latestVersion}`, icon: Icon.Upload, onAction: () => handleUpgrade(pkg) })) : !pkg.installedVersion ? (React.createElement(Action, { title: `安装 ${pkg.name} (${installCmd})`, icon: Icon.Download, onAction: () => handleInstall(pkg) })) : (React.createElement(Action, { title: "\u67E5\u770B\u8F6F\u4EF6\u5305\u8BE6\u60C5", icon: Icon.Eye, onAction: () => push(React.createElement(HomebrewDetailView, { pkg: pkg, onPackageMutated: updatePackageState })) })),
                    !pkg.installedVersion ? null : (React.createElement(Action, { title: `升级 ${pkg.name} (${upgradeCmd})`, icon: Icon.Upload, onAction: () => handleUpgrade(pkg) })),
                    React.createElement(Action, { title: `复制命令 (${installCmd})`, icon: Icon.CopyClipboard, shortcut: { modifiers: ["ctrl"], key: "c" }, onAction: async () => {
                            await Clipboard.copy(installCmd);
                            await showToast(Toast.Style.Success, "已复制安装命令", installCmd);
                        } }),
                    pkg.installedVersion && (React.createElement(Action, { title: `卸载 ${pkg.name}`, icon: Icon.Trash, style: Action.Style.Destructive, shortcut: { modifiers: ["ctrl"], key: "x" }, onAction: () => handleUninstall(pkg) })),
                    React.createElement(Action, { title: "\u5237\u65B0\u8F6F\u4EF6\u5305\u5217\u8868", icon: Icon.ArrowClockwise, shortcut: { modifiers: ["ctrl"], key: "r" }, onAction: () => setRefreshTick((t) => t + 1) }),
                    React.createElement(Action, { title: "\u6E05\u7406 Homebrew \u7F13\u5B58 (brew cleanup)", icon: Icon.Broom, onAction: handleCleanup }),
                    React.createElement(Action.OpenInBrowser, { title: "\u8BBF\u95EE\u8F6F\u4EF6\u4E3B\u9875", url: pkg.homepage })) }));
        }))));
}
export default HomebrewCommand;
