import React, { Action, ActionPanel, Color, Icon, List, useMemo, useState } from '../../index.js';
import { searchCommonPorts, searchHttpStatus, searchLinuxCommands } from './dict-service.js';
export * from './types.js';
export * from './dict-service.js';
export function LinuxHttpDictCommand(props = {}) {
    const defaultCategory = props.initialCategory ??
        (props.featureCode === 'http-status'
            ? 'http'
            : props.featureCode === 'port-dict'
                ? 'port'
                : 'linux');
    const [category, setCategory] = useState(defaultCategory);
    const [searchText, setSearchText] = useState(props.initialSearchText ?? '');
    const filteredCommands = useMemo(() => searchLinuxCommands(searchText), [searchText]);
    const filteredHttpStatus = useMemo(() => searchHttpStatus(searchText), [searchText]);
    const filteredPorts = useMemo(() => searchCommonPorts(searchText), [searchText]);
    return (React.createElement(List, { searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: category === 'linux'
            ? '搜索 Linux 命令或中文场景（如：tar、解压、端口占用、查找文件、awk）...'
            : category === 'http'
                ? '输入 HTTP 状态码或故障现象（如：502、504、499、403、网关超时）...'
                : '输入端口号或服务名称（如：6379、3306、redis、mysql、nacos）...', searchBarAccessory: React.createElement(List.Dropdown, { value: category, onChange: (v) => setCategory(v), tooltip: "\u5207\u6362\u901F\u67E5\u5B57\u5178\u7C7B\u522B" },
            React.createElement(List.Dropdown.Item, { title: "Linux \u9AD8\u9891\u547D\u4EE4\u5B9E\u4F8B", value: "linux", icon: Icon.Terminal }),
            React.createElement(List.Dropdown.Item, { title: "HTTP \u72B6\u6001\u7801\u4E0E\u6392\u969C", value: "http", icon: Icon.Globe }),
            React.createElement(List.Dropdown.Item, { title: "\u77E5\u540D\u670D\u52A1\u9ED8\u8BA4\u7AEF\u53E3", value: "port", icon: Icon.Wifi })), isShowingDetail: true },
        category === 'linux' && (React.createElement(List.Section, { title: `Linux 高频实战命令库（共 ${filteredCommands.length} 项）` }, filteredCommands.map((item) => (React.createElement(List.Item, { key: item.id, id: item.id, icon: Icon.Terminal, title: item.name, subtitle: item.description, accessories: [{ tag: item.groupLabel }], detail: React.createElement(List.Item.Detail, { markdown: `### \`${item.name}\` — ${item.description}

#### 生产高频场景实例
${item.examples
                    .map((ex) => `##### ${ex.title}
\`\`\`bash
${ex.cmd}
\`\`\`
${ex.note ? `*${ex.note}*` : ''}`)
                    .join('\n\n')}

#### 常用核心参数说明
| 参数选项 | 作用说明 |
| :--- | :--- |
${item.params.map((p) => `| \`${p.flag}\` | ${p.desc} |`).join('\n')}
`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6240\u5C5E\u5206\u7C7B", text: item.groupLabel }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u9AD8\u9891\u8BC4\u7EA7", text: item.stars }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8F6F\u4EF6\u5305\u540D", text: item.package || item.name })) }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u9996\u9009\u63A8\u8350\u547D\u4EE4", content: item.examples[0]?.cmd || item.name }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5168\u90E8\u793A\u4F8B\u547D\u4EE4", content: item.examples.map((e) => `# ${e.title}\n${e.cmd}`).join('\n\n'), shortcut: { modifiers: ['cmd', 'shift'], key: 'c' } })) }))))),
        category === 'http' && (React.createElement(List.Section, { title: `HTTP 状态码排障指南（共 ${filteredHttpStatus.length} 项）` }, filteredHttpStatus.map((item) => (React.createElement(List.Item, { key: String(item.code), id: String(item.code), icon: Icon.Globe, title: `${item.code} ${item.phrase}`, subtitle: item.meaning, accessories: [
                item.code >= 500
                    ? { tag: { value: '服务端错误', color: Color.Red } }
                    : item.code >= 400
                        ? { tag: '客户端/网关异常' }
                        : { tag: '正常/重定向' }
            ], detail: React.createElement(List.Item.Detail, { markdown: `### HTTP ${item.code} — ${item.phrase}
> **标准语义**：${item.meaning}

#### 线上核心诱因 (Root Causes)
${item.causes.map((c) => `- ${c}`).join('\n')}

#### 生产排障自查清单 (Troubleshooting)
${item.troubleshooting.map((t, i) => `${i + 1}. **${t.step}**：${t.action}`).join('\n')}

#### 架构设计提示
${item.architectureNotes}
`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6807\u51C6\u4F9D\u636E", text: item.rfc }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u72B6\u6001\u5206\u7EA7", text: `${Math.floor(item.code / 100)}xx` }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5B89\u5168\u91CD\u8BD5\u5EFA\u8BAE", text: item.isRetryable ? '支持幂等退避重试' : '不可盲目重试（需修参数/查单）' })) }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6392\u969C\u6307\u5357\u6458\u8981", content: `HTTP ${item.code} ${item.phrase}: ${item.meaning}\n${item.troubleshooting.map((t) => `- ${t.step}: ${t.action}`).join('\n')}` }),
                React.createElement(Action.CopyToClipboard, { title: "\u4EC5\u590D\u5236\u72B6\u6001\u7801\u6570\u5B57", content: String(item.code), shortcut: { modifiers: ['cmd'], key: 'c' } })) }))))),
        category === 'port' && (React.createElement(List.Section, { title: `知名网络端口与安全组基线（共 ${filteredPorts.length} 项）` }, filteredPorts.map((item) => (React.createElement(List.Item, { key: String(item.port), id: String(item.port), icon: Icon.Wifi, title: `端口 ${item.port} — ${item.service}`, subtitle: item.description, accessories: [{ tag: `${item.protocol} · ${item.category}` }], detail: React.createElement(List.Item.Detail, { markdown: `### 端口 \`${item.port}\` (${item.protocol}) — ${item.service}

#### 服务说明
${item.description}

#### 防火墙与安全组加固建议
> ${item.securityNotice}

#### 快速排查命令
\`\`\`bash
# 检查本机是否正在监听 ${item.port} 端口
ss -tulpn | grep :${item.port}
\`\`\`
`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u9ED8\u8BA4\u7AEF\u53E3\u53F7", text: String(item.port) }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u4F20\u8F93\u5C42\u534F\u8BAE", text: item.protocol }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u670D\u52A1\u7C7B\u522B", text: item.category })) }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u7AEF\u53E3\u53F7", content: String(item.port) }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u7AEF\u53E3\u76D1\u542C\u6392\u67E5\u547D\u4EE4", content: `ss -tulpn | grep :${item.port}`, shortcut: { modifiers: ['cmd'], key: 'c' } })) })))))));
}
export default LinuxHttpDictCommand;
