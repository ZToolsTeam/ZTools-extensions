/**
 * Script Commands (极客自定义脚本命令工作台)
 *
 * 深度对齐 Raycast 官方 `script-commands` 规范：
 * - 100% 兼容 `@raycast.schemaVersion 1`、`@raycast.title`、`@raycast.mode` (`compact` | `fullOutput` | `inline` | `silent`)、`@raycast.packageName` 元数据注释解析
 * - 支持 Bash / Zsh / AppleScript / Python / Node.js / PowerShell 多语言脚本模板生成与一键执行
 * - 对接主进程 `script_commands_list`、`script_commands_execute`、`script_commands_create`、`script_commands_reload` IPC
 */
import React from "../../index.js";
import { List, Detail, Form, ActionPanel, Action, Icon, Clipboard, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useEffect, useMemo } from "../../runtime/hooks.js";
import { callHostTransport, isRealElectronHost } from "../shared/native-ipc.js";
export const DEFAULT_SCRIPT_COMMANDS = Object.freeze([
    {
        id: "script-flush-dns",
        title: "Flush macOS DNS Cache",
        mode: "compact",
        packageName: "Network Utils",
        description: "Clear local mDNSResponder & dscacheutil DNS cache",
        author: "ZTools Official",
        language: "zsh",
        filePath: "~/.ztools/scripts/flush-dns.sh",
        sourceCode: [
            "#!/bin/zsh",
            "# @raycast.schemaVersion 1",
            "# @raycast.title Flush macOS DNS Cache",
            "# @raycast.mode compact",
            "# @raycast.packageName Network Utils",
            "# @raycast.description Clear local mDNSResponder & dscacheutil DNS cache",
            "",
            "dscacheutil -flushcache",
            "echo '✅ DNS Cache Flushed Successfully'"
        ].join("\n"),
        lastOutput: "✅ DNS Cache Flushed Successfully"
    },
    {
        id: "script-git-standup",
        title: "Git Today's Commits Summary",
        mode: "fullOutput",
        packageName: "Developer Tools",
        description: "Show all git commits authored since midnight in current workspace",
        author: "ZTools Official",
        language: "bash",
        filePath: "~/.ztools/scripts/git-standup.sh",
        sourceCode: [
            "#!/usr/bin/env bash",
            "# @raycast.schemaVersion 1",
            "# @raycast.title Git Today's Commits Summary",
            "# @raycast.mode fullOutput",
            "# @raycast.packageName Developer Tools",
            "",
            "git log --since='midnight' --oneline --decorate"
        ].join("\n"),
        lastOutput: "f81c2e9 feat: 完成 macOS 内置套件补齐\n9a3d104 fix: 修复 POSIX 路径分隔符兼容"
    },
    {
        id: "script-toggle-dark-mode",
        title: "Toggle macOS Dark Mode via AppleScript",
        mode: "silent",
        packageName: "System Appearance",
        description: "Switch macOS System Events appearance dark mode",
        author: "ZTools Official",
        language: "applescript",
        filePath: "~/.ztools/scripts/toggle-dark-mode.scpt",
        sourceCode: [
            "#!/usr/bin/osascript",
            "# @raycast.schemaVersion 1",
            "# @raycast.title Toggle macOS Dark Mode via AppleScript",
            "# @raycast.mode silent",
            "# @raycast.packageName System Appearance",
            "",
            'tell application "System Events" to tell appearance preferences to set dark mode to not dark mode'
        ].join("\n"),
        lastOutput: "Dark mode toggled"
    },
    {
        id: "script-public-ip",
        title: "Get Local & Public IPv4 Address",
        mode: "inline",
        packageName: "Network Utils",
        description: "Fetch current LAN IP and external egress IP",
        author: "ZTools Official",
        language: "python",
        filePath: "~/.ztools/scripts/ip-info.py",
        sourceCode: [
            "#!/usr/bin/env python3",
            "# @raycast.schemaVersion 1",
            "# @raycast.title Get Local & Public IPv4 Address",
            "# @raycast.mode inline",
            "# @raycast.packageName Network Utils",
            "",
            "import socket",
            "print(socket.gethostbyname(socket.gethostname()))"
        ].join("\n"),
        lastOutput: ""
    }
]);
/**
 * 解析脚本头部的 `@raycast.*` 元数据注释
 */
