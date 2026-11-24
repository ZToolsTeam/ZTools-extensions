import type { CheatsheetShortcutItem, HotkeyProbePreset } from './types.js'
import { t } from './i18n.js'
import { HIGH_CONFLICT_HOTKEY_PRESETS, CHEATSHEET_SHORTCUTS } from './cheatsheet-data.zh-data.js'

export { HIGH_CONFLICT_HOTKEY_PRESETS, CHEATSHEET_SHORTCUTS }

const PRESET_KEYS: Record<string, { victim: Parameters<typeof t>[0]; culprit: Parameters<typeof t>[0]; guide: Parameters<typeof t>[0] }> = {
  'hk-ctrl-alt-a': { victim: 'p1Victim', culprit: 'p1Culprit', guide: 'p1Guide' },
  'hk-ctrl-alt-s': { victim: 'p2Victim', culprit: 'p2Culprit', guide: 'p2Guide' },
  'hk-ctrl-shift-f': { victim: 'p3Victim', culprit: 'p3Culprit', guide: 'p3Guide' },
  'hk-alt-z': { victim: 'p4Victim', culprit: 'p4Culprit', guide: 'p4Guide' },
  'hk-alt-r': { victim: 'p5Victim', culprit: 'p5Culprit', guide: 'p5Guide' },
  'hk-ctrl-alt-p': { victim: 'p6Victim', culprit: 'p6Culprit', guide: 'p6Guide' },
  'hk-ctrl-alt-d': { victim: 'p7Victim', culprit: 'p7Culprit', guide: 'p7Guide' },
  'hk-ctrl-alt-w': { victim: 'p8Victim', culprit: 'p8Culprit', guide: 'p8Guide' },
  'hk-ctrl-alt-z': { victim: 'p9Victim', culprit: 'p9Culprit', guide: 'p9Guide' },
  'hk-ctrl-space': { victim: 'p10Victim', culprit: 'p10Culprit', guide: 'p10Guide' },
  'hk-ctrl-alt-up': { victim: 'p11Victim', culprit: 'p11Culprit', guide: 'p11Guide' },
  'hk-ctrl-alt-down': { victim: 'p12Victim', culprit: 'p12Culprit', guide: 'p12Guide' },
  'hk-f1': { victim: 'p13Victim', culprit: 'p13Culprit', guide: 'p13Guide' },
  'hk-win-l': { victim: 'p14Victim', culprit: 'p14Culprit', guide: 'p14Guide' }
}

const SHEET_KEYS: Record<string, { cat: Parameters<typeof t>[0]; title: Parameters<typeof t>[0]; sub: Parameters<typeof t>[0] }> = {
  'os-clipboard-history': { cat: 'catLabelOs', title: 'cs1Title', sub: 'cs1Sub' },
  'os-virtual-desktop-new': { cat: 'catLabelOs', title: 'cs2Title', sub: 'cs2Sub' },
  'os-snap-layout': { cat: 'catLabelOs', title: 'cs3Title', sub: 'cs3Sub' },
  'os-task-manager': { cat: 'catLabelOs', title: 'cs4Title', sub: 'cs4Sub' },
  'os-snipping-tool': { cat: 'catLabelOs', title: 'cs5Title', sub: 'cs5Sub' },
  'vsc-command-palette': { cat: 'catLabelVscode', title: 'cs6Title', sub: 'cs6Sub' },
  'vsc-multi-cursor': { cat: 'catLabelVscode', title: 'cs7Title', sub: 'cs7Sub' },
  'vsc-quick-open': { cat: 'catLabelVscode', title: 'cs8Title', sub: 'cs8Sub' },
  'vsc-global-symbol': { cat: 'catLabelVscode', title: 'cs9Title', sub: 'cs9Sub' },
  'vsc-split-editor': { cat: 'catLabelVscode', title: 'cs10Title', sub: 'cs10Sub' },
  'xls-abs-ref': { cat: 'catLabelExcel', title: 'cs11Title', sub: 'cs11Sub' },
  'xls-flash-fill': { cat: 'catLabelExcel', title: 'cs12Title', sub: 'cs12Sub' },
  'xls-auto-sum': { cat: 'catLabelExcel', title: 'cs13Title', sub: 'cs13Sub' },
  'xls-freeze-panes': { cat: 'catLabelExcel', title: 'cs14Title', sub: 'cs14Sub' },
  'xls-filter-toggle': { cat: 'catLabelExcel', title: 'cs15Title', sub: 'cs15Sub' },
  'ps-free-transform': { cat: 'catLabelPs', title: 'cs16Title', sub: 'cs16Sub' },
  'ps-merge-visible': { cat: 'catLabelPs', title: 'cs17Title', sub: 'cs17Sub' },
  'web-reopen-tab': { cat: 'catLabelBrowser', title: 'cs18Title', sub: 'cs18Sub' },
  'web-clear-cache-reload': { cat: 'catLabelBrowser', title: 'cs19Title', sub: 'cs19Sub' },
  'web-incognito': { cat: 'catLabelBrowser', title: 'cs20Title', sub: 'cs20Sub' }
}

export function getHighConflictPresets(): HotkeyProbePreset[] {
  return HIGH_CONFLICT_HOTKEY_PRESETS.map((p) => {
    const keys = PRESET_KEYS[p.id]
    return keys
      ? { ...p, commonVictim: t(keys.victim), typicalCulprit: t(keys.culprit), modifyGuide: t(keys.guide) }
      : p
  })
}

export function getCheatsheetShortcuts(): CheatsheetShortcutItem[] {
  return CHEATSHEET_SHORTCUTS.map((s) => {
    const keys = SHEET_KEYS[s.id]
    return keys
      ? { ...s, categoryLabel: t(keys.cat), title: t(keys.title), subtitle: t(keys.sub) }
      : s
  })
}
