import type { CleanDurationPreset } from './types.js';
export * from './types.js';
export * from './keyboard-lock-service.js';
export declare function CleanKeyboardDetailView({ preset, onStateChange, hostOverride }: {
    preset?: CleanDurationPreset;
    onStateChange?: () => void;
    hostOverride?: unknown;
}): JSX.Element;
export declare function CustomDurationForm({ onLocked, hostOverride }: {
    onLocked?: () => void;
    hostOverride?: unknown;
}): JSX.Element;
export declare function CleanKeyboardCommand(props?: {
    featureCode?: string;
    hostOverride?: unknown;
}): JSX.Element;
export default CleanKeyboardCommand;
