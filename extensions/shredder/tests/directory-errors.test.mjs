import { directoryScanContract } from '../../shared/scan-contract-tests.mjs'
import { fetchShredCandidates } from '../dist/logic.js'

directoryScanContract(() => fetchShredCandidates(), r => r.candidates.length)
