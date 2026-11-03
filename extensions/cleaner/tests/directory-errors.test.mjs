import { directoryScanContract } from '../../shared/scan-contract-tests.mjs'
import { fetchCleanRulesAndScan } from '../dist/logic.js'

directoryScanContract(() => fetchCleanRulesAndScan(), r => r.groups.reduce((n, g) => n + g.fileCount, 0))