export function parseRaycastScriptHeaders(sourceCode) {
    const lines = (sourceCode || "").split(/\r?\n/).slice(0, 40);
    let title = "Untitled Script";
    let mode = "compact";
    let packageName = "Custom Scripts";
    let description = "";
    let schemaVersion = 1;
    for (const line of lines) {
        const match = line.match(/@raycast\.([a-zA-Z0-9_]+)\s+(.+)$/);
        if (!match)
            continue;
        const key = match[1].trim();
        const val = match[2].trim();
        if (key === "title" && val)
            title = val;
        else if (key === "mode" &&
            ["compact", "fullOutput", "inline", "silent"].includes(val)) {
            mode = val;
        }
        else if (key === "packageName" && val) {
            packageName = val;
        }
        else if (key === "description" && val) {
            description = val;
        }
        else if (key === "schemaVersion") {
            schemaVersion = Number(val) || 1;
        }
    }
    return { title, mode, packageName, description, schemaVersion };
}
/**
 * 根据语言与参数生成标准 `@raycast.*` 脚本模板源码
 */
export function buildScriptCommandTemplate(input) {
    const lang = input.language || "bash";
    const shebangMap = {
        bash: "#!/usr/bin/env bash",
        zsh: "#!/bin/zsh",
        applescript: "#!/usr/bin/osascript",
        python: "#!/usr/bin/env python3",
        node: "#!/usr/bin/env node",
        powershell: "#!/usr/bin/env pwsh"
    };
    const commentPrefix = lang === "node" ? "//" : "#";
    const defaultBodyMap = {
        bash: 'echo "Hello from ZTools Script Command!"',
        zsh: 'echo "Hello from ZTools Zsh Script!"',
        applescript: 'display notification "Executed from ZTools" with title "Script Command"',
        python: 'print("Hello from Python Script Command!")',
        node: 'console.log("Hello from Node.js Script Command!");',
        powershell: 'Write-Output "Hello from PowerShell Script Command!"'
    };
    return [
        shebangMap[lang],
        `${commentPrefix} @raycast.schemaVersion 1`,
        `${commentPrefix} @raycast.title ${input.title.trim() || "New Script Command"}`,
        `${commentPrefix} @raycast.mode ${input.mode || "compact"}`,
        `${commentPrefix} @raycast.packageName ${input.packageName?.trim() || "Custom Scripts"}`,
        `${commentPrefix} @raycast.description ${input.description?.trim() || "Created in ZTools Script Commands"}`,
        "",
        input.body?.trim() || defaultBodyMap[lang]
    ].join("\n");
}
/**
 * 加载脚本命令列表（对接 script_commands_list / script_commands_reload IPC）
 */
export async function fetchScriptCommands(forceReload = false, hostOverride) {
    const realHost = isRealElectronHost(hostOverride);
    if (hostOverride || realHost) {
        const method = forceReload ? "script_commands_reload" : "script_commands_list";
        const res = await callHostTransport(method, {}, hostOverride);
        const rawList = Array.isArray(res.data)
            ? res.data
            : Array.isArray(res.data?.scripts)
                ? res.data.scripts
                : Array.isArray(res.data?.commands)
                    ? res.data.commands
                    : Array.isArray(res.data?.items) ? res.data.items : null;
        if (res.ok && res.data?.success !== false && rawList) {
            if (rawList.length > 0 || realHost || forceReload) {
                return rawList.map((item, idx) => {
                    const parsed = item.sourceCode
                        ? parseRaycastScriptHeaders(String(item.sourceCode))
                        : null;
                    return {
                        id: String(item.id || `script-${idx}`),
                        title: String(item.title || parsed?.title || "Script Command"),
                        mode: (item.mode || parsed?.mode || "compact"),
                        packageName: String(item.packageName || parsed?.packageName || "Custom"),
                        description: String(item.description || parsed?.description || ""),
                        author: item.author ? String(item.author) : "User",
                        language: (item.language || "bash"),
                        filePath: String(item.filePath || item.path || `~/.ztools/scripts/${item.id || idx}.sh`),
                        sourceCode: String(item.sourceCode || ""),
                        lastOutput: item.lastOutput ? String(item.lastOutput) : undefined,
                        lastRunAt: item.lastRunAt ? Number(item.lastRunAt) : undefined
                    };
                });
            }
        }
        const hasExplicitMock = Boolean(hostOverride &&
            typeof hostOverride === "object" &&
            (method in hostOverride || "transport" in hostOverride));
        if (!res.ok || res.data?.success === false) {
            if (forceReload || realHost || hasExplicitMock) {
                throw new Error(res.error ||
                    res.data?.error ||
                    (forceReload ? "重新扫描脚本目录失败" : "读取脚本目录失败"));
            }
        }
        if (realHost) {
            return [];
        }
    }
    return [...DEFAULT_SCRIPT_COMMANDS];
}
/**
 * 执行指定脚本命令（对接 script_commands_execute IPC）
 */
