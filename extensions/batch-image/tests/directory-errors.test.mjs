import { directoryScanContract } from '../../shared/scan-contract-tests.mjs'
import { fetchRealImageWorkspace } from '../dist/logic.js'

directoryScanContract(() => fetchRealImageWorkspace(), r => r.files.length)
