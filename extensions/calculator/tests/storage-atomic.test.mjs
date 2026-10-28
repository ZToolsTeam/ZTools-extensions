import { registerStorageSafety } from '../../shared/storage-safety-cases.mjs'
import { addCalculatorHistory, getCalculatorHistory, deleteCalculatorHistory, clearCalculatorHistory, togglePinCalculatorHistory } from '../dist/calculator-engine.js'

registerStorageSafety({
  key: 'ztools-calculator-history-v1',
  sample: { id: 'saved-calc', expression: '1+1', answer: '2', type: 'math', timestamp: 1, pinned: false },
  create: suffix => addCalculatorHistory(`${suffix.charCodeAt(0)}+1`, String(suffix.charCodeAt(0) + 1), 'math'),
  load: getCalculatorHistory, remove: deleteCalculatorHistory, clear: clearCalculatorHistory,
  toggle: togglePinCalculatorHistory, toggleField: 'pinned'
})
