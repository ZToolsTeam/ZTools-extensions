import { isRealElectronHost } from '../shared/native-ipc.js';
import React, { List, ActionPanel, Action, Icon, Color, Clipboard, showToast, ToastStyle, useState, useMemo, } from '../../index.js';
import { parseCurlCommand, generateCodeFromCurl, executeCurlRequest, } from './curl-service.js';
export * from './types.js';
export * from './curl-service.js';
const DEFAULT_CURL_SAMPLE = 'curl -X POST "https://httpbin.org/post" -H "Content-Type: application/json" -H "X-Client: ZTools" -d \'{"query":"declarative-ui","limit":10}\'';
export function CurlHttpCommand() {
    const [rawCurl, setRawCurl] = useState(isRealElectronHost() ? '' : DEFAULT_CURL_SAMPLE);
    const [targetLang, setTargetLang] = useState('fetch');
    const [responseSnap, setResponseSnap] = useState(null);
    const [isSending, setIsSending] = useState(false);
    const parsedState = useMemo(() => {
        try {
            const parsed = parseCurlCommand(rawCurl);
            const generatedCode = generateCodeFromCurl(parsed, targetLang);
            return { ok: true, parsed, generatedCode };
        }
        catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }, [rawCurl, targetLang]);
    const handleLoadClipboard = async () => {
        try {
            const clip = await Clipboard.readText();
            if (!clip || !clip.trim()) {
                await showToast({
                    style: ToastStyle.Failure,
                    title: '剪贴板为空',
                    message: '请先从浏览器 DevTools 复制 Copy as cURL 命令',
                });
                return;
            }
            setRawCurl(clip.trim());
            setResponseSnap(null);
            await showToast({
                style: ToastStyle.Success,
                title: '已载入剪贴板 cURL 命令',
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
    const handleSendRequest = async () => {
        if (!parsedState.ok || isSending)
            return;
        setIsSending(true);
        try {
            const snap = await executeCurlRequest(parsedState.parsed);
            setResponseSnap(snap);
            await showToast({
                style: snap.ok ? ToastStyle.Success : ToastStyle.Failure,
                title: `HTTP ${snap.status} (${snap.elapsedMs}ms)`,
                message: `${snap.sizeBytes} bytes`,
            });
        }
        catch (err) {
            await showToast({
                style: ToastStyle.Failure,
                title: '请求执行失败',
                message: err instanceof Error ? err.message : String(err),
            });
        }
        finally {
            setIsSending(false);
        }
    };
    return (React.createElement(List, { isShowingDetail: true, isLoading: isSending, searchBarPlaceholder: "\u7C98\u8D34 cURL \u547D\u4EE4\u6216 HTTP URL...", searchText: rawCurl, onSearchTextChange: setRawCurl, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u9009\u62E9\u76EE\u6807\u4EE3\u7801\u8BED\u8A00", value: targetLang, onChange: (val) => setTargetLang(val) },
            React.createElement(List.Dropdown.Item, { title: "JavaScript Fetch", value: "fetch" }),
            React.createElement(List.Dropdown.Item, { title: "TypeScript Axios", value: "axios" }),
            React.createElement(List.Dropdown.Item, { title: "Python Requests", value: "python" }),
            React.createElement(List.Dropdown.Item, { title: "Go net/http", value: "go" })) },
        !parsedState.ok && (React.createElement(List.Section, { title: "cURL \u8BED\u6CD5\u89E3\u6790\u9519\u8BEF" },
            React.createElement(List.Item, { id: "curl-parse-error", title: "\u65E0\u6CD5\u89E3\u6790 cURL \u547D\u4EE4", subtitle: parsedState.error, icon: Icon.ExclamationMark, accessories: [{ tag: { value: '语法错误', color: Color.Red } }], detail: React.createElement(List.Item.Detail, { markdown: `### cURL 解析异常\n\n\`\`\`text\n${parsedState.error}\n\`\`\`\n\n支持从 Chrome / Edge DevTools 直接复制 \`Copy as cURL (bash / cmd / PowerShell)\`。` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: "\u4ECE\u526A\u8D34\u677F\u7C98\u8D34 cURL", icon: Icon.Clipboard, onAction: () => void handleLoadClipboard() })) }))),
        parsedState.ok && (React.createElement(List.Section, { title: "\u8BF7\u6C42\u7ED3\u6784\u4E0E\u591A\u8BED\u8A00\u4EE3\u7801\u4E92\u8F6C" },
            React.createElement(List.Item, { id: "curl-overview", title: `${parsedState.parsed.method} ${parsedState.parsed.url}`, subtitle: `Headers: ${Object.keys(parsedState.parsed.headers).length} 项 · 代码目标: ${targetLang.toUpperCase()}`, icon: Icon.Terminal, accessories: [
                    responseSnap
                        ? responseSnap.ok
                            ? { tag: `HTTP ${responseSnap.status} · ${responseSnap.elapsedMs}ms` }
                            : {
                                tag: {
                                    value: `HTTP ${responseSnap.status}`,
                                    color: Color.Red,
                                },
                            }
                        : { tag: parsedState.parsed.method },
                ], detail: React.createElement(List.Item.Detail, { markdown: `### 生成代码 (${targetLang.toUpperCase()})\n\`\`\`${targetLang === 'python' ? 'python' : targetLang === 'go' ? 'go' : 'ts'}\n${parsedState.generatedCode}\n\`\`\`\n\n${responseSnap
                        ? `### 实时响应结果 (HTTP ${responseSnap.status} · ${responseSnap.elapsedMs}ms)\n\`\`\`json\n${responseSnap.bodyText}\n\`\`\``
                        : '### 实时响应结果\n按回车执行「立即发起 HTTP 请求」即可在本地验证此接口并查看响应载荷。'}`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8BF7\u6C42\u65B9\u6CD5 (Method)", text: parsedState.parsed.method }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u76EE\u6807\u5730\u5740 (URL)", text: parsedState.parsed.url }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8BF7\u6C42\u5934\u6570\u91CF", text: `${Object.keys(parsedState.parsed.headers).length} 项` }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8BF7\u6C42\u4F53 (Body)", text: parsedState.parsed.body
                                ? `${parsedState.parsed.body.length} 字符`
                                : '无请求体' })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: "\u7ACB\u5373\u53D1\u8D77 HTTP \u8BF7\u6C42", icon: Icon.Play, onAction: () => void handleSendRequest() }),
                    React.createElement(Action.CopyToClipboard, { title: `复制 ${targetLang.toUpperCase()} 代码`, content: parsedState.generatedCode }),
                    responseSnap && (React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u54CD\u5E94 Body", content: responseSnap.bodyText })),
                    React.createElement(Action, { title: "\u4ECE\u526A\u8D34\u677F\u8F7D\u5165 cURL", icon: Icon.Clipboard, onAction: () => void handleLoadClipboard() })) }),
            Object.entries(parsedState.parsed.headers).map(([hKey, hVal]) => (React.createElement(List.Item, { key: hKey, id: `header-${hKey}`, title: hKey, subtitle: String(hVal), icon: Icon.Code, accessories: [{ tag: 'Header' }], detail: React.createElement(List.Item.Detail, { markdown: `### Request Header: \`${hKey}\`\n\n\`\`\`text\n${String(hVal)}\n\`\`\`` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: `复制 ${hKey}`, content: `${hKey}: ${String(hVal)}` })) })))))));
}
export default CurlHttpCommand;
