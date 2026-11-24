import React, { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { detectActiveInterfaces, scanSubnet, sendWakeOnLan } from './lan-service.js';
export * from './types.js';
export * from './lan-service.js';
export function LanScannerCommand(props = {}) {
    const [interfaces, setInterfaces] = useState(props.initialInterfaces ?? [
        {
            name: 'WLAN',
            ip: '192.168.1.105',
            subnetMask: '255.255.255.0',
            subnetDisplay: '192.168.1.0/24',
            broadcastIp: '192.168.1.255'
        }
    ]);
    const [selectedInterface, setSelectedInterface] = useState(props.initialInterfaces?.[0]?.name || 'WLAN');
    const [devices, setDevices] = useState(props.initialDevices ?? []);
    const [searchText, setSearchText] = useState('');
    const [isScanning, setIsScanning] = useState(!props.initialDevices);
    const [scanDurationMs, setScanDurationMs] = useState(340);
    const handleStartScan = async () => {
        setIsScanning(true);
        const t0 = Date.now();
        try {
            const ifaces = await detectActiveInterfaces(undefined, props.hostOverride);
            if (ifaces.length > 0) {
                setInterfaces(ifaces);
            }
            const targetIface = ifaces.find((i) => i.name === selectedInterface) || ifaces[0];
            const scanned = await scanSubnet(targetIface, undefined, props.hostOverride);
            if (scanned.length > 0 || !props.initialDevices) {
                setDevices(scanned);
            }
            setScanDurationMs(Math.max(12, Date.now() - t0));
        }
        catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: '扫描局域网失败',
                message: err instanceof Error ? err.message : '未连接局域网'
            });
        }
        finally {
            setIsScanning(false);
        }
    };
    useEffect(() => {
        if (!props.initialDevices) {
            void handleStartScan();
        }
    }, []);
    const currentSubnet = useMemo(() => {
        const found = interfaces.find((i) => i.name === selectedInterface) || interfaces[0];
        return found?.subnetDisplay || '192.168.1.0/24';
    }, [interfaces, selectedInterface]);
    const filteredDevices = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        if (!q)
            return devices;
        return devices.filter((d) => d.ip.toLowerCase().includes(q) ||
            (d.mac && d.mac.toLowerCase().includes(q)) ||
            (d.vendor && d.vendor.toLowerCase().includes(q)) ||
            (d.hostname && d.hostname.toLowerCase().includes(q)) ||
            (d.customName && d.customName.toLowerCase().includes(q)));
    }, [devices, searchText]);
    const handleWakeOnLan = async (mac) => {
        try {
            const activeIface = interfaces.find((i) => i.name === selectedInterface) || interfaces[0];
            await sendWakeOnLan(mac, activeIface?.broadcastIp || '255.255.255.255', { dryRun: false }, props.hostOverride);
            await showToast({
                style: Toast.Style.Success,
                title: `已向 ${mac} 广播发送 102 字节 WOL 远程唤醒魔术包`
            });
        }
        catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: '发送 WOL 魔术包失败',
                message: err instanceof Error ? err.message : 'MAC 地址无效'
            });
        }
    };
    const handleToggleFavorite = (target) => {
        setDevices((prev) => prev.map((d) => (d.ip === target.ip ? { ...d, isFavorite: !d.isFavorite } : d)));
    };
    return (React.createElement(List, { isLoading: isScanning, isShowingDetail: true, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22 IP\u3001\u8BBE\u5907\u5907\u6CE8\u3001MAC \u5730\u5740\u6216\u5382\u5546 (\u5982: 192.168.1.1\u3001\u7FA4\u6656\u3001Apple) ...", searchBarAccessory: React.createElement(List.Dropdown, { value: selectedInterface, onChange: setSelectedInterface, tooltip: "\u9009\u62E9\u626B\u63CF\u7F51\u5361" }, interfaces.map((iface) => (React.createElement(List.Dropdown.Item, { key: iface.name, title: `${iface.name} (${iface.subnetDisplay})`, value: iface.name, icon: Icon.Globe })))), filterBar: {
            summaryText: `网段: ${currentSubnet} · 发现 ${devices.length} 台在线设备 · 扫描耗时 ${scanDurationMs}ms`,
            actions: [{ id: 'rescan', title: '重新扫描', onAction: handleStartScan }]
        } }, filteredDevices.map((d) => {
        const displayTitle = d.customName || d.hostname || d.ip;
        return (React.createElement(List.Item, { key: d.ip, id: d.ip, title: displayTitle, subtitle: d.ip !== displayTitle ? d.ip : d.vendor || '局域网主机', icon: Icon.Desktop, accessories: [
                ...(d.isFavorite ? [{ tag: '已收藏' }] : []),
                { tag: d.vendor || '未知厂商' },
                { text: d.openPortsText }
            ], detail: React.createElement(List.Item.Detail, { markdown: `### 开放服务与端口\n${d.openPortsMarkdown || `已开放端口: ${d.openPorts.length > 0 ? d.openPorts.join(', ') : '未检测到常见开放端口'}`}`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "IP \u5730\u5740", text: d.ip }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "MAC \u5730\u5740", text: d.mac || '未知' }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u786C\u4EF6\u5236\u9020\u5546 (OUI)", text: d.vendor || '未知厂商' }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u4E3B\u673A\u540D (mDNS)", text: d.hostname || '未广播' }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5F80\u8FD4\u5EF6\u8FDF (RTT)", text: `${d.pingMs} ms` }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u8BBE\u5907\u5907\u6CE8", text: d.customName || '未设置备注' })) }), actions: React.createElement(ActionPanel, null,
                d.primaryWebUrl ? (React.createElement(Action.OpenInBrowser, { title: `在浏览器中打开 Web 服务 (${d.primaryWebUrl})`, url: d.primaryWebUrl, icon: Icon.Globe })) : null,
                d.mac ? (React.createElement(Action, { title: "\u53D1\u9001 Wake-on-LAN \u8FDC\u7A0B\u5524\u9192\u5F00\u673A", icon: Icon.Bolt, shortcut: { modifiers: ['cmd'], key: 'w' }, onAction: () => handleWakeOnLan(d.mac) })) : null,
                React.createElement(Action, { title: d.isFavorite ? '取消收藏' : '设为常用收藏设备', icon: Icon.Pin, shortcut: { modifiers: ['cmd'], key: 'f' }, onAction: () => handleToggleFavorite(d) }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 IP \u5730\u5740", content: d.ip, shortcut: { modifiers: ['cmd'], key: 'c' } }),
                d.mac ? (React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 MAC \u5730\u5740", content: d.mac, shortcut: { modifiers: ['cmd', 'shift'], key: 'c' } })) : null) }));
    })));
}
export default LanScannerCommand;
