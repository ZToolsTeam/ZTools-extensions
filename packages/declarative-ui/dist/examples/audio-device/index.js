import React, { Action, ActionPanel, Clipboard, Detail, Form, Icon, List, Toast, showToast, useEffect, useMemo, useNavigation, useState } from '../../index.js';
import { buildAudioPlatformCommand, defaultAudioDeviceManager } from './audio-service.js';
import { isRealElectronHost } from '../shared/native-ipc.js';
export * from './types.js';
export * from './audio-service.js';
export function AudioDeviceDetailView({ device, onUpdated }) {
    const winCmd = buildAudioPlatformCommand('switch', device, 'Windows');
    const macCmd = buildAudioPlatformCommand('switch', device, 'macOS');
    const markdown = `
# ${device.name}

${device.isDefault ? `> **当前正作为系统默认${device.type === 'output' ? '输出 (播放)' : '输入 (录音)'}设备**\n` : ''}

---

### 硬件规格与实时状态
- **设备类型**: \`${device.type === 'output' ? '音频输出 (Output)' : '音频输入 (Input)'}\`
- **连接总线 (Transport)**: \`${String(device.transportType).toUpperCase()}\`
- **当前音量**: \`${device.isMuted ? '已静音' : `${device.volume}%`}\`
- **采样率 / 声道**: \`${device.sampleRate || 48000} Hz / ${device.channels || 2} Ch\`
- **硬件端点 UID**: \`${device.uid}\`

---

### 底层平台切换指令预览
**Windows (CoreAudio / PowerShell)**:
\`\`\`powershell
${winCmd.commandLine}
\`\`\`

**macOS (SwitchAudioSource)**:
\`\`\`bash
${macCmd.commandLine}
\`\`\`
`;
    return (React.createElement(Detail, { navigationTitle: `音频设备: ${device.name}`, markdown: markdown, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u8BBE\u5907\u540D\u79F0", text: device.name, icon: Icon.SpeakerOn }),
            React.createElement(Detail.Metadata.TagList, { title: "\u9ED8\u8BA4\u72B6\u6001" },
                React.createElement(Detail.Metadata.TagList.Item, { text: device.isDefault ? '当前默认' : '待命' })),
            React.createElement(Detail.Metadata.Label, { title: "\u5F53\u524D\u97F3\u91CF", text: device.isMuted ? '已静音 (Muted)' : `${device.volume}%`, icon: device.isMuted ? Icon.SpeakerOff : Icon.SpeakerHigh }),
            React.createElement(Detail.Metadata.Label, { title: "\u4F20\u8F93\u534F\u8BAE", text: String(device.transportType).toUpperCase(), icon: Icon.Plug })), actions: React.createElement(ActionPanel, null,
            React.createElement(Action, { title: `设为默认${device.type === 'output' ? '输出' : '输入'}设备`, icon: Icon.Checkmark, onAction: async () => {
                    const res = await defaultAudioDeviceManager.setDefaultDevice(device.id);
                    await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.success ? `已切换默认设备为: ${device.name}` : res.error || '切换失败');
                    onUpdated?.();
                } }),
            React.createElement(Action, { title: device.isMuted ? '取消静音 (Unmute)' : '静音设备 (Mute)', icon: device.isMuted ? Icon.SpeakerOn : Icon.SpeakerOff, onAction: async () => {
                    const res = await defaultAudioDeviceManager.toggleDeviceMute(device.id);
                    await showToast(Toast.Style.Success, `${res.device?.isMuted ? '已静音' : '已恢复声音'}: ${device.name}`);
                    onUpdated?.();
                } }),
            React.createElement(Action, { title: "\u590D\u5236\u786C\u4EF6\u7AEF\u70B9 UID", icon: Icon.CopyClipboard, onAction: async () => {
                    await Clipboard.copy(device.uid);
                    await showToast(Toast.Style.Success, '已复制硬件 UID');
                } })) }));
}
export function AudioVolumeForm({ device, onSaved }) {
    const { pop } = useNavigation();
    return (React.createElement(Form, { navigationTitle: `设置音量: ${device.name}`, actions: React.createElement(ActionPanel, null,
            React.createElement(Action.SubmitForm, { title: "\u5E94\u7528\u97F3\u91CF\u8BBE\u7F6E", icon: Icon.Checkmark, onSubmit: async (values) => {
                    const vol = Number(values.volume);
                    const res = await defaultAudioDeviceManager.setDeviceVolume(device.id, vol);
                    if (!res.success) {
                        await showToast(Toast.Style.Failure, res.error || '音量设置无效');
                        return;
                    }
                    await showToast(Toast.Style.Success, `${device.name} 音量已设为 ${res.device?.volume}%`);
                    onSaved?.();
                    pop();
                } })) },
        React.createElement(Form.TextField, { id: "volume", title: "\u76EE\u6807\u97F3\u91CF\u767E\u5206\u6BD4 (0 ~ 100)", placeholder: "\u8F93\u5165 0 \u5230 100 \u4E4B\u95F4\u7684\u6570\u5B57...", defaultValue: String(device.volume) })));
}
export function AudioDeviceCommand(props) {
    const [searchText, setSearchText] = useState('');
    const [ioFilter, setIoFilter] = useState(() => props?.featureCode === 'audio-input' ? 'input' : 'all');
    const [version, setVersion] = useState(0);
    const [isLoading, setIsLoading] = useState(() => Boolean(props?.hostOverride) || isRealElectronHost());
    const refresh = () => setVersion((v) => v + 1);
    useEffect(() => {
        if (props?.featureCode === 'audio-input') {
            setIoFilter('input');
        }
    }, [props?.featureCode]);
    useEffect(() => {
        let active = true;
        setIsLoading(true);
        void defaultAudioDeviceManager
            .syncDevicesFromHost(props?.hostOverride)
            .then(async () => {
            if (!active)
                return;
            if (props?.featureCode === 'audio-mute-toggle') {
                const defOut = defaultAudioDeviceManager.getDefaultOutputDevice();
                if (defOut) {
                    await defaultAudioDeviceManager.toggleDeviceMute(defOut.id, undefined, props?.hostOverride);
                }
            }
            setIsLoading(false);
            refresh();
        })
            .catch(() => {
            if (active)
                setIsLoading(false);
        });
        return () => {
            active = false;
        };
    }, [props?.featureCode, props?.hostOverride]);
    const devices = useMemo(() => defaultAudioDeviceManager.filterDevices({
        ioType: ioFilter,
        query: searchText
    }), [ioFilter, searchText, version]);
    const outputDevices = devices.filter((d) => d.type === 'output');
    const inputDevices = devices.filter((d) => d.type === 'input');
    const combos = useMemo(() => defaultAudioDeviceManager.getCombos(), [version]);
    const defaultOut = outputDevices.find((d) => d.isDefault) || outputDevices[0];
    const defaultIn = inputDevices.find((d) => d.isDefault) || inputDevices[0];
    const renderDeviceItem = (dev) => (React.createElement(List.Item, { key: dev.id, id: dev.id, icon: dev.isMuted
            ? Icon.SpeakerOff
            : dev.type === 'output'
                ? Icon.SpeakerHigh
                : Icon.Microphone, title: dev.name, subtitle: `${String(dev.transportType).toUpperCase()} · ${dev.isMuted ? '已静音' : `音量 ${dev.volume}%`}`, accessories: [
            ...(dev.isFavourite ? [{ icon: Icon.Star }] : []),
            dev.isDefault ? { tag: '当前默认' } : { text: '待命' }
        ], actions: React.createElement(ActionPanel, null,
            React.createElement(Action, { title: `设为默认${dev.type === 'output' ? '输出 (播放)' : '输入 (麦克风)'}设备`, icon: Icon.Checkmark, onAction: async () => {
                    const res = await defaultAudioDeviceManager.setDefaultDevice(dev.id, props?.hostOverride);
                    await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.success ? `已切换至: ${dev.name}` : res.error || '切换失败');
                    refresh();
                } }),
            React.createElement(Action, { title: dev.isMuted ? '取消静音 (Unmute)' : '一键静音 (Mute)', icon: dev.isMuted ? Icon.SpeakerOn : Icon.SpeakerOff, shortcut: { modifiers: ['ctrl'], key: 'm' }, onAction: async () => {
                    const res = await defaultAudioDeviceManager.toggleDeviceMute(dev.id, undefined, props?.hostOverride);
                    await showToast(Toast.Style.Success, `${res.device?.isMuted ? '已静音' : '已取消静音'}: ${dev.name}`);
                    refresh();
                } }),
            React.createElement(Action.Push, { title: "\u7CBE\u786E\u8BBE\u7F6E\u97F3\u91CF\u767E\u5206\u6BD4...", icon: Icon.SpeakerHigh, shortcut: { modifiers: ['ctrl'], key: 'l' }, target: React.createElement(AudioVolumeForm, { device: dev, onSaved: refresh }) }),
            React.createElement(Action, { title: "\u97F3\u91CF +10%", icon: Icon.Plus, shortcut: { modifiers: ['ctrl'], key: 'arrowup' }, onAction: async () => {
                    const res = defaultAudioDeviceManager.stepDeviceVolume(dev.id, 10, props?.hostOverride);
                    await showToast(Toast.Style.Success, `音量: ${res.device?.volume}%`);
                    refresh();
                } }),
            React.createElement(Action, { title: "\u97F3\u91CF -10%", icon: Icon.Minus, shortcut: { modifiers: ['ctrl'], key: 'arrowdown' }, onAction: async () => {
                    const res = defaultAudioDeviceManager.stepDeviceVolume(dev.id, -10, props?.hostOverride);
                    await showToast(Toast.Style.Success, `音量: ${res.device?.volume}%`);
                    refresh();
                } }),
            [25, 50, 75, 100].map((presetVol) => (React.createElement(Action, { key: `vol-${presetVol}`, title: `快速设置音量为 ${presetVol}%`, icon: Icon.SpeakerHigh, onAction: async () => {
                    const res = await defaultAudioDeviceManager.setDeviceVolume(dev.id, presetVol, props?.hostOverride);
                    await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.success ? `${dev.name} 音量已设为 ${presetVol}%` : res.error || '设置失败');
                    refresh();
                } }))),
            React.createElement(Action, { title: dev.isFavourite ? '取消常用收藏' : '设为常用收藏', icon: dev.isFavourite ? Icon.StarDisabled : Icon.Star, shortcut: { modifiers: ['ctrl'], key: 'f' }, onAction: async () => {
                    defaultAudioDeviceManager.toggleFavourite(dev.id);
                    refresh();
                } }),
            React.createElement(Action, { title: "\u91CD\u65B0\u626B\u63CF\u97F3\u9891\u8BBE\u5907 (Refresh Devices)", icon: Icon.Repeat, shortcut: { modifiers: ['ctrl'], key: 'r' }, onAction: async () => {
                    const list = await defaultAudioDeviceManager.syncDevicesFromHost(props?.hostOverride);
                    refresh();
                    await showToast(Toast.Style.Success, `已刷新音频设备 (${list.length} 个)`);
                } }),
            React.createElement(Action.Push, { title: "\u67E5\u770B\u786C\u4EF6\u4E0E\u5E95\u5C42\u547D\u4EE4\u8BE6\u60C5", icon: Icon.Info, target: React.createElement(AudioDeviceDetailView, { device: dev, onUpdated: refresh }) })) }));
    return (React.createElement(List, { isLoading: isLoading, navigationTitle: "\u97F3\u9891\u8BBE\u5907\u5207\u6362", searchBarPlaceholder: "\u641C\u7D22\u8033\u673A\u3001\u663E\u793A\u5668\u97F3\u54CD\u3001\u626C\u58F0\u5668\u6216\u9EA6\u514B\u98CE...", onSearchTextChange: setSearchText, filterBar: {
            summaryText: `默认输出: ${defaultOut ? `${defaultOut.name} (${defaultOut.isMuted ? '静音' : `${defaultOut.volume}%`})` : '无'} | 默认输入: ${defaultIn ? defaultIn.name : '无'}`,
            actions: [
                {
                    id: 'mute-default-out',
                    title: defaultOut?.isMuted ? '取消输出静音' : '静音当前输出',
                    style: 'primary',
                    onAction: async () => {
                        if (!defaultOut)
                            return;
                        await defaultAudioDeviceManager.toggleDeviceMute(defaultOut.id, undefined, props?.hostOverride);
                        refresh();
                    }
                },
                {
                    id: 'refresh-audio',
                    title: '刷新声卡',
                    style: 'secondary',
                    onAction: async () => {
                        const list = await defaultAudioDeviceManager.syncDevicesFromHost(props?.hostOverride);
                        refresh();
                        await showToast(Toast.Style.Success, `已刷新音频设备 (${list.length} 个)`);
                    }
                }
            ]
        }, searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u6309\u8F93\u5165/\u8F93\u51FA\u7C7B\u578B\u7B5B\u9009", value: ioFilter, onChange: (val) => setIoFilter(val) },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u97F3\u9891\u8BBE\u5907 (All)", value: "all" }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u8F93\u51FA\u64AD\u653E\u8BBE\u5907 (Output)", value: "output" }),
            React.createElement(List.Dropdown.Item, { title: "\u4EC5\u8F93\u5165\u5F55\u97F3\u8BBE\u5907 (Input)", value: "input" }),
            React.createElement(List.Dropdown.Item, { title: "\u5E38\u7528\u6536\u85CF\u8BBE\u5907 (Favourites)", value: "favourites" })) }, devices.length === 0 ? (React.createElement(List.Section, { title: "\u68C0\u6D4B\u7ED3\u679C" },
        React.createElement(List.Item, { id: "empty-audio", icon: Icon.SpeakerOff, title: "\u672A\u68C0\u6D4B\u5230\u5339\u914D\u7684\u97F3\u9891\u8BBE\u5907", subtitle: "\u8BF7\u786E\u8BA4\u8033\u673A\u3001\u626C\u58F0\u5668\u6216\u9EA6\u514B\u98CE\u5DF2\u8FDE\u63A5\uFF0C\u6216\u6309 Ctrl+R \u91CD\u65B0\u626B\u63CF\u58F0\u5361" }))) : (React.createElement(React.Fragment, null,
        ioFilter === 'all' && searchText.trim() === '' && (React.createElement(List.Section, { title: "\u5FEB\u6377\u573A\u666F\u7EC4\u5408 (Audio Combos)", subtitle: `${combos.length} 个预设` }, combos.map((combo) => (React.createElement(List.Item, { key: combo.id, id: combo.id, icon: Icon.SpeakerHigh, title: combo.name, subtitle: combo.description, accessories: [{ tag: combo.shortcut || 'Combo' }], actions: React.createElement(ActionPanel, null,
                React.createElement(Action, { title: `激活场景: ${combo.name}`, icon: Icon.Bolt, onAction: async () => {
                        const res = defaultAudioDeviceManager.applyComboPreset(combo.id, props?.hostOverride);
                        await showToast(res.success ? Toast.Style.Success : Toast.Style.Failure, res.success ? `已应用组合: ${combo.name}` : res.error || '应用失败');
                        refresh();
                    } })) }))))),
        outputDevices.length > 0 && (React.createElement(List.Section, { title: "\u8F93\u51FA\u64AD\u653E\u8BBE\u5907 (Output)", subtitle: `${outputDevices.length} 个设备` }, outputDevices.map(renderDeviceItem))),
        inputDevices.length > 0 && (React.createElement(List.Section, { title: "\u8F93\u5165\u5F55\u97F3\u8BBE\u5907 (Input / Mic)", subtitle: `${inputDevices.length} 个设备` }, inputDevices.map(renderDeviceItem)))))));
}
export default AudioDeviceCommand;
