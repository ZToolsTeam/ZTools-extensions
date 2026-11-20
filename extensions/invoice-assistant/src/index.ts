import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  useState,
  useEffect,
  useLocale,
  useRef,
  useNavigation,
  showToast,
  Toast,
  confirmAlert,
  FilterBar,
  KeyboardShortcut
} from '@ztools/declarative-ui'
import {
  InvoiceRecordItem,
  InvoiceEditValues,
  InvoiceFieldKey,
  InvoiceParseError,
  InvoiceExportMode,
  INVOICE_RENAME_TEMPLATES,
  EXPENSE_CATEGORY_CYCLE,
  INVOICE_IMPORT_RULES,
  INVOICE_IMPORT_SUPPORTED_TEXT,
  createInvoiceImportTransport,
  formatCurrency,
  buildTargetInvoiceFileName,
  buildInvoiceTsvTable,
  buildInvoiceSummaryText,
  exportInvoices,
  openInvoiceLocation,
  trashInvoiceFile,
  detectInvoiceAnomalies,
  applyInvoiceEdits,
  validateInvoiceEdits,
  getInvoiceFieldIssues,
  getInvoiceFieldLabel,
  getInvoiceRenameTemplates,
  getInvoiceCategoryGroups,
  translateCategory,
  describeInvoiceIssues,
  isInvoiceComplete,
  isInvoiceSelectable,
  defaultCheckedInvoiceIds,
  matchesInvoiceFilter,
  parseInvoiceFiles
} from './logic.js'
import { t } from './i18n.js'
import { isRealElectronHost } from './native-ipc.js'
import { isDeclarativeFileInputSupported } from './host-compat.js'
import {
  FileImportResult,
  NormalizedFileInput,
  collectFolderFiles,
  createImportInputProps,
  expandInputPaths,
  friendlyFileError,
  isVolumeRoot,
  mergeByPath,
  normalizeFileInput,
  pathKey,
  pickFiles,
  pickFolder,
  summarizeImport
} from './file-import.js'

export * from './logic.js'

/** 用户在本次会话里手动补全的字段与分类，后续追加导入按文件路径保留 */
type InvoiceOverride = Partial<InvoiceEditValues> & { category?: InvoiceRecordItem['category'] }

interface ImportProgress {
  visitedDirs: number
  matchedFiles: number
}

interface ParseProgress {
  done: number
  total: number
}

type ImportTask = (
  signal: AbortSignal,
  onProgress: (progress: ImportProgress) => void
) => Promise<FileImportResult>

const SHORTCUT_PICK_FILES: KeyboardShortcut = { modifiers: ['ctrl'], key: 'o' }
const SHORTCUT_PICK_FOLDER: KeyboardShortcut = { modifiers: ['ctrl', 'shift'], key: 'o' }
const SHORTCUT_REMOVE: KeyboardShortcut = { modifiers: ['ctrl'], key: 'backspace' }
const SHORTCUT_CLEAR: KeyboardShortcut = { modifiers: ['ctrl', 'shift'], key: 'backspace' }
const SHORTCUT_TOGGLE_ALL: KeyboardShortcut = { modifiers: ['ctrl'], key: 'a' }
const SHORTCUT_LOCATE_FILE: KeyboardShortcut = { modifiers: ['ctrl'], key: 'l' }

function overrideKey(filePath: string): string {
  return pathKey(filePath)
}

function applyOverrides(items: InvoiceRecordItem[], overrides: Map<string, InvoiceOverride>): InvoiceRecordItem[] {
  if (overrides.size === 0) return items
  return detectInvoiceAnomalies(
    items.map((item) => {
      const ov = overrides.get(overrideKey(item.path))
      if (!ov) return item
      const next: InvoiceRecordItem = { ...item, ...ov }
      if (ov.issueDate) next.issueDateNeedsReview = false
      return next
    })
  )
}

function amountInputText(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '' : value.toFixed(2)
}

