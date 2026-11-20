import React, {
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  Toast,
  showToast,
  useLocale,
  useMemo,
  useState,
  useNavigation
} from '@ztools/declarative-ui'
import {
  applyCombinedHosts,
  buildCombinedHostsContent,
  flushDnsCache,
  getDefaultHostsProfiles,
  parseHostsContent,
  readSystemHosts
} from './hosts-service.js'
import { t } from './i18n.js'
import type { HostsProfile } from './types.js'

export * from './types.js'
export * from './hosts-service.js'

export function HostsProfileForm({
  initialProfile,
  onSave
}: {
  initialProfile?: HostsProfile
  onSave: (profile: HostsProfile) => void
}) {
  useLocale()
  const { pop } = useNavigation()
  const [name, setName] = useState(initialProfile?.name ?? '')
  const [rawContent, setRawContent] = useState(
    initialProfile?.rawContent ?? '127.0.0.1       example.local'
  )

  const handleSubmit = async () => {
    if (!name.trim()) {
      await showToast({ style: Toast.Style.Failure, title: t('errProfileNameEmpty') })
      return
    }
    const rules = parseHostsContent(rawContent)
    const validCount = rules.filter((r) => r.isValid).length
    const invalidCount = rules.filter((r) => !r.isValid).length

    onSave({
      id: initialProfile?.id || `hosts-${Date.now()}`,
      name: name.trim(),
      isEnabled: initialProfile?.isEnabled ?? true,
      isSystem: initialProfile?.isSystem ?? false,
      rawContent,
      rulesCount: validCount,
      invalidCount,
      updatedAt: Date.now(),
      updatedAtFormatted: t('justUpdated')
    })
    await showToast({ style: Toast.Style.Success, title: t('toastProfileSaved', { name: name.trim() }) })
    pop()
  }

  return (
    <Form
      navigationTitle={initialProfile ? t('winFormNavEdit') : t('winFormNavNew')}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={t('winSaveProfileAction')} icon={Icon.CheckCircle} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title={t('winFieldNameTitle')}
        placeholder={t('winFieldNamePlaceholder')}
        value={name}
        onChange={setName}
      />
      <Form.TextArea
        id="rawContent"
        title={t('winFieldContentTitle')}
        placeholder={t('winFieldContentPlaceholder')}
        value={rawContent}
        onChange={setRawContent}
      />
    </Form>
  )
}

export interface HostsSwitcherCommandProps {
  featureCode?: string
  initialProfiles?: HostsProfile[]
  hostOverride?: unknown
}

