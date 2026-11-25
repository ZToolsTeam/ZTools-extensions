import React, { Action, ActionPanel, Color, Icon, List, useMemo, useState } from '../../index.js';
import { COMMIT_TYPES, GITIGNORE_STACK_TEMPLATES, buildConventionalCommit, generateGitignoreContent, searchGitEmergencies } from './git-helper-service.js';
export * from './types.js';
export * from './git-helper-service.js';
export function GitHelperCommand(props = {}) {
    const defaultMode = props.initialMode ??
        (props.featureCode === 'git-commit-builder'
            ? 'commit'
            : props.featureCode === 'gitignore-generator'
                ? 'gitignore'
                : 'emergency');
    const [mode, setMode] = useState(defaultMode);
    const [searchText, setSearchText] = useState(props.initialSearchText ?? '');
    const [selectedStacks, setSelectedStacks] = useState(props.initialSelectedStacks ?? ['Node', 'ReactVue', 'macOS', 'Windows', 'IDEs']);
    const filteredEmergencies = useMemo(() => searchGitEmergencies(searchText), [searchText]);
    const parsedCommitInput = useMemo(() => {
        const raw = searchText.trim();
        if (!raw) {
            return { scope: 'core', subject: '新增声明式插件独立开发与安全扫描支持' };
        }
        const colonIdx = raw.indexOf(':');
        if (colonIdx > 0 && colonIdx < 24) {
            return {
                scope: raw.slice(0, colonIdx).trim(),
                subject: raw.slice(colonIdx + 1).trim()
            };
        }
        return { scope: '', subject: raw };
    }, [searchText]);
    const gitignoreOutput = useMemo(() => generateGitignoreContent(selectedStacks), [selectedStacks]);
    const toggleStack = (stackId) => {
        setSelectedStacks((prev) => prev.includes(stackId) ? prev.filter((id) => id !== stackId) : [...prev, stackId]);
    };
    return (React.createElement(List, { searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: mode === 'emergency'
            ? '输入大白话翻车场景（如：撤销提交、漏提文件、恢复误删分支、撤销pull）...'
            : mode === 'commit'
                ? '输入改动说明（支持 scope:描述 格式，如 auth:修复登录态刷新失败）...'
                : '搜索技术栈或系统模板（如：Node、Python、Go、Rust、macOS）...', searchBarAccessory: React.createElement(List.Dropdown, { value: mode, onChange: (v) => setMode(v), tooltip: "\u5207\u6362 Git \u52A9\u624B\u5DE5\u4F5C\u6A21\u5F0F" },
            React.createElement(List.Dropdown.Item, { title: "Git \u7FFB\u8F66\u81EA\u6551\u9526\u56CA", value: "emergency", icon: Icon.Shield }),
            React.createElement(List.Dropdown.Item, { title: "\u89C4\u8303\u63D0\u4EA4\u751F\u6210\u5668 (Commit)", value: "commit", icon: Icon.Pencil }),
            React.createElement(List.Dropdown.Item, { title: ".gitignore \u6A21\u677F\u5408\u6210", value: "gitignore", icon: Icon.Document })), isShowingDetail: true },
        mode === 'emergency' && (React.createElement(List.Section, { title: `高频翻车现场与自救指南（共 ${filteredEmergencies.length} 项）` }, filteredEmergencies.map((item) => (React.createElement(List.Item, { key: item.id, id: item.id, icon: Icon.Shield, title: item.title, subtitle: item.primaryCommand, accessories: [
                item.safetyLevel === '有损警告'
                    ? { tag: { value: item.safetyLevel, color: Color.Red } }
                    : { tag: item.safetyLevel }
            ], detail: React.createElement(List.Item.Detail, { markdown: `### 事故现场：${item.title}

#### 首选救命命令（回车一键复制）
\`\`\`bash
${item.primaryCommand}
\`\`\`

#### 分步安全排障操作
${item.steps
                    .map((s, i) => `${i + 1}. **${s.title}**
\`\`\`bash
${s.cmd}
\`\`\`
*${s.explain}*`)
                    .join('\n\n')}

#### 底层 Git 原理与防坑说明
> ${item.principle}
`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u573A\u666F\u5206\u7C7B", text: item.categoryLabel }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5B89\u5168\u7B49\u7EA7", text: item.safetyLevel }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u4E0A\u624B\u96BE\u5EA6", text: item.difficulty })) }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u9996\u9009\u6551\u547D\u547D\u4EE4", content: item.primaryCommand }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5168\u90E8\u81EA\u6551\u6B65\u9AA4\u547D\u4EE4", content: item.steps.map((s) => `# ${s.title}\n${s.cmd}`).join('\n\n'), shortcut: { modifiers: ['cmd', 'shift'], key: 'c' } })) }))))),
        mode === 'commit' && (React.createElement(List.Section, { title: "\u9009\u62E9 Conventional Commits \u63D0\u4EA4\u7C7B\u578B\uFF08\u5F3A\u5236\u4E2D\u6587\u89C4\u8303\uFF09" }, COMMIT_TYPES.map((t) => {
            const built = buildConventionalCommit({
                type: t.type,
                scope: parsedCommitInput.scope,
                subject: parsedCommitInput.subject
            });
            return (React.createElement(List.Item, { key: t.type, id: t.type, icon: Icon.Pencil, title: `${t.type}: ${t.chineseMeaning}`, subtitle: built.message, accessories: [{ tag: `前缀 ${t.type}:` }], detail: React.createElement(List.Item.Detail, { markdown: `### 规范提交命令预览
\`\`\`bash
${built.gitCommand}
\`\`\`

#### 生成的 Commit Message
> **${built.message}**

#### 类型规范说明 (\`${t.type}\`)
- **中文定义**：${t.chineseMeaning}
- **适用边界**：${t.description}

#### 团队标准范例
${t.examples.map((ex) => `- \`${ex}\``).join('\n')}
` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5B8C\u6574 git commit \u547D\u4EE4", content: built.gitCommand }),
                    React.createElement(Action.CopyToClipboard, { title: "\u4EC5\u590D\u5236\u4E2D\u6587\u63D0\u4EA4\u5907\u6CE8\u6587\u672C", content: built.message, shortcut: { modifiers: ['cmd'], key: 'c' } })) }));
        }))),
        mode === 'gitignore' && (React.createElement(List.Section, { title: `.gitignore 模板多选合成（已选 ${selectedStacks.length} 个栈，去重后 ${gitignoreOutput.totalUniqueRules} 条规则）` }, GITIGNORE_STACK_TEMPLATES.map((tpl) => {
            const checked = selectedStacks.includes(tpl.id);
            return (React.createElement(List.Item, { key: tpl.id, id: tpl.id, icon: checked ? Icon.CheckCircle : Icon.Circle, title: tpl.name, subtitle: `${tpl.category} · 含 ${tpl.rules.length} 条忽略规则`, accessories: [
                    {
                        tag: checked ? '已勾选合并' : '未选'
                    }
                ], detail: React.createElement(List.Item.Detail, { markdown: `### 合成后的 \`.gitignore\` 预览（自动去重）
\`\`\`gitignore
${gitignoreOutput.content}
\`\`\`
`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5DF2\u5408\u5E76\u6280\u672F\u6808", text: gitignoreOutput.selectedStacks.join(', ') }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u53BB\u91CD\u540E\u89C4\u5219\u603B\u6570", text: `${gitignoreOutput.totalUniqueRules} 条` })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5408\u6210\u540E\u7684 .gitignore \u5168\u6587", content: gitignoreOutput.content }),
                    React.createElement(Action, { title: checked ? `取消勾选 ${tpl.name}` : `勾选加入 ${tpl.name}`, icon: checked ? Icon.XMarkCircle : Icon.CheckCircle, shortcut: { modifiers: ['cmd'], key: 't' }, onAction: () => toggleStack(tpl.id) })) }));
        })))));
}
export default GitHelperCommand;
