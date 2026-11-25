import { isRealElectronHost } from '../shared/native-ipc.js';
import React, { List, ActionPanel, Action, Icon, Color, Clipboard, showToast, ToastStyle, useState, useMemo, } from '../../index.js';
import { decodeJwtToken, verifyJwtHmacSha256, parseAndInspectUrl, } from './jwt-url-service.js';
export * from './types.js';
export * from './jwt-url-service.js';
const DEFAULT_JWT_SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEwMjQiLCJuYW1lIjoiWlRvb2xzIERldmVsb3BlciIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTczNTY4OTYwMCwiZXhwIjoxOTg4MTUwNDAwfQ.4f-8h_l7mN3vR2kX9pQ1wZ5yB6cT0dG8jL4sA2eF6uI';
export function JwtUrlCodecCommand() {
    const [mode, setMode] = useState('jwt');
    const [rawInput, setRawInput] = useState(isRealElectronHost() ? '' : DEFAULT_JWT_SAMPLE);
    const [secretInput, setSecretInput] = useState('');
    const [verifyMsg, setVerifyMsg] = useState('未验签（可通过动作面板读取剪贴板密钥验签）');
    const jwtState = useMemo(() => {
        if (mode !== 'jwt')
            return null;
        try {
            const result = decodeJwtToken(rawInput);
            return { ok: true, result };
        }
        catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }, [mode, rawInput]);
    const urlState = useMemo(() => {
        if (mode !== 'url')
            return null;
        try {
            const result = parseAndInspectUrl(rawInput);
            return { ok: true, result };
        }
        catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }, [mode, rawInput]);
    const handleLoadFromClipboard = async () => {
        try {
            const text = await Clipboard.readText();
            if (!text || !text.trim()) {
                await showToast({
                    style: ToastStyle.Failure,
                    title: '剪贴板为空',
                    message: '请先复制 JWT Token 或 URL 链接',
                });
                return;
            }
            const trimmed = text.trim();
            setRawInput(trimmed);
            if (trimmed.split('.').length === 3 && /^eyJ/.test(trimmed.replace(/^Bearer\s+/i, ''))) {
                setMode('jwt');
            }
            else if (/^https?:\/\//i.test(trimmed) || trimmed.includes('?')) {
                setMode('url');
            }
            await showToast({
                style: ToastStyle.Success,
                title: '已从剪贴板载入内容',
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
    const handleVerifyFromClipboardSecret = async () => {
        try {
            const clipSecret = (await Clipboard.readText())?.trim() || secretInput.trim();
            if (!clipSecret) {
                await showToast({
                    style: ToastStyle.Failure,
                    title: '缺少验签密钥',
                    message: '请先复制 HS256 密钥到剪贴板',
                });
                return;
            }
            setSecretInput(clipSecret);
            const res = await verifyJwtHmacSha256(rawInput, clipSecret);
            setVerifyMsg(res.verified ? `验签通过 (${res.algorithm})` : `验签失败: ${res.reason}`);
            await showToast({
                style: res.verified ? ToastStyle.Success : ToastStyle.Failure,
                title: res.verified ? 'HS256 签名校验通过' : 'HS256 签名校验失败',
                message: res.reason,
            });
        }
        catch (err) {
            await showToast({
                style: ToastStyle.Failure,
                title: '验签异常',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    };
    return (React.createElement(List, { isShowingDetail: true, searchBarPlaceholder: "\u7C98\u8D34 JWT Token \u6216 URL \u94FE\u63A5\u76F4\u63A5\u89E3\u6790...", searchText: rawInput, onSearchTextChange: setRawInput, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u5207\u6362\u89E3\u6790\u6A21\u5F0F", value: mode, onChange: (val) => setMode(val) },
            React.createElement(List.Dropdown.Item, { title: "JWT Token \u6DF1\u5EA6\u89E3\u6790", value: "jwt" }),
            React.createElement(List.Dropdown.Item, { title: "URL \u4E0E Query \u53C2\u6570\u62C6\u89E3", value: "url" })) },
        mode === 'jwt' && jwtState && !jwtState.ok && (React.createElement(List.Section, { title: "JWT \u89E3\u6790\u5F02\u5E38" },
            React.createElement(List.Item, { id: "jwt-error", title: "JWT \u7ED3\u6784\u6216\u7F16\u7801\u975E\u6CD5", subtitle: jwtState.error, icon: Icon.ExclamationMark, accessories: [{ tag: { value: '解析失败', color: Color.Red } }], detail: React.createElement(List.Item.Detail, { markdown: `### JWT 解析失败\n\n\`\`\`text\n${jwtState.error}\n\`\`\`\n\n请确认输入符合 \`Header.Payload.Signature\` 三段式 Base64URL 规范。` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: "\u4ECE\u526A\u8D34\u677F\u8F7D\u5165 Token", icon: Icon.Clipboard, onAction: () => void handleLoadFromClipboard() })) }))),
        mode === 'jwt' && jwtState && jwtState.ok && (React.createElement(List.Section, { title: "JWT \u8F7D\u8377\u4E0E\u751F\u547D\u5468\u671F\u8BCA\u65AD" },
            React.createElement(List.Item, { id: "jwt-overview", title: `算法 ${jwtState.result.algorithm} · 载荷字段 (${Object.keys(jwtState.result.payload).length} 项)`, subtitle: jwtState.result.expiryCountdownText, icon: Icon.Key, accessories: [
                    jwtState.result.isExpired
                        ? { tag: { value: 'TOKEN 已过期', color: Color.Red } }
                        : { tag: '有效期内' },
                ], detail: React.createElement(List.Item.Detail, { markdown: `### Payload JSON\n\`\`\`json\n${JSON.stringify(jwtState.result.payload, null, 2)}\n\`\`\`\n\n### Header JSON\n\`\`\`json\n${JSON.stringify(jwtState.result.header, null, 2)}\n\`\`\``, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7B7E\u540D\u7B97\u6CD5 (alg)", text: jwtState.result.algorithm }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7B7E\u53D1\u65F6\u95F4 (iat)", text: jwtState.result.issuedAtText || '未声明' }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u751F\u6548\u65F6\u95F4 (nbf)", text: jwtState.result.notBeforeText || '未声明' }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8FC7\u671F\u65F6\u95F4 (exp)", text: jwtState.result.expiresAtText || '未声明' }),
                        React.createElement(List.Item.Detail.Metadata.Separator, null),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u751F\u547D\u5468\u671F\u72B6\u6001", text: jwtState.result.expiryCountdownText }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u672C\u5730\u9A8C\u7B7E\u72B6\u6001", text: verifyMsg })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Payload JSON", content: JSON.stringify(jwtState.result.payload, null, 2) }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Header JSON", content: JSON.stringify(jwtState.result.header, null, 2) }),
                    React.createElement(Action, { title: "\u4F7F\u7528\u526A\u8D34\u677F\u5BC6\u94A5\u6821\u9A8C HS256 \u7B7E\u540D", icon: Icon.Shield, onAction: () => void handleVerifyFromClipboardSecret() }),
                    React.createElement(Action, { title: "\u4ECE\u526A\u8D34\u677F\u91CD\u65B0\u8BFB\u53D6 Token", icon: Icon.Clipboard, onAction: () => void handleLoadFromClipboard() })) }),
            Object.entries(jwtState.result.payload).map(([claimKey, claimVal]) => (React.createElement(List.Item, { key: claimKey, id: `claim-${claimKey}`, title: claimKey, subtitle: typeof claimVal === 'object' ? JSON.stringify(claimVal) : String(claimVal), icon: Icon.Code, accessories: [{ tag: typeof claimVal }], detail: React.createElement(List.Item.Detail, { markdown: `### Claim: \`${claimKey}\`\n\n\`\`\`json\n${JSON.stringify(claimVal, null, 2)}\n\`\`\`` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: `复制 ${claimKey} 值`, content: typeof claimVal === 'object' ? JSON.stringify(claimVal) : String(claimVal) })) }))))),
        mode === 'url' && urlState && !urlState.ok && (React.createElement(List.Section, { title: "URL \u89E3\u6790\u5F02\u5E38" },
            React.createElement(List.Item, { id: "url-error", title: "URL \u683C\u5F0F\u65E0\u6CD5\u8BC6\u522B", subtitle: urlState.error, icon: Icon.ExclamationMark, accessories: [{ tag: { value: '格式错误', color: Color.Red } }], detail: React.createElement(List.Item.Detail, { markdown: `### URL 解析异常\n\n\`\`\`text\n${urlState.error}\n\`\`\`` }) }))),
        mode === 'url' && urlState && urlState.ok && (React.createElement(List.Section, { title: `URL 结构与 Query 参数 (${urlState.result.queryParams.length} 项)` },
            React.createElement(List.Item, { id: "url-overview", title: urlState.result.host !== '-' ? `${urlState.result.host}${urlState.result.pathname}` : 'Query 参数集合', subtitle: urlState.result.decodedFullUrl, icon: Icon.Globe, accessories: [{ tag: urlState.result.protocol.toUpperCase() }], detail: React.createElement(List.Item.Detail, { markdown: `### 解码后完整 URL\n\`\`\`text\n${urlState.result.decodedFullUrl}\n\`\`\`\n\n### Query 参数 JSON\n\`\`\`json\n${JSON.stringify(Object.fromEntries(urlState.result.queryParams.map((p) => [
                        p.key,
                        p.decodedValue,
                    ])), null, 2)}\n\`\`\``, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u534F\u8BAE (Protocol)", text: urlState.result.protocol }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u4E3B\u673A (Host)", text: urlState.result.host }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7AEF\u53E3 (Port)", text: urlState.result.port }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8DEF\u5F84 (Pathname)", text: urlState.result.pathname }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u54C8\u5E0C\u951A\u70B9 (Hash)", text: urlState.result.hash || '无' })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u89E3\u7801\u540E\u5B8C\u6574 URL", content: urlState.result.decodedFullUrl }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Query \u53C2\u6570 JSON", content: JSON.stringify(Object.fromEntries(urlState.result.queryParams.map((p) => [
                            p.key,
                            p.decodedValue,
                        ])), null, 2) })) }),
            urlState.result.queryParams.map((param, idx) => (React.createElement(List.Item, { key: `${param.key}-${idx}`, id: `param-${param.key}-${idx}`, title: param.key, subtitle: param.decodedValue, icon: Icon.Document, accessories: [
                    param.isNestedUrl
                        ? { tag: '嵌套 URL' }
                        : param.isJsonLike
                            ? { tag: 'JSON 载荷' }
                            : { tag: 'Query' },
                ], detail: React.createElement(List.Item.Detail, { markdown: `### 参数 \`${param.key}\`\n\n#### 解码值\n\`\`\`text\n${param.decodedValue}\n\`\`\`\n\n#### 原始编码值\n\`\`\`text\n${param.rawValue}\n\`\`\`` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u89E3\u7801\u503C", content: param.decodedValue }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 key=value", content: `${param.key}=${param.rawValue}` })) })))))));
}
export default JwtUrlCodecCommand;
