import React, {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  LocalStorage,
  showToast,
  Toast,
  confirmAlert,
  useLocale,
  useNavigation,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef
} from '@ztools/declarative-ui'
import type { EncryptedVaultEnvelope, VaultCategory, VaultEntry, VaultNewEntryInput } from './types.js'
import { t } from './i18n.js'
import {
  copySecretWithAutoClear,
  createVaultEntry,
  decryptVaultEntries,
  encryptVaultEntries,
  generateSecurePassword,
  getVaultCategoryLabel,
  validateMasterPassword,
  validateNewEntryInput
} from './vault-crypto.js'

export * from './types.js'
export * from './vault-crypto.js'

const VAULT_STORAGE_KEY = 'ztools.password-vault.envelope.v1'

function parseStoredEnvelope(raw: unknown): EncryptedVaultEnvelope {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(t('errEnvelopeFormatInvalid'))
  }
  const envelope = value as Record<string, unknown>
  if ((envelope.version !== 1 && !(envelope.version === 2 && Number.isSafeInteger(envelope.kdfIterations))) ||
      typeof envelope.saltBase64 !== 'string' || !envelope.saltBase64 ||
      typeof envelope.ivBase64 !== 'string' || !envelope.ivBase64 ||
      typeof envelope.cipherTextBase64 !== 'string' || !envelope.cipherTextBase64) {
    throw new Error(t('errEnvelopeIncomplete'))
  }
  return envelope as unknown as EncryptedVaultEnvelope
}

function getCategoryIcon(category: VaultCategory): Icon {
  switch (category) {
    case 'login':
      return Icon.Globe
    case 'apikey':
      return Icon.Key
    case 'server':
      return Icon.Terminal
    case 'license':
      return Icon.Document
    default:
      return Icon.Lock
  }
}

interface VaultEntryFormProps {
  initialPassword?: string
  initialEntry?: VaultEntry
  onSave: (input: VaultNewEntryInput) => Promise<void>
}

export function VaultEntryForm({ initialPassword = '', initialEntry, onSave }: VaultEntryFormProps) {
  useLocale()
  const { pop } = useNavigation()
  const [title, setTitle] = useState(initialEntry?.title ?? '')
  const [category, setCategory] = useState<VaultCategory>(initialEntry?.category ?? 'login')
  const [username, setUsername] = useState(initialEntry?.username ?? '')
  const [endpoint, setEndpoint] = useState(initialEntry?.endpoint ?? '')
  const [secretPlain, setSecretPlain] = useState(initialEntry?.secretPlain ?? initialPassword)
  const [note, setNote] = useState(initialEntry?.note ?? '')

  const submitting = useRef(false)
  const [saving, setSaving] = useState(false)

  const handleGenerate = useCallback(async () => {
    const pwd = generateSecurePassword(20, true)
    setSecretPlain(pwd)
    await showToast({
      style: Toast.Style.Success,
      title: t('toastGenerated20')
    })
  }, [])

  const handleSubmit = useCallback(async () => {
    const input: VaultNewEntryInput = {
      title,
      category,
      username,
      endpoint,
      secretPlain,
      note
    }
    const check = validateNewEntryInput(input)
    if (!check.valid) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastCannotSaveEntry'),
        message: check.error
      })
      return
    }
    if (submitting.current) return
    submitting.current = true; setSaving(true)
    try { await onSave(input); pop() }
    catch (error) { await showToast({ style: Toast.Style.Failure, title: t('toastNotSavedKept'), message: error instanceof Error ? error.message : String(error) }) }
    finally { submitting.current = false; setSaving(false) }
  }, [title, category, username, endpoint, secretPlain, note, onSave, pop])

  return (
    <Form
      navigationTitle={initialEntry ? t('formTitleEdit') : t('formTitleNew')}
      isLoading={saving}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={t('formSubmitSave')} icon={Icon.Lock} onSubmit={handleSubmit} />
          <Action title={t('formActionGen20')} icon={Icon.Wand} onAction={handleGenerate} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title={t('fieldTitleLabel')}
        placeholder={t('fieldTitlePlaceholder')}
        value={title}
        onChange={setTitle}
      />
      <Form.Dropdown
        id="category"
        title={t('fieldCategoryLabel')}
        value={category}
        onChange={(v: string) => setCategory(v as VaultCategory)}
      >
        <Form.Dropdown.Item value="login" title={t('catLoginForm')} icon={Icon.Globe} />
        <Form.Dropdown.Item value="apikey" title={t('catApikeyForm')} icon={Icon.Key} />
        <Form.Dropdown.Item value="server" title={t('catServerForm')} icon={Icon.Terminal} />
        <Form.Dropdown.Item value="license" title={t('catLicenseForm')} icon={Icon.Document} />
      </Form.Dropdown>
      <Form.TextField
        id="username"
        title={t('fieldUsernameLabel')}
        placeholder={t('fieldUsernamePlaceholder')}
        value={username}
        onChange={setUsername}
      />
      <Form.TextField
        id="endpoint"
        title={t('fieldEndpointLabel')}
        placeholder={t('fieldEndpointPlaceholder')}
        value={endpoint}
        onChange={setEndpoint}
      />
      <Form.PasswordField
        id="secretPlain"
        title={t('fieldSecretLabel')}
        placeholder={t('fieldSecretPlaceholder')}
        value={secretPlain}
        onChange={setSecretPlain}
      />
      <Form.TextArea
        id="note"
        title={t('fieldNoteLabel')}
        placeholder={t('fieldNotePlaceholder')}
        value={note}
        onChange={setNote}
      />
    </Form>
  )
}