export function InvoiceEditForm(props: {
  invoice: InvoiceRecordItem
  /** 返回 false 表示发票已不在列表中（例如已移入回收站），未保存 */
  onSave: (values: InvoiceEditValues) => boolean
}) {
  useLocale()
  const inv = props.invoice
  const { pop } = useNavigation()
  const issues = getInvoiceFieldIssues(inv)
  const [invoiceNo, setInvoiceNo] = useState(inv.invoiceNo)
  const [issueDate, setIssueDate] = useState(inv.issueDate)
  const [sellerName, setSellerName] = useState(inv.sellerName)
  const [buyerName, setBuyerName] = useState(inv.buyerName)
  const [totalAmount, setTotalAmount] = useState(amountInputText(inv.totalAmount))
  const [taxAmount, setTaxAmount] = useState(amountInputText(inv.taxAmount))
  const [errors, setErrors] = useState<Partial<Record<InvoiceFieldKey, string>>>({})

  const clearError = (field: InvoiceFieldKey) => {
    setErrors((prev) => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  async function handleSave() {
    const result = validateInvoiceEdits({ invoiceNo, issueDate, sellerName, buyerName, totalAmount, taxAmount })
    if (!result.ok) {
      setErrors(result.errors)
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastFixRedFields'),
        message: Object.values(result.errors)[0]
      })
      return
    }
    if (!props.onSave(result.values)) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastSaveNotInList'),
        message: inv.fileName
      })
      return
    }
    await showToast({ style: Toast.Style.Success, title: t('toastSavedInvoice'), message: inv.fileName })
    pop()
  }

  const issueText = describeInvoiceIssues(inv)
  const field = (
    id: InvoiceFieldKey,
    value: string,
    setter: (v: string) => void,
    placeholder: string,
    info?: string
  ) =>
    Form.TextField({
      id,
      title: getInvoiceFieldLabel(id),
      placeholder,
      value,
      error: errors[id],
      info,
      onChange: (v: string) => {
        setter(v)
        clearError(id)
      }
    })

  return Form({
    navigationTitle: t('formNavTitle', { file: inv.fileName }),
    actions: ActionPanel({
      children: [Action({ title: t('formSaveAction'), icon: Icon.Check, onAction: handleSave })]
    }),
    children: [
      Form.Description({
        title: t('formOriginalFile'),
        text: issueText ? t('formOriginalFileDesc', { file: inv.fileName, issues: issueText }) : inv.fileName
      }),
      field('invoiceNo', invoiceNo, setInvoiceNo, t('phInvoiceNo')),
      field(
        'issueDate',
        issueDate,
        setIssueDate,
        'YYYY-MM-DD',
        issues.needsReview.includes('issueDate')
          ? t('infoIssueDateReview')
          : undefined
      ),
      field('sellerName', sellerName, setSellerName, t('phSellerName')),
      field('buyerName', buyerName, setBuyerName, t('phBuyerName')),
      field('totalAmount', totalAmount, setTotalAmount, t('phTotalAmount')),
      field('taxAmount', taxAmount, setTaxAmount, t('phTaxAmount'))
    ]
  })
}

