import { isRealElectronHost } from '../shared/native-ipc.js';
import React, { List, ActionPanel, Action, Icon, Color, Clipboard, showToast, ToastStyle, useState, useMemo, } from '../../index.js';
import { optimizeSvgSource } from './svg-service.js';
export * from './types.js';
export * from './svg-service.js';
const DEFAULT_SVG_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Sketch 64.1 - https://sketch.com -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:sketch="http://www.bohemiancoding.com/sketch/ns" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.754321" stroke-linecap="round" stroke-linejoin="round">
  <metadata>Created with Sketch</metadata>
  <polygon points="12.00001 2.00004 2.00002 7.00009 12.00001 12.00005 22.00008 7.00009 12.00001 2.00004" />
  <polyline points="2.00002 17.00001 12.00001 22.00006 22.00008 17.00001" />
  <polyline points="2.00002 12.00005 12.00001 17.00001 22.00008 12.00005" />
</svg>`;
export function SvgIconStudioCommand() {
    const [rawSvg, setRawSvg] = useState(isRealElectronHost() ? '' : DEFAULT_SVG_SAMPLE);
    const [exportFormat, setExportFormat] = useState('minified');
    const svgState = useMemo(() => {
        try {
            const result = optimizeSvgSource(rawSvg);
            return { ok: true, result };
        }
        catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }, [rawSvg]);
    const handleLoadClipboard = async () => {
        try {
            const clip = await Clipboard.readText();
            if (!clip || !clip.trim()) {
                await showToast({
                    style: ToastStyle.Failure,
                    title: '剪贴板为空',
                    message: '请先复制 <svg>...</svg> 源码到剪贴板',
                });
                return;
            }
            setRawSvg(clip.trim());
            await showToast({
                style: ToastStyle.Success,
                title: '已载入剪贴板 SVG 源码',
            });
        }
        catch (err) {
            await showToast({
                style: ToastStyle.Failure,
                title: '读取剪贴板失败',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    };
    return (React.createElement(List, { isShowingDetail: true, searchBarPlaceholder: "\u7C98\u8D34 <svg>...</svg> \u6E90\u7801\u5B9E\u65F6\u51C0\u5316\u538B\u7F29...", searchText: rawSvg, onSearchTextChange: setRawSvg, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u9009\u62E9\u5BFC\u51FA\u4EE3\u7801\u683C\u5F0F", value: exportFormat, onChange: (val) => setExportFormat(val) },
            React.createElement(List.Dropdown.Item, { title: "\u538B\u7F29\u540E SVG (Minified)", value: "minified" }),
            React.createElement(List.Dropdown.Item, { title: "React TSX \u65E0\u72B6\u6001\u7EC4\u4EF6", value: "react-tsx" }),
            React.createElement(List.Dropdown.Item, { title: "Vue 3 SFC \u5355\u6587\u4EF6\u7EC4\u4EF6", value: "vue-sfc" }),
            React.createElement(List.Dropdown.Item, { title: "Data URI (UTF-8 / Base64)", value: "data-uri" })) },
        !svgState.ok && (React.createElement(List.Section, { title: "SVG \u89E3\u6790\u5F02\u5E38" },
            React.createElement(List.Item, { id: "svg-error", title: "SVG \u6E90\u7801\u4E0D\u5408\u6CD5", subtitle: svgState.error, icon: Icon.ExclamationMark, accessories: [{ tag: { value: '解析失败', color: Color.Red } }], detail: React.createElement(List.Item.Detail, { markdown: `### SVG 校验未通过\n\n\`\`\`text\n${svgState.error}\n\`\`\`\n\n请粘贴包含完整 \`<svg ...>...</svg>\` 标签的矢量图代码。` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: "\u4ECE\u526A\u8D34\u677F\u8F7D\u5165 SVG", icon: Icon.Clipboard, onAction: () => void handleLoadClipboard() })) }))),
        svgState.ok && (React.createElement(List.Section, { title: "SVG \u538B\u7F29\u4F18\u5316\u4E0E\u591A\u6846\u67B6\u4EE3\u7801\u5BFC\u51FA" },
            React.createElement(List.Item, { id: "svg-minified", title: "\u65E0\u635F\u538B\u7F29 SVG (Minified)", subtitle: `${svgState.result.metrics.originalBytes} B -> ${svgState.result.metrics.optimizedBytes} B (节省 ${svgState.result.metrics.savedPercentage}%)`, icon: Icon.Code, accessories: [
                    svgState.result.metrics.removedDangerousNodes > 0
                        ? {
                            tag: {
                                value: `已拦截 ${svgState.result.metrics.removedDangerousNodes} 处 XSS 节点`,
                                color: Color.Red,
                            },
                        }
                        : { tag: `-${svgState.result.metrics.savedPercentage}%` },
                ], detail: React.createElement(List.Item.Detail, { markdown: `### 压缩后 SVG 源码\n\`\`\`xml\n${svgState.result.optimizedSvg}\n\`\`\`\n\n### React TSX 组件预览\n\`\`\`tsx\n${svgState.result.reactTsxCode}\n\`\`\``, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u539F\u59CB\u4F53\u79EF", text: `${svgState.result.metrics.originalBytes} Bytes` }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u538B\u7F29\u540E\u4F53\u79EF", text: `${svgState.result.metrics.optimizedBytes} Bytes` }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u538B\u7F29\u7387", text: `节省 ${svgState.result.metrics.savedBytes} Bytes (${svgState.result.metrics.savedPercentage}%)` }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u753B\u5E03\u89C6\u53E3 (viewBox)", text: svgState.result.metrics.viewBox }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u56FE\u5F62\u8282\u70B9\u6570", text: `${svgState.result.metrics.pathCount} 个矢量图元` })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u538B\u7F29\u540E SVG", content: svgState.result.optimizedSvg }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 React TSX \u7EC4\u4EF6", content: svgState.result.reactTsxCode }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Vue 3 SFC \u7EC4\u4EF6", content: svgState.result.vueSfcCode }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Base64 Data URI", content: svgState.result.base64DataUri }),
                    React.createElement(Action, { title: "\u4ECE\u526A\u8D34\u677F\u8F7D\u5165\u65B0 SVG", icon: Icon.Clipboard, onAction: () => void handleLoadClipboard() })) }),
            React.createElement(List.Item, { id: "svg-react-tsx", title: "React TSX \u65E0\u72B6\u6001\u56FE\u6807\u7EC4\u4EF6", subtitle: "\u81EA\u52A8\u8F6C\u6362 strokeWidth / fillRule / clipRule \u9A7C\u5CF0\u5C5E\u6027\u5E76\u900F\u4F20 SVGProps", icon: Icon.Document, accessories: [{ tag: 'React TSX' }], detail: React.createElement(List.Item.Detail, { markdown: `### React TSX 组件代码\n\`\`\`tsx\n${svgState.result.reactTsxCode}\n\`\`\`` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 React TSX \u7EC4\u4EF6", content: svgState.result.reactTsxCode })) }),
            React.createElement(List.Item, { id: "svg-vue-sfc", title: "Vue 3 SFC \u5355\u6587\u4EF6\u56FE\u6807\u7EC4\u4EF6", subtitle: "\u6807\u51C6 <template> + <script setup lang='ts'> \u7ED3\u6784", icon: Icon.Document, accessories: [{ tag: 'Vue 3 SFC' }], detail: React.createElement(List.Item.Detail, { markdown: `### Vue 3 SFC 组件代码\n\`\`\`vue\n${svgState.result.vueSfcCode}\n\`\`\`` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Vue 3 SFC \u7EC4\u4EF6", content: svgState.result.vueSfcCode })) }),
            React.createElement(List.Item, { id: "svg-data-uri", title: "CSS / Image \u5185\u8054 Data URI", subtitle: svgState.result.base64DataUri.slice(0, 72), icon: Icon.Eye, accessories: [{ tag: 'Data URI' }], detail: React.createElement(List.Item.Detail, { markdown: `### UTF-8 Data URI\n\`\`\`text\n${svgState.result.dataUri}\n\`\`\`\n\n### Base64 Data URI\n\`\`\`text\n${svgState.result.base64DataUri}\n\`\`\`` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 UTF-8 Data URI", content: svgState.result.dataUri }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Base64 Data URI", content: svgState.result.base64DataUri })) })))));
}
export default SvgIconStudioCommand;
