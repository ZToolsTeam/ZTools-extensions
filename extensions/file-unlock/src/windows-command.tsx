import React, {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
  useEffect,
  useLocale,
  useMemo,
  useRef,
  useState
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  copyProcessInfoToClipboard,
  detectClipboardCandidatePath,
  extractDroppedUnlockPath,
  filterLockingProcesses,
  inspectTargetLocks,
  loadRemovableDrives,
  looksLikeFilePath,
  normalizeProcessBaseName,
  openUnlockedTarget,
  revealLockedTargetInFolder,
  revealProcessExecutableInFolder,
  sanitizeInputPath,
  selectUnlockTarget,
  unlockAllProcesses,
  unlockAndTrashTarget,
  unlockSingleProcess
} from './unlock-service.js'
import { createCompatFileInputProps, isDeclarativeFileInputSupported } from './host-compat.js'
import type {
  LockingProcessItem,
  RemovableDriveItem,
  UnlockProcessFilter
} from './types.js'

function extractBaseName(targetPath: string): string {
  const cleaned = sanitizeInputPath(targetPath).replace(/[\\/]+$/, '')
  if (!cleaned) return t('unspecifiedPath')
  if (/^[a-zA-Z]:$/.test(cleaned)) return `${cleaned}\\`
  const parts = cleaned.split(/[\\/]/)
  return parts[parts.length - 1] || cleaned
}