export function InvoiceAssistantCommand() {
  useLocale()
  const launchCtx = (((globalThis as Record<string, unknown>).window || globalThis) as { __ztoolsLaunchContext?: { pluginId?: string; featureCode?: string } }).__ztoolsLaunchContext; const initialFeature = launchCtx && (!launchCtx.pluginId || launchCtx.pluginId === 'invoice-assistant') ? String(launchCtx.featureCode || '').trim() : ''
  const initialTemplateId =
    initialFeature === 'invoice-rename' && INVOICE_RENAME_TEMPLATES[1]
      ? INVOICE_RENAME_TEMPLATES[1].id
      : INVOICE_RENAME_TEMPLATES[0]!.id
  const initialFilterKey = initialFeature === 'invoice-travel' ? 'TRAVEL' : 'ALL'
  const transport = createInvoiceImportTransport()
  const [searchText, setSearchText] = useState('')
  const [activeTemplateId, setActiveTemplateId] = useState<string>(initialTemplateId)
  const [selectedFilterKey, setSelectedFilterKey] = useState<string>(initialFilterKey)
  const [invoices, setInvoices] = useState<InvoiceRecordItem[]>([])
  // 默认只勾选字段完整、非重复且抬头正常的发票，从源头防止把重复或信息不全的发票打入报销单
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [parseErrors, setParseErrors] = useState<InvoiceParseError[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importStage, setImportStage] = useState<'reading' | 'parsing'>('reading')
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [parseProgress, setParseProgress] = useState<ParseProgress | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportingIds, setExportingIds] = useState<string[]>([])
  const { push } = useNavigation()

  const exportingRef = useRef(false)
  const exportingIdsRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)
  const importSeqRef = useRef(0)
  const importAbortRef = useRef<AbortController | null>(null)
  const idSeqRef = useRef(0)
  const overridesRef = useRef<Map<string, InvoiceOverride>>(new Map())
  // 表单保存与导入回调需读取最新列表而不是旧闭包状态
  const latestRef = useRef({ invoices, checkedIds })
  latestRef.current = { invoices, checkedIds }

  async function runImport(task: ImportTask) {
    importAbortRef.current?.abort()
    const controller = new AbortController()
    importAbortRef.current = controller
    const seq = ++importSeqRef.current
    setIsImporting(true)
    setImportStage('reading')
    setImportProgress(null)
    setParseProgress(null)

    try {
      const result = await task(controller.signal, (progress) => {
        if (mountedRef.current && seq === importSeqRef.current) setImportProgress(progress)
      })
      if (!mountedRef.current || seq !== importSeqRef.current || controller.signal.aborted) return
      if (result.canceled) return
      if (result.error) {
        const summary = summarizeImport(result, { added: 0 }, INVOICE_IMPORT_SUPPORTED_TEXT)
        if (summary) {
          await showToast({
            style: Toast.Style.Failure,
            title: summary.title,
            message: summary.message
          })
        }
        return
      }

      const { invoices: currentBeforeParse } = latestRef.current
      const { added: newFiles, duplicates } = mergeByPath<{ path: string; sizeBytes: number | null }>(
        currentBeforeParse,
        result.files,
        (f) => f.path
      )
      if (newFiles.length === 0) {
        const summary = summarizeImport(result, { added: 0, duplicates }, INVOICE_IMPORT_SUPPORTED_TEXT)
        if (summary) {
          await showToast({
            style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
            title: summary.title,
            message: summary.message
          })
        }
        return
      }

      setImportStage('parsing')
      setParseProgress({ done: 0, total: newFiles.length })
      const sizeByPath = new Map(newFiles.map((f) => [overrideKey(f.path), f.sizeBytes]))
      const parseRes = await parseInvoiceFiles(
        newFiles.map((f) => f.path),
        '',
        undefined,
        new Date(),
        {
          signal: controller.signal,
          onProgress: (prog) => {
            if (mountedRef.current && seq === importSeqRef.current) setParseProgress(prog)
          }
        }
      )
      if (!mountedRef.current || seq !== importSeqRef.current || controller.signal.aborted || parseRes.canceled) return

      if (!parseRes.ok) {
        await showToast({
          style: Toast.Style.Failure,
          title: t('errParseInvoicesFailed'),
          message: parseRes.error
        })
        return
      }

      const { invoices: currentInvoices, checkedIds: currentChecked } = latestRef.current
      const existingPaths = new Set(currentInvoices.map((i) => overrideKey(i.path)))
      const addedItems: InvoiceRecordItem[] = []
      for (const item of parseRes.invoices) {
        const key = overrideKey(item.path)
        if (existingPaths.has(key)) continue
        existingPaths.add(key)
        const importedSize = sizeByPath.get(key)
        addedItems.push({
          ...item,
          id: `inv-${++idSeqRef.current}-${item.path}`,
          sizeBytes: item.sizeBytes > 0 ? item.sizeBytes : (importedSize ?? 0)
        })
      }

      const addedIdSet = new Set(addedItems.map((i) => i.id))
      // 已有发票在前，新增发票在后，确保新导入重复票不会把已有发票变成重复并影响已有勾选
      const mergedRaw = [...currentInvoices, ...addedItems]
      const nextInvoices = applyOverrides(detectInvoiceAnomalies(mergedRaw), overridesRef.current)
      const addedEvaluated = nextInvoices.filter((item) => addedIdSet.has(item.id))
      const addedCheckedIds = defaultCheckedInvoiceIds(addedEvaluated)
      const nextCheckedIds = Array.from(new Set([...currentChecked, ...addedCheckedIds]))

      latestRef.current = { invoices: nextInvoices, checkedIds: nextCheckedIds }
      setInvoices(nextInvoices)
      setCheckedIds(nextCheckedIds)

      if (parseRes.parseErrors.length > 0) {
        setParseErrors((prev) => [...parseRes.parseErrors, ...prev])
        const notes: string[] = []
        if (duplicates > 0) notes.push(t('noteAlreadyInList', { count: duplicates }))
        if (result.ignored > 0) notes.push(t('noteIgnoredUnsupported', { count: result.ignored }))
        if (result.truncated) notes.push(t('noteTruncated'))
        if (result.failedDirs.length > 0) notes.push(t('noteFailedDirs', { count: result.failedDirs.length }))
        const firstErr = `${parseRes.parseErrors[0]!.file}: ${parseRes.parseErrors[0]!.error}`
        await showToast({
          style: Toast.Style.Failure,
          title:
            addedItems.length > 0
              ? t('toastPartialImportTitle', { added: addedItems.length, errors: parseRes.parseErrors.length })
              : t('toastAllImportFailedTitle', { errors: parseRes.parseErrors.length }),
          message: [firstErr, ...notes].join(t('semiSep'))
        })
        return
      }

      const summary = summarizeImport(result, { added: addedItems.length, duplicates }, INVOICE_IMPORT_SUPPORTED_TEXT)
      if (summary) {
        const msg = summary.ok
          ? [summary.message, t('noteCheckedCount', { count: nextCheckedIds.length })].filter(Boolean).join(t('semiSep'))
          : summary.message
        await showToast({
          style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
          title: summary.title,
          message: msg
        })
      }
    } catch (err) {
      if (!mountedRef.current || seq !== importSeqRef.current) return
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastImportFailed'),
        message: friendlyFileError(err)
      })
    } finally {
      if (mountedRef.current && seq === importSeqRef.current) {
        importAbortRef.current = null
        setIsImporting(false)
        setImportProgress(null)
        setParseProgress(null)
      }
    }
  }

  function handlePickFiles() {
    void runImport(() => pickFiles(transport, INVOICE_IMPORT_RULES, { title: t('pickFilesTitle'), filterName: t('pickFilesFilter') }))
  }

  function handlePickFolder() {
    void runImport(async (signal, onProgress) => {
      const picked = await pickFolder(transport, { title: t('pickFolderTitle') })
      if (picked.canceled || signal.aborted) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
      if (picked.error || !picked.folderPath) {
        return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false, error: picked.error || t('errNoFolderSelected') }
      }
      if (isVolumeRoot(picked.folderPath)) {
        const confirmed = await confirmAlert({
          title: t('confirmRootTitle', { path: picked.folderPath }),
          message: t('confirmRootMsg'),
          primaryAction: { title: t('confirmRootAction'), style: 'default' }
        })
        if (!confirmed || signal.aborted) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
      }
      return collectFolderFiles(transport, picked.folderPath, INVOICE_IMPORT_RULES, { signal, onProgress })
    })
  }

  function handleFileInput(input: NormalizedFileInput) {
    void runImport((signal, onProgress) =>
      expandInputPaths(transport, input.paths, INVOICE_IMPORT_RULES, {
        knownDirectories: input.directories,
        signal,
        onProgress
      })
    )
  }

  function handleRemove(inv: InvoiceRecordItem) {
    if (exportingIdsRef.current.has(inv.id)) {
      void showToast({ style: Toast.Style.Failure, title: t('toastWaitProcessingRemove') })
      return
    }
    overridesRef.current.delete(overrideKey(inv.path))
    const nextInvoices = detectInvoiceAnomalies(latestRef.current.invoices.filter((item) => item.id !== inv.id))
    const nextIds = new Set(nextInvoices.map((i) => i.id))
    const nextChecked = latestRef.current.checkedIds.filter((id) => nextIds.has(id))
    latestRef.current = { invoices: nextInvoices, checkedIds: nextChecked }
    setInvoices(nextInvoices)
    setCheckedIds(nextChecked)
  }

  function handleClear() {
    if (exportingRef.current) {
      void showToast({ style: Toast.Style.Failure, title: t('toastWaitProcessingClear') })
      return
    }
    // 递增批次号并中止进行中的导入，过期结果不再回写
    importSeqRef.current += 1
    importAbortRef.current?.abort()
    importAbortRef.current = null
    overridesRef.current.clear()
    setIsImporting(false)
    setImportProgress(null)
    setParseProgress(null)
    latestRef.current = { invoices: [], checkedIds: [] }
    setInvoices([])
    setCheckedIds([])
    setParseErrors([])
  }

  useEffect(() => {
    mountedRef.current = true
    let dispose: unknown = null
    let eventsApi:
      | {
          on?: (ev: string, cb: (payload: unknown) => void) => unknown
          off?: (ev: string, cb: (payload: unknown) => void) => void
        }
      | undefined
    const handleDrop = (envelope: unknown) => {
      const input = normalizeFileInput(envelope)
      if (input.paths.length > 0) handleFileInput(input)
    }

    if (!isDeclarativeFileInputSupported()) {
      const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null
      eventsApi = (w?.ztools as { events?: typeof eventsApi } | undefined)?.events
      if (eventsApi && typeof eventsApi.on === 'function') {
        dispose = eventsApi.on('plugin_files_dropped', handleDrop)
      }
    }

    return () => {
      mountedRef.current = false
      importSeqRef.current += 1
      importAbortRef.current?.abort()
      if (typeof dispose === 'function') {
        ;(dispose as () => void)()
      } else if (eventsApi && typeof eventsApi.off === 'function') {
        eventsApi.off('plugin_files_dropped', handleDrop)
      }
    }
  }, [])

  const fileInputProps = createImportInputProps(handleFileInput, {
    dropTitle: t('dropTitle'),
    dropSubtitle: t('dropSubtitle')
  })

  const checkedSet = new Set(checkedIds)
  const selectedInvoices = invoices.filter((i) => checkedSet.has(i.id))
  const totalAmountSum = selectedInvoices.reduce((acc, i) => acc + (i.totalAmount ?? 0), 0)
  const totalTaxSum = selectedInvoices.reduce((acc, i) => acc + (i.taxAmount ?? 0), 0)
  const duplicateCount = invoices.filter((i) => i.isDuplicate).length
  const abnormalHeaderCount = invoices.filter((i) => i.isHeaderAbnormal).length
  const incompleteCount = invoices.filter((i) => !isInvoiceComplete(i)).length

  async function handleExport(mode: InvoiceExportMode) {
    if (exportingRef.current) return
    if (selectedInvoices.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: t('errExportEmpty') })
      return
    }
    const targetIds = selectedInvoices.map((i) => i.id)
    exportingRef.current = true
    exportingIdsRef.current = new Set(targetIds)
    setIsExporting(true)
    setExportingIds(targetIds)
    let progressToast: { hide: () => Promise<void> } | null = null
    try {
      progressToast = await showToast({
        style: Toast.Style.Animated,
        title:
          mode === 'bundle'
            ? t('toastExportingBundle', { count: selectedInvoices.length })
            : t('toastExportingCsv', { count: selectedInvoices.length }),
        message: t('toastTotalSum', { amount: formatCurrency(totalAmountSum) })
      })
      const res = await exportInvoices(mode, selectedInvoices, activeTemplateId)
      await progressToast?.hide()
      if (!mountedRef.current) return
      if (!res.ok) {
        await showToast({
          style: Toast.Style.Failure,
          title: mode === 'bundle' ? t('toastExportBundleFailed') : t('toastExportCsvFailed'),
          message: friendlyFileError(res.error)
        })
        return
      }
      await showToast({
        style: Toast.Style.Success,
        title:
          mode === 'bundle'
            ? t('toastExportBundleOk', { count: res.copiedCount, amount: formatCurrency(totalAmountSum) })
            : t('toastExportCsvOk', { count: selectedInvoices.length, amount: formatCurrency(totalAmountSum) }),
        message: t('toastOutputDirMsg', { dir: res.outputDir })
      })
    } catch (err) {
      await progressToast?.hide()
      if (!mountedRef.current) return
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastExportException'),
        message: friendlyFileError(err)
      })
    } finally {
      await progressToast?.hide()
      exportingRef.current = false
      exportingIdsRef.current = new Set()
      if (mountedRef.current) {
        setIsExporting(false)
        setExportingIds([])
      }
    }
  }

  async function handleCopyExcelTsv() {
    if (selectedInvoices.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: t('toastPickToCopyTsv') })
      return
    }
    try {
      await Clipboard.copy(buildInvoiceTsvTable(selectedInvoices, activeTemplateId))
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastCopyTsvFailed'),
        message: err instanceof Error ? err.message : String(err)
      })
      return
    }
    await showToast({
      style: Toast.Style.Success,
      title: t('toastCopyTsvOk', { count: selectedInvoices.length }),
      message: t('toastCopyTsvHint')
    })
  }

  function rememberOverride(filePath: string, patch: InvoiceOverride) {
    const key = overrideKey(filePath)
    overridesRef.current.set(key, { ...(overridesRef.current.get(key) ?? {}), ...patch })
  }

  function handleCycleCategory(target: InvoiceRecordItem) {
    const idx = EXPENSE_CATEGORY_CYCLE.indexOf(target.category)
    const nextCat = EXPENSE_CATEGORY_CYCLE[(idx + 1) % EXPENSE_CATEGORY_CYCLE.length]!
    rememberOverride(target.path, { category: nextCat })
    setInvoices((prev) => prev.map((inv) => (inv.id === target.id ? { ...inv, category: nextCat } : inv)))
  }

  function handleSaveEdits(target: InvoiceRecordItem, values: InvoiceEditValues): boolean {
    const { invoices: current, checkedIds: currentChecked } = latestRef.current
    const key = overrideKey(target.path)
    const existing = current.find((i) => overrideKey(i.path) === key)
    if (!existing) return false
    rememberOverride(target.path, values)
    const next = applyInvoiceEdits(current, existing.id, values)
    const selectable = new Set(next.filter(isInvoiceSelectable).map((i) => i.id))
    const edited = next.find((i) => i.id === existing.id)
    const kept = currentChecked.filter((id) => selectable.has(id))
    if (edited && selectable.has(edited.id) && !edited.isHeaderAbnormal && !kept.includes(edited.id)) {
      kept.push(edited.id)
    }
    latestRef.current = { invoices: next, checkedIds: kept }
    setInvoices(next)
    setCheckedIds(kept)
    return true
  }

  function openEditForm(inv: InvoiceRecordItem) {
    push(() => InvoiceEditForm({ invoice: inv, onSave: (values) => handleSaveEdits(inv, values) }))
  }

  async function handleCheckChange(inv: InvoiceRecordItem, checked: boolean) {
    if (!checked) {
      setCheckedIds(checkedIds.filter((id) => id !== inv.id))
      return
    }
    if (!isInvoiceComplete(inv)) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastIncompleteCannotCheck'),
        message: describeInvoiceIssues(inv)
      })
      return
    }
    if (inv.isDuplicate) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastDuplicateCannotCheck'),
        message: t('toastDuplicateHint')
      })
      return
    }
    setCheckedIds(Array.from(new Set([...checkedIds, inv.id])))
  }

  async function handleCopyParseErrors() {
    const text = parseErrors.map((e) => `${e.file}\t${e.error}`).join('\n')
    try {
      await Clipboard.copy(text)
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastCopyFailed'),
        message: err instanceof Error ? err.message : String(err)
      })
      return
    }
    await showToast({ style: Toast.Style.Success, title: t('toastCopiedParseErrors', { count: parseErrors.length }) })
  }

  const q = searchText.trim().toLowerCase()
  const filteredInvoices = invoices.filter((inv) => {
    if (!matchesInvoiceFilter(inv, selectedFilterKey)) return false
    if (!q) return true
    return (
      inv.sellerName.toLowerCase().includes(q) ||
      inv.invoiceNo.toLowerCase().includes(q) ||
      inv.issueDate.toLowerCase().includes(q) ||
      inv.category.toLowerCase().includes(q) ||
      translateCategory(inv.category).toLowerCase().includes(q) ||
      inv.fileName.toLowerCase().includes(q) ||
      (inv.totalAmount !== null && String(inv.totalAmount).includes(q))
    )
  })
  const selectableFiltered = filteredInvoices.filter(isInvoiceSelectable)
  const allSelectableChecked =
    selectableFiltered.length > 0 && selectableFiltered.every((i) => checkedSet.has(i.id))

  function toggleAllSelectable() {
    if (selectableFiltered.length === 0) {
      void showToast({ style: Toast.Style.Failure, title: t('toastNoSelectable') })
      return
    }
    const ids = new Set(selectableFiltered.map((i) => i.id))
    setCheckedIds((prev) =>
      allSelectableChecked
        ? prev.filter((id) => !ids.has(id))
        : Array.from(new Set([...prev, ...ids]))
    )
  }

  const pickFilesAction = () =>
    Action({ title: t('actionPickFiles'), icon: Icon.Plus, shortcut: SHORTCUT_PICK_FILES, onAction: handlePickFiles })
  const pickFolderAction = () =>
    Action({ title: t('actionPickFolder'), icon: Icon.Folder, shortcut: SHORTCUT_PICK_FOLDER, onAction: handlePickFolder })
  const clearListAction = () =>
    Action({
      title: t('actionClearList'),
      icon: Icon.Trash,
      style: Action.Style.Destructive,
      shortcut: SHORTCUT_CLEAR,
      onAction: handleClear
    })

  const maxAmount = Math.max(1, ...filteredInvoices.map((i) => i.totalAmount ?? 0))

  const exportBundleTitle = t('exportBundleBtnTitle', { count: selectedInvoices.length, amount: formatCurrency(totalAmountSum) })

  const rightInvoiceItems = filteredInvoices.map((inv) => {
    const isChecked = checkedSet.has(inv.id)
    const complete = isInvoiceComplete(inv)
    const targetRename = complete ? buildTargetInvoiceFileName(inv, activeTemplateId) : null
    const issueText = describeInvoiceIssues(inv)
    const isProcessing = exportingIds.includes(inv.id)

    const exportAction = Action({
      title: exportBundleTitle,
      icon: Icon.Bolt,
      onAction: () => handleExport('bundle')
    })
    const editAction = Action({
      title: complete ? t('actionEditComplete') : t('actionEditIncomplete'),
      icon: Icon.Pencil,
      shortcut: { modifiers: ['ctrl'], key: 'i' },
      onAction: () => openEditForm(inv)
    })
    const copyTsvAction = Action({
      title: t('actionCopyTsv'),
      icon: Icon.CopyClipboard,
      shortcut: { modifiers: ['ctrl'], key: 'enter' },
      onAction: handleCopyExcelTsv
    })
    const csvAction = Action({
      title: t('actionExportCsv'),
      icon: Icon.Download,
      shortcut: { modifiers: ['ctrl'], key: 'e' },
      onAction: () => handleExport('csv')
    })
    const otherActions = [
      Action({
        title: t('actionCycleCategory', { category: translateCategory(inv.category) }),
        icon: Icon.Tag,
        shortcut: { modifiers: ['ctrl'], key: 't' },
        onAction: () => handleCycleCategory(inv)
      }),
      Action({
        title: t('actionCopySummary'),
        icon: Icon.Clipboard,
        shortcut: { modifiers: ['ctrl', 'shift'], key: 'c' },
        onAction: async () => {
          await Clipboard.copy(buildInvoiceSummaryText(inv))
          await showToast({ style: Toast.Style.Success, title: t('toastCopiedSummary') })
        }
      }),
      Action({
        title: t('actionLocateFile'),
        icon: Icon.Folder,
        shortcut: SHORTCUT_LOCATE_FILE,
        onAction: async () => {
          const opened = await openInvoiceLocation(inv.path)
          if (!opened) {
            await showToast({ style: Toast.Style.Failure, title: t('toastLocateFailed'), message: inv.path })
          }
        }
      }),
      Action({
        title: t('actionTrashFile'),
        icon: Icon.Trash,
        style: Action.Style.Destructive,
        shortcut: { modifiers: [], key: 'delete' },
        onAction: async () => {
          if (exportingIdsRef.current.has(inv.id)) {
            await showToast({ style: Toast.Style.Failure, title: t('toastWaitProcessingTrash') })
            return
          }
          const ok = await confirmAlert({
            title: t('confirmTrashTitle'),
            message: t('confirmTrashMsg', {
              file: inv.fileName,
              no: inv.invoiceNo || t('unrecognized'),
              amount: formatCurrency(inv.totalAmount)
            }),
            primaryAction: { title: t('confirmTrashBtn'), style: 'destructive' }
          })
          if (!ok) return
          const tr = await trashInvoiceFile(inv.path)
          if (!mountedRef.current) return
          if (tr.ok) {
            overridesRef.current.delete(overrideKey(inv.path))
            const nextInvoices = detectInvoiceAnomalies(latestRef.current.invoices.filter((item) => item.id !== inv.id))
            const nextChecked = latestRef.current.checkedIds.filter((id) => id !== inv.id)
            latestRef.current = { invoices: nextInvoices, checkedIds: nextChecked }
            setInvoices(nextInvoices)
            setCheckedIds(nextChecked)
            await showToast({ style: Toast.Style.Success, title: t('toastTrashed') })
          } else {
            await showToast({
              style: Toast.Style.Failure,
              title: t('toastTrashFailed'),
              message: tr.error || t('toastFileInUse')
            })
          }
        }
      }),
      ActionPanel.Section({
        title: t('sectionList'),
        children: [
          ...(isProcessing
            ? []
            : [
                Action({
                  title: t('actionRemoveFromList'),
                  icon: Icon.Minus,
                  shortcut: SHORTCUT_REMOVE,
                  onAction: () => handleRemove(inv)
                })
              ]),
          pickFilesAction(),
          pickFolderAction(),
          Action({
            title: allSelectableChecked ? t('actionDeselectAll') : t('actionSelectAll'),
            icon: Icon.CheckCircle,
            shortcut: SHORTCUT_TOGGLE_ALL,
            onAction: toggleAllSelectable
          }),
          clearListAction()
        ]
      })
    ]

    // 信息不全的发票：回车先补全；其余动作顺序不变，次动作（⌘/Ctrl+Enter）始终是复制明细
    const actionList = complete
      ? [exportAction, copyTsvAction, csvAction, editAction, ...otherActions]
      : [editAction, copyTsvAction, exportAction, csvAction, ...otherActions]

    const flagged = !complete || inv.isDuplicate || inv.isHeaderAbnormal
    // 灰阶为主：只有重复发票号（可能重复报销）用红色警示；信息不全、抬头异常用默认灰阶标签，靠文字区分
    const statusTag = !complete
      ? { tag: { value: t('tagIncomplete') } }
      : inv.isDuplicate
        ? { tag: { value: t('tagDuplicate'), color: Color.Red } }
        : inv.isHeaderAbnormal
          ? { tag: { value: t('tagAbnormalHeader') } }
          : { tag: { value: translateCategory(inv.category) } }

    const accessories: Array<Record<string, unknown>> = []
    if (inv.totalAmount !== null) {
      accessories.push({
        progress: { value: Math.max(8, Math.min(100, Math.round((inv.totalAmount / maxAmount) * 100))) }
      })
    }
    accessories.push(statusTag, { text: inv.totalAmount !== null ? formatCurrency(inv.totalAmount) : t('amountUnrecognized') })

    return List.Item({
      id: inv.id,
      title: targetRename ?? inv.fileName,
      subtitle: complete
        ? t('itemSubtitleComplete', { no: inv.invoiceNo, buyer: inv.buyerName, tax: formatCurrency(inv.taxAmount) })
        : issueText,
      checkable: true,
      checked: isChecked,
      onCheckChange: (checked) => {
        void handleCheckChange(inv, checked)
      },
      icon: {
        source: flagged ? Icon.ExclamationMark : Icon.Document,
        tintColor: Color.SecondaryText
      },
      accessories,
      actions: ActionPanel({
        title: inv.sellerName || inv.fileName,
        children: actionList
      })
    })
  })

  const inClient = isRealElectronHost()
  const summaryParts = [
    t('summarySelected', { selected: selectedInvoices.length, total: invoices.length, amount: formatCurrency(totalAmountSum), tax: formatCurrency(totalTaxSum) }),
    t('summaryDuplicates', { count: duplicateCount })
  ]
  if (incompleteCount > 0) summaryParts.push(t('summaryIncomplete', { count: incompleteCount }))
  if (parseErrors.length > 0) summaryParts.push(t('summaryParseErrors', { count: parseErrors.length }))
  summaryParts.push(t('summaryClearHint'))

  const summaryText = isImporting
    ? importStage === 'parsing' && parseProgress
      ? t('summaryParsing', { total: parseProgress.total, done: parseProgress.done })
      : t('summaryReading', { dirs: importProgress?.visitedDirs ?? 0, files: importProgress?.matchedFiles ?? 0 })
    : invoices.length === 0
      ? inClient
        ? t('emptyNoInvoices')
        : t('emptyClientNeeded')
      : summaryParts.join(' · ')

  const auditItems = [
    List.Item({
      id: 'audit-duplicate',
      title: t('auditDupTitle'),
      subtitle:
        duplicateCount > 0
          ? t('auditDupSubFound', { count: duplicateCount })
          : t('auditDupSubNone'),
      icon: {
        source: duplicateCount > 0 ? Icon.ExclamationMark : Icon.CheckCircle,
        tintColor: Color.SecondaryText
      },
      accessories: [
        duplicateCount > 0
          ? { tag: { value: t('auditDupTagFound', { count: duplicateCount }), color: Color.Red } }
          : { tag: { value: t('auditDupTagNone') } }
      ],
      actions: ActionPanel({
        title: t('auditDupPanel'),
        children: [
          Action({
            title: t('auditDupAction'),
            icon: Icon.Filter,
            onAction: () => setSelectedFilterKey(selectedFilterKey === 'DUPLICATE' ? 'ALL' : 'DUPLICATE')
          })
        ]
      })
    }),
    List.Item({
      id: 'audit-header',
      title: t('auditHeaderTitle'),
      subtitle:
        abnormalHeaderCount > 0
          ? t('auditHeaderSubFound', { count: abnormalHeaderCount })
          : t('auditHeaderSubNone'),
      icon: {
        source: abnormalHeaderCount > 0 ? Icon.ExclamationMark : Icon.CheckCircle,
        tintColor: Color.SecondaryText
      },
      accessories: [
        abnormalHeaderCount > 0
          ? { tag: { value: t('auditHeaderTagFound', { count: abnormalHeaderCount }) } }
          : { tag: { value: t('auditHeaderTagNone') } }
      ],
      actions: ActionPanel({
        title: t('auditHeaderPanel'),
        children: [
          Action({
            title: t('auditHeaderAction'),
            icon: Icon.Filter,
            onAction: () => setSelectedFilterKey(selectedFilterKey === 'ABNORMAL' ? 'ALL' : 'ABNORMAL')
          })
        ]
      })
    }),
    List.Item({
      id: 'audit-incomplete',
      title: t('auditIncTitle'),
      subtitle:
        incompleteCount > 0
          ? t('auditIncSubFound', { count: incompleteCount })
          : t('auditIncSubNone'),
      icon: {
        source: incompleteCount > 0 ? Icon.ExclamationMark : Icon.CheckCircle,
        tintColor: Color.SecondaryText
      },
      accessories: [
        incompleteCount > 0
          ? { tag: { value: t('auditIncTagFound', { count: incompleteCount }) } }
          : { tag: { value: t('auditIncTagNone') } }
      ],
      actions: ActionPanel({
        title: t('auditIncPanel'),
        children: [
          Action({
            title: t('auditIncAction'),
            icon: Icon.Filter,
            onAction: () => setSelectedFilterKey(selectedFilterKey === 'INCOMPLETE' ? 'ALL' : 'INCOMPLETE')
          })
        ]
      })
    })
  ]
  if (parseErrors.length > 0) {
    auditItems.push(
      List.Item({
        id: 'audit-parse-errors',
        title: t('auditErrTitle'),
        subtitle: t('auditErrSub', { count: parseErrors.length }),
        icon: { source: Icon.ExclamationMark, tintColor: Color.SecondaryText },
        // 读取失败是真正的错误，标签保留红色
        accessories: [{ tag: { value: t('auditErrTag', { count: parseErrors.length }), color: Color.Red } }],
        actions: ActionPanel({
          title: t('auditErrTitle'),
          children: [
            Action({
              title: t('auditErrAction'),
              icon: Icon.CopyClipboard,
              onAction: handleCopyParseErrors
            })
          ]
        })
      })
    )
  }

  const emptyText = !inClient
    ? t('emptyClientNeeded')
    : invoices.length === 0
      ? t('emptyNoInvoices')
      : t('emptyNoMatch')

  return List({
    ...fileInputProps,
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading: isImporting || isExporting,
    actions: ActionPanel({
      children: [pickFilesAction(), pickFolderAction()]
    }),
    searchBarAccessory: List.Dropdown({
      tooltip: t('dropdownTooltip'),
      value: activeTemplateId,
      onChange: (val) => setActiveTemplateId(val),
      children: getInvoiceRenameTemplates().map((tpl) =>
        List.Dropdown.Item({
          title: tpl.title,
          value: tpl.id
        })
      )
    }),
    filterBar: FilterBar({
      summaryText,
      actions: [
        {
          id: 'pick-files',
          label: t('barPickFiles'),
          title: t('barPickFiles'),
          style: 'primary',
          onAction: handlePickFiles
        },
        {
          id: 'pick-folder',
          label: t('barPickFolder'),
          title: t('barPickFolder'),
          style: 'secondary',
          onAction: handlePickFolder
        }
      ]
    }),
    subList: {
      title: t('subListTitle'),
      subtitle: t('subListSubtitle', { count: filteredInvoices.length, amount: formatCurrency(totalAmountSum) }),
      checkable: selectableFiltered.length > 0,
      checked:
        selectableFiltered.length > 0 && selectableFiltered.every((i) => checkedSet.has(i.id))
          ? true
          : filteredInvoices.some((i) => checkedSet.has(i.id))
            ? 'indeterminate'
            : false,
      onCheckChange: (checked) => {
        const ids = new Set(selectableFiltered.map((i) => i.id))
        setCheckedIds(
          checked
            ? Array.from(new Set([...checkedIds, ...ids]))
            : checkedIds.filter((id) => !filteredInvoices.some((i) => i.id === id))
        )
      },
      emptyText,
      items: rightInvoiceItems
    },
    children: [
      List.Section({
        title: t('catSectionTitle'),
        children: getInvoiceCategoryGroups().map((grp) => {
          const matched = invoices.filter((i) => matchesInvoiceFilter(i, grp.id))
          const sum = matched.reduce((acc, i) => acc + (i.totalAmount ?? 0), 0)
          const unknownAmountCount = matched.filter((i) => i.totalAmount === null).length
          const isSelected = selectedFilterKey === grp.id
          return List.Item({
            id: `inv-cat-${grp.id}`,
            title: grp.name,
            subtitle:
              unknownAmountCount > 0
                ? t('catSubWithUnknown', { amount: formatCurrency(sum), count: unknownAmountCount })
                : formatCurrency(sum),
            icon: {
              source: isSelected ? Icon.CheckCircle : Icon.Folder,
              tintColor: Color.SecondaryText
            },
            accessories: [{ text: t('catCountText', { count: matched.length }) }],
            actions: ActionPanel({
              title: grp.name,
              children: [
                Action({
                  title: t('catFilterAction', { name: grp.name }),
                  icon: Icon.Filter,
                  onAction: () => setSelectedFilterKey(grp.id)
                }),
                Action({
                  title: exportBundleTitle,
                  icon: Icon.Bolt,
                  onAction: () => handleExport('bundle')
                }),
                ActionPanel.Section({
                  title: t('sectionList'),
                  children: [
                    pickFilesAction(),
                    pickFolderAction(),
                    ...(invoices.length > 0 ? [clearListAction()] : [])
                  ]
                })
              ]
            })
          })
        })
      }),
      List.Section({
        title: t('auditSectionTitle'),
        children: auditItems
      })
    ]
  })
}

export default InvoiceAssistantCommand
