import React, { Action, ActionPanel, Clipboard, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { buildAllConversionTargets, detectAndParse } from './table-service.js';
export * from './types.js';
export * from './table-service.js';
const DEFAULT_SAMPLE_TSV = [
    '服务模块\tQPS峰值\tP99延迟(ms)\t核心状态',
    'ztools-indexer\t48500\t1.8\ttrue',
    'declarative-reconciler\t19200\t3.2\ttrue',
    'host-ipc-bridge\t12800\t2.4\ttrue'
].join('\n');
export function TableConverterCommand(props = {}) {
    const [rawText, setRawText] = useState(props.initialRawText ?? DEFAULT_SAMPLE_TSV);
    const [headerMode, setHeaderMode] = useState(props.initialHeaderMode ?? 'first-row-header');
    const [sqlTableName] = useState(props.initialSqlTableName ?? 'my_table');
    const [searchText, setSearchText] = useState('');
    const [isConverting, setIsConverting] = useState(false);
    const handleReadClipboard = async () => {
        setIsConverting(true);
        try {
            const clipText = await Clipboard.readText();
            if (clipText && clipText.trim()) {
                setRawText(clipText);
                await showToast({
                    style: Toast.Style.Success,
                    title: '已从剪贴板读取表格数据'
                });
            }
        }
        catch {
            // Keep current text if clipboard is empty or unavailable
        }
        finally {
            setIsConverting(false);
        }
    };
    useEffect(() => {
        if (props.initialRawText === undefined) {
            void handleReadClipboard();
        }
    }, [props.featureCode]);
    const parsed = useMemo(() => detectAndParse(rawText, headerMode === 'first-row-header'), [rawText, headerMode]);
    const conversionTargets = useMemo(() => {
        const targets = buildAllConversionTargets(parsed.grid, sqlTableName);
        const q = searchText.trim().toLowerCase();
        if (!q)
            return targets;
        return targets.filter((t) => t.title.toLowerCase().includes(q) ||
            t.subtitle.toLowerCase().includes(q) ||
            t.id.toLowerCase().includes(q));
    }, [parsed.grid, sqlTableName, searchText]);
    const rowCount = parsed.grid.rows.length;
    const colCount = parsed.grid.headers.length;
    return (React.createElement(List, { navigationTitle: "\u8868\u683C\u4E92\u8F6C", isLoading: isConverting, isShowingDetail: true, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u5207\u6362\u76EE\u6807\u8F6C\u6362\u683C\u5F0F\uFF08Markdown / JSON / SQL / HTML / CSV\uFF09...", searchBarAccessory: React.createElement(List.Dropdown, { value: headerMode, onChange: (val) => setHeaderMode(val), tooltip: "\u8868\u5934\u8BC6\u522B\u6A21\u5F0F" },
            React.createElement(List.Dropdown.Item, { title: "\u7B2C\u4E00\u884C\u4E3A\u5217\u6807\u9898\uFF08\u9996\u884C\u8868\u5934\uFF09", value: "first-row-header", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u7EAF\u6570\u636E\u65E0\u8868\u5934\uFF08\u81EA\u52A8\u5206\u914D col_1, col_2...\uFF09", value: "no-header", icon: Icon.Code })), filterBar: {
            summaryText: parsed.format === 'empty'
                ? '等待输入或从剪贴板粘贴表格数据'
                : `识别源格式: ${parsed.format.toUpperCase()} · 共 ${rowCount} 行 × ${colCount} 列`,
            actions: [
                {
                    id: 'read-clipboard',
                    title: '读取剪贴板',
                    onAction: () => {
                        void handleReadClipboard();
                    }
                }
            ]
        } }, conversionTargets.map((target) => (React.createElement(List.Item, { key: target.id, id: target.id, title: target.title, subtitle: target.subtitle, icon: target.id === 'markdown' ? Icon.Document : Icon.Code, accessories: [{ tag: target.badge }], detail: React.createElement(List.Item.Detail, { markdown: `\`\`\`${target.language}\n${target.previewText}\n\`\`\``, metadata: React.createElement(List.Item.Detail.Metadata, null,
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8F93\u51FA\u683C\u5F0F", text: target.title }),
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u884C\u6570 / \u5217\u6570", text: `${rowCount} 行 × ${colCount} 列` }),
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8F93\u51FA\u5B57\u7B26\u6570", text: `${target.fullText.length} 字符` }),
                React.createElement(List.Item.Detail.Metadata.Separator, null),
                React.createElement(List.Item.Detail.Metadata.Label, { title: "\u63A8\u65AD\u5217\u7C7B\u578B", text: target.typeSummary })) }), actions: React.createElement(ActionPanel, null,
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8F6C\u6362\u7ED3\u679C", content: target.fullText, icon: Icon.Clipboard }),
            React.createElement(Action.Paste, { title: "\u76F4\u63A5\u4E0A\u5C4F\u7C98\u8D34", content: target.fullText, icon: Icon.Text, shortcut: { modifiers: ['cmd'], key: 'enter' } }),
            React.createElement(Action, { title: "\u91CD\u65B0\u8BFB\u53D6\u526A\u8D34\u677F", icon: Icon.ArrowClockwise, shortcut: { modifiers: ['cmd'], key: 'r' }, onAction: handleReadClipboard })) })))));
}
export default TableConverterCommand;
