import React, {
  Action, ActionPanel, Clipboard, Detail, Form, Icon, List, Toast, showToast,
  useCallback, useEffect, useMemo, useNavigation, useRef, useState
} from '@ztools/declarative-ui'
import type { WifiProfileInfo, WifiSecurityFilter, WifiSecurityType } from './types.js'
import {
  NOT_IN_CLIENT_MESSAGE, fetchSavedWifiProfiles, filterAndSortWifiProfiles, generateWifiQrString,
  generateWifiQrSvgDataUrl, revealWifiPasswordFromHost
} from './wifi-service.js'

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

async function copyValue(value: string, title: string): Promise<void> {
  try {
    await Clipboard.copy(value)
    await showToast(Toast.Style.Success, title)
  } catch (error) {
    await showToast(Toast.Style.Failure, '复制失败', errorMessage(error))
  }
}

function qrPreview(profile: WifiProfileInfo): { payload?: string; markdown: string } {
  if (profile.isEnterprise) return { markdown: '企业认证网络不支持密码二维码。' }
  if (profile.authType === 'Unknown') return { markdown: '系统未提供加密类型，生成二维码时请按路由器设置选择。' }
  if (!profile.isOpenNetwork && !profile.password) return { markdown: '读取密码后可生成连网二维码。' }
  try {
    const payload = generateWifiQrString(profile.ssid, profile.password, profile.authType)
    return { payload, markdown: `![连网二维码](${generateWifiQrSvgDataUrl(profile)})\n\n${codeBlock(payload)}` }
  } catch (error) {
    return { markdown: errorMessage(error) }
  }
}

function passwordDescription(profile: WifiProfileInfo): string {
  if (profile.isOpenNetwork) return '开放网络，无需密码。'
  if (profile.isEnterprise) return '企业认证网络没有可共享的预共享密码。'
  return profile.password ? codeBlock(profile.password) : '尚未读取密码。'
}