export interface PasswordVaultProps {
  featureCode?: string
  /** 从生成器进入时，新建凭据预先填入这个密码 */
  prefillPassword?: string
  initialUnlockedEntries?: VaultEntry[]
  initialMasterPassword?: string
}

export function PasswordVault({
  featureCode = 'vault-list',
  prefillPassword,
  initialUnlockedEntries,
  initialMasterPassword
}: PasswordVaultProps = {}) {
  useLocale()
  const { push } = useNavigation()
  const [isLoading, setIsLoading] = useState<boolean>(!initialUnlockedEntries)
  const [hasExistingVault, setHasExistingVault] = useState<boolean>(false)
  const [storedEnvelope, setStoredEnvelope] = useState<EncryptedVaultEnvelope | null>(null)
  const [masterPassword, setMasterPassword] = useState<string>(initialMasterPassword || '')
  const [passwordInput, setPasswordInput] = useState<string>('')
  const [isUnlocked, setIsUnlocked] = useState<boolean>(Boolean(initialUnlockedEntries))
  const [entries, setEntries] = useState<VaultEntry[]>(initialUnlockedEntries || [])
  const [searchText, setSearchText] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [revealedId, setRevealedId] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string>('')
  const [loadError, setLoadError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)

  const mountedRef = useRef<boolean>(true)
  const readReadyRef = useRef(false)
  const authenticatingRef = useRef(false)
  const mutatingRef = useRef(false)
  const rawEnvelopeRef = useRef<unknown>(undefined)
  const entriesRef = useRef<VaultEntry[]>(initialUnlockedEntries || [])
  const sessionEpoch = useRef(0)
  const currentSession = sessionEpoch.current

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sessionEpoch.current++
    }
  }, [])

  useEffect(() => {
    if (initialUnlockedEntries) {
      return
    }
    let active = true
    readReadyRef.current = false
    setIsLoading(true)
    setLoadError('')
    ;(async () => {
      try {
        const raw = await LocalStorage.getItem(VAULT_STORAGE_KEY)
        if (!active || !mountedRef.current) return
        if (raw !== undefined) {
          setStoredEnvelope(parseStoredEnvelope(raw))
          setHasExistingVault(true)
        } else {
          setStoredEnvelope(null)
          setHasExistingVault(false)
        }
        rawEnvelopeRef.current = raw
        readReadyRef.current = true
      } catch {
        if (active && mountedRef.current) {
          setLoadError(t('errLoadVaultFailed'))
        }
      } finally {
        if (active && mountedRef.current) {
          setIsLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [initialUnlockedEntries, reloadCount])

  const persistEntries = useCallback(async (pwd: string, nextEntries: VaultEntry[], initialize = false) => {
    if (!mountedRef.current || !readReadyRef.current) throw new Error(t('errReReadAndUnlock'))
    if (mutatingRef.current) throw new Error(t('errSavingBusy'))
    const epoch = sessionEpoch.current, expected = initialize ? undefined : rawEnvelopeRef.current
    if (!initialize && expected === undefined) throw new Error(t('errStateChanged'))
    mutatingRef.current = true
    try {
      const envelope = await encryptVaultEntries(pwd, nextEntries), serialized = JSON.stringify(envelope)
      if (!mountedRef.current || epoch !== sessionEpoch.current) throw new Error(t('errLockedNotWritten'))
      const saved = await LocalStorage.compareAndSet(VAULT_STORAGE_KEY, expected, serialized)
      if (!saved) {
        readReadyRef.current = false; sessionEpoch.current++
        if (mountedRef.current) {
          setIsUnlocked(false); setMasterPassword(''); setEntries([]); entriesRef.current = []
          setLoadError(t('errDataChangedRead'))
        }
        throw new Error(t('errDataChangedRetry'))
      }
      if (mountedRef.current && epoch === sessionEpoch.current) {
        rawEnvelopeRef.current = serialized
        setStoredEnvelope(envelope); setHasExistingVault(true)
      }
    } finally { mutatingRef.current = false }
  }, [])

  const handleUnlockOrInitialize = useCallback(async () => {
    if (!readReadyRef.current || isLoading || loadError || authenticatingRef.current || mutatingRef.current) return
    setAuthError('')
    const check = validateMasterPassword(passwordInput, { isNewVault: !(hasExistingVault && storedEnvelope) })
    if (!check.valid) {
      setAuthError(check.error || t('errMasterLengthShort'))
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastInvalidMasterTitle'),
        message: check.error
      })
      return
    }

    authenticatingRef.current = true
    try {
      if (hasExistingVault && storedEnvelope) {
        const decrypted = await decryptVaultEntries(passwordInput, storedEnvelope)
        if (!mountedRef.current) return
        setMasterPassword(passwordInput)
        entriesRef.current = decrypted; sessionEpoch.current++
        setEntries(decrypted)
        setIsUnlocked(true)
        setPasswordInput('')
        await showToast({
          style: Toast.Style.Success,
          title: t('toastUnlockedTitle'),
          message: t('toastUnlockedMsg', { count: decrypted.length })
        })
      } else {
        await persistEntries(passwordInput, [], true)
        if (!mountedRef.current) return
        setMasterPassword(passwordInput)
        entriesRef.current = []; sessionEpoch.current++
        setEntries([])
        setIsUnlocked(true)
        setPasswordInput('')
        await showToast({
          style: Toast.Style.Success,
          title: t('toastInitTitle'),
          message: t('toastInitMsg')
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const title = hasExistingVault ? t('errUnlockFailedTitle') : t('errCreateFailedTitle')
      if (mountedRef.current) {
        setAuthError(title)
        if (!hasExistingVault) {
          readReadyRef.current = false
          setLoadError(msg)
        }
      }
      await showToast({
        style: Toast.Style.Failure,
        title,
        message: msg
      })
    } finally {
      authenticatingRef.current = false
    }
  }, [passwordInput, hasExistingVault, storedEnvelope, persistEntries, isLoading, loadError])

  const handleLockVault = useCallback(async () => {
    if (mutatingRef.current) {
      await showToast({ style: Toast.Style.Failure, title: t('toastLockBusy') })
      return
    }
    sessionEpoch.current++; entriesRef.current = []
    setIsUnlocked(false)
    setMasterPassword('')
    setEntries([])
    setRevealedId(null)
    await showToast({
      style: Toast.Style.Success,
      title: t('toastLockedTitle')
    })
  }, [])

  const handleSaveEntry = useCallback(async (input: VaultNewEntryInput, existingId?: string) => {
    if (!masterPassword || currentSession !== sessionEpoch.current) throw new Error(t('errLockedReunlock'))
    const created = createVaultEntry(input)
    if (existingId && !entriesRef.current.some(entry => entry.id === existingId)) throw new Error(t('errEntryMissing'))
    const next = existingId ? entriesRef.current.map(entry => entry.id === existingId ? { ...created, id: existingId } : entry) : [created, ...entriesRef.current]
    await persistEntries(masterPassword, next)
    if (!mountedRef.current || currentSession !== sessionEpoch.current) return
    entriesRef.current = next; setEntries(next)
    await showToast({ style: Toast.Style.Success, title: t('toastEntrySaved'), message: created.title })
  }, [masterPassword, persistEntries, currentSession])

  const handleDeleteEntry = useCallback(async (id: string) => {
    const target = entriesRef.current.find(entry => entry.id === id)
    // 删除不可恢复：必须由用户明确确认，取消或无法弹出确认框时不删除
    const confirmed = await confirmAlert({
      title: t('confirmDeleteTitle', { title: target?.title || t('unnamedEntry') }),
      message: t('confirmDeleteMsg'),
      primaryAction: { title: t('confirmDeletePrimary'), style: 'destructive' },
      dismissAction: { title: t('confirmCancel') }
    })
    if (!confirmed) return
    try {
      if (!masterPassword || currentSession !== sessionEpoch.current) throw new Error(t('errLockedReunlock'))
      const next = entriesRef.current.filter(entry => entry.id !== id)
      await persistEntries(masterPassword, next)
      if (!mountedRef.current || currentSession !== sessionEpoch.current) return
      entriesRef.current = next; setEntries(next)
      await showToast({ style: Toast.Style.Success, title: t('toastEntryRemoved') })
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: t('toastDeleteFailedKept'), message: error instanceof Error ? error.message : String(error) })
    }
  }, [masterPassword, persistEntries, currentSession])

  const handleCopySecretWithAutoClear = useCallback(async (item: VaultEntry) => {
    await copySecretWithAutoClear(item.secretPlain)
    await showToast({
      style: Toast.Style.Success,
      title: t('toastCopiedSecretTitle'),
      message: t('toastAutoClearMsg')
    })
  }, [])

  const handleQuickGeneratePassword = useCallback(async () => {
    const generated = generateSecurePassword(20, true)
    await copySecretWithAutoClear(generated)
    await showToast({
      style: Toast.Style.Success,
      title: t('toastQuickGenTitle'),
      message: t('toastAutoClearMsg')
    })
  }, [])

  const filteredEntries = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return entries.filter((item: VaultEntry) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) {
        return false
      }
      if (!q) return true
      return (
        item.title.toLowerCase().includes(q) ||
        item.username.toLowerCase().includes(q) ||
        item.endpoint.toLowerCase().includes(q) ||
        item.note.toLowerCase().includes(q)
      )
    })
  }, [entries, searchText, categoryFilter])

  if (!isUnlocked && (isLoading || loadError)) {
    return (
      <Form
        isLoading={isLoading}
        navigationTitle={isLoading ? t('navLoadingVault') : t('navVaultUnavailable')}
        actions={!isLoading ? (
          <ActionPanel>
            <Action title={t('actionReloadVault')} onAction={() => {
              readReadyRef.current = false
              setIsLoading(true)
              setLoadError('')
              setReloadCount((count) => count + 1)
            }} />
          </ActionPanel>
        ) : undefined}
      >
        <Form.Description text={loadError || t('loadDescDefault')} />
      </Form>
    )
  }

  if (!isUnlocked) {
    return (
      <Form
        isLoading={isLoading}
        navigationTitle={hasExistingVault ? t('navUnlockVault') : t('navInitVault')}
        actions={
          <ActionPanel>
            <Action.SubmitForm
              title={hasExistingVault ? t('actionUnlockVault') : t('actionCreateVault')}
              icon={Icon.Lock}
              onSubmit={handleUnlockOrInitialize}
            />
            <Action
              title={t('actionGenAndCopy20')}
              icon={Icon.Wand}
              onAction={handleQuickGeneratePassword}
            />
          </ActionPanel>
        }
      >
        <Form.Description
          title={t('descArchTitle')}
          text={hasExistingVault ? t('descArchUnlock') : t('descArchInit')}
        />
        <Form.PasswordField
          id="masterPassword"
          title={t('fieldMasterPwdTitle')}
          placeholder={t('fieldMasterPwdPlaceholder')}
          value={passwordInput}
          onChange={setPasswordInput}
          error={authError || undefined}
        />
      </Form>
    )
  }

  return (
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={t('searchPlaceholder')}
      searchBarAccessory={
        <List.Dropdown value={categoryFilter} onChange={setCategoryFilter} tooltip={t('filterTooltip')}>
          <List.Dropdown.Item title={t('filterAll')} value="all" icon={Icon.Lock} />
          <List.Dropdown.Item title={t('catLoginForm')} value="login" icon={Icon.Globe} />
          <List.Dropdown.Item title={t('catApikeyForm')} value="apikey" icon={Icon.Key} />
          <List.Dropdown.Item title={t('catServerForm')} value="server" icon={Icon.Terminal} />
          <List.Dropdown.Item title={t('catLicenseForm')} value="license" icon={Icon.Document} />
        </List.Dropdown>
      }
      filterBar={{
        summaryText: t('summaryUnlocked', { count: entries.length }),
        actions: [
          {
            id: 'new-entry',
            title: t('btnNewEntry'),
            onAction: () =>
              push(
                <VaultEntryForm
                  initialPassword={
                    prefillPassword || (featureCode === 'vault-generator' ? generateSecurePassword(20, true) : '')
                  }
                  onSave={handleSaveEntry}
                />
              )
          },
          { id: 'lock-vault', title: t('btnLockVault'), onAction: handleLockVault }
        ]
      }}
    >
      {filteredEntries.map((item: VaultEntry) => (
        <List.Item
          key={item.id}
          id={item.id}
          title={item.title}
          subtitle={`${item.username || item.endpoint || t('subtitlePrivateItem')}${item.note ? (revealedId === item.id ? ` · ${item.note}` : t('subtitleHasNote')) : ''}`}
          icon={getCategoryIcon(item.category)}
          accessories={[
            { tag: getVaultCategoryLabel(item.category) },
            { text: revealedId === item.id ? item.secretPlain : '••••••••••••' },
            { text: item.updatedAtShort }
          ]}
          actions={
            <ActionPanel>
              <Action
                title={t('actionCopySecret')}
                icon={Icon.Key}
                onAction={() => handleCopySecretWithAutoClear(item)}
              />
              {item.username && (
                <Action.CopyToClipboard title={t('actionCopyUsername')} content={item.username} />
              )}
              <Action
                title={revealedId === item.id ? t('actionHidePlain') : t('actionRevealPlain')}
                icon={Icon.Eye}
                shortcut={{ modifiers: ['ctrl'], key: 'e' }}
                onAction={() => setRevealedId((cur: string | null) => (cur === item.id ? null : item.id))}
              />
              <Action.Push
                title={t('actionEditEntry')}
                icon={Icon.Pencil}
                target={<VaultEntryForm initialEntry={item} onSave={input => handleSaveEntry(input, item.id)} />}
              />
              <Action
                title={t('actionQuickGen20')}
                icon={Icon.Wand}
                shortcut={{ modifiers: ['ctrl'], key: 'g' }}
                onAction={handleQuickGeneratePassword}
              />
              <Action
                title={t('actionDeleteEntry')}
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ['ctrl'], key: 'backspace' }}
                onAction={() => handleDeleteEntry(item.id)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  )
}

export const PasswordVaultCommand = PasswordVault

interface GeneratorPreset {
  id: string
  titleKey: 'presetStrong20' | 'presetPlain20' | 'presetStrong32' | 'presetPlain16'
  length: number
  symbols: boolean
}

const GENERATOR_PRESETS: GeneratorPreset[] = [
  { id: 'strong-20', titleKey: 'presetStrong20', length: 20, symbols: true },
  { id: 'plain-20', titleKey: 'presetPlain20', length: 20, symbols: false },
  { id: 'strong-32', titleKey: 'presetStrong32', length: 32, symbols: true },
  { id: 'plain-16', titleKey: 'presetPlain16', length: 16, symbols: false }
]

function generatePresetPasswords(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const preset of GENERATOR_PRESETS) result[preset.id] = generateSecurePassword(preset.length, preset.symbols)
  return result
}

/**
 * 「随机密码」入口：生成随机密码不需要保险箱，直接生成并安全复制；
 * 只有选择「存入保险箱」时才进入解锁流程。
 */
export function PasswordGenerator() {
  useLocale()
  const [initial] = useState<{ passwords: Record<string, string>; error: string }>(() => {
    try {
      return { passwords: generatePresetPasswords(), error: '' }
    } catch (error) {
      return { passwords: {}, error: error instanceof Error ? error.message : String(error) }
    }
  })
  const [passwords, setPasswords] = useState<Record<string, string>>(initial.passwords)
  const [generateError, setGenerateError] = useState<string>(initial.error)

  const regenerate = useCallback(() => {
    try {
      setPasswords(generatePresetPasswords())
      setGenerateError('')
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const handleCopy = useCallback(async (password: string) => {
    try {
      await copySecretWithAutoClear(password)
      await showToast({ style: Toast.Style.Success, title: t('toastCopiedRandomTitle'), message: t('toastAutoClearMsg') })
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: t('toastCopyFailedTitle'), message: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  if (generateError) {
    return (
      <List>
        <List.Item
          id="generate-error"
          title={t('genErrorTitle')}
          subtitle={generateError}
          icon={Icon.ExclamationMark}
          actions={
            <ActionPanel>
              <Action title={t('actionRegenerate')} icon={Icon.ArrowClockwise} onAction={regenerate} />
            </ActionPanel>
          }
        />
      </List>
    )
  }

  return (
    <List
      searchBarPlaceholder={t('genSearchPlaceholder')}
      filterBar={{ summaryText: t('genSummary') }}
    >
      {GENERATOR_PRESETS.map((preset) => {
        const password = passwords[preset.id] || ''
        return (
          <List.Item
            key={preset.id}
            id={preset.id}
            title={password}
            subtitle={t(preset.titleKey)}
            icon={Icon.Key}
            actions={
              <ActionPanel>
                <Action title={t('actionCopyPassword')} icon={Icon.Clipboard} onAction={() => handleCopy(password)} />
                <Action
                  title={t('actionRegenerate')}
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ['ctrl'], key: 'r' }}
                  onAction={regenerate}
                />
                <Action.Push
                  title={t('actionSaveToVault')}
                  icon={Icon.Lock}
                  shortcut={{ modifiers: ['ctrl'], key: 's' }}
                  target={<PasswordVault featureCode="vault-generator" prefillPassword={password} />}
                />
              </ActionPanel>
            }
          />
        )
      })}
    </List>
  )
}

/**
 * 两个入口对应的根组件。客户端调用根组件时不传参数，靠 commands 按 featureCode 找到入口；
 * 「随机密码」入口不需要解锁，直接生成并复制，选择存入保险箱时才要求主密码。
 */
export const commands = {
  'vault-list': () => PasswordVault({ featureCode: 'vault-list' }),
  'vault-generator': () => PasswordGenerator()
}

export default PasswordVault