export function HostsSwitcherCommand(props: HostsSwitcherCommandProps = {}) {
  const locale = useLocale()
  const { push } = useNavigation()
  const [profiles, setProfiles] = useState<HostsProfile[]>(
    () => props.initialProfiles ?? getDefaultHostsProfiles()
  )
  const [filterStatus, setFilterStatus] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [searchText, setSearchText] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)

  React.useEffect(() => {
    if (!props.initialProfiles) {
      const defaults = getDefaultHostsProfiles()
      setProfiles((prev) =>
        prev.map((p) => {
          const def = defaults.find((d) => d.id === p.id)
          return def && p.id !== 'hosts-system' ? { ...p, name: def.name } : def && p.id === 'hosts-system' ? { ...p, name: def.name } : p
        })
      )
    }
  }, [locale])

  React.useEffect(() => {
    if (!props.initialProfiles) {
      void (async () => {
        const sysRes = await readSystemHosts(undefined, props.hostOverride)
        if (sysRes.ok && sysRes.content.trim()) {
          const rules = parseHostsContent(sysRes.content)
          const validCount = rules.filter((r) => r.isValid).length
          const invalidCount = rules.filter((r) => !r.isValid).length
          setProfiles((prev) =>
            prev.map((p) =>
              p.id === 'hosts-system'
                ? {
                    ...p,
                    rawContent: sysRes.content,
                    rulesCount: validCount,
                    invalidCount
                  }
                : p
            )
          )
        }
      })()
    }
  }, [])

  const filteredProfiles = useMemo(() => {
    const byStatus = profiles.filter((p) => {
      if (filterStatus === 'enabled') return p.isEnabled
      if (filterStatus === 'disabled') return !p.isEnabled
      return true
    })
    const q = searchText.trim().toLowerCase()
    if (!q) return byStatus
    return byStatus.filter(
      (p) => p.name.toLowerCase().includes(q) || p.rawContent.toLowerCase().includes(q)
    )
  }, [profiles, filterStatus, searchText])

  const activeCount = useMemo(
    () => profiles.filter((p) => p.isEnabled).length,
    [profiles]
  )

  const handleToggleProfile = async (profileId: string) => {
    const previous = profiles
    const next = profiles.map((p) =>
      p.id === profileId ? { ...p, isEnabled: !p.isEnabled } : p
    )
    setProfiles(next)
    setIsLoading(true)
    try {
      const merged = buildCombinedHostsContent(next)
      const res = await applyCombinedHosts(merged.combinedContent, undefined, props.hostOverride)
      if (!res.success) {
        // 系统 hosts 没有写入：启用状态退回原样，不能显示成已切换
        setProfiles(previous)
        await showToast({
          style: Toast.Style.Failure,
          title: t('toastWriteBlocked'),
          message: res.error
        })
        return
      }
      if (res.warnings?.length) {
        // 已写入但刷新 DNS 等后续步骤失败：如实说明，不能提示“已刷新”
        const detail = res.warnings.map((w) => w.replace(/^hosts 已写入，但/, '')).join('；')
        await showToast({
          style: Toast.Style.Success,
          title: t('toastWrittenWithWarnings', { count: merged.activeRulesCount, detail })
        })
        return
      }
      await showToast({
        style: Toast.Style.Success,
        title: t('toastAppliedAndFlushed', { count: merged.activeRulesCount })
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleFlushDns = async () => {
    setIsLoading(true)
    try {
      const res = await flushDnsCache(undefined, props.hostOverride)
      if (!res.success) {
        await showToast({
          style: Toast.Style.Failure,
          title: t('errFlushDnsFailed'),
          message: res.error
        })
        return
      }
      await showToast({
        style: Toast.Style.Success,
        title: t('toastFlushDnsSuccess')
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenCreateForm = () => {
    push(
      <HostsProfileForm
        onSave={(created) => {
          setProfiles((prev) => [...prev, created])
        }}
      />
    )
  }

  const handleEditProfile = (profile: HostsProfile) => {
    push(
      <HostsProfileForm
        initialProfile={profile}
        onSave={(updated) => {
          setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        }}
      />
    )
  }

  const handleDeleteProfile = async (id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id))
    await showToast({ style: Toast.Style.Success, title: t('toastProfileDeleted') })
  }

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={true}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={t('winSearchPlaceholder')}
      searchBarAccessory={
        <List.Dropdown
          value={filterStatus}
          onChange={(v: string) => setFilterStatus(v as 'all' | 'enabled' | 'disabled')}
          tooltip={t('winFilterTooltip')}
        >
          <List.Dropdown.Item title={t('winFilterAll')} value="all" icon={Icon.List} />
          <List.Dropdown.Item title={t('winFilterEnabled')} value="enabled" icon={Icon.CheckCircle} />
          <List.Dropdown.Item title={t('winFilterDisabled')} value="disabled" icon={Icon.Circle} />
        </List.Dropdown>
      }
      filterBar={{
        summaryText: t('winSummaryText', { total: profiles.length, active: activeCount }),
        actions: [
          { id: 'new-profile', title: t('winBarNewProfile'), onAction: handleOpenCreateForm },
          { id: 'flush-dns', title: t('winBarFlushDns'), onAction: handleFlushDns }
        ]
      }}
    >
      {filteredProfiles.map((profile) => (
        <List.Item
          key={profile.id}
          id={profile.id}
          title={profile.name}
          subtitle={t('winRulesCount', { count: profile.rulesCount })}
          icon={profile.isEnabled ? Icon.CheckCircle : Icon.Circle}
          accessories={[
            ...(profile.isSystem ? [{ tag: t('winTagSystemSource') }] : []),
            { text: profile.isEnabled ? t('winStatusEnabled') : t('winStatusInactive') }
          ]}
          detail={
            <List.Item.Detail
              markdown={`\`\`\`ini\n${profile.rawContent}\n\`\`\``}
              metadata={
                <List.Item.Detail.Metadata>
                  <List.Item.Detail.Metadata.Label title={t('winMetaName')} text={profile.name} />
                  <List.Item.Detail.Metadata.Label
                    title={t('winMetaStatus')}
                    text={profile.isEnabled ? t('winMetaStatusActive') : t('winMetaStatusDisabled')}
                  />
                  <List.Item.Detail.Metadata.Label
                    title={t('winMetaRulesCount')}
                    text={t('winMetaRulesText', { count: profile.rulesCount })}
                  />
                  <List.Item.Detail.Metadata.Separator />
                  <List.Item.Detail.Metadata.Label
                    title={t('winMetaLastUpdated')}
                    text={profile.updatedAtFormatted}
                  />
                </List.Item.Detail.Metadata>
              }
            />
          }
          actions={
            <ActionPanel>
              <Action
                title={profile.isEnabled ? t('winActionDisable') : t('winActionEnable')}
                icon={profile.isEnabled ? Icon.XMarkCircle : Icon.CheckCircle}
                onAction={() => handleToggleProfile(profile.id)}
              />
              <Action
                title={t('winActionEdit')}
                icon={Icon.Pencil}
                shortcut={{ modifiers: ['ctrl'], key: 'e' }}
                onAction={() => handleEditProfile(profile)}
              />
              <Action
                title={t('winActionFlushDns')}
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ['ctrl'], key: 'r' }}
                onAction={handleFlushDns}
              />
              <Action
                title={t('winActionNew')}
                icon={Icon.Plus}
                shortcut={{ modifiers: ['ctrl'], key: 'n' }}
                onAction={handleOpenCreateForm}
              />
              {!profile.isSystem ? (
                <Action
                  title={t('winActionDelete')}
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ['ctrl'], key: 'backspace' }}
                  onAction={() => handleDeleteProfile(profile.id)}
                />
              ) : null}
            </ActionPanel>
          }
        />
      ))}
    </List>
  )
}

export default HostsSwitcherCommand
