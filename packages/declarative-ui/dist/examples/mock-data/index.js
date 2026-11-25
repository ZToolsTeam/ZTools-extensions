import React, { Action, ActionPanel, Icon, List, Toast, showToast, useMemo, useState } from '../../index.js';
import { generateMockBatchUsers, generateMockSingleItems } from './mock-service.js';
export * from './types.js';
export * from './mock-service.js';
export function MockDataCommand(props = {}) {
    const defaultTab = props.initialTab ?? (props.featureCode === 'mock-batch-json' ? 'batch' : 'single');
    const [tab, setTab] = useState(defaultTab);
    const [searchText, setSearchText] = useState('');
    const [seed, setSeed] = useState(props.initialSeed ?? 20261025);
    const singleItems = useMemo(() => {
        const all = generateMockSingleItems(seed);
        const q = searchText.trim().toLowerCase();
        if (!q || tab !== 'single')
            return all;
        return all.filter((item) => item.label.toLowerCase().includes(q) ||
            item.category.toLowerCase().includes(q) ||
            item.value.toLowerCase().includes(q));
    }, [seed, searchText, tab]);
    const batchSize = useMemo(() => {
        if (tab !== 'batch')
            return 10;
        const parsed = Number(searchText.trim());
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 500)
            return parsed;
        return 10;
    }, [tab, searchText]);
    const batchUsers = useMemo(() => generateMockBatchUsers(batchSize, seed), [batchSize, seed]);
    const batchJsonString = useMemo(() => JSON.stringify(batchUsers, null, 2), [batchUsers]);
    const handleRegenerate = async () => {
        setSeed((prev) => prev + 101);
        await showToast({
            style: Toast.Style.Success,
            title: '已重新生成一批 100% 校验位合规的测试数据'
        });
    };
    return (React.createElement(List, { searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: tab === 'single'
            ? '搜索测试数据类型（如：身份证、统一社会信用代码、银行卡、手机号）...'
            : '输入批量生成的 JSON 记录条数（默认 10 条，支持 1~500）...', searchBarAccessory: React.createElement(List.Dropdown, { value: tab, onChange: (v) => setTab(v), tooltip: "\u5207\u6362\u6D4B\u8BD5\u6570\u636E\u751F\u6210\u6A21\u5F0F" },
            React.createElement(List.Dropdown.Item, { title: "\u5355\u9879\u6781\u901F\u751F\u6210 (\u5E26\u6821\u9A8C\u4F4D)", value: "single", icon: Icon.Document }),
            React.createElement(List.Dropdown.Item, { title: "\u6279\u91CF\u7528\u6237 JSON \u6570\u7EC4", value: "batch", icon: Icon.Code })), isShowingDetail: true },
        tab === 'single' && (React.createElement(List.Section, { title: "\u7B26\u5408\u56FD\u5BB6\u6821\u9A8C\u4F4D\u6807\u51C6\u7B97\u6CD5\u7684\u865A\u62DF\u6D4B\u8BD5\u6570\u636E\uFF08\u56DE\u8F66\u5373\u590D\u5236\uFF09" }, singleItems.map((item) => (React.createElement(List.Item, { key: item.id, id: item.id, icon: Icon.CheckCircle, title: item.label, subtitle: item.value, accessories: [{ tag: item.standard }], detail: React.createElement(List.Item.Detail, { markdown: `### ${item.label}
\`\`\`text
${item.value}
\`\`\`

#### 编码结构拆解
${item.breakdownMarkdown}

#### 校验位算法说明
> ${item.algorithmNote}

*声明：本数据由纯本地数学公式即时合成，不对应任何真实自然人或企业，仅供研发联调测试。*
`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u9075\u5FAA\u6807\u51C6", text: item.standard }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u6821\u9A8C\u72B6\u6001", text: "100% \u7B97\u6CD5\u5408\u89C4\u901A\u8FC7" }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u683C\u5F0F\u7279\u5F81", text: item.formatType })) }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8BE5\u6D4B\u8BD5\u6570\u503C", content: item.value }),
                React.createElement(Action, { title: "\u6362\u4E00\u6279\u5168\u65B0\u7684\u5408\u89C4\u6D4B\u8BD5\u6570\u636E", icon: Icon.ArrowClockwise, shortcut: { modifiers: ['cmd'], key: 'r' }, onAction: handleRegenerate }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u952E\u503C\u5BF9 JSON", content: JSON.stringify({ [item.fieldKey]: item.value }, null, 2), shortcut: { modifiers: ['cmd', 'shift'], key: 'c' } })) }))))),
        tab === 'batch' && (React.createElement(List.Section, { title: "\u6279\u91CF\u7ED3\u6784\u5316 Mock \u7528\u6237\u6570\u7EC4" },
            React.createElement(List.Item, { id: "batch-users-json", icon: Icon.Code, title: `批量模拟用户列表 JSON (${batchUsers.length} 条完整记录)`, subtitle: "\u542B\u59D3\u540D\u300118\u4F4D\u8EAB\u4EFD\u8BC1\u3001\u624B\u673A\u53F7\u3001\u4FE1\u7528\u4EE3\u7801\u3001Luhn \u94F6\u884C\u5361", accessories: [{ tag: `${batchUsers.length} 条已就绪` }], detail: React.createElement(List.Item.Detail, { markdown: `### 批量 Mock JSON 数组预览 (${batchUsers.length} 条)
\`\`\`json
${batchJsonString}
\`\`\`
`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u751F\u6210\u6761\u6570", text: `${batchUsers.length} 条` }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "JSON \u4F53\u79EF", text: `${(batchJsonString.length / 1024).toFixed(1)} KB` })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5B8C\u6574 JSON \u6570\u7EC4", content: batchJsonString }),
                    React.createElement(Action, { title: "\u91CD\u65B0\u968F\u673A\u751F\u6210\u4E00\u6279", icon: Icon.ArrowClockwise, shortcut: { modifiers: ['cmd'], key: 'r' }, onAction: handleRegenerate })) })))));
}
export default MockDataCommand;
