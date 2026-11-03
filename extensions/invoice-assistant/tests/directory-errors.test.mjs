import { directoryScanContract } from '../../shared/scan-contract-tests.mjs'
import { fetchRealInvoicesWorkspace } from '../dist/logic.js'

directoryScanContract(() => fetchRealInvoicesWorkspace(), r => r.invoices.length)
