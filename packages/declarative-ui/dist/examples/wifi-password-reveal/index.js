import React, { Action, ActionPanel, Clipboard, Detail, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { isRealElectronHost } from '../shared/native-ipc.js';
import { SAMPLE_WIFI_PROFILES, fetchSavedWifiProfiles, filterAndSortWifiProfiles, generateWifiQrString, generateWifiQrSvgDataUrl, revealWifiPasswordFromHost } from './wifi-service.js';
export * from './types.js';
export * from './wifi-service.js';
export function WifiDetailView({ profile, hostOverride }) {
    const [resolvedPassword, setResolvedPassword] = useState(profile.password);
    useEffect(() => {
        let active = true;
        setResolvedPassword(profile.password);
        if (!profile.password &&
            !profile.isOpenNetwork &&
            !profile.isEnterprise &&
            (hostOverride || isRealElectronHost())) {
            void revealWifiPasswordFromHost(profile.ssid, hostOverride).then((pwd) => {
                if (active && pwd) {
                    setResolvedPassword(pwd);
                }
            });
        }
        return () => {
            active = false;
        };
    }, [profile.ssid, profile.password, profile.isOpenNetwork, profile.isEnterprise, hostOverride]);
    const effectiveProfile = useMemo(() => ({ ...profile, password: resolvedPassword }), [profile, resolvedPassword]);
    const qrString = useMemo(() => generateWifiQrString(effectiveProfile.ssid, effectiveProfile.password, effectiveProfile.authType), [effectiveProfile.ssid, effectiveProfile.password, effectiveProfile.authType]);
    const qrSvgUrl = useMemo(() => generateWifiQrSvgDataUrl(effectiveProfile), [effectiveProfile]);
    const displayPassword = effectiveProfile.isOpenNetwork
        ? '(开放网络 — 无需密码)'
        : effectiveProfile.isEnterprise
            ? '(802.1X 企业证书认证 — 无预共享明文密码)'
            : effectiveProfile.password || '(未读取到密码)';
    const markdown = `
# ${effectiveProfile.ssid}

${effectiveProfile.isConnected ? '> **当前已连接此无线网络**\n' : ''}
${effectiveProfile.notes ? `> ${effectiveProfile.notes}\n` : ''}

---

### 明文密码 (Key Content)
\`\`\`text
${displayPassword}
\`\`\`

### 手机扫码一键连网协议串
\`\`\`text
${qrString}
\`\`\`

![Wi-Fi QR Preview](${qrSvgUrl})
`;
    return (React.createElement(Detail, { navigationTitle: `Wi-Fi 详情: ${effectiveProfile.ssid}`, markdown: markdown, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u52A0\u5BC6\u7B97\u6CD5 (Cipher)", text: effectiveProfile.cipher || 'CCMP (AES)', icon: Icon.Lock }),
            React.createElement(Detail.Metadata.Label, { title: "\u65E0\u7EBF\u9891\u6BB5 (Band)", text: effectiveProfile.band || 'Dual-Band', icon: Icon.Signal3 }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.Label, { title: "\u4FE1\u53F7\u5F3A\u5EA6", text: `${effectiveProfile.signalPercent ?? 85}%`, icon: Icon.BarChart }),
            React.createElement(Detail.Metadata.Label, { title: "\u6700\u8FD1\u8FDE\u63A5", text: effectiveProfile.lastConnected || '已保存', icon: Icon.Clock })), actions: React.createElement(ActionPanel, null,
            !effectiveProfile.isOpenNetwork && !effectiveProfile.isEnterprise && (React.createElement(Action, { title: "\u590D\u5236 Wi-Fi \u5BC6\u7801", icon: Icon.CopyClipboard, onAction: async () => {
                    let pwd = effectiveProfile.password;
                    if (!pwd && (hostOverride || isRealElectronHost())) {
                        pwd = await revealWifiPasswordFromHost(effectiveProfile.ssid, hostOverride);
                        if (pwd)
                            setResolvedPassword(pwd);
                    }
                    if (pwd) {
                        await Clipboard.copy(pwd);
                        await showToast(Toast.Style.Success, `已复制 "${effectiveProfile.ssid}" 的密码`);
                    }
                    else {
                        await showToast(Toast.Style.Failure, `未能读取 "${effectiveProfile.ssid}" 的明文密码`);
                    }
                } })),
            React.createElement(Action, { title: "\u590D\u5236\u626B\u7801\u8FDE\u7F51\u534F\u8BAE\u4E32 (WIFI:)", icon: Icon.QrCode, shortcut: { modifiers: ['ctrl'], key: 'q' }, onAction: async () => {
                    await Clipboard.copy(qrString);
                    await showToast(Toast.Style.Success, '已复制 WIFI: 标准二维码连网串');
                } }),
            React.createElement(Action, { title: "\u590D\u5236\u7F51\u7EDC\u540D\u79F0 (SSID)", icon: Icon.Text, shortcut: { modifiers: ['ctrl', 'shift'], key: 'c' }, onAction: async () => {
                    await Clipboard.copy(effectiveProfile.ssid);
                    await showToast(Toast.Style.Success, `已复制 SSID: ${effectiveProfile.ssid}`);
                } })) }));
}
export function WifiPasswordRevealCommand(props) {
    const [allProfiles, setAllProfiles] = useState(() => props?.hostOverride || isRealElectronHost() ? [] : SAMPLE_WIFI_PROFILES);
    const [searchText, setSearchText] = useState('');
    const [securityFilter, setSecurityFilter] = useState('all');
    const [revealInList, setRevealInList] = useState(false);
    const [isLoading, setIsLoading] = useState(() => Boolean(props?.hostOverride) || isRealElectronHost());
    const reloadWifiProfiles = async () => {
        setIsLoading(true);
        try {
            const loaded = await fetchSavedWifiProfiles({ hostOverride: props?.hostOverride });
            setAllProfiles(loaded);
            await showToast(Toast.Style.Success, `已刷新无线网络配置 (${loaded.length} 个)`);
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        let active = true;
        setIsLoading(true);
        void fetchSavedWifiProfiles({ hostOverride: props?.hostOverride })
            .then((loaded) => {
            if (active && (loaded.length > 0 || props?.hostOverride || isRealElectronHost())) {
                setAllProfiles(loaded);
            }
        })
            .finally(() => {
            if (active)
                setIsLoading(false);
        });
        return () => {
            active = false;
        };
    }, [props?.hostOverride]);
    const profiles = useMemo(() => filterAndSortWifiProfiles(allProfiles, {
        query: searchText,
        securityFilter,
        sortBy: 'connected'
    }), [allProfiles, searchText, securityFilter]);
    const connectedProfile = useMemo(() => profiles.find((p) => p.isConnected), [profiles]);
    return (React.createElement(List, { isLoading: isLoading, isShowingDetail: true, navigationTitle: "Wi-Fi \u5BC6\u7801\u67E5\u770B", searchBarPlaceholder: "\u641C\u7D22\u5DF2\u4FDD\u5B58\u7684 Wi-Fi \u540D\u79F0\u3001\u62FC\u97F3\u6216\u9891\u6BB5...", onSearchTextChange: setSearchText, filterBar: {
            summaryText: `已保存 ${profiles.length} 个 Wi-Fi 网络 | 当前连接：${connectedProfile ? connectedProfile.ssid : '未连接'}`,
            actions: [
                {
                    id: 'toggle-reveal',
                    title: revealInList ? '隐藏列表明文密码' : '显示列表明文密码',
                    style: 'primary',
                    onAction: () => {
                        setRevealInList((prev) => !prev);
                    }
                },
                {
                    id: 'refresh-wifi',
                    title: '刷新网络配置',
                    style: 'secondary',
                    onAction: () => {
                        void reloadWifiProfiles();
                    }
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6309\u52A0\u5BC6\u7C7B\u578B\u8FC7\u6EE4", value: securityFilter, onChange: (val) => setSecurityFilter(val) },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u5DF2\u4FDD\u5B58\u7F51\u7EDC", value: "all" }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u5F53\u524D\u8FDE\u63A5", value: "connected" }),
            React.createElement(List.Dropdown.Item, { title: "WPA3 \u4E2A\u4EBA\u52A0\u5BC6", value: "wpa3" }),
            React.createElement(List.Dropdown.Item, { title: "WPA2 \u4E2A\u4EBA\u52A0\u5BC6", value: "wpa2" }),
            React.createElement(List.Dropdown.Item, { title: "\u5F00\u653E\u65E0\u5BC6\u7801\u7F51\u7EDC", value: "open" }),
            React.createElement(List.Dropdown.Item, { title: "802.1X \u4F01\u4E1A\u7F51\u7EDC", value: "enterprise" })) }, profiles.length === 0 ? (React.createElement(List.Section, { title: "\u68C0\u6D4B\u7ED3\u679C" },
        React.createElement(List.Item, { id: "empty-wifi", icon: Icon.Wifi, title: "\u672A\u68C0\u6D4B\u5230\u5DF2\u4FDD\u5B58\u7684\u65E0\u7EBF\u7F51\u7EDC\u914D\u7F6E", subtitle: "\u8BF7\u786E\u8BA4\u5F53\u524D\u8BBE\u5907\u5DF2\u542F\u7528\u65E0\u7EBF\u7F51\u5361\uFF08WLAN\uFF09\uFF0C\u6216\u5207\u6362\u53F3\u4E0A\u89D2\u7B5B\u9009\u6761\u4EF6\u91CD\u8BD5" }))) : (React.createElement(List.Section, { title: "\u5DF2\u4FDD\u5B58\u7684\u65E0\u7EBF\u7F51\u7EDC\u914D\u7F6E\u6587\u4EF6", subtitle: `共 ${profiles.length} 个网络` }, profiles.map((item) => {
        const maskedPwd = item.password
            ? revealInList
                ? item.password
                : '••••••••'
            : item.isOpenNetwork
                ? '开放网络（无密码）'
                : item.isEnterprise
                    ? '802.1X 证书认证'
                    : '回车复制或查看明文密码';
        const qrString = generateWifiQrString(item.ssid, item.password, item.authType);
        const qrSvgUrl = generateWifiQrSvgDataUrl(item);
        const detailMarkdown = `### 手机扫码一键连网\n\n![Wi-Fi QR Code](${qrSvgUrl})\n\n### 明文密码\n\`\`\`text\n${item.isOpenNetwork ? '(开放网络 — 无需密码)' : item.isEnterprise ? '(802.1X 企业认证 — 无预共享密码)' : item.password || '(按回车提取密码)'}\n\`\`\`\n\n### 二维码连网协议串\n\`${qrString}\``;
        return (React.createElement(List.Item, { key: item.id, id: item.id, icon: Icon.Wifi, title: item.ssid, subtitle: `${item.authType} · ${maskedPwd}`, accessories: [
                item.isConnected ? { tag: '已连接' } : { text: item.lastConnected || '已保存' }
            ], detail: React.createElement(List.Item.Detail, { markdown: detailMarkdown, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u52A0\u5BC6\u7B97\u6CD5 (Cipher)", text: item.cipher || 'CCMP (AES)' }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u65E0\u7EBF\u9891\u6BB5 (Band)", text: item.band || 'Dual-Band' }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u7F51\u5361\u63A5\u53E3", text: item.interfaceName || 'WLAN' })) }), actions: React.createElement(ActionPanel, null,
                !item.isOpenNetwork && !item.isEnterprise && (React.createElement(Action, { title: "\u590D\u5236 Wi-Fi \u5BC6\u7801", icon: Icon.CopyClipboard, onAction: async () => {
                        let pwd = item.password;
                        if (!pwd && (props?.hostOverride || isRealElectronHost())) {
                            pwd = await revealWifiPasswordFromHost(item.ssid, props?.hostOverride);
                            if (pwd) {
                                setAllProfiles((prev) => prev.map((p) => (p.id === item.id ? { ...p, password: pwd } : p)));
                            }
                        }
                        if (pwd) {
                            await Clipboard.copy(pwd);
                            await showToast(Toast.Style.Success, `已复制 "${item.ssid}" 的密码`);
                        }
                        else {
                            await showToast(Toast.Style.Failure, `未能提取 "${item.ssid}" 的明文密码`);
                        }
                    } })),
                React.createElement(Action.Push, { title: "\u5168\u5C4F\u67E5\u770B\u5BC6\u7801\u4E0E\u8FDE\u7F51\u4E8C\u7EF4\u7801", icon: Icon.Eye, shortcut: { modifiers: ['ctrl'], key: 'enter' }, target: React.createElement(WifiDetailView, { profile: item, hostOverride: props?.hostOverride }) }),
                React.createElement(Action, { title: revealInList ? '隐藏列表明文密码' : '显示列表明文密码', icon: revealInList ? Icon.EyeDisabled : Icon.Eye, shortcut: { modifiers: ['ctrl'], key: 'h' }, onAction: () => setRevealInList(!revealInList) }),
                React.createElement(Action, { title: "\u590D\u5236\u626B\u7801\u8FDE\u7F51\u534F\u8BAE\u4E32 (WIFI:)", icon: Icon.QrCode, shortcut: { modifiers: ['ctrl'], key: 'q' }, onAction: async () => {
                        await Clipboard.copy(qrString);
                        await showToast(Toast.Style.Success, '已复制 WIFI: 标准二维码连网串');
                    } }),
                React.createElement(Action, { title: "\u590D\u5236\u7F51\u7EDC\u540D\u79F0 (SSID)", icon: Icon.Text, shortcut: { modifiers: ['ctrl', 'shift'], key: 'c' }, onAction: async () => {
                        await Clipboard.copy(item.ssid);
                        await showToast(Toast.Style.Success, `已复制 SSID: ${item.ssid}`);
                    } })) }));
    })))));
}
export default WifiPasswordRevealCommand;