export default function FileUnlockCommand(props?: {
  initialPath?: string
  featureCode?: string
  hostOverride?: unknown
}) {
  const locale = useLocale()
  const [targetPath, setTargetPath] = useState<string>(
    sanitizeInputPath(props?.initialPath ?? '')
  )
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [processFilter, setProcessFilter] = useState<UnlockProcessFilter>('all')
  const [processes, setProcesses] = useState<LockingProcessItem[]>([])
  const [removableDrives, setRemovableDrives] = useState<RemovableDriveItem[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [lastError, setLastError] = useState<string>('')
  const [partialScan, setPartialScan] = useState<boolean>(false)
  const [driveNotice, setDriveNotice] = useState<string>('')
  const isUsbEntry = props?.featureCode === 'usb-unlock'
  // 检测批次号：每次检测、清空目标、卸载都会递增，迟到的检测结果一律丢弃
  const inspectSeq = useRef(0)
  // 目标代次：清空目标或卸载时递增，进行中的解锁操作完成后不再回写旧目标的状态
  const targetEpoch = useRef(0)
  const alive = useRef(true)

  const runInspection = async (rawPath: string) => {
    const cleaned = sanitizeInputPath(rawPath)
    const seq = ++inspectSeq.current
    if (!cleaned) {
      setProcesses([])
      setLastError('')
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setLastError('')
    try {
      const res = await inspectTargetLocks(cleaned, props?.hostOverride)
      if (!alive.current || seq !== inspectSeq.current) return
      if (!res.ok) {
        setProcesses([])
        setLastError(res.error || t('errTargetInspectFailed'))
        await showToast({
          style: Toast.Style.Failure,
          title: t('toastCannotScanTitle'),
          message: res.error || t('toastCannotScanMsg')
        })
        return
      }
      setTargetPath(res.targetPath)
      setProcesses(res.processes)
      setPartialScan(res.partial === true)
      setLastError('')
    } finally {
      if (alive.current && seq === inspectSeq.current) {
        setIsLoading(false)
      }
    }
  }

  /** 读取外接移动磁盘列表：只列出盘符与容量，不扫描磁盘内的任何文件 */
  const refreshRemovableDrives = async () => {
    const drives = await loadRemovableDrives(props?.hostOverride)
    if (!alive.current) return
    setRemovableDrives(drives.drives)
    setDriveNotice(drives.error ? t('driveNoticeFailedPrefix', { error: drives.error }) : drives.warning ?? '')
  }

  useEffect(() => {
    alive.current = true
    // 启动时不读取剪贴板、不自动检测任何路径：
    // - 宿主显式传入 initialPath 时才检测该路径（用户主动发起的目标）
    // - U 盘入口只列出外接移动磁盘，由用户选择后再检测
    const initialTarget = sanitizeInputPath(props?.initialPath ?? '')
    if (initialTarget) {
      void runInspection(initialTarget)
    } else if (isUsbEntry) {
      void refreshRemovableDrives()
    }
    return () => {
      alive.current = false
      ++inspectSeq.current
      ++targetEpoch.current
    }
  }, [props?.initialPath, props?.featureCode, props?.hostOverride])

  useEffect(() => {
    if (isDeclarativeFileInputSupported()) return
    const ztools = (globalThis as { window?: { ztools?: { events?: { on?: (event: string, cb: (payload: unknown) => void) => (() => void) | void; off?: (event: string, cb: (payload: unknown) => void) => void } } } }).window?.ztools
    if (typeof ztools?.events?.on !== 'function') return
    const handler = (envelopeOrPayload: unknown) => {
      const dropped = extractDroppedUnlockPath(envelopeOrPayload)
      if (!dropped) return
      setTargetPath(dropped)
      void runInspection(dropped)
    }
    const off = ztools.events.on('plugin_files_dropped', handler)
    return () => {
      if (typeof off === 'function') off()
      else ztools?.events?.off?.('plugin_files_dropped', handler)
    }
  }, [])

  const handlePickTarget = async (directory: boolean) => {
    const epoch = targetEpoch.current
    const picked = await selectUnlockTarget(directory, props?.hostOverride)
    if (!alive.current || epoch !== targetEpoch.current) return
    if (picked.canceled) return
    if (picked.error || !picked.path) {
      await showToast({
        style: Toast.Style.Failure,
        title: directory ? t('toastPickFolderFailed') : t('toastPickFileFailed'),
        message: picked.error || t('toastNoValidPath')
      })
      return
    }
    setTargetPath(picked.path)
    await runInspection(picked.path)
  }

  /** 用户主动触发：读取剪贴板，内容是完整路径时设为检测目标 */
  const handleDetectClipboard = async () => {
    if (isLoading) {
      await showToast({ style: Toast.Style.Failure, title: t('toastBusyWait') })
      return
    }
    const epoch = targetEpoch.current
    const candidate = await detectClipboardCandidatePath(props?.hostOverride)
    if (!alive.current || epoch !== targetEpoch.current) return
    if (!candidate) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastClipboardNoPath'),
        message: t('toastClipboardPathHint')
      })
      return
    }
    setTargetPath(candidate)
    await runInspection(candidate)
  }

  /** 清空当前目标：只重置检测目标与占用结果，不碰磁盘文件；检测进行中不可用 */
  const handleClearTarget = async () => {
    if (isLoading) {
      await showToast({ style: Toast.Style.Failure, title: t('toastBusyClearWin') })
      return
    }
    ++inspectSeq.current
    ++targetEpoch.current
    setTargetPath('')
    setProcesses([])
    setPartialScan(false)
    setLastError('')
    setSearchQuery('')
    setProcessFilter('all')
  }

  const fileInputProps = createCompatFileInputProps(
    (files) => {
      const dropped = extractDroppedUnlockPath({ files })
      if (!dropped) return
      setTargetPath(dropped)
      void runInspection(dropped)
    },
    { allowDirectories: true }
  )

  const killableCount = useMemo(
    () => processes.filter((p) => !p.isProtected).length,
    [processes]
  )

  const filteredProcesses = useMemo(
    () => filterLockingProcesses(processes, processFilter, searchQuery),
    [processes, processFilter, searchQuery]
  )

  const handleSearchChange = (text: string) => {
    setSearchQuery(text)
    if (looksLikeFilePath(text)) {
      const nextTarget = sanitizeInputPath(text)
      setTargetPath(nextTarget)
      void runInspection(nextTarget)
    }
  }

  const handleUnlockSingle = async (proc: LockingProcessItem, trashAfterUnlock = false) => {
    if (proc.isProtected) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastPolicyBlocked'),
        message: t('toastPolicyBlockedMsg', { name: proc.name, pid: proc.pid })
      })
      return
    }

    const actionTitle = trashAfterUnlock
      ? t('confirmSingleTrashTitle', { name: proc.name, pid: proc.pid })
      : t('confirmSingleKillTitle', { name: proc.name, pid: proc.pid })

    const confirmed = await confirmAlert({
      title: actionTitle,
      message:
        normalizeProcessBaseName(proc.name) === 'explorer'
          ? t('confirmExplorerMsg')
          : t('confirmTargetProcMsg', { target: targetPath, exec: proc.executablePath })
    })
    if (!confirmed) return
    const epoch = targetEpoch.current

    const res = await unlockSingleProcess(
      proc,
      targetPath,
      { trashAfterUnlock },
      props?.hostOverride
    )
    // 操作期间目标已被清空或界面已关闭：只如实提示结果，不再回写旧目标的状态
    const stale = !alive.current || epoch !== targetEpoch.current

    if (!res.ok) {
      await showToast({
        style: Toast.Style.Failure,
        title:
          res.errorCode === 'PROCESS_IDENTITY_MISMATCH'
            ? t('toastPidMismatch')
            : res.errorCode === 'PROCESS_PROTECTED'
              ? t('toastProtectedNoKill')
              : t('toastUnlockFailed'),
        message: res.error || t('toastTryAdminHint')
      })
      if (!stale && ['PROCESS_IDENTITY_MISMATCH', 'LOCK_CHANGED', 'LOCK_RECHECK_FAILED', 'PROCESS_GONE'].includes(res.errorCode ?? '') && targetPath) {
        await runInspection(targetPath)
      }
      return
    }

    await showToast({
      style: Toast.Style.Success,
      title: res.trashed
        ? t('toastUnlockedTrashed', { name: extractBaseName(targetPath) })
        : t('toastUnlockedProc', { name: proc.name }),
      message: res.explorerRestarted ? t('toastExplorerRestarted') : t('toastHandleReleased', { pid: proc.pid })
    })

    if (stale) return
    if (res.trashed) {
      setProcesses([])
    } else if (targetPath) {
      await runInspection(targetPath)
    }
  }

  const handleUnlockAll = async (trashAfterUnlock = false) => {
    if (!targetPath) {
      await showToast({
        style: Toast.Style.Animated,
        title: t('toastInputPathFirst')
      })
      return
    }

    if (processes.length > 0 && killableCount === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastCannotUnlockKernel'),
        message: t('toastAllProtectedMsg')
      })
      return
    }

    const confirmed = await confirmAlert({
      title: trashAfterUnlock
        ? t('confirmBatchTrashTitle', { count: killableCount, name: extractBaseName(targetPath) })
        : t('confirmBatchKillTitle', { count: killableCount }),
      message: t('confirmTargetOnlyMsg', { target: targetPath })
    })
    if (!confirmed) return
    const epoch = targetEpoch.current

    const res = trashAfterUnlock
      ? await unlockAndTrashTarget(processes, targetPath, props?.hostOverride)
      : await unlockAllProcesses(processes, targetPath, {}, props?.hostOverride)
    const stale = !alive.current || epoch !== targetEpoch.current

    if (!res.ok) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastBatchIncomplete'),
        message: res.error || t('toastBatchPartialAdminHint')
      })
      if (!stale) await runInspection(targetPath)
      return
    }

    await showToast({
      style: Toast.Style.Success,
      title: res.trashed
        ? t('toastBatchUnlockedTrashed')
        : t('toastBatchUnlockedCount', { count: res.unlockedCount }),
      message:
        res.skippedProtectedCount > 0
          ? t('toastSkippedProtected', { count: res.skippedProtectedCount })
          : extractBaseName(targetPath)
    })

    if (stale) return
    if (res.trashed) {
      setProcesses([])
    } else {
      await runInspection(targetPath)
    }
  }

  const summaryText = useMemo(() => {
    if (!targetPath) {
      return isUsbEntry ? t('winSummaryUsbIdle') : t('winSummaryIdle')
    }
    const name = extractBaseName(targetPath)
    if (isLoading) {
      return t('winSummaryScanning', { name })
    }
    if (lastError) {
      return t('winSummaryError', { name, error: lastError })
    }
    if (processes.length === 0 && partialScan) {
      return t('winSummaryPartial', { name })
    }
    if (processes.length === 0) {
      return t('winSummaryUnlocked', { name })
    }
    return t('winSummaryFound', { name, total: processes.length, killable: killableCount })
  }, [isUsbEntry, targetPath, isLoading, lastError, processes.length, killableCount, partialScan, locale])

  const renderPickAndClipboardActions = () => [
    <Action
      key="act-pick-file"
      title={t('actionPickFileInspect')}
      icon={Icon.Document}
      shortcut={{ modifiers: ['ctrl'], key: 'o' }}
      onAction={() => {
        void handlePickTarget(false)
      }}
    />,
    <Action
      key="act-pick-folder"
      title={t('actionPickFolderInspect')}
      icon={Icon.Folder}
      shortcut={{ modifiers: ['ctrl', 'shift'], key: 'o' }}
      onAction={() => {
        void handlePickTarget(true)
      }}
    />,
    <Action
      key="act-detect-clipboard"
      title={t('actionDetectClipboard')}
      icon={Icon.Clipboard}
      onAction={() => {
        void handleDetectClipboard()
      }}
    />
  ]

  const renderClearTargetAction = () =>
    targetPath ? (
      <Action
        title={t('actionClearTarget')}
        icon={Icon.Trash}
        shortcut={{ modifiers: ['ctrl', 'shift'], key: 'backspace' }}
        onAction={() => {
          void handleClearTarget()
        }}
      />
    ) : null

  return (
    <List
      {...fileInputProps}
      navigationTitle={t('navTitle')}
      isLoading={isLoading}
      isShowingDetail={false}
      searchText={searchQuery}
      searchBarPlaceholder={t('winSearchPlaceholder')}
      onSearchTextChange={handleSearchChange}
      actions={
        <ActionPanel>
          {renderPickAndClipboardActions()}
          {renderClearTargetAction()}
        </ActionPanel>
      }
      searchBarAccessory={
        <List.Dropdown
          tooltip={t('winFilterTooltip')}
          value={processFilter}
          onChange={(val: string) => setProcessFilter(val as UnlockProcessFilter)}
        >
          <List.Dropdown.Item title={t('winFilterAll')} value="all" />
          <List.Dropdown.Item title={t('winFilterKillable')} value="killable" />
          <List.Dropdown.Item title={t('winFilterProtected')} value="protected" />
        </List.Dropdown>
      }
      filterBar={{
        summaryText,
        actions: [
          {
            id: 'pick-file',
            title: t('actionPickFileInspect'),
            style: 'secondary',
            onAction: () => {
              void handlePickTarget(false)
            }
          },
          {
            id: 'pick-folder',
            title: t('actionPickFolderInspect'),
            style: 'secondary',
            onAction: () => {
              void handlePickTarget(true)
            }
          }
        ]
      }}
    >
      {driveNotice && (
        <List.Section title={t('secUsbDrivesTitle')}>
          <List.Item id="drive-notice" icon={Icon.ExclamationMark} title={driveNotice} subtitle={t('driveNoticeSub')} />
        </List.Section>
      )}
      {removableDrives.length > 0 && (
        <List.Section
          title={t('secUsbDrivesTitle')}
          subtitle={t('secUsbDrivesSub', { count: removableDrives.length })}
        >
          {removableDrives.map((drive) => (
            <List.Item
              key={`drive-${drive.mount}`}
              id={`drive-${drive.mount}`}
              icon={Icon.HardDrive}
              title={`${drive.label} (${drive.mount})`}
              subtitle={t('driveSizeSub', { free: drive.freeText, total: drive.totalText })}
              accessories={[{ text: targetPath === drive.mount ? t('driveTagCurrent') : t('driveTagInspect') }]}
              actions={
                <ActionPanel>
                  <Action
                    title={t('actionInspectUsbDrive')}
                    icon={Icon.MagnifyingGlass}
                    onAction={() => {
                      setTargetPath(drive.mount)
                      void runInspection(drive.mount)
                    }}
                  />
                  <Action
                    title={t('actionOpenDriveInFm')}
                    icon={Icon.Folder}
                    onAction={() => {
                      void openUnlockedTarget(drive.mount, props?.hostOverride)
                    }}
                  />
                  <Action
                    title={t('actionRefreshDrives')}
                    icon={Icon.ArrowClockwise}
                    onAction={() => {
                      void refreshRemovableDrives()
                    }}
                  />
                  <Action
                    title={t('actionDetectClipboard')}
                    icon={Icon.Clipboard}
                    onAction={() => {
                      void handleDetectClipboard()
                    }}
                  />
                  {renderClearTargetAction()}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {filteredProcesses.length === 0 ? (
        <List.Section title={t('secInspectResult')}>
          <List.Item
            id="empty-status"
            icon={isLoading ? Icon.Clock : lastError ? Icon.ExclamationMark : Icon.CheckCircle}
            title={
              !targetPath
                ? t('emptyTitleNoTarget')
                : isLoading
                  ? t('emptyTitleScanning')
                  : lastError
                    ? t('emptyTitleError')
                    : partialScan
                      ? t('emptyTitlePartial')
                      : t('emptyTitleUnlocked')
            }
            subtitle={
              !targetPath
                ? t('emptySubNoTarget')
                : isLoading
                  ? t('emptySubScanning')
                  : lastError
                    ? lastError
                    : partialScan
                      ? t('emptySubPartial')
                      : t('emptySubUnlocked')
            }
            actions={
              <ActionPanel>
                {targetPath && (
                  <Action
                    title={t('actionRescanLocks')}
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ['ctrl'], key: 'r' }}
                    onAction={() => {
                      void runInspection(targetPath)
                    }}
                  />
                )}
                {targetPath && !lastError && processes.length > 0 && (
                  <Action
                    title={t('actionUnlockAll')}
                    icon={Icon.LockUnlocked}
                    onAction={() => {
                      void handleUnlockAll(false)
                    }}
                  />
                )}
                {targetPath && !lastError && (
                  <Action
                    title={t('actionUnlockAndTrash')}
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={() => {
                      void handleUnlockAll(true)
                    }}
                  />
                )}
                {renderPickAndClipboardActions()}
                {targetPath && (
                  <Action
                    title={t('actionRevealTargetDir')}
                    icon={Icon.Folder}
                    onAction={() => {
                      void revealLockedTargetInFolder(targetPath, props?.hostOverride)
                    }}
                  />
                )}
                {renderClearTargetAction()}
              </ActionPanel>
            }
          />
        </List.Section>
      ) : (
        <List.Section
          title={t('secLockingProcs')}
          subtitle={t('secLockingProcsSub', { count: filteredProcesses.length })}
        >
          {filteredProcesses.map((proc) => (
            <List.Item
              key={proc.id}
              id={proc.id}
              icon={proc.isProtected ? Icon.Shield : Icon.Terminal}
              title={proc.name}
              subtitle={`PID ${proc.pid} · ${proc.executablePath}`}
              accessories={
                proc.isProtected
                  ? [{ tag: { value: t('tagSysProtected'), color: Color.Red } }]
                  : [{ text: proc.serviceTypeLabel }]
              }
              actions={
                <ActionPanel>
                  <Action
                    title={t('actionUnlockSingle')}
                    icon={Icon.LockUnlocked}
                    onAction={() => {
                      void handleUnlockSingle(proc, false)
                    }}
                  />
                  <Action
                    title={t('actionKillAndDelete')}
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={() => {
                      void handleUnlockSingle(proc, true)
                    }}
                  />
                  <ActionPanel.Section title={t('secTargetAndBatch')}>
                    <Action
                      title={t('actionUnlockAll')}
                      icon={Icon.LockUnlocked}
                      onAction={() => {
                        void handleUnlockAll(false)
                      }}
                    />
                    <Action
                      title={t('actionUnlockAndTrash')}
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={() => {
                        void handleUnlockAll(true)
                      }}
                    />
                    <Action
                      title={t('actionRescanLocks')}
                      icon={Icon.ArrowClockwise}
                      shortcut={{ modifiers: ['ctrl'], key: 'r' }}
                      onAction={() => {
                        void runInspection(targetPath)
                      }}
                    />
                    {renderClearTargetAction()}
                  </ActionPanel.Section>
                  <ActionPanel.Section title={t('secLocateAndSelect')}>
                    <Action
                      title={t('actionRevealProcDir')}
                      icon={Icon.Folder}
                      onAction={() => {
                        void revealProcessExecutableInFolder(proc.executablePath, props?.hostOverride)
                      }}
                    />
                    <Action
                      title={t('actionRevealLockedDir')}
                      icon={Icon.Folder}
                      onAction={() => {
                        void revealLockedTargetInFolder(targetPath || proc.lockedPath, props?.hostOverride)
                      }}
                    />
                    <Action
                      title={t('actionCopyProcInfo')}
                      icon={Icon.Clipboard}
                      shortcut={{ modifiers: ['ctrl'], key: 'c' }}
                      onAction={async () => {
                        const text = `${proc.name} (PID ${proc.pid}) - ${proc.executablePath} -> ${proc.lockedPath}`
                        await copyProcessInfoToClipboard(text, props?.hostOverride)
                        await showToast({
                          style: Toast.Style.Success,
                          title: t('toastCopiedProcInfo')
                        })
                      }}
                    />
                    {renderPickAndClipboardActions()}
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  )
}
