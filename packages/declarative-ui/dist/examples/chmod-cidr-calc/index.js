import React, { List, ActionPanel, Action, Icon, Color, useState, useMemo, } from '../../index.js';
import { calculateIpv4Cidr, convertChmod } from './chmod-cidr-service.js';
export * from './types.js';
export * from './chmod-cidr-service.js';
const PRESET_CIDRS = [
    '192.168.1.0/24',
    '10.244.0.0/16',
    '172.16.32.0/20',
    '192.168.10.128/26',
    '10.0.0.1/31',
    '203.0.113.42/32',
];
const PRESET_CHMODS = [
    { code: '755', desc: '可执行程序 / 公开目录标准权限 (rwxr-xr-x)' },
    { code: '644', desc: '常规配置文件 / 静态资源标准权限 (rw-r--r--)' },
    { code: '600', desc: 'SSH 私钥 (~/.ssh/id_ed25519) 严格私有权限 (rw-------)' },
    { code: '700', desc: '私有目录 (~/.ssh) 仅属主可访问权限 (rwx------)' },
    { code: '777', desc: '全放开读写执行权限（存在安全风险）' },
];
export function ChmodCidrCalcCommand() {
    const [mode, setMode] = useState('cidr');
    const [queryText, setQueryText] = useState('192.168.1.0/24');
    const cidrState = useMemo(() => {
        if (mode !== 'cidr')
            return null;
        try {
            const result = calculateIpv4Cidr(queryText);
            return { ok: true, result };
        }
        catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }, [mode, queryText]);
    const chmodState = useMemo(() => {
        if (mode !== 'chmod')
            return null;
        try {
            const result = convertChmod(queryText);
            return { ok: true, result };
        }
        catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }, [mode, queryText]);
    return (React.createElement(List, { isShowingDetail: true, searchBarPlaceholder: mode === 'cidr'
            ? '输入 IPv4/CIDR（如 192.168.1.0/24 或 10.0.0.1/28）...'
            : '输入八进制权限（如 755、600）或符号权限（如 rwxr-xr-x）...', searchText: queryText, onSearchTextChange: (val) => {
            setQueryText(val);
            const trimmed = (val || '').trim();
            if (trimmed) {
                if (trimmed.includes('.') || trimmed.includes('/')) {
                    setMode('cidr');
                }
                else if (/^[0-7]{3}$/.test(trimmed) || /^[rwx-]{9}$/i.test(trimmed)) {
                    setMode('chmod');
                }
            }
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u5207\u6362\u8BA1\u7B97\u5668\u6A21\u5F0F", value: mode, onChange: (val) => {
                const nextMode = val;
                setMode(nextMode);
                setQueryText(nextMode === 'cidr' ? '192.168.1.0/24' : '755');
            } },
            React.createElement(List.Dropdown.Item, { title: "IPv4 CIDR \u5B50\u7F51\u8BA1\u7B97\u5668", value: "cidr" }),
            React.createElement(List.Dropdown.Item, { title: "Linux chmod \u6743\u9650\u63A8\u6F14", value: "chmod" })) },
        mode === 'cidr' && cidrState && !cidrState.ok && (React.createElement(List.Section, { title: "CIDR \u7F51\u6BB5\u683C\u5F0F\u9519\u8BEF" },
            React.createElement(List.Item, { id: "cidr-error", title: "\u65E0\u6CD5\u89E3\u6790 IPv4 CIDR", subtitle: cidrState.error, icon: Icon.ExclamationMark, accessories: [{ tag: { value: '输入错误', color: Color.Red } }], detail: React.createElement(List.Item.Detail, { markdown: `### IPv4 CIDR 校验错误\n\n\`\`\`text\n${cidrState.error}\n\`\`\`\n\n示例格式：\`192.168.1.0/24\`、\`10.0.0.0/8\`、\`172.16.0.1/32\`。` }) }))),
        mode === 'cidr' && cidrState && cidrState.ok && (React.createElement(List.Section, { title: "IPv4 CIDR \u5B50\u7F51\u89C4\u5212\u8BA1\u7B97\u7ED3\u679C" },
            React.createElement(List.Item, { id: "cidr-main", title: `${cidrState.result.networkAddress}/${cidrState.result.prefixLength}`, subtitle: `可用范围: ${cidrState.result.firstUsableIp} ~ ${cidrState.result.lastUsableIp} (${cidrState.result.usableHosts.toLocaleString()} 台主机)`, icon: Icon.Wifi, accessories: [{ tag: `掩码 ${cidrState.result.netmask}` }], detail: React.createElement(List.Item.Detail, { markdown: `### 子网规划详情 (\`${cidrState.result.input}\`)\n\n- **可用主机范围**: \`${cidrState.result.firstUsableIp}\` - \`${cidrState.result.lastUsableIp}\`\n- **32位二进制掩码**:\n\`\`\`text\n${cidrState.result.netmaskBinary}\n\`\`\`\n- **地址段属性**: ${cidrState.result.addressScope}\n- **路由说明**: ${cidrState.result.usageHint}`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7F51\u7EDC\u5730\u5740 (Network)", text: cidrState.result.networkAddress }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5B50\u7F51\u63A9\u7801 (Netmask)", text: cidrState.result.netmask }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u53CD\u63A9\u7801 (Wildcard)", text: cidrState.result.wildcardMask }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5E7F\u64AD\u5730\u5740 (Broadcast)", text: cidrState.result.broadcastAddress }),
                        React.createElement(List.Item.Detail.Metadata.Separator, null),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u603B\u5730\u5740\u5BB9\u91CF", text: `${cidrState.result.totalHosts.toLocaleString()} 个 IP` }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u53EF\u7528\u4E3B\u673A\u6570", text: `${cidrState.result.usableHosts.toLocaleString()} 台` })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u53EF\u7528 IP \u8303\u56F4", content: `${cidrState.result.firstUsableIp} - ${cidrState.result.lastUsableIp}` }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5B50\u7F51\u63A9\u7801", content: cidrState.result.netmask }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u7F51\u7EDC\u5730\u5740/CIDR", content: `${cidrState.result.networkAddress}/${cidrState.result.prefixLength}` })) }),
            PRESET_CIDRS.map((preset) => (React.createElement(List.Item, { key: preset, id: `preset-cidr-${preset}`, title: `常用网段模板: ${preset}`, subtitle: "\u70B9\u51FB\u56DE\u8F66\u7ACB\u5373\u8F7D\u5165\u6B64\u7F51\u6BB5\u8FDB\u884C\u5B50\u7F51\u8BA1\u7B97", icon: Icon.Globe, accessories: [{ tag: '快速切换' }], actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: `计算 ${preset}`, icon: Icon.Play, onAction: () => setQueryText(preset) })) }))))),
        mode === 'chmod' && chmodState && !chmodState.ok && (React.createElement(List.Section, { title: "chmod \u6743\u9650\u8868\u8FBE\u5F0F\u9519\u8BEF" },
            React.createElement(List.Item, { id: "chmod-error", title: "\u65E0\u6CD5\u89E3\u6790 chmod \u6743\u9650\u503C", subtitle: chmodState.error, icon: Icon.ExclamationMark, accessories: [{ tag: { value: '格式错误', color: Color.Red } }], detail: React.createElement(List.Item.Detail, { markdown: `### chmod 权限格式错误\n\n\`\`\`text\n${chmodState.error}\n\`\`\`` }) }))),
        mode === 'chmod' && chmodState && chmodState.ok && (React.createElement(List.Section, { title: "Linux chmod \u6743\u9650\u4F4D\u53CC\u5411\u63A8\u6F14" },
            React.createElement(List.Item, { id: "chmod-main", title: `${chmodState.result.octal}  (${chmodState.result.lsSymbolic})`, subtitle: chmodState.result.chmodCommand, icon: chmodState.result.isWorldWritable ? Icon.ExclamationMark : Icon.Shield, accessories: [
                    chmodState.result.isWorldWritable
                        ? { tag: { value: '高危全局可写', color: Color.Red } }
                        : { tag: chmodState.result.symbolic },
                ], detail: React.createElement(List.Item.Detail, { markdown: `### Linux 权限矩阵 (\`${chmodState.result.octal}\` / \`${chmodState.result.lsSymbolic}\`)\n\n${chmodState.result.securityWarning
                        ? `> **${chmodState.result.securityWarning}**\n\n`
                        : ''}| 角色 | 八进制 | 符号 | 读取 (r=4) | 写入 (w=2) | 执行 (x=1) |\n| :--- | :---: | :---: | :---: | :---: | :---: |\n${chmodState.result.roles
                        .map((r) => `| ${r.role} | \`${r.digit}\` | \`${r.symbolic}\` | ${r.read ? '允许' : '-'} | ${r.write ? '允许' : '-'} | ${r.execute ? '允许' : '-'} |`)
                        .join('\n')}\n\n### 终端命令\n\`\`\`bash\n${chmodState.result.chmodCommand}\n${chmodState.result.chmodRecursiveCommand}\n\`\`\``, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u516B\u8FDB\u5236\u8868\u793A (Octal)", text: chmodState.result.octal }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7B26\u53F7\u8868\u793A (Symbolic)", text: chmodState.result.symbolic }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "ls -l \u663E\u793A\u683C\u5F0F", text: chmodState.result.lsSymbolic })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 chmod \u547D\u4EE4", content: chmodState.result.chmodCommand }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u516B\u8FDB\u5236\u6743\u9650\u503C", content: chmodState.result.octal }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u7B26\u53F7\u6743\u9650\u503C", content: chmodState.result.symbolic })) }),
            PRESET_CHMODS.map((item) => (React.createElement(List.Item, { key: item.code, id: `preset-chmod-${item.code}`, title: `chmod ${item.code}`, subtitle: item.desc, icon: Icon.Key, accessories: [
                    item.code === '777'
                        ? { tag: { value: '风险权限', color: Color.Red } }
                        : { tag: '常用预设' },
                ], actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: `查看 chmod ${item.code} 详情`, icon: Icon.Play, onAction: () => setQueryText(item.code) }),
                    React.createElement(Action.CopyToClipboard, { title: `复制 chmod ${item.code}`, content: `chmod ${item.code} ` })) })))))));
}
export default ChmodCidrCalcCommand;
