import React, { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { getProxyStatus, parseSshConfigFile, setDevToolsProxy, unsetDevToolsProxy } from './ssh-proxy-service.js';
export * from './types.js';
export * from './ssh-proxy-service.js';
export function SshProxyHelperCommand(props = {}) {
    const [sshHosts, setSshHosts] = useState(props.initialHosts ?? []);
    const [proxyStatus, setProxyStatus] = useState(props.initialProxyStatus ?? {
        isEnabled: true,
        port: 7890,
        isGitSet: true,
        isNpmSet: true,
        detectedPorts: [7890, 10808]
    });
    const [filterCategory, setFilterCategory] = useState('all');
    const [searchText, setSearchText] = useState('');
    const [isLoading, setIsLoading] = useState(!props.initialHosts);
    useEffect(() => {
        if (!props.initialHosts) {
            void (async () => {
                setIsLoading(true);
                try {
                    const [hosts, status] = await Promise.all([
                        parseSshConfigFile(undefined, props.hostOverride),
                        getProxyStatus(undefined, props.hostOverride)
                    ]);
                    setSshHosts(hosts);
                    if (!props.initialProxyStatus) {
                        setProxyStatus(status);
                    }
                }
                finally {
                    setIsLoading(false);
                }
            })();
        }
    }, []);
    const filteredHosts = useMemo(() => {
        const byCat = sshHosts.filter((h) => {
            if (filterCategory === 'prod')
                return Boolean(h.proxyJump || /prod|bastion|jump/i.test(h.host));
            if (filterCategory === 'tunnels')
                return Boolean(h.localForwards && h.localForwards.length > 0);
            return true;
        });
        const q = searchText.trim().toLowerCase();
        if (!q)
            return byCat;
        return byCat.filter((h) => h.host.toLowerCase().includes(q) ||
            h.hostName.toLowerCase().includes(q) ||
            (h.user && h.user.toLowerCase().includes(q)));
    }, [sshHosts, filterCategory, searchText]);
    const handleToggleProxy = async () => {
        try {
            if (proxyStatus.isEnabled) {
                const next = await unsetDevToolsProxy({ applySystemGit: true }, props.hostOverride);
                setProxyStatus(next);
                await showToast({
                    style: Toast.Style.Success,
                    title: '已关闭 Git & NPM 全局命令行代理'
                });
            }
            else {
                const next = await setDevToolsProxy(proxyStatus.port, { applySystemGit: true }, props.hostOverride);
                setProxyStatus(next);
                await showToast({
                    style: Toast.Style.Success,
                    title: `已开启 Git & NPM 代理 (127.0.0.1:${proxyStatus.port})`
                });
            }
        }
        catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: '切换开发代理失败',
                message: err instanceof Error ? err.message : '端口未监听'
            });
        }
    };
    const currentProxyPort = proxyStatus.port;
    const isProxyEnabled = proxyStatus.isEnabled;
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22 SSH \u4E3B\u673A\u522B\u540D\u3001IP\u3001\u7528\u6237\u6216\u4EE3\u7406\u7AEF\u53E3 (\u5982: prod-db\u3001192.168\u3001root) ...", searchBarAccessory: React.createElement(List.Dropdown, { value: filterCategory, onChange: (v) => setFilterCategory(v), tooltip: "\u7B5B\u9009\u4E3B\u673A\u5206\u7C7B" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u4E3B\u673A\u4E0E\u4EE3\u7406", value: "all", icon: Icon.List }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u67E5\u770B\u751F\u4EA7 / \u8DF3\u677F\u673A", value: "prod", icon: Icon.Lock }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u67E5\u770B\u672C\u5730\u7AEF\u53E3\u96A7\u9053", value: "tunnels", icon: Icon.ArrowRight })), filterBar: {
            summaryText: `Git/NPM 代理: ${isProxyEnabled ? `已开启 (端口: ${currentProxyPort})` : '已关闭'} · 共 ${sshHosts.length} 台 SSH 主机`,
            actions: [
                {
                    id: 'toggle-proxy',
                    title: isProxyEnabled ? '关闭代理' : '开启代理',
                    onAction: handleToggleProxy
                }
            ]
        } },
        React.createElement(List.Section, { title: "\u5F00\u53D1\u5DE5\u5177\u94FE\u4EE3\u7406\u7BA1\u63A7" },
            React.createElement(List.Item, { id: "dev-proxy-card", title: `Git & NPM 命令行代理 (${isProxyEnabled ? '已启用' : '已停用'})`, subtitle: `本地代理端口: 127.0.0.1:${currentProxyPort}`, icon: isProxyEnabled ? Icon.CheckCircle : Icon.Circle, accessories: [
                    { tag: isProxyEnabled ? '已全局接管' : '直连直通' },
                    { text: isProxyEnabled ? 'Git & NPM 加速中' : '未生效' }
                ], detail: React.createElement(List.Item.Detail, { markdown: `### 命令行代理环境变量\n\`\`\`bash\n# macOS / Linux (Bash / Zsh)\nexport http_proxy=http://127.0.0.1:${currentProxyPort}\nexport https_proxy=http://127.0.0.1:${currentProxyPort}\n\n# Windows PowerShell\n$env:http_proxy="http://127.0.0.1:${currentProxyPort}"\n$env:https_proxy="http://127.0.0.1:${currentProxyPort}"\n\`\`\``, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "Git \u5168\u5C40\u4EE3\u7406", text: proxyStatus.isGitSet
                                ? `http://127.0.0.1:${currentProxyPort}`
                                : '未配置 (直连)' }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "NPM \u4EE3\u7406", text: proxyStatus.isNpmSet
                                ? `http://127.0.0.1:${currentProxyPort}`
                                : '未配置 (直连)' }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u55C5\u63A2\u7AEF\u53E3", text: proxyStatus.detectedPorts.join(', ') || '无可用代理端口' })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: isProxyEnabled
                            ? '关闭 Git & NPM 全局代理'
                            : '一键开启 Git & NPM 全局代理', icon: isProxyEnabled ? Icon.XMarkCircle : Icon.CheckCircle, onAction: handleToggleProxy }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u7EC8\u7AEF\u4EE3\u7406\u73AF\u5883\u53D8\u91CF\u6307\u4EE4", content: `export http_proxy=http://127.0.0.1:${currentProxyPort}; export https_proxy=http://127.0.0.1:${currentProxyPort}`, shortcut: { modifiers: ['cmd'], key: 'c' } })) })),
        React.createElement(List.Section, { title: "SSH \u4E3B\u673A\u5217\u8868" }, filteredHosts.map((host) => (React.createElement(List.Item, { key: host.host, id: host.host, title: host.host, subtitle: `${host.user || 'root'}@${host.hostName}:${host.port || 22}`, icon: Icon.Terminal, accessories: [
                ...(host.proxyJump ? [{ tag: `跳板: ${host.proxyJump}` }] : []),
                { text: host.identityFileShort || '默认密钥' }
            ], detail: React.createElement(List.Item.Detail, { markdown: `\`\`\`ini\nHost ${host.host}\n  HostName ${host.hostName}\n  User ${host.user || 'root'}\n  Port ${host.port || 22}\n${host.identityFile ? `  IdentityFile ${host.identityFile}\n` : ''}${host.proxyJump ? `  ProxyJump ${host.proxyJump}\n` : ''}\`\`\``, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "Host \u522B\u540D", text: host.host }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u76EE\u6807 IP / \u57DF\u540D", text: host.hostName }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u767B\u5F55\u7528\u6237\u540D", text: host.user || 'root' }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "SSH \u7AEF\u53E3", text: String(host.port || 22) }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8BA4\u8BC1\u5BC6\u94A5", text: host.identityFile || '系统默认密钥' })) }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 SSH \u8FDE\u63A5\u547D\u4EE4", content: `ssh ${host.host}`, icon: Icon.Terminal }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u4E3B\u673A\u771F\u5B9E IP / \u57DF\u540D", content: host.hostName, shortcut: { modifiers: ['cmd', 'shift'], key: 'c' } })) }))))));
}
export default SshProxyHelperCommand;
