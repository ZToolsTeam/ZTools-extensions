import { registerStorageSafety } from '../../shared/storage-safety-cases.mjs'
import { saveColorToPalette, getSavedPalette, removeFromPalette, clearPalette } from '../dist/converter.js'

registerStorageSafety({
  key: 'color_picker_palette',
  sample: { id: 'saved-color', name: '原始颜色', hex: '#123456', savedAt: '2026-10-27' },
  create: suffix => saveColorToPalette(`测试颜色 ${suffix}`, `#${suffix.charCodeAt(0).toString(16)}1122`),
  load: getSavedPalette, remove: removeFromPalette, clear: clearPalette
})