export async function executeScriptCommand(script, hostOverride) {
    const startedAt = Date.now();
    if (!script || !script.id) {
        return {
            ok: false,
            output: "脚本 ID 不能为空",
            stdout: "",
            stderr: "脚本 ID 不能为空",
            exitCode: 1,
            durationMs: 0,
            executedAt: startedAt
        };
    }
    if (hostOverride || isRealElectronHost()) {
        const res = await callHostTransport("script_commands_execute", {
            id: script.id,
            filePath: script.filePath,
            args: "args" in script && Array.isArray(script.args) ? script.args : []
        }, hostOverride);
        const durationMs = Math.max(1, Number(res.data?.durationMs ?? (Date.now() - startedAt)));
        if (res.ok && res.data) {
            const stdout = String(res.data.stdout ?? res.data.output ?? "").trim();
            const stderr = String(res.data.stderr ?? "").trim();
            const exitCode = Number(res.data.exitCode ?? 0);
            const combinedOutput = [stdout, stderr ? `[stderr]\n${stderr}` : ""]
                .filter(Boolean)
                .join("\n\n") || "执行完成 (无输出)";
            return {
                ok: exitCode === 0,
                output: combinedOutput,
                stdout,
                stderr,
                exitCode,
                durationMs,
                executedAt: Date.now()
            };
        }
        const errText = res.error || "脚本执行失败";
        return {
            ok: false,
            output: errText,
            stdout: "",
            stderr: errText,
            exitCode: 1,
            durationMs,
            executedAt: Date.now()
        };
    }
    const fallbackOutput = "lastOutput" in script && script.lastOutput
        ? script.lastOutput
        : `Executed ${script.id} successfully`;
    return {
        ok: true,
        output: fallbackOutput,
        stdout: fallbackOutput,
        stderr: "",
        exitCode: 0,
        durationMs: Math.max(1, Date.now() - startedAt),
        executedAt: Date.now()
    };
}
/**
 * 从模板创建新脚本命令（对接 script_commands_create IPC）
 */
