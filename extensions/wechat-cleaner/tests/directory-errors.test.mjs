import { directoryScanContract } from '../../shared/scan-contract-tests.mjs'
import { fetchWechatCleanSnapshot } from '../dist/logic.js'

directoryScanContract(() => fetchWechatCleanSnapshot(), r => r.allFiles.length)
