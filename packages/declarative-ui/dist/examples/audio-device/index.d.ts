import type { AudioDevice } from './types.js';
export * from './types.js';
export * from './audio-service.js';
export declare function AudioDeviceDetailView({ device, onUpdated }: {
    device: AudioDevice;
    onUpdated?: () => void;
}): JSX.Element;
export declare function AudioVolumeForm({ device, onSaved }: {
    device: AudioDevice;
    onSaved?: () => void;
}): JSX.Element;
export declare function AudioDeviceCommand(props?: {
    featureCode?: string;
    hostOverride?: unknown;
}): JSX.Element;
export default AudioDeviceCommand;