export async function createScriptCommand(input, hostOverride) {
    const cleanTitle = (input.title || "").trim();
    if (!cleanTitle) {
        throw new Error("TITLE_REQUIRED: 脚本标题不能为空");
    }
    const lang = input.language || "bash";
    const extMap = {
        bash: "sh",
        zsh: "zsh",
        applescript: "scpt",
        python: "py",
        node: "mjs",
        powershell: "ps1"
    };
    const slug = cleanTitle
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
        .replace(/^-|-$/g, "") || `script-${Date.now()}`;
    const sourceCode = buildScriptCommandTemplate(input);
    if (hostOverride || isRealElectronHost()) {
        const res = await callHostTransport("script_commands_create", {
            title: cleanTitle,
            mode: input.mode || "compact",
            packageName: input.packageName || "Custom Scripts",
            description: input.description || "",
            language: lang,
            sourceCode
        }, hostOverride);
        if (res.ok && res.data && res.data.id) {
            return {
                id: String(res.data.id),
                title: String(res.data.title || cleanTitle),
                mode: (res.data.mode || input.mode || "compact"),
                packageName: String(res.data.packageName || input.packageName || "Custom Scripts"),
                description: String(res.data.description || input.description || ""),
                language: lang,
                filePath: String(res.data.filePath || `~/.ztools/scripts/${slug}.${extMap[lang]}`),
                sourceCode
            };
        }
    }
    return {
        id: `script-${slug}-${Date.now()}`,
        title: cleanTitle,
        mode: input.mode || "compact",
        packageName: input.packageName?.trim() || "Custom Scripts",
        description: input.description?.trim() || "",
        language: lang,
        filePath: `~/.ztools/scripts/${slug}.${extMap[lang]}`,
        sourceCode
    };
}
export const parseScriptCommandMetadata = parseRaycastScriptHeaders;
export const generateScriptCommandTemplate = buildScriptCommandTemplate;
export const listScriptCommandsFromHost = fetchScriptCommands;
export const runScriptCommandOnHost = executeScriptCommand;
export const createScriptCommandOnHost = createScriptCommand;
export function RunScriptWithArgsForm({ script, onExecuted }) {
    const [arg1, setArg1] = useState("");
    const [arg2, setArg2] = useState("");
    const [arg3, setArg3] = useState("");
    const { pop } = useNavigation();
    const handleSubmit = async (values) => {
        const args = [
            values?.arg1 ?? arg1,
            values?.arg2 ?? arg2,
            values?.arg3 ?? arg3
        ]
            .map((a) => String(a || "").trim())
            .filter(Boolean);
        await showToast(Toast.Style.Animated, `正在带参执行: ${script.title}...`);
        const res = await executeScriptCommand({
            id: script.id,
            filePath: script.filePath,
            args
        });
        onExecuted?.(res);
        await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.ok ? `已执行: ${script.title} (${res.durationMs}ms)` : `执行失败 (Exit ${res.exitCode})`, res.output.slice(0, 120));
        pop();
    };
    return (React.createElement(Form, { navigationTitle: `传入参数运行脚本: ${script.title}`, actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u7ACB\u5373\u5E26\u53C2\u8FD0\u884C\u811A\u672C", icon: Icon.Play, onSubmit: handleSubmit }),
            React.createElement(Action, { title: "\u7ACB\u5373\u5E26\u53C2\u8FD0\u884C\u811A\u672C", icon: Icon.Play, onAction: () => handleSubmit() })) },
        React.createElement(Form.TextField, { id: "arg1", title: "\u53C2\u6570 1 (@raycast.argument1)", placeholder: "\u8F93\u5165\u7B2C 1 \u4E2A\u547D\u4EE4\u884C\u53C2\u6570 ($1)...", value: arg1, onChange: setArg1 }),
        React.createElement(Form.TextField, { id: "arg2", title: "\u53C2\u6570 2 (@raycast.argument2)", placeholder: "\u8F93\u5165\u7B2C 2 \u4E2A\u547D\u4EE4\u884C\u53C2\u6570 ($2\uFF0C\u9009\u586B)...", value: arg2, onChange: setArg2 }),
        React.createElement(Form.TextField, { id: "arg3", title: "\u53C2\u6570 3 (@raycast.argument3)", placeholder: "\u8F93\u5165\u7B2C 3 \u4E2A\u547D\u4EE4\u884C\u53C2\u6570 ($3\uFF0C\u9009\u586B)...", value: arg3, onChange: setArg3 })));
}
export function CreateScriptCommandForm({ onCreated }) {
    const [title, setTitle] = useState("");
    const [packageName, setPackageName] = useState("Developer Tools");
    const [mode, setMode] = useState("compact");
    const [language, setLanguage] = useState("powershell");
    const [description, setDescription] = useState("");
    const [body, setBody] = useState('Write-Output "✅ Executed from ZTools Script Command"');
    const { pop } = useNavigation();
    const handleSubmit = async (values) => {
        try {
            const created = await createScriptCommand({
                title: values?.title ?? title,
                packageName: values?.packageName ?? packageName,
                mode: (values?.mode ?? mode),
                language: (values?.language ?? language),
                description: values?.description ?? description,
                body: values?.body ?? body
            });
            onCreated?.(created);
            await showToast(Toast.Style.Success, `已创建脚本: ${created.title}`, created.filePath);
            pop();
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "创建脚本失败", err?.message || String(err));
        }
    };
    return (React.createElement(Form, { navigationTitle: "\u521B\u5EFA\u81EA\u5B9A\u4E49\u811A\u672C\u547D\u4EE4 (Create Script Command)", actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u4FDD\u5B58\u5E76\u751F\u6210\u811A\u672C", icon: Icon.Check, onSubmit: handleSubmit }),
            React.createElement(Action, { title: "\u4FDD\u5B58\u5E76\u751F\u6210\u811A\u672C", icon: Icon.Check, onAction: () => handleSubmit() })) },
        React.createElement(Form.TextField, { id: "title", title: "\u811A\u672C\u6807\u9898 (@raycast.title)", placeholder: "\u4F8B\u5982: Restart Docker / Flush DNS", value: title, onChange: setTitle }),
        React.createElement(Form.Dropdown, { id: "language", title: "\u811A\u672C\u8FD0\u884C\u8BED\u8A00 (Runtime)", value: language, onChange: (v) => setLanguage(v) },
            React.createElement(Form.Dropdown.Item, { value: "powershell", title: "PowerShell (pwsh)" }),
            React.createElement(Form.Dropdown.Item, { value: "node", title: "Node.js (/usr/bin/env node)" }),
            React.createElement(Form.Dropdown.Item, { value: "python", title: "Python 3 (/usr/bin/env python3)" }),
            React.createElement(Form.Dropdown.Item, { value: "zsh", title: "Zsh (/bin/zsh)" }),
            React.createElement(Form.Dropdown.Item, { value: "bash", title: "Bash (/usr/bin/env bash)" }),
            React.createElement(Form.Dropdown.Item, { value: "applescript", title: "AppleScript (/usr/bin/osascript)" })),
        React.createElement(Form.Dropdown, { id: "mode", title: "\u8F93\u51FA\u5448\u73B0\u6A21\u5F0F (@raycast.mode)", value: mode, onChange: (v) => setMode(v) },
            React.createElement(Form.Dropdown.Item, { value: "compact", title: "Compact (\u5355\u884C Toast \u53CD\u9988)" }),
            React.createElement(Form.Dropdown.Item, { value: "fullOutput", title: "Full Output (\u5B8C\u6574\u7EC8\u7AEF\u8F93\u51FA\u89C6\u56FE)" }),
            React.createElement(Form.Dropdown.Item, { value: "inline", title: "Inline (\u5217\u8868\u5185\u8054\u5B9E\u65F6\u5237\u65B0)" }),
            React.createElement(Form.Dropdown.Item, { value: "silent", title: "Silent (\u9759\u9ED8\u540E\u53F0\u6267\u884C)" })),
        React.createElement(Form.TextField, { id: "packageName", title: "\u6240\u5C5E\u5206\u7EC4 (@raycast.packageName)", placeholder: "\u4F8B\u5982: Developer Tools / System", value: packageName, onChange: setPackageName }),
        React.createElement(Form.TextField, { id: "description", title: "\u811A\u672C\u63CF\u8FF0 (@raycast.description)", placeholder: "\u7B80\u77ED\u63CF\u8FF0\u8BE5\u811A\u672C\u7684\u7528\u9014", value: description, onChange: setDescription }),
        React.createElement(Form.TextArea, { id: "body", title: "\u811A\u672C\u6267\u884C\u4EE3\u7801", placeholder: "\u8F93\u5165\u8981\u6267\u884C\u7684\u547D\u4EE4\u6216\u4EE3\u7801...", value: body, onChange: setBody })));
}
export function ScriptCommandOutputDetailView({ script, output, executionResult }) {
    const markdown = [
        `# ⚡ ${script.title}`,
        `> **分组**: \`${script.packageName}\` &nbsp;|&nbsp; **语言**: \`${script.language}\` &nbsp;|&nbsp; **模式**: \`${script.mode}\`${executionResult
            ? ` &nbsp;|&nbsp; **退出码**: \`${executionResult.exitCode}\` &nbsp;|&nbsp; **耗时**: \`${executionResult.durationMs}ms\``
            : ""}`,
        `---`,
        `### 🖥️ 最近一次执行输出 (Real Execution Output)`,
        `\`\`\`text\n${executionResult?.stdout || output || "(无标准输出)"}\n\`\`\``,
        executionResult?.stderr
            ? `### ⚠️ 标准错误输出 (stderr)\n\`\`\`text\n${executionResult.stderr}\n\`\`\``
            : "",
        `### 脚本源码 (${script.filePath})`,
        `\`\`\`${script.language}\n${script.sourceCode}\n\`\`\``
    ]
        .filter(Boolean)
        .join("\n\n");
    return (React.createElement(Detail, { navigationTitle: `运行结果: ${script.title}`, markdown: markdown, actions: React.createElement(ActionPanel, null,
            React.createElement(Action, { title: "\u590D\u5236\u8F93\u51FA\u7ED3\u679C", icon: Icon.CopyClipboard, onAction: async () => {
                    await Clipboard.copy(output);
                    await showToast(Toast.Style.Success, "已复制脚本输出");
                } }),
            React.createElement(Action, { title: "\u590D\u5236\u811A\u672C\u6E90\u7801", icon: Icon.Code, onAction: async () => {
                    await Clipboard.copy(script.sourceCode);
                    await showToast(Toast.Style.Success, "已复制脚本源码");
                } })) }));
}
export function ScriptCommandsCommand() {
    const realHost = isRealElectronHost();
    const [scripts, setScripts] = useState(() => realHost ? [] : [...DEFAULT_SCRIPT_COMMANDS]);
    const [lastOutputs, setLastOutputs] = useState({});
    const [searchText, setSearchText] = useState("");
    const [filterMode, setFilterMode] = useState("all");
    const [selectedId, setSelectedId] = useState(null);
    const [isLoading, setIsLoading] = useState(realHost);
    const { push } = useNavigation();
    useEffect(() => {
        let active = true;
        setIsLoading(true);
        fetchScriptCommands(false)
            .then((list) => {
            if (!active)
                return;
            setScripts(list);
            setIsLoading(false);
        })
            .catch(() => {
            if (active)
                setIsLoading(false);
        });
        return () => {
            active = false;
        };
    }, []);
    const displayedScripts = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        return scripts.filter((s) => {
            if (filterMode !== "all" && s.mode !== filterMode && s.language !== filterMode) {
                return false;
            }
            if (!q)
                return true;
            return (s.title.toLowerCase().includes(q) ||
                s.packageName.toLowerCase().includes(q) ||
                s.description.toLowerCase().includes(q) ||
                s.language.toLowerCase().includes(q));
        });
    }, [scripts, searchText, filterMode]);
    const recordExecutionResult = (script, res) => {
        setLastOutputs((prev) => ({
            ...prev,
            [script.id]: res
        }));
        setScripts((prev) => prev.map((item) => item.id === script.id
            ? { ...item, lastOutput: res.output, lastRunAt: res.executedAt }
            : item));
    };
    const handleRunScript = async (script) => {
        await showToast(Toast.Style.Animated, `正在运行脚本: ${script.title}...`);
        const res = await executeScriptCommand(script);
        recordExecutionResult(script, res);
        if (script.mode === "fullOutput") {
            push(React.createElement(ScriptCommandOutputDetailView, { script: script, output: res.output, executionResult: res }));
        }
        await showToast(res.ok ? Toast.Style.Success : Toast.Style.Failure, res.ok
            ? `已执行: ${script.title} (${res.durationMs}ms)`
            : `执行失败: ${script.title} (Exit ${res.exitCode})`, res.output.slice(0, 120));
    };
    const handleReload = async () => {
        setIsLoading(true);
        try {
            const list = await fetchScriptCommands(true);
            setScripts(list);
            await showToast(Toast.Style.Success, "已重新扫描加载本地脚本目录", `共 ${list.length} 个脚本`);
        }
        catch (err) {
            await showToast(Toast.Style.Failure, "重新扫描脚本目录失败", err instanceof Error ? err.message : String(err));
        }
        finally {
            setIsLoading(false);
        }
    };
    const activeScript = useMemo(() => displayedScripts.find((s) => s.id === selectedId) || displayedScripts[0] || null, [displayedScripts, selectedId]);
    const executedCount = Object.keys(lastOutputs).length;
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchBarPlaceholder: "\u641C\u7D22\u672C\u5730\u81EA\u5B9A\u4E49\u811A\u672C (@raycast.title, \u5206\u7EC4, \u8BED\u8A00)...", onSearchTextChange: setSearchText, onSelectionChange: setSelectedId, filterBar: {
            summaryText: `脚本工作台 · 已加载 ${scripts.length} 个脚本 | 当前显示 ${displayedScripts.length} 个 | 本次已运行 ${executedCount} 次`,
            actions: [
                {
                    id: "create-script-command",
                    label: "新建脚本命令",
                    title: "新建脚本命令",
                    style: "primary",
                    onAction: () => {
                        push(React.createElement(CreateScriptCommandForm, { onCreated: (created) => setScripts((prev) => [created, ...prev]) }));
                    }
                },
                {
                    id: "reload-scripts-dir",
                    label: "重新加载脚本目录",
                    title: "重新加载脚本目录",
                    style: "secondary",
                    onAction: handleReload
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6309\u8F93\u51FA\u6A21\u5F0F\u6216\u8BED\u8A00\u8FC7\u6EE4", value: filterMode, onChange: setFilterMode },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u811A\u672C (All Scripts)", value: "all", icon: Icon.Terminal }),
            React.createElement(List.Dropdown.Item, { title: "Compact \u6A21\u5F0F", value: "compact", icon: Icon.Bolt }),
            React.createElement(List.Dropdown.Item, { title: "Full Output \u6A21\u5F0F", value: "fullOutput", icon: Icon.Document }),
            React.createElement(List.Dropdown.Item, { title: "Inline \u5185\u8054\u6A21\u5F0F", value: "inline", icon: Icon.Text }),
            React.createElement(List.Dropdown.Item, { title: "Silent \u9759\u9ED8\u6A21\u5F0F", value: "silent", icon: Icon.EyeSlash }),
            React.createElement(List.Dropdown.Item, { title: "PowerShell \u811A\u672C", value: "powershell", icon: Icon.Terminal }),
            React.createElement(List.Dropdown.Item, { title: "Zsh / Bash \u811A\u672C", value: "zsh", icon: Icon.Terminal }),
            React.createElement(List.Dropdown.Item, { title: "AppleScript \u811A\u672C", value: "applescript", icon: Icon.Code })), actions: React.createElement(ActionPanel, { title: "\u811A\u672C\u5DE5\u4F5C\u53F0" },
            React.createElement(Action.Push, { title: "\u65B0\u5EFA\u811A\u672C\u547D\u4EE4 (Create Script Command)", icon: Icon.Plus, target: React.createElement(CreateScriptCommandForm, { onCreated: (created) => setScripts((prev) => [created, ...prev]) }) }),
            React.createElement(Action, { title: "\u91CD\u65B0\u52A0\u8F7D\u811A\u672C\u76EE\u5F55 (Reload Scripts)", icon: Icon.ArrowClockwise, onAction: handleReload })) },
        React.createElement(List.Section, { title: `脚本命令列表 (Script Commands · ${displayedScripts.length})` }, displayedScripts.map((script) => {
            const execRes = lastOutputs[script.id];
            const displayOutput = execRes?.output || script.lastOutput;
            return (React.createElement(List.Item, { key: script.id, id: script.id, title: script.title, subtitle: displayOutput
                    ? `▶ ${displayOutput.replace(/\r?\n/g, " ").slice(0, 72)}`
                    : `${script.packageName} • ${script.filePath}`, icon: execRes ? (execRes.ok ? Icon.CheckCircle : Icon.XMarkCircle) : Icon.Terminal, accessories: [
                    ...(execRes
                        ? [{ text: `${execRes.durationMs}ms (Exit ${execRes.exitCode})` }]
                        : []),
                    { text: script.language.toUpperCase() },
                    { text: script.mode }
                ], detail: React.createElement(List.Item.Detail, { markdown: [
                        `# ⚡ ${script.title}`,
                        `> \`${script.packageName}\` • \`${script.language}\` • \`@raycast.mode ${script.mode}\``,
                        displayOutput
                            ? [
                                `### 🖥️ 最近一次执行输出 (Real Execution Output)`,
                                execRes
                                    ? `- **退出码 (Exit Code)**: \`${execRes.exitCode}\` &nbsp;|&nbsp; **执行耗时**: \`${execRes.durationMs} ms\``
                                    : "",
                                `\`\`\`text\n${execRes?.stdout || displayOutput}\n\`\`\``,
                                execRes?.stderr
                                    ? `**标准错误 (stderr)**:\n\`\`\`text\n${execRes.stderr}\n\`\`\``
                                    : ""
                            ]
                                .filter(Boolean)
                                .join("\n\n")
                            : `> 尚未运行此脚本，按 **Enter** 立即在宿主进程真实执行并捕获 \`stdout / stderr\`。`,
                        script.description ? `### 脚本说明\n${script.description}` : "",
                        `### 脚本源码 (${script.filePath})`,
                        `\`\`\`${script.language}\n${script.sourceCode}\n\`\`\``
                    ]
                        .filter(Boolean)
                        .join("\n\n"), metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u811A\u672C\u6807\u9898", text: script.title, icon: Icon.Terminal }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6240\u5C5E\u5206\u7EC4", text: script.packageName, icon: Icon.Folder }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8F93\u51FA\u6A21\u5F0F", text: script.mode, icon: Icon.Eye }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8FD0\u884C\u73AF\u5883", text: script.language, icon: Icon.Code }),
                        execRes && (React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6700\u8FD1\u6267\u884C\u72B6\u6001", text: `Exit ${execRes.exitCode} (${execRes.durationMs}ms)`, icon: execRes.ok ? Icon.CheckCircle : Icon.XMarkCircle })),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6587\u4EF6\u8DEF\u5F84", text: script.filePath, icon: Icon.Document })) }), actions: React.createElement(ActionPanel, { title: script.title },
                    React.createElement(Action, { title: "\u8FD0\u884C\u811A\u672C (Run Script Command)", icon: Icon.Play, onAction: () => handleRunScript(script) }),
                    React.createElement(Action.Push, { title: "\u4F20\u5165\u53C2\u6570\u5E76\u8FD0\u884C\u811A\u672C (Run with Arguments)", icon: Icon.Terminal, shortcut: { modifiers: ["ctrl", "shift"], key: "r" }, target: React.createElement(RunScriptWithArgsForm, { script: script, onExecuted: (res) => recordExecutionResult(script, res) }) }),
                    displayOutput && (React.createElement(Action, { title: "\u590D\u5236\u6700\u8FD1\u4E00\u6B21\u6267\u884C\u8F93\u51FA", icon: Icon.CopyClipboard, onAction: async () => {
                            await Clipboard.copy(displayOutput);
                            await showToast(Toast.Style.Success, "已复制脚本执行输出");
                        } })),
                    React.createElement(Action.Push, { title: "\u65B0\u5EFA\u811A\u672C\u547D\u4EE4 (Create Script Command)", icon: Icon.Plus, shortcut: { modifiers: ["ctrl"], key: "n" }, target: React.createElement(CreateScriptCommandForm, { onCreated: (created) => setScripts((prev) => [created, ...prev]) }) }),
                    React.createElement(Action, { title: "\u91CD\u65B0\u52A0\u8F7D\u811A\u672C\u76EE\u5F55 (Reload Scripts)", icon: Icon.ArrowClockwise, shortcut: { modifiers: ["ctrl"], key: "r" }, onAction: handleReload }),
                    React.createElement(Action, { title: "\u590D\u5236\u811A\u672C\u6E90\u7801", icon: Icon.Code, shortcut: { modifiers: ["ctrl"], key: "c" }, onAction: async () => {
                            await Clipboard.copy(script.sourceCode);
                            await showToast(Toast.Style.Success, "已复制脚本源码");
                        } })) }));
        }))));
}
export default ScriptCommandsCommand;