export function WifiQrForm({ profile, hostOverride }: { profile: WifiProfileInfo; hostOverride?: unknown }) {
  const [security, setSecurity] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const selectionRevision = useRef(0)
  const mounted = useRef(true)
  const { push } = useNavigation()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const generate = async () => {
    if (pending.current) return
    if (!security) { await showToast(Toast.Style.Failure, '请选择网络实际使用的加密类型'); return }
    pending.current = true
    const selection = selectionRevision.current
    setBusy(true)
    try {
      const authType = security as WifiSecurityType
      const password = authType === 'Open' ? '' : profile.password || await revealWifiPasswordFromHost(profile.ssid, hostOverride)
      if (!mounted.current || selection !== selectionRevision.current) return
      const resolved = { ...profile, authType, password, isOpenNetwork: authType === 'Open' }
      generateWifiQrString(resolved.ssid, password, authType)
      push(<WifiDetailView profile={resolved} hostOverride={hostOverride} />)
    } catch (error) {
      if (mounted.current && selection === selectionRevision.current) await showToast(Toast.Style.Failure, '无法生成连网二维码', errorMessage(error))
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <Form navigationTitle="选择网络加密类型" isLoading={busy} actions={<ActionPanel><Action.SubmitForm title="生成连网二维码" onSubmit={generate} /></ActionPanel>}>
      <Form.Description text="系统未提供此网络的加密类型，请按路由器设置选择。选择开放网络不会读取密码。" />
      <Form.Dropdown id="security" title="加密类型" value={security} onChange={value => { selectionRevision.current++; setSecurity(value) }}>
        <Form.Dropdown.Item value="" title="请选择" />
        <Form.Dropdown.Item value="WPA2-Personal" title="WPA / WPA2 / WPA3 个人网络" />
        <Form.Dropdown.Item value="WEP" title="WEP" />
        <Form.Dropdown.Item value="Open" title="开放网络（无需密码）" />
      </Form.Dropdown>
    </Form>
  )
}

export function WifiDetailView({ profile, hostOverride }: { profile: WifiProfileInfo; hostOverride?: unknown }) {
  const { push } = useNavigation()
  const qr = qrPreview(profile)
  return <Detail
    navigationTitle={`Wi-Fi 详情：${profile.ssid}`}
    markdown={`### 密码\n\n${passwordDescription(profile)}\n\n### 连网二维码\n\n${qr.markdown}`}
    actions={<ActionPanel>
      {profile.password && <Action title="复制 Wi-Fi 密码" icon={Icon.CopyClipboard} onAction={() => copyValue(profile.password, '已复制 Wi-Fi 密码')} />}
      {qr.payload && <Action title="复制连网协议串" icon={Icon.QrCode} onAction={() => copyValue(qr.payload!, '已复制连网协议串')} />}
      {profile.authType === 'Unknown' && !profile.isEnterprise && <Action title="生成连网二维码" icon={Icon.QrCode} onAction={() => push(<WifiQrForm profile={profile} hostOverride={hostOverride} />)} />}
      <Action title="复制网络名称" icon={Icon.Text} onAction={() => copyValue(profile.ssid, '已复制网络名称')} />
    </ActionPanel>}
  />
}

export function WifiPasswordRevealCommand(props?: { featureCode?: string; hostOverride?: unknown }) {
  const [allProfiles, setAllProfiles] = useState<readonly WifiProfileInfo[]>([])
  const [searchText, setSearchText] = useState('')
  const [securityFilter, setSecurityFilter] = useState<WifiSecurityFilter>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
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
    setAllProfiles([])
    try {
      const loaded = await fetchSavedWifiProfiles({ hostOverride })
      if (!mounted.current || request !== revision.current) return
      setAllProfiles(loaded)
      if (notify) await showToast(Toast.Style.Success, `已读取 ${loaded.length} 个无线网络`)
    } catch (error) {
      if (mounted.current && request === revision.current) {
        setLoadError(errorMessage(error))
        if (notify) await showToast(Toast.Style.Failure, '读取无线网络失败', errorMessage(error))
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
      const password = profile.password || (profile.isOpenNetwork || profile.isEnterprise ? '' : await revealWifiPasswordFromHost(profile.ssid, hostOverride))
      if (!mounted.current || request !== revision.current) return
      const resolved = { ...profile, password }
      setAllProfiles(current => current.map(item => item.id === profile.id ? resolved : item))
      if (action === 'copy') await copyValue(password, '已复制 Wi-Fi 密码')
      else push(<WifiDetailView profile={resolved} hostOverride={hostOverride} />)
    } catch (error) {
      if (mounted.current && request === revision.current) await showToast(Toast.Style.Failure, '读取 Wi-Fi 密码失败', errorMessage(error))
    } finally {
      pendingRead.current = false
      if (mounted.current) setReadingPassword(false)
    }
  }
  const profiles = useMemo(() => filterAndSortWifiProfiles(allProfiles, { query: searchText, securityFilter, sortBy: 'connected' }), [allProfiles, searchText, securityFilter])
  return <List
    isLoading={isLoading || readingPassword}
    isShowingDetail={false}
    navigationTitle="Wi-Fi 密码查看"
    searchBarPlaceholder="搜索已保存的无线网络…"
    onSearchTextChange={setSearchText}
    filterBar={{
      summaryText: isLoading ? '正在读取无线网络…' : loadError === NOT_IN_CLIENT_MESSAGE ? NOT_IN_CLIENT_MESSAGE : loadError ? '读取失败，可重试' : readingPassword ? '正在读取密码，请留意系统授权提示…' : `已保存 ${allProfiles.length} 个网络`,
      actions: [{ id: 'refresh', title: '重新读取', onAction: () => reload(true) }]
    }}
    searchBarAccessory={<List.Dropdown tooltip="筛选网络" value={securityFilter} onChange={value => setSecurityFilter(value as WifiSecurityFilter)}>
      <List.Dropdown.Item title="全部网络" value="all" />
      <List.Dropdown.Item title="当前连接" value="connected" />
      <List.Dropdown.Item title="开放网络" value="open" />
      <List.Dropdown.Item title="企业认证" value="enterprise" />
    </List.Dropdown>}
  >
    {loadError ? <List.Item id="load-error" title={loadError === NOT_IN_CLIENT_MESSAGE ? NOT_IN_CLIENT_MESSAGE : '无法读取无线网络'} subtitle={loadError === NOT_IN_CLIENT_MESSAGE ? '在 ZTools 中打开本插件后读取已保存的网络' : loadError} icon={Icon.ExclamationMark} /> : profiles.length === 0 ? <List.Item id="empty" title={isLoading ? '正在读取…' : allProfiles.length ? '没有符合筛选条件的网络' : '没有已保存的无线网络'} icon={Icon.Wifi} /> : profiles.map(profile => <List.Item
      key={profile.id} id={profile.id} title={profile.ssid} icon={Icon.Wifi}
      accessories={[...(profile.isConnected ? [{ text: '当前连接' }] : []), ...(profile.authType !== 'Unknown' ? [{ text: profile.authType }] : [])]}
      actions={<ActionPanel>
        {!profile.isOpenNetwork && !profile.isEnterprise && <Action title="复制 Wi-Fi 密码" icon={Icon.CopyClipboard} onAction={() => runProfileAction(profile, 'copy')} />}
        <Action title="查看密码与二维码" icon={Icon.Eye} onAction={() => runProfileAction(profile, 'show')} />
        {!profile.isEnterprise && profile.authType === 'Unknown' && <Action title="生成连网二维码" icon={Icon.QrCode} onAction={() => runProfileAction(profile, 'qr')} />}
        <Action title="复制网络名称" icon={Icon.Text} onAction={() => copyValue(profile.ssid, '已复制网络名称')} />
      </ActionPanel>}
    />)}
  </List>
}

export default WifiPasswordRevealCommand
