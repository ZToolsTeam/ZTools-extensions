import React, {
  Action, ActionPanel, Clipboard, Detail, Form, Icon, List, Toast, showToast,
  useCallback, useEffect, useLocale, useMemo, useNavigation, useRef, useState
} from '@ztools/declarative-ui'
import type { WifiProfileInfo, WifiSecurityFilter, WifiSecurityType } from './types.js'
import {
  NOT_IN_CLIENT_ERROR_CODE,
  fetchSavedWifiProfiles, filterAndSortWifiProfiles, generateWifiQrString,
  generateWifiQrSvgDataUrl, hasConnectionInfo, revealWifiPasswordFromHost
} from './wifi-service.js'
import { extractErrorCode } from './error-i18n.js'
import { t } from './i18n.js'

export * from './types.js'
export * from './wifi-service.js'

function codeBlock(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map(value => value.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}text\n${text}\n${fence}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type SensitiveCopyResponse = {
  success?: boolean
  data?: { success?: boolean; clearAfterMs?: number }
  error?: { code?: string; message?: string } | string
}

type SensitiveClipboardBridge = {
  __ztoolsElectron?: {
    transport?: {
      methods?: {
        clipboard_copy_text?: (request: {
          messageId: string
          params: { text: string; sensitive: boolean }
          timeoutMs: number
        }) => Promise<SensitiveCopyResponse>
      }
    }
  }
}

let sensitiveCopySeq = 0

function isUnsupportedSensitiveCopyError(code?: string, message?: string): boolean {
  if (code === 'NOT_SUPPORTED' || code === 'METHOD_NOT_FOUND' || code === 'METHOD_NOT_AVAILABLE') {
    return true
  }
  return typeof message === 'string' && /NOT_SUPPORTED|METHOD_NOT_FOUND|METHOD_NOT_AVAILABLE|is not a function/i.test(message)
}

async function copySensitiveText(text: string): Promise<{ sensitive: boolean; clearAfterMs?: number }> {
  const method = (globalThis as unknown as SensitiveClipboardBridge).__ztoolsElectron?.transport?.methods?.clipboard_copy_text
  if (typeof method === 'function') {
    let response: SensitiveCopyResponse | undefined
    let shouldFallback = false
    try {
      const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}_${++sensitiveCopySeq}`
      response = await method({
        messageId: `wifi_copy_${id}`,
        params: { text, sensitive: true },
        timeoutMs: 5000
      })
    } catch (error) {
      const errCode = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined
      if (isUnsupportedSensitiveCopyError(errCode, errorMessage(error))) {
        shouldFallback = true
      } else {
        throw error
      }
    }
    if (!shouldFallback) {
      if (response?.success === true && response.data?.success === true) {
        const clearAfterMs = response.data.clearAfterMs
        if (typeof clearAfterMs === 'number' && Number.isFinite(clearAfterMs) && clearAfterMs > 0) {
          return { sensitive: true, clearAfterMs }
        }
        return { sensitive: false }
      }
      const errCode = response?.error && typeof response.error === 'object' && typeof response.error.code === 'string'
        ? response.error.code
        : undefined
      const errMsg = response?.error && typeof response.error === 'object' && typeof response.error.message === 'string'
        ? response.error.message
        : typeof response?.error === 'string'
          ? response.error
          : undefined
      if (!isUnsupportedSensitiveCopyError(errCode, errMsg)) {
        throw new Error(errMsg || t('toastCopyFailed'))
      }
    }
  }
  await Clipboard.copy(text)
  return { sensitive: false }
}

async function copyValue(value: string, title: string): Promise<void> {
  try {
    await Clipboard.copy(value)
    await showToast(Toast.Style.Success, title)
  } catch (error) {
    await showToast(Toast.Style.Failure, t('toastCopyFailed'), errorMessage(error))
  }
}

async function copySensitiveValue(value: string, title: string): Promise<void> {
  try {
    const copied = await copySensitiveText(value)
    const message = copied.sensitive
      ? t('toastSensitiveAutoClear', { sec: Math.max(1, Math.round((copied.clearAfterMs ?? 30000) / 1000)) })
      : t('toastSensitiveFallback')
    await showToast(Toast.Style.Success, title, message)
  } catch (error) {
    await showToast(Toast.Style.Failure, t('toastCopyFailed'), errorMessage(error))
  }
}

function qrPreview(profile: WifiProfileInfo): { payload?: string; markdown: string } {
  if (profile.isEnterprise) return { markdown: t('qrEnterpriseMsg') }
  if (profile.authType === 'Unknown') return { markdown: t('qrUnknownSecurityMsg') }
  if (!profile.isOpenNetwork && !profile.password) return { markdown: t('qrNeedPasswordMsg') }
  try {
    const payload = generateWifiQrString(profile.ssid, profile.password, profile.authType)
    return { payload, markdown: `![${t('qrImageAlt')}](${generateWifiQrSvgDataUrl(profile)})\n\n${codeBlock(payload)}` }
  } catch (error) {
    return { markdown: errorMessage(error) }
  }
}

function passwordDescription(profile: WifiProfileInfo): string {
  if (profile.isOpenNetwork) return t('pwdOpenNetwork')
  if (profile.isEnterprise) return t('pwdEnterpriseNetwork')
  return profile.password ? codeBlock(profile.password) : t('pwdNotReadYet')
}

export function WifiQrForm({ profile, hostOverride }: { profile: WifiProfileInfo; hostOverride?: unknown }) {
  useLocale()
  const [security, setSecurity] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const selectionRevision = useRef(0)
  const mounted = useRef(true)
  const { push } = useNavigation()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const generate = async () => {
    if (pending.current) return
    if (!security) { await showToast(Toast.Style.Failure, t('toastSelectSecurity')); return }
    pending.current = true
    const selection = selectionRevision.current
    setBusy(true)
    try {
      const authType = security as WifiSecurityType
      const password = authType === 'Open' ? '' : profile.password || await revealWifiPasswordFromHost(profile.profileName ?? profile.ssid, hostOverride)
      if (!mounted.current || selection !== selectionRevision.current) return
      const resolved = { ...profile, authType, password, isOpenNetwork: authType === 'Open' }
      generateWifiQrString(resolved.ssid, password, authType)
      push(<WifiDetailView profile={resolved} hostOverride={hostOverride} />)
    } catch (error) {
      if (mounted.current && selection === selectionRevision.current) await showToast(Toast.Style.Failure, t('toastQrFailed'), errorMessage(error))
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <Form navigationTitle={t('formNavTitle')} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title={t('formSubmitTitle')} onSubmit={generate} /></ActionPanel>}>
      <Form.Description text={t('formDesc')} />
      <Form.Dropdown id="security" title={t('formFieldSecurity')} value={security} onChange={value => { selectionRevision.current++; setSecurity(value) }}>
        <Form.Dropdown.Item value="" title={t('formOptPlaceholder')} />
        <Form.Dropdown.Item value="WPA2-Personal" title={t('formOptWpa')} />
        <Form.Dropdown.Item value="WEP" title="WEP" />
        <Form.Dropdown.Item value="Open" title={t('formOptOpen')} />
      </Form.Dropdown>
    </Form>
  )
}

export function WifiDetailView({ profile, hostOverride }: { profile: WifiProfileInfo; hostOverride?: unknown }) {
  useLocale()
  const { push } = useNavigation()
  const qr = qrPreview(profile)
  return <Detail
    navigationTitle={t('detailNavTitle', { ssid: profile.ssid })}
    markdown={t('detailMarkdown', { password: passwordDescription(profile), qr: qr.markdown })}
    actions={<ActionPanel>
      {profile.password && <Action title={t('actionCopyPassword')} icon={Icon.CopyClipboard} onAction={() => copySensitiveValue(profile.password, t('toastCopiedPassword'))} />}
      {qr.payload && <Action title={t('actionCopyQrPayload')} icon={Icon.QrCode} onAction={() => (profile.password ? copySensitiveValue(qr.payload!, t('toastCopiedQrPayload')) : copyValue(qr.payload!, t('toastCopiedQrPayload')))} />}
      {profile.authType === 'Unknown' && !profile.isEnterprise && <Action title={t('actionGenerateQr')} icon={Icon.QrCode} onAction={() => push(<WifiQrForm profile={profile} hostOverride={hostOverride} />)} />}
      <Action title={t('actionCopySsid')} icon={Icon.Text} onAction={() => copyValue(profile.ssid, t('toastCopiedSsid'))} />
    </ActionPanel>}
  />
}

export function WifiPasswordRevealCommand(props?: { featureCode?: string; hostOverride?: unknown }) {
  const locale = useLocale()
  const [allProfiles, setAllProfiles] = useState<readonly WifiProfileInfo[]>([])
  const [searchText, setSearchText] = useState('')
  const [securityFilter, setSecurityFilter] = useState<WifiSecurityFilter>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadErrorCode, setLoadErrorCode] = useState('')
  const [readingPassword, setReadingPassword] = useState(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const pendingRead = useRef(false)
  const { push } = useNavigation()
  const hostOverride = props?.hostOverride

  const reload = useCallback(async (notify = false) => {
    const request = ++revision.current
    setIsLoading(true)
    setLoadError('')
    setLoadErrorCode('')
    setAllProfiles([])
    try {
      const loaded = await fetchSavedWifiProfiles({ hostOverride })
      if (!mounted.current || request !== revision.current) return
      setAllProfiles(loaded)
      if (notify) await showToast(Toast.Style.Success, t('toastLoadedProfiles', { count: loaded.length }))
    } catch (error) {
      if (mounted.current && request === revision.current) {
        setLoadError(errorMessage(error))
        setLoadErrorCode(extractErrorCode(error))
        if (notify) await showToast(Toast.Style.Failure, t('toastLoadProfilesFailed'), errorMessage(error))
      }
    } finally {
      if (mounted.current && request === revision.current) setIsLoading(false)
    }
  }, [hostOverride])

  useEffect(() => {
    mounted.current = true
    void reload()
    return () => { mounted.current = false; revision.current++ }
  }, [reload])

  const runProfileAction = async (profile: WifiProfileInfo, action: 'copy' | 'show' | 'qr') => {
    if (pendingRead.current || isLoading) return
    if (action === 'qr' && profile.authType === 'Unknown') {
      push(<WifiQrForm profile={profile} hostOverride={hostOverride} />)
      return
    }
    pendingRead.current = true
    setReadingPassword(true)
    const request = revision.current
    try {
      const password = profile.password || (profile.isOpenNetwork || profile.isEnterprise ? '' : await revealWifiPasswordFromHost(profile.profileName ?? profile.ssid, hostOverride))
      if (!mounted.current || request !== revision.current) return
      const resolved = { ...profile, password }
      setAllProfiles(current => current.map(item => item.id === profile.id ? resolved : item))
      if (action === 'copy') await copySensitiveValue(password, t('toastCopiedPassword'))
      else push(<WifiDetailView profile={resolved} hostOverride={hostOverride} />)
    } catch (error) {
      if (mounted.current && request === revision.current) await showToast(Toast.Style.Failure, t('toastReadPasswordFailed'), errorMessage(error))
    } finally {
      pendingRead.current = false
      if (mounted.current) setReadingPassword(false)
    }
  }
  const connectionKnown = hasConnectionInfo(allProfiles)
  // 系统未提供当前连接（如新版 macOS 不向命令行返回当前网络）时不提供该筛选，避免把“未知”显示成“没有连接”。
  // macOS 不向插件提供已保存网络的加密方式（authType 为 Unknown）：说明只在状态条出现一次，不在每行重复；
  // 全部未知时“开放网络 / 企业认证”筛选没有依据，不提供。部分未知时才在对应行标出，便于与已知行区分。
  const unknownCount = allProfiles.filter(profile => profile.authType === 'Unknown').length
  const allUnknown = allProfiles.length > 0 && unknownCount === allProfiles.length
  const securityUnknownNote = !unknownCount ? '' : allUnknown ? t('noteAllUnknown') : t('notePartialUnknown', { count: unknownCount })
  const activeFilter: WifiSecurityFilter = (securityFilter === 'connected' && !connectionKnown && !isLoading) || (allUnknown && (securityFilter === 'open' || securityFilter === 'enterprise')) ? 'all' : securityFilter
  const profiles = useMemo(() => filterAndSortWifiProfiles(allProfiles, { query: searchText, securityFilter: activeFilter, sortBy: 'connected' }), [allProfiles, searchText, activeFilter, locale])
  const isNotInClientError = loadErrorCode === NOT_IN_CLIENT_ERROR_CODE
  const notInClientText = t('notInClient')
  return <List
    isLoading={isLoading || readingPassword}
    isShowingDetail={false}
    navigationTitle={t('navTitle')}
    searchBarPlaceholder={t('searchPlaceholder')}
    onSearchTextChange={setSearchText}
    filterBar={{
      summaryText: isLoading ? t('summaryLoading') : isNotInClientError ? notInClientText : loadError ? t('summaryLoadFailed') : readingPassword ? t('summaryReadingPwd') : t('summarySavedCount', { count: allProfiles.length, note: securityUnknownNote }),
      actions: [{ id: 'refresh', title: t('actionRefresh'), onAction: () => reload(true) }]
    }}
    searchBarAccessory={<List.Dropdown tooltip={t('filterTooltip')} value={activeFilter} onChange={value => setSecurityFilter(value as WifiSecurityFilter)}>
      <List.Dropdown.Item title={t('filterAll')} value="all" />
      {connectionKnown && <List.Dropdown.Item title={t('filterConnected')} value="connected" />}
      {!allUnknown && <List.Dropdown.Item title={t('filterOpen')} value="open" />}
      {!allUnknown && <List.Dropdown.Item title={t('filterEnterprise')} value="enterprise" />}
    </List.Dropdown>}
  >
    {loadError ? <List.Item id="load-error" title={isNotInClientError ? notInClientText : t('errLoadTitle')} subtitle={isNotInClientError ? t('errClientRequiredSub') : loadError} icon={Icon.ExclamationMark} /> : profiles.length === 0 ? <List.Item id="empty" title={isLoading ? t('emptyLoading') : allProfiles.length ? t('emptyNoMatch') : t('emptyNoProfiles')} icon={Icon.Wifi} /> : profiles.map(profile => <List.Item
      key={profile.id} id={profile.id} title={profile.ssid} subtitle={profile.profileName && profile.profileName !== profile.ssid ? t('profileSubtitlePrefix', { name: profile.profileName }) : undefined} icon={Icon.Wifi}
      accessories={[...(profile.isConnected ? [{ text: t('tagConnected') }] : []), ...(profile.authType !== 'Unknown' ? [{ text: profile.authType }] : allUnknown ? [] : [{ text: t('tagUnknownSecurity') }])]}
      actions={<ActionPanel>
        {!profile.isOpenNetwork && !profile.isEnterprise && <Action title={t('actionCopyPassword')} icon={Icon.CopyClipboard} onAction={() => runProfileAction(profile, 'copy')} />}
        <Action title={t('actionShowDetail')} icon={Icon.Eye} onAction={() => runProfileAction(profile, 'show')} />
        {!profile.isEnterprise && profile.authType === 'Unknown' && <Action title={t('actionGenerateQr')} icon={Icon.QrCode} onAction={() => runProfileAction(profile, 'qr')} />}
        <Action title={t('actionCopySsid')} icon={Icon.Text} onAction={() => copyValue(profile.ssid, t('toastCopiedSsid'))} />
      </ActionPanel>}
    />)}
  </List>
}

export default WifiPasswordRevealCommand
