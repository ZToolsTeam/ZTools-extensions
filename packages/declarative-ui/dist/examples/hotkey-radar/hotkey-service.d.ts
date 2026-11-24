import type { CheatsheetShortcutItem, HotkeyModeFilter, HotkeyProbePreset, HotkeyProbeResultItem, ParsedHotkeyCombo } from './types.js';
export declare function parseAndNormalizeHotkeyCombo(rawInput: string): ParsedHotkeyCombo;
export declare function probeGlobalHotkeys(presets?: readonly HotkeyProbePreset[], customCombo?: string, hostOverride?: unknown): Promise<HotkeyProbeResultItem[]>;
export declare function filterCheatsheetItems(modeFilter: HotkeyModeFilter, query?: string, items?: readonly CheatsheetShortcutItem[]): CheatsheetShortcutItem[];
export declare function killHotkeySuspectProcess(item: Pick<HotkeyProbeResultItem, 'isSystemReserved' | 'suspectPid' | 'suspectProcess' | 'suspectApp'>, hostOverride?: unknown): Promise<{
    ok: boolean;
    errorCode?: string;
    error?: string;
}>;
