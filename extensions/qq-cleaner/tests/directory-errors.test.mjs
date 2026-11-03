import { directoryScanContract } from '../../shared/scan-contract-tests.mjs'
import { fetchQQCleanSnapshot } from '../dist/logic.js'

directoryScanContract(() => fetchQQCleanSnapshot(), r => r.allFiles.length)
