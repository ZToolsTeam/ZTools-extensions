import { TransportType } from './types.js';
import { callHostTransport, isRealElectronHost } from '../shared/native-ipc.js';
export const INITIAL_AUDIO_DEVICES = Object.freeze([
    {
        id: 'out-bluetooth-airpods',
        uid: '{0.0.0.00000000}.{airpods-pro-out}',
        name: 'AirPods Pro (蓝牙降噪耳机)',
        type: 'output',
        isInput: false,
        isOutput: true,
        isDefault: true,
        isCommunicationDefault: true,
        volume: 65,
        isMuted: false,
        transportType: TransportType.Bluetooth,
        sampleRate: 48000,
        channels: 2,
        isFavourite: true,
        isHidden: false
    },
    {
        id: 'out-display-dell-4k',
        uid: '{0.0.0.00000000}.{dell-u2723qe-dp}',
        name: 'Dell U2723QE (外接显示器音响)',
        type: 'output',
        isInput: false,
        isOutput: true,
        isDefault: false,
        isCommunicationDefault: false,
        volume: 50,
        isMuted: false,
        transportType: TransportType.DisplayPort,
        sampleRate: 48000,
        channels: 2,
        isFavourite: true,
        isHidden: false
    },
    {
        id: 'out-builtin-realtek',
        uid: '{0.0.0.00000000}.{realtek-hd-speakers}',
        name: 'Realtek High Definition Audio (本机扬声器)',
        type: 'output',
        isInput: false,
        isOutput: true,
        isDefault: false,
        isCommunicationDefault: false,
        volume: 80,
        isMuted: false,
        transportType: TransportType.BuiltIn,
        sampleRate: 48000,
        channels: 2,
        isFavourite: false,
        isHidden: false
    },
    {
        id: 'out-usb-dac',
        uid: '{0.0.0.00000000}.{fiio-ka13-usb-dac}',
        name: 'FiiO USB DAC-E10 (桌面解码耳放)',
        type: 'output',
        isInput: false,
        isOutput: true,
        isDefault: false,
        isCommunicationDefault: false,
        volume: 45,
        isMuted: false,
        transportType: TransportType.Usb,
        sampleRate: 96000,
        channels: 2,
        isFavourite: true,
        isHidden: false
    },
    {
        id: 'in-usb-shure-mv7',
        uid: '{0.0.1.00000000}.{shure-mv7-usb-mic}',
        name: 'Shure MV7 Podcast Microphone (桌面电容麦)',
        type: 'input',
        isInput: true,
        isOutput: false,
        isDefault: true,
        isCommunicationDefault: true,
        volume: 85,
        isMuted: false,
        transportType: TransportType.Usb,
        sampleRate: 48000,
        channels: 1,
        isFavourite: true,
        isHidden: false
    },
    {
        id: 'in-bluetooth-airpods-mic',
        uid: '{0.0.1.00000000}.{airpods-pro-in}',
        name: 'AirPods Pro Hands-Free (蓝牙耳机麦克风)',
        type: 'input',
        isInput: true,
        isOutput: false,
        isDefault: false,
        isCommunicationDefault: false,
        volume: 75,
        isMuted: false,
        transportType: TransportType.Bluetooth,
        sampleRate: 24000,
        channels: 1,
        isFavourite: true,
        isHidden: false
    },
    {
        id: 'in-builtin-array',
        uid: '{0.0.1.00000000}.{realtek-mic-array}',
        name: '英特尔智音技术麦克风阵列 (内置麦克风)',
        type: 'input',
        isInput: true,
        isOutput: false,
        isDefault: false,
        isCommunicationDefault: false,
        volume: 70,
        isMuted: true,
        transportType: TransportType.BuiltIn,
        sampleRate: 48000,
        channels: 2,
        isFavourite: false,
        isHidden: false
    }
]);
export const DEFAULT_AUDIO_COMBOS = Object.freeze([
    {
        id: 'combo-meeting',
        name: '线上会议模式 (腾讯会议/飞书)',
        description: '输出切至蓝牙/会议耳机，输入切至桌面麦克风并解除静音',
        outputDeviceId: 'out-bluetooth-airpods',
        inputDeviceId: 'in-usb-shure-mv7',
        outputVolume: 65,
        inputVolume: 90,
        muteInput: false,
        shortcut: 'Alt+1'
    },
    {
        id: 'combo-speaker-chill',
        name: '桌面外放影音模式 (防窃听静音麦)',
        description: '输出切至外接显示器音响，自动将输入麦克风静音保护隐私',
        outputDeviceId: 'out-display-dell-4k',
        inputDeviceId: 'in-builtin-array',
        outputVolume: 55,
        inputVolume: 0,
        muteInput: true,
        shortcut: 'Alt+2'
    },
    {
        id: 'combo-hifi-music',
        name: 'Hi-Fi 沉浸听歌模式',
        description: '输出切至 USB DAC 解码耳放，音量调至 45% 黄金听感区间',
        outputDeviceId: 'out-usb-dac',
        inputDeviceId: 'in-usb-shure-mv7',
        outputVolume: 45,
        inputVolume: 80,
        muteInput: true,
        shortcut: 'Alt+3'
    }
]);
export function clampVolume(volume) {
    if (typeof volume !== 'number' || !Number.isFinite(volume)) {
        throw new Error('音量值必须为有效数字');
    }
    return Math.max(0, Math.min(100, Math.round(volume)));
}
export function buildAudioPlatformCommand(action, device, platform = 'Windows', value) {
    const safeName = device.name.replace(/"/g, '\\"');
    if (platform === 'Windows') {
        if (action === 'switch') {
            const cmd = `Set-AudioDevice -ID "${device.uid}"`;
            return {
                platform: 'Windows',
                executable: 'powershell.exe',
                args: ['-NoProfile', '-Command', cmd],
                commandLine: `powershell.exe -NoProfile -Command "${cmd}"`,
                description: `Windows CoreAudio 切换默认${device.type === 'output' ? '输出' : '输入'}设备为 ${device.name}`
            };
        }
        if (action === 'volume') {
            const vol = clampVolume(typeof value === 'number' ? value : device.volume);
            const prop = device.type === 'output' ? '-PlaybackVolume' : '-RecordingVolume';
            const cmd = `Set-AudioDevice ${prop} ${vol}`;
            return {
                platform: 'Windows',
                executable: 'powershell.exe',
                args: ['-NoProfile', '-Command', cmd],
                commandLine: `powershell.exe -NoProfile -Command "${cmd}"`,
                description: `设置 ${device.name} 音量为 ${vol}%`
            };
        }
        const muteFlag = value ? '1' : '0';
        const prop = device.type === 'output' ? '-PlaybackMute' : '-RecordingMute';
        const cmd = `Set-AudioDevice ${prop} ${muteFlag}`;
        return {
            platform: 'Windows',
            executable: 'powershell.exe',
            args: ['-NoProfile', '-Command', cmd],
            commandLine: `powershell.exe -NoProfile -Command "${cmd}"`,
            description: `${value ? '静音' : '取消静音'} ${device.name}`
        };
    }
    if (action === 'switch') {
        return {
            platform: 'macOS',
            executable: 'SwitchAudioSource',
            args: ['-t', device.type, '-s', device.name],
            commandLine: `SwitchAudioSource -t ${device.type} -s "${safeName}"`,
            description: `macOS CoreAudio 切换默认${device.type === 'output' ? '输出' : '输入'}设备为 ${device.name}`
        };
    }
    if (action === 'volume') {
        const vol = clampVolume(typeof value === 'number' ? value : device.volume);
        const osa = device.type === 'output'
            ? `set volume output volume ${vol}`
            : `set volume input volume ${vol}`;
        return {
            platform: 'macOS',
            executable: 'osascript',
            args: ['-e', osa],
            commandLine: `osascript -e '${osa}'`,
            description: `设置 ${device.name} 音量为 ${vol}%`
        };
    }
    const osa = `set volume ${value ? 'with' : 'without'} output muted`;
    return {
        platform: 'macOS',
        executable: 'osascript',
        args: ['-e', osa],
        commandLine: `osascript -e '${osa}'`,
        description: `${value ? '静音' : '取消静音'} ${device.name}`
    };
}
export class AudioDeviceManager {
    devices;
    combos;
    platform;
    constructor(initialDevices, initialCombos = DEFAULT_AUDIO_COMBOS, platform = typeof process !== 'undefined' && process.platform === 'darwin'
        ? 'macOS'
        : 'Windows') {
        const sourceDevices = initialDevices ?? (isRealElectronHost() ? [] : INITIAL_AUDIO_DEVICES);
        this.devices = sourceDevices.map((d) => ({ ...d }));
        this.combos = initialCombos.map((c) => ({ ...c }));
        this.platform = platform;
    }
    mapRawHostDevice(raw, idx) {
        const type = raw?.type === 'input' || raw?.isInput === true || raw?.dataFlow === 'capture'
            ? 'input'
            : 'output';
        const id = String(raw?.id || raw?.uid || `${type}-dev-${idx}`);
        const uid = String(raw?.uid || raw?.id || id);
        const name = String(raw?.name || raw?.deviceName || `Audio Device ${idx + 1}`);
        const volRaw = Number(raw?.volume ?? 70);
        const volume = Number.isFinite(volRaw) ? Math.max(0, Math.min(100, Math.round(volRaw))) : 70;
        return {
            id,
            uid,
            name,
            type,
            isInput: type === 'input',
            isOutput: type === 'output',
            isDefault: Boolean(raw?.isDefault ?? raw?.default),
            isCommunicationDefault: Boolean(raw?.isCommunicationDefault ?? raw?.isDefault),
            volume,
            isMuted: Boolean(raw?.isMuted ?? raw?.muted),
            transportType: String(raw?.transportType || TransportType.BuiltIn),
            sampleRate: Number(raw?.sampleRate) > 0 ? Number(raw.sampleRate) : 48000,
            channels: Number(raw?.channels) > 0 ? Number(raw.channels) : type === 'output' ? 2 : 1,
            isFavourite: Boolean(raw?.isFavourite),
            isHidden: Boolean(raw?.isHidden)
        };
    }
    async syncDevicesFromHost(hostOverride) {
        if (!hostOverride && !isRealElectronHost()) {
            return this.getAllDevices();
        }
        try {
            const ipcRes = await callHostTransport('audio_get_devices', {}, hostOverride);
            if (ipcRes.ok && ipcRes.data !== undefined && ipcRes.data !== null) {
                const list = Array.isArray(ipcRes.data)
                    ? ipcRes.data
                    : Array.isArray(ipcRes.data?.devices)
                        ? ipcRes.data.devices
                        : null;
                if (list !== null) {
                    this.devices = list
                        .filter((item) => Boolean(item && typeof item === 'object'))
                        .map((raw, idx) => this.mapRawHostDevice(raw, idx));
                    return this.getAllDevices();
                }
            }
        }
        catch {
            // 继续尝试 dllplugin_call
        }
        try {
            const dllRes = await callHostTransport('dllplugin_call', {
                plugin: 'AudioDevicePlugin',
                func: 'listDevices',
                params: {}
            }, hostOverride);
            if (dllRes.ok && dllRes.data) {
                const payload = dllRes.data?.result !== undefined ? dllRes.data.result : dllRes.data;
                const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
                const list = Array.isArray(parsed)
                    ? parsed
                    : Array.isArray(parsed?.devices)
                        ? parsed.devices
                        : null;
                if (list !== null) {
                    this.devices = list
                        .filter((item) => Boolean(item && typeof item === 'object'))
                        .map((raw, idx) => this.mapRawHostDevice(raw, idx));
                    return this.getAllDevices();
                }
            }
        }
        catch {
            // ignore
        }
        return this.getAllDevices();
    }
    getAllDevices() {
        return this.devices.map((d) => ({ ...d }));
    }
    getOutputDevices() {
        return this.devices.filter((d) => d.type === 'output').map((d) => ({ ...d }));
    }
    getInputDevices() {
        return this.devices.filter((d) => d.type === 'input').map((d) => ({ ...d }));
    }
    getDefaultOutputDevice() {
        const found = this.devices.find((d) => d.type === 'output' && d.isDefault) ||
            this.devices.find((d) => d.type === 'output');
        return found ? { ...found } : undefined;
    }
    getDefaultInputDevice() {
        const found = this.devices.find((d) => d.type === 'input' && d.isDefault) ||
            this.devices.find((d) => d.type === 'input');
        return found ? { ...found } : undefined;
    }
    getCombos() {
        return this.combos.map((c) => ({ ...c }));
    }
    filterDevices(options = {}) {
        const ioType = options.ioType || 'all';
        const transport = options.transportType || 'all';
        const includeHidden = options.includeHidden ?? false;
        const q = (options.query || '').trim().toLowerCase();
        return this.devices
            .filter((d) => {
            if (!includeHidden && d.isHidden)
                return false;
            if (ioType === 'output' && d.type !== 'output')
                return false;
            if (ioType === 'input' && d.type !== 'input')
                return false;
            if (ioType === 'favourites' && !d.isFavourite)
                return false;
            if (transport !== 'all' && d.transportType !== transport)
                return false;
            if (!q)
                return true;
            return `${d.name} ${d.transportType} ${d.type}`.toLowerCase().includes(q);
        })
            .map((d) => ({ ...d }));
    }
    setDefaultDevice(deviceId, hostOverride) {
        const cleanId = (deviceId || '').trim();
        const target = this.devices.find((d) => d.id === cleanId || d.uid === cleanId);
        if (!target) {
            const failRes = {
                success: false,
                action: 'switch-default',
                errorCode: 'DEVICE_NOT_FOUND',
                error: `未找到指定的音频设备: "${cleanId}"`
            };
            return Object.assign(Promise.resolve(failRes), failRes);
        }
        const command = buildAudioPlatformCommand('switch', target, this.platform);
        const applySwitch = () => {
            for (const dev of this.devices) {
                if (dev.type === target.type) {
                    dev.isDefault = dev.id === target.id;
                    dev.isCommunicationDefault = dev.id === target.id;
                }
            }
        };
        if (hostOverride || isRealElectronHost()) {
            const prevDefaults = this.devices.map((d) => ({
                id: d.id,
                isDefault: d.isDefault,
                isCommunicationDefault: d.isCommunicationDefault
            }));
            applySwitch();
            const optimistic = {
                success: true,
                action: 'switch-default',
                device: { ...target },
                command
            };
            const promise = (async () => {
                let res = await callHostTransport('audio_set_default_device', {
                    id: target.id,
                    uid: target.uid,
                    name: target.name,
                    type: target.type
                }, hostOverride);
                if (!res.ok && (String(res.error || '').startsWith('METHOD_NOT_AVAILABLE:') || res.error === 'NO_WINDOW_ENV')) {
                    res = await callHostTransport('dllplugin_call', {
                        plugin: 'AudioDevicePlugin',
                        func: 'setDefault',
                        params: {
                            id: target.id,
                            uid: target.uid,
                            name: target.name,
                            type: target.type
                        }
                    }, hostOverride);
                }
                const innerFailed = res.data && typeof res.data === 'object' && res.data.ok === false;
                if (!res.ok || innerFailed) {
                    for (const prev of prevDefaults) {
                        const dev = this.devices.find((d) => d.id === prev.id);
                        if (dev) {
                            dev.isDefault = prev.isDefault;
                            dev.isCommunicationDefault = prev.isCommunicationDefault;
                        }
                    }
                    const errMsg = String(res.data?.error || res.error || '切换默认音频设备失败');
                    const extractedCode = errMsg.match(/^([A-Z0-9_]+):/)?.[1];
                    return {
                        success: false,
                        action: 'switch-default',
                        device: { ...target },
                        command,
                        errorCode: String(res.data?.errorCode || extractedCode || 'SWITCH_DEFAULT_FAILED'),
                        error: errMsg
                    };
                }
                return optimistic;
            })();
            return Object.assign(promise, optimistic);
        }
        applySwitch();
        const okRes = {
            success: true,
            action: 'switch-default',
            device: { ...target },
            command
        };
        return Object.assign(Promise.resolve(okRes), okRes);
    }
    setDeviceVolume(deviceId, volume, hostOverride) {
        const cleanId = (deviceId || '').trim();
        const target = this.devices.find((d) => d.id === cleanId || d.uid === cleanId);
        if (!target) {
            const failRes = {
                success: false,
                action: 'set-volume',
                errorCode: 'DEVICE_NOT_FOUND',
                error: `未找到指定的音频设备: "${cleanId}"`
            };
            return Object.assign(Promise.resolve(failRes), failRes);
        }
        let clamped;
        try {
            clamped = clampVolume(volume);
        }
        catch (e) {
            const failRes = {
                success: false,
                action: 'set-volume',
                errorCode: 'INVALID_VOLUME',
                error: e instanceof Error ? e.message : '无效的音量参数'
            };
            return Object.assign(Promise.resolve(failRes), failRes);
        }
        const prevVol = target.volume;
        const prevMuted = target.isMuted;
        target.volume = clamped;
        if (clamped > 0 && target.isMuted) {
            target.isMuted = false;
        }
        const command = buildAudioPlatformCommand('volume', target, this.platform, clamped);
        if (hostOverride || isRealElectronHost()) {
            const optimistic = {
                success: true,
                action: 'set-volume',
                device: { ...target },
                command
            };
            const promise = (async () => {
                let res = await callHostTransport('audio_set_volume', {
                    id: target.id,
                    uid: target.uid,
                    name: target.name,
                    type: target.type,
                    volume: clamped
                }, hostOverride);
                if (!res.ok && (String(res.error || '').startsWith('METHOD_NOT_AVAILABLE:') || res.error === 'NO_WINDOW_ENV')) {
                    res = await callHostTransport('dllplugin_call', {
                        plugin: 'AudioDevicePlugin',
                        func: 'setVolume',
                        params: {
                            id: target.id,
                            type: target.type,
                            volume: clamped
                        }
                    }, hostOverride);
                }
                const innerFailed = res.data && typeof res.data === 'object' && res.data.ok === false;
                if (!res.ok || innerFailed) {
                    target.volume = prevVol;
                    target.isMuted = prevMuted;
                    return {
                        success: false,
                        action: 'set-volume',
                        device: { ...target },
                        command,
                        error: String(res.data?.error || res.error || '设置音频设备音量失败')
                    };
                }
                return optimistic;
            })();
            return Object.assign(promise, optimistic);
        }
        const okRes = {
            success: true,
            action: 'set-volume',
            device: { ...target },
            command
        };
        return Object.assign(Promise.resolve(okRes), okRes);
    }
    stepDeviceVolume(deviceId, delta, hostOverride) {
        const target = this.devices.find((d) => d.id === deviceId || d.uid === deviceId);
        if (!target) {
            return {
                success: false,
                action: 'step-volume',
                error: `未找到音频设备: "${deviceId}"`
            };
        }
        const nextVol = clampVolume(target.volume + (Number.isFinite(delta) ? delta : 0));
        const res = this.setDeviceVolume(target.id, nextVol, hostOverride);
        return {
            ...res,
            action: 'step-volume'
        };
    }
    toggleDeviceMute(deviceId, forceState, hostOverride) {
        const target = this.devices.find((d) => d.id === deviceId || d.uid === deviceId);
        if (!target) {
            const failRes = {
                success: false,
                action: 'toggle-mute',
                error: `未找到音频设备: "${deviceId}"`
            };
            return Object.assign(Promise.resolve(failRes), failRes);
        }
        const prevMuted = target.isMuted;
        target.isMuted = forceState !== undefined ? Boolean(forceState) : !target.isMuted;
        const command = buildAudioPlatformCommand('mute', target, this.platform, target.isMuted);
        if (hostOverride || isRealElectronHost()) {
            const optimistic = {
                success: true,
                action: 'toggle-mute',
                device: { ...target },
                command
            };
            const promise = (async () => {
                let res = await callHostTransport('audio_toggle_mute', {
                    id: target.id,
                    uid: target.uid,
                    name: target.name,
                    type: target.type,
                    muted: target.isMuted
                }, hostOverride);
                if (!res.ok && (String(res.error || '').startsWith('METHOD_NOT_AVAILABLE:') || res.error === 'NO_WINDOW_ENV')) {
                    res = await callHostTransport('dllplugin_call', {
                        plugin: 'AudioDevicePlugin',
                        func: 'setMute',
                        params: {
                            id: target.id,
                            type: target.type,
                            muted: target.isMuted
                        }
                    }, hostOverride);
                }
                const innerFailed = res.data && typeof res.data === 'object' && res.data.ok === false;
                if (!res.ok || innerFailed) {
                    target.isMuted = prevMuted;
                    return {
                        success: false,
                        action: 'toggle-mute',
                        device: { ...target },
                        command,
                        error: String(res.data?.error || res.error || '切换静音状态失败')
                    };
                }
                return optimistic;
            })();
            return Object.assign(promise, optimistic);
        }
        const okRes = {
            success: true,
            action: 'toggle-mute',
            device: { ...target },
            command
        };
        return Object.assign(Promise.resolve(okRes), okRes);
    }
    toggleFavourite(deviceId) {
        const target = this.devices.find((d) => d.id === deviceId || d.uid === deviceId);
        if (!target) {
            return {
                success: false,
                action: 'toggle-favourite',
                error: `未找到音频设备: "${deviceId}"`
            };
        }
        target.isFavourite = !target.isFavourite;
        return {
            success: true,
            action: 'toggle-favourite',
            device: { ...target }
        };
    }
    applyComboPreset(comboId, hostOverride) {
        const combo = this.combos.find((c) => c.id === comboId);
        if (!combo) {
            return {
                success: false,
                action: 'apply-combo',
                error: `未找到音频场景预设: "${comboId}"`
            };
        }
        const outRes = this.setDefaultDevice(combo.outputDeviceId, hostOverride);
        if (!outRes.success) {
            return {
                success: false,
                action: 'apply-combo',
                error: outRes.error
            };
        }
        if (combo.outputVolume !== undefined) {
            this.setDeviceVolume(combo.outputDeviceId, combo.outputVolume, hostOverride);
        }
        const inRes = this.setDefaultDevice(combo.inputDeviceId, hostOverride);
        if (!inRes.success) {
            return {
                success: false,
                action: 'apply-combo',
                error: inRes.error
            };
        }
        if (combo.inputVolume !== undefined) {
            this.setDeviceVolume(combo.inputDeviceId, combo.inputVolume, hostOverride);
        }
        if (combo.muteInput !== undefined) {
            this.toggleDeviceMute(combo.inputDeviceId, combo.muteInput, hostOverride);
        }
        return {
            success: true,
            action: 'apply-combo',
            combo: { ...combo },
            device: this.getDefaultOutputDevice()
        };
    }
    resetToDefaults() {
        this.devices = INITIAL_AUDIO_DEVICES.map((d) => ({ ...d }));
        this.combos = DEFAULT_AUDIO_COMBOS.map((c) => ({ ...c }));
    }
}
export const defaultAudioDeviceManager = new AudioDeviceManager();
export async function getAllDevices(hostOverride) {
    if (hostOverride || isRealElectronHost()) {
        return defaultAudioDeviceManager.syncDevicesFromHost(hostOverride);
    }
    return defaultAudioDeviceManager.getAllDevices();
}
export async function getInputDevices(hostOverride) {
    if (hostOverride || isRealElectronHost()) {
        await defaultAudioDeviceManager.syncDevicesFromHost(hostOverride);
    }
    return defaultAudioDeviceManager.getInputDevices();
}
export async function getOutputDevices(hostOverride) {
    if (hostOverride || isRealElectronHost()) {
        await defaultAudioDeviceManager.syncDevicesFromHost(hostOverride);
    }
    return defaultAudioDeviceManager.getOutputDevices();
}
export async function getDefaultOutputDevice(hostOverride) {
    if (hostOverride || isRealElectronHost()) {
        await defaultAudioDeviceManager.syncDevicesFromHost(hostOverride);
    }
    return defaultAudioDeviceManager.getDefaultOutputDevice();
}
export async function getDefaultInputDevice(hostOverride) {
    if (hostOverride || isRealElectronHost()) {
        await defaultAudioDeviceManager.syncDevicesFromHost(hostOverride);
    }
    return defaultAudioDeviceManager.getDefaultInputDevice();
}
export async function setDefaultOutputDevice(deviceId, hostOverride) {
    return defaultAudioDeviceManager.setDefaultDevice(deviceId, hostOverride);
}
export async function setDefaultInputDevice(deviceId, hostOverride) {
    return defaultAudioDeviceManager.setDefaultDevice(deviceId, hostOverride);
}
export async function setOutputDeviceVolume(deviceId, volume, hostOverride) {
    return defaultAudioDeviceManager.setDeviceVolume(deviceId, volume, hostOverride);
}
export async function toggleOutputDeviceMute(deviceId, hostOverride) {
    return defaultAudioDeviceManager.toggleDeviceMute(deviceId, undefined, hostOverride);
}
export async function setInputDeviceVolume(deviceId, volume, hostOverride) {
    return defaultAudioDeviceManager.setDeviceVolume(deviceId, volume, hostOverride);
}
export async function toggleInputDeviceMute(deviceId, hostOverride) {
    return defaultAudioDeviceManager.toggleDeviceMute(deviceId, undefined, hostOverride);
}
