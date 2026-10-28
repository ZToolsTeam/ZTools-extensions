import { registerStorageSafety } from '../../shared/storage-safety-cases.mjs'
import { saveQrItem, getQrHistory, deleteQrItem, clearQrHistory, toggleFavoriteQrItem } from '../dist/qr-generator.js'

registerStorageSafety({
  key: 'ztools_qr_history',
  sample: { id: 'saved-qr', title: '原始二维码', content: '仅内存的测试内容', level: 'M', createdAt: '2026-10-27', favorite: false },
  create: suffix => saveQrItem({ id: `qr-${suffix}`, title: suffix, content: `测试 ${suffix}`, level: 'M', createdAt: '2026-10-27', favorite: true }),
  load: getQrHistory, remove: deleteQrItem, clear: clearQrHistory,
  toggle: toggleFavoriteQrItem, toggleField: 'favorite'
})
