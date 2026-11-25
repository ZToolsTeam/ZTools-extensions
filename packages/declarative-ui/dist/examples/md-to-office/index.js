import React, { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { callHostTransport } from '../shared/native-ipc.js';
import { buildWordClipboardHtml, exportMarkdownToDocxFile, parseMarkdownAST } from './md-to-office-service.js';
export * from './types.js';
export * from './md-to-office-service.js';
function getElementIcon(type) {
    switch (type) {
        case 'heading':
            return Icon.Pin;
        case 'table':
            return Icon.List;
        case 'code':
            return Icon.Code;
        default:
            return Icon.Document;
    }
}
export function MdToOfficeCommand(props = {}) {
    const [markdownText, setMarkdownText] = useState(props.initialMarkdown ?? '');
    const [preset, setPreset] = useState(props.initialPreset ?? 'official');
    const [fontSize, setFontSize] = useState(props.initialFontSize ?? 'size-3');
    const [firstLineIndent, setFirstLineIndent] = useState(true);
    const [searchText, setSearchText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const handleReadClipboard = async () => {
        setIsLoading(true);
        try {
            let res = await callHostTransport('dllplugin_call', {
                plugin: 'MdToOfficePlugin',
                func: 'read_clipboard_md',
                params: { action: 'read_clipboard_md' }
            }, props.hostOverride);
            if (!res.ok || !(res.data?.text || res.data?.markdown)) {
                res = await callHostTransport('md_to_office', { action: 'read_clipboard_md' }, props.hostOverride);
            }
            const text = String(res.data?.text ?? res.data?.markdown ?? '').trim();
            if (!text) {
                await showToast({
                    style: Toast.Style.Failure,
                    title: '剪贴板中暂无可解析的 Markdown 文本'
                });
                return;
            }
            setMarkdownText(text);
            await showToast({
                style: Toast.Style.Success,
                title: `已载入剪贴板文本`
            });
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        if (!props.initialMarkdown) {
            void handleReadClipboard();
        }
    }, [props.featureCode]);
    const parsed = useMemo(() => parseMarkdownAST(markdownText), [markdownText]);
    const docMeta = parsed.elements.length > 0 ? parsed.metadata : null;
    const filteredElements = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        if (!q)
            return parsed.elements;
        return parsed.elements.filter((el) => el.title.toLowerCase().includes(q) ||
            el.typeLabel.toLowerCase().includes(q) ||
            el.rawContent.toLowerCase().includes(q));
    }, [parsed.elements, searchText]);
    const handleExportDocx = async () => {
        if (!markdownText.trim()) {
            await showToast({
                style: Toast.Style.Failure,
                title: '请先粘贴或载入有效的 Markdown 文本'
            });
            return;
        }
        setIsLoading(true);
        try {
            let dialogRes = await callHostTransport('window_show_save_dialog', {
                title: '导出为标准 Word 文档 (.docx)',
                defaultPath: `${parsed.metadata.title || 'AI研报文档'}.docx`
            }, props.hostOverride);
            if (!dialogRes.ok || !dialogRes.data?.filePath) {
                dialogRes = await callHostTransport('dialog_show_save', {
                    title: '导出为标准 Word 文档 (.docx)',
                    defaultPath: `${parsed.metadata.title || 'AI研报文档'}.docx`
                }, props.hostOverride);
            }
            const savePath = dialogRes.data?.filePath;
            const res = await exportMarkdownToDocxFile(markdownText, { preset, fontSize, firstLineIndent }, savePath, props.hostOverride);
            if (!res.ok) {
                await showToast({
                    style: Toast.Style.Failure,
                    title: res.error || '导出 Word 文档失败'
                });
                return;
            }
            await showToast({
                style: Toast.Style.Success,
                title: `已生成原生 Word 文档 (${Math.max(1, Math.round((res.byteLength ?? 0) / 1024))} KB)`
            });
        }
        catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: err instanceof Error ? err.message : String(err)
            });
        }
        finally {
            setIsLoading(false);
        }
    };
    const handleCopyRichText = async () => {
        if (!markdownText.trim()) {
            await showToast({
                style: Toast.Style.Failure,
                title: '请先粘贴或载入有效的 Markdown 文本'
            });
            return;
        }
        try {
            const html = buildWordClipboardHtml(markdownText, {
                preset,
                fontSize,
                firstLineIndent
            });
            const dllRes = await callHostTransport('dllplugin_call', {
                plugin: 'MdToOfficePlugin',
                func: 'copy_rich_html',
                params: { action: 'copy_rich_html', html, plainText: markdownText }
            }, props.hostOverride);
            if (!dllRes.ok) {
                await callHostTransport('md_to_office', { action: 'copy_rich_html', html, plainText: markdownText }, props.hostOverride);
            }
            await showToast({
                style: Toast.Style.Success,
                title: '已复制为 Word 排版格式，切回 Word/WPS 按 Ctrl+V 即可粘贴'
            });
        }
        catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: err instanceof Error ? err.message : String(err)
            });
        }
    };
    return (React.createElement(List, { navigationTitle: "AI\u6587\u6863\u8F6CWord", isLoading: isLoading, isShowingDetail: false, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u6587\u6863\u63D0\u53D6\u7684\u6807\u9898\u5927\u7EB2\u3001\u8868\u683C\u6216\u4EE3\u7801\u5757...", filterBar: {
            summaryText: docMeta
                ? `共 ${docMeta.wordCount} 字 · 识别 ${docMeta.headingsCount} 个标题、${docMeta.tablesCount} 个表格、${docMeta.codeBlocksCount} 处代码块`
                : '支持 DeepSeek / ChatGPT 研报、党政公文、学术三线表一键转 Word (.docx)',
            actions: [
                {
                    id: 'paste-clipboard',
                    title: '读取剪贴板',
                    onAction: () => {
                        void handleReadClipboard();
                    }
                },
                {
                    id: 'export-docx',
                    title: '导出为 Word (.docx)',
                    onAction: () => {
                        void handleExportDocx();
                    }
                }
            ]
        }, workbenchPanel: {
            title: docMeta ? docMeta.title : '请粘贴或载入 Markdown 文本',
            subtitle: docMeta
                ? `共 ${docMeta.wordCount} 字 · ${docMeta.headingsCount} 个标题 · ${docMeta.tablesCount} 个表格`
                : '纯本地 OpenXML 排版转换引擎',
            fields: [
                {
                    id: 'stylePreset',
                    label: '排版规范风格',
                    type: 'select',
                    value: preset,
                    options: [
                        { label: '中国党政公文规范 (仿宋 / 黑体 / 28磅行距)', value: 'official' },
                        { label: '现代商务研报规范 (微软雅黑 / 雅致表头)', value: 'business' },
                        { label: '学术论文规范 (宋体 / TNR / 学术三线表)', value: 'academic' }
                    ],
                    onChange: (val) => setPreset(val)
                },
                {
                    id: 'fontSize',
                    label: '正文字号',
                    type: 'select',
                    value: fontSize,
                    options: [
                        { label: '三号字 (公文标准 16pt)', value: 'size-3' },
                        { label: '小四号字 (报告通用 12pt)', value: 'size-s4' },
                        { label: '五号字 (紧凑排版 10.5pt)', value: 'size-5' }
                    ],
                    onChange: (val) => setFontSize(val)
                },
                {
                    id: 'firstLineIndent',
                    label: '首行缩进 2 字符 (200 字符单位)',
                    type: 'toggle',
                    value: firstLineIndent,
                    onChange: (val) => setFirstLineIndent(Boolean(val))
                }
            ],
            previewCard: {
                title: preset === 'official'
                    ? '二号方正小标宋标题 · 三号仿宋正文 · 28磅固定行距'
                    : preset === 'academic'
                        ? '黑体章节标题 · 宋体+Times New Roman · 国家标准学术三线表'
                        : '微软雅黑现代商务层级 · 自适应网格数据表',
                subtitle: docMeta
                    ? `已解析 ${parsed.elements.length} 个结构块，按 Enter 一键导出 .docx`
                    : '等待剪贴板或文件载入 Markdown 内容'
            }
        }, subList: {
            title: `文档结构大纲与核心要素 (${filteredElements.length} 项)`,
            subtitle: '按 Enter 导出为 Word (.docx)，或复制为富文本直接粘贴至 Word',
            emptyText: '请在剪贴板复制 Markdown 文本后点击「读取剪贴板」',
            items: filteredElements.map((el) => (React.createElement(List.Item, { key: el.id, id: el.id, title: el.title, subtitle: el.preview, icon: getElementIcon(el.type), accessories: [{ tag: el.typeLabel }, { text: el.extraInfo }], actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: "\u5BFC\u51FA\u4E3A Word (.docx)", icon: Icon.Download, onAction: handleExportDocx }),
                    React.createElement(Action, { title: "\u590D\u5236\u5BCC\u6587\u672C (\u76F4\u63A5\u53BB Word \u7C98\u8D34)", icon: Icon.Clipboard, onAction: handleCopyRichText }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8BE5\u6BB5\u539F\u59CB\u6587\u672C", content: el.rawContent })) })))
        } }));
}
export default MdToOfficeCommand;
