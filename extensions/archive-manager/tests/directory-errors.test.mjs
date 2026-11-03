import { directoryScanContract } from '../../shared/scan-contract-tests.mjs'
import { fetchRealArchiveCandidates } from '../dist/logic.js'

directoryScanContract(() => fetchRealArchiveCandidates(), r => r.length)
