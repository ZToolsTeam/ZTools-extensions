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
  useNavigation,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef
} from '@ztools/declarative-ui'
import type { EncryptedVaultEnvelope, VaultCategory, VaultEntry, VaultNewEntryInput } from './types.js'
import {
  copySecretWithAutoClear,
  createVaultEntry,
  decryptVaultEntries,
  encryptVaultEntries,
  generateSecurePassword,
  validateMasterPassword,
  validateNewEntryInput
} from './vault-crypto.js'

export * from './types.js'
export * from './vault-crypto.js'

const VAULT_STORAGE_KEY = 'ztools.password-vault.envelope.v1'

function parseStoredEnvelope(raw: unknown): EncryptedVaultEnvelope {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('保险箱数据格式无效')
  }
  const envelope = value as Record<string, unknown>
  if ((envelope.version !== 1 && !(envelope.version === 2 && Number.isSafeInteger(envelope.kdfIterations))) ||
      typeof envelope.saltBase64 !== 'string' || !envelope.saltBase64 ||
      typeof envelope.ivBase64 !== 'string' || !envelope.ivBase64 ||
      typeof envelope.cipherTextBase64 !== 'string' || !envelope.cipherTextBase64) {
    throw new Error('保险箱数据不完整或版本不受支持')
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
      title: '已填入 20 位高强度随机密码'
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
        title: '无法保存凭据',
        message: check.error
      })
      return
    }
    if (submitting.current) return
    submitting.current = true; setSaving(true)
    try { await onSave(input); pop() }
    catch (error) { await showToast({ style: Toast.Style.Failure, title: '未保存，原数据保留', message: error instanceof Error ? error.message : String(error) }) }
    finally { submitting.current = false; setSaving(false) }
  }, [title, category, username, endpoint, secretPlain, note, onSave, pop])

  return (
    <Form
      navigationTitle={initialEntry ? '编辑加密凭据' : '新建加密凭据'}
      isLoading={saving}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="加密保存至保险箱" icon={Icon.Lock} onSubmit={handleSubmit} />
          <Action title="生成 20 位随机密码填入" icon={Icon.Wand} onAction={handleGenerate} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="凭据名称"
        placeholder="例如：GitHub 主账号 / DeepSeek API Key / 生产数据库"
        value={title}
        onChange={setTitle}
      />
      <Form.Dropdown
        id="category"
        title="凭据分类"
        value={category}
        onChange={(v: string) => setCategory(v as VaultCategory)}
      >
        <Form.Dropdown.Item value="login" title="网站与应用账号" icon={Icon.Globe} />
        <Form.Dropdown.Item value="apikey" title="API Key 与访问令牌" icon={Icon.Key} />
        <Form.Dropdown.Item value="server" title="服务器与数据库密码" icon={Icon.Terminal} />
        <Form.Dropdown.Item value="license" title="软件激活码与备忘" icon={Icon.Document} />
      </Form.Dropdown>
      <Form.TextField
        id="username"
        title="用户名 / 标识"
        placeholder="账号、邮箱、Key 名称或 root"
        value={username}
        onChange={setUsername}
      />
      <Form.TextField
        id="endpoint"
        title="网址 / 主机地址"
        placeholder="例如：https://github.com 或 10.0.0.12:5432"
        value={endpoint}
        onChange={setEndpoint}
      />
      <Form.PasswordField
        id="secretPlain"
        title="密码 / Secret"
        placeholder="输入敏感密码、API Secret 或激活码（AES-256-GCM 加密存储）"
        value={secretPlain}
        onChange={setSecretPlain}
      />
      <Form.TextArea
        id="note"
        title="加密备注"
        placeholder="两步验证恢复码或到期提醒说明（随密文一同加密）"
        value={note}
        onChange={setNote}
      />
    </Form>
  )
}

export interface PasswordVaultProps {
  featureCode?: string
  initialUnlockedEntries?: VaultEntry[]
  initialMasterPassword?: string
}

export function PasswordVault({
  featureCode = 'vault-list',
  initialUnlockedEntries,
  initialMasterPassword
}: PasswordVaultProps = {}) {
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
          setLoadError('无法读取保险箱，原数据未被修改。请重试；如果仍然失败，请先保留数据并联系支持。')
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
    if (!mountedRef.current || !readReadyRef.current) throw new Error('请重新读取并解锁保险箱')
    if (mutatingRef.current) throw new Error('正在保存，请稍候')
    const epoch = sessionEpoch.current, expected = initialize ? undefined : rawEnvelopeRef.current
    if (!initialize && expected === undefined) throw new Error('保险箱状态已变化，请重新读取')
    mutatingRef.current = true
    try {
      const envelope = await encryptVaultEntries(pwd, nextEntries), serialized = JSON.stringify(envelope)
      if (!mountedRef.current || epoch !== sessionEpoch.current) throw new Error('保险箱已锁定或关闭，本次未写入')
      const saved = await LocalStorage.compareAndSet(VAULT_STORAGE_KEY, expected, serialized)
      if (!saved) {
        readReadyRef.current = false; sessionEpoch.current++
        if (mountedRef.current) {
          setIsUnlocked(false); setMasterPassword(''); setEntries([]); entriesRef.current = []
          setLoadError('保险箱数据已变化，原数据未被覆盖。请重新读取并解锁后重试。')
        }
        throw new Error('保险箱数据已变化，原数据未被覆盖。请重新读取后重试。')
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
      setAuthError(check.error || '主密码长度不足')
      await showToast({
        style: Toast.Style.Failure,
        title: '主密码格式不合法',
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
          title: '保险箱已解锁',
          message: `成功解密 ${decrypted.length} 项凭据`
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
          title: '加密保险箱初始化完成',
          message: '所有凭据均使用 PBKDF2 + AES-256-GCM 离线加密存储'
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const title = hasExistingVault ? '主密码错误或保险箱数据损坏，无法解锁' : '无法创建保险箱，原数据未被修改'
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
      await showToast({ style: Toast.Style.Failure, title: '正在保存，请完成后再锁定' })
      return
    }
    sessionEpoch.current++; entriesRef.current = []
    setIsUnlocked(false)
    setMasterPassword('')
    setEntries([])
    setRevealedId(null)
    await showToast({
      style: Toast.Style.Success,
      title: '保险箱已锁定，内存密钥已销毁'
    })
  }, [])

  const handleSaveEntry = useCallback(async (input: VaultNewEntryInput, existingId?: string) => {
    if (!masterPassword || currentSession !== sessionEpoch.current) throw new Error('保险箱已锁定，请重新解锁')
    const created = createVaultEntry(input)
    if (existingId && !entriesRef.current.some(entry => entry.id === existingId)) throw new Error('此凭据已不存在，请重新读取')
    const next = existingId ? entriesRef.current.map(entry => entry.id === existingId ? { ...created, id: existingId } : entry) : [created, ...entriesRef.current]
    await persistEntries(masterPassword, next)
    if (!mountedRef.current || currentSession !== sessionEpoch.current) return
    entriesRef.current = next; setEntries(next)
    await showToast({ style: Toast.Style.Success, title: '凭据已加密保存', message: created.title })
  }, [masterPassword, persistEntries, currentSession])

  const handleDeleteEntry = useCallback(async (id: string) => {
    const target = entriesRef.current.find(entry => entry.id === id)
    // 删除不可恢复：必须由用户明确确认，取消或无法弹出确认框时不删除
    const confirmed = await confirmAlert({
      title: `删除凭据「${target?.title || '未命名'}」？`,
      message: '删除后无法恢复，保险箱里不会留下副本。',
      primaryAction: { title: '删除', style: 'destructive' },
      dismissAction: { title: '取消' }
    })
    if (!confirmed) return
    try {
      if (!masterPassword || currentSession !== sessionEpoch.current) throw new Error('保险箱已锁定，请重新解锁')
      const next = entriesRef.current.filter(entry => entry.id !== id)
      await persistEntries(masterPassword, next)
      if (!mountedRef.current || currentSession !== sessionEpoch.current) return
      entriesRef.current = next; setEntries(next)
      await showToast({ style: Toast.Style.Success, title: '已从加密保险箱中移除该凭据' })
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: '未删除，原数据保留', message: error instanceof Error ? error.message : String(error) })
    }
  }, [masterPassword, persistEntries, currentSession])

  const handleCopySecretWithAutoClear = useCallback(async (item: VaultEntry) => {
    await copySecretWithAutoClear(item.secretPlain)
    await showToast({
      style: Toast.Style.Success,
      title: '已复制密码 / Secret',
      message: '将在 30 秒后自动清空剪贴板痕迹'
    })
  }, [])

  const handleQuickGeneratePassword = useCallback(async () => {
    const generated = generateSecurePassword(20, true)
    await copySecretWithAutoClear(generated)
    await showToast({
      style: Toast.Style.Success,
      title: '已生成 20 位高强度随机密码并复制',
      message: '将在 30 秒后自动清空剪贴板痕迹'
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
        navigationTitle={isLoading ? '正在读取密码保险箱' : '保险箱暂不可用'}
        actions={!isLoading ? (
          <ActionPanel>
            <Action title="重新读取保险箱" onAction={() => {
              readReadyRef.current = false
              setIsLoading(true)
              setLoadError('')
              setReloadCount((count) => count + 1)
            }} />
          </ActionPanel>
        ) : undefined}
      >
        <Form.Description text={loadError || '读取完成后才能解锁或创建保险箱。'} />
      </Form>
    )
  }

  if (!isUnlocked) {
    return (
      <Form
        isLoading={isLoading}
        navigationTitle={hasExistingVault ? '解锁密码保险箱' : '初始化密码保险箱'}
        actions={
          <ActionPanel>
            <Action.SubmitForm
              title={hasExistingVault ? '解锁保险箱' : '设置主密码并创建保险箱'}
              icon={Icon.Lock}
              onSubmit={handleUnlockOrInitialize}
            />
            <Action
              title="生成 20 位随机密码复制到剪贴板"
              icon={Icon.Wand}
              onAction={handleQuickGeneratePassword}
            />
          </ActionPanel>
        }
      >
        <Form.Description
          title="加密架构说明"
          text={
            hasExistingVault
              ? '请输入主密码以派生 AES-256-GCM 密钥解密本地保险箱。主密码绝不落盘或上传。'
              : '首次使用请设置至少 8 位的主密码（PBKDF2-SHA256 600,000 次迭代 + AES-256-GCM 本地加密）。'
          }
        />
        <Form.PasswordField
          id="masterPassword"
          title="主密码 (Master Password)"
          placeholder="输入主密码以解锁或初始化本地保险箱..."
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
      searchBarPlaceholder="搜索账号标题、用户名、网址域名或 API Key 名称..."
      searchBarAccessory={
        <List.Dropdown value={categoryFilter} onChange={setCategoryFilter} tooltip="按凭据类型筛选">
          <List.Dropdown.Item title="全部加密凭据" value="all" icon={Icon.Lock} />
          <List.Dropdown.Item title="网站与应用账号" value="login" icon={Icon.Globe} />
          <List.Dropdown.Item title="API Key 与访问令牌" value="apikey" icon={Icon.Key} />
          <List.Dropdown.Item title="服务器与数据库密码" value="server" icon={Icon.Terminal} />
          <List.Dropdown.Item title="软件激活码与备忘" value="license" icon={Icon.Document} />
        </List.Dropdown>
      }
      filterBar={{
        summaryText: `保险箱已解锁 (AES-256-GCM) · 共加密保管 ${entries.length} 项凭据 · 复制后 30 秒自动清剪贴板`,
        actions: [
          {
            id: 'new-entry',
            title: '新建凭据',
            onAction: () =>
              push(
                <VaultEntryForm
                  initialPassword={
                    featureCode === 'vault-generator' ? generateSecurePassword(20, true) : ''
                  }
                  onSave={handleSaveEntry}
                />
              )
          },
          { id: 'lock-vault', title: '立即锁定', onAction: handleLockVault }
        ]
      }}
    >
      {filteredEntries.map((item: VaultEntry) => (
        <List.Item
          key={item.id}
          id={item.id}
          title={item.title}
          subtitle={`${item.username || item.endpoint || '私密条目'}${item.note ? ` · ${item.note}` : ''}`}
          icon={getCategoryIcon(item.category)}
          accessories={[
            { tag: item.categoryLabel },
            { text: revealedId === item.id ? item.secretPlain : '••••••••••••' },
            { text: item.updatedAtShort }
          ]}
          actions={
            <ActionPanel>
              <Action
                title="复制密码 / Secret（30秒后自动清剪贴板）"
                icon={Icon.Key}
                onAction={() => handleCopySecretWithAutoClear(item)}
              />
              {item.username && (
                <Action.CopyToClipboard title="复制用户名 / 账号" content={item.username} />
              )}
              <Action
                title={revealedId === item.id ? '隐藏明文密码' : '临时显示明文密码'}
                icon={Icon.Eye}
                shortcut={{ modifiers: ['cmd'], key: 'h' }}
                onAction={() => setRevealedId((cur: string | null) => (cur === item.id ? null : item.id))}
              />
              <Action.Push
                title="编辑此凭据"
                icon={Icon.Pencil}
                target={<VaultEntryForm initialEntry={item} onSave={input => handleSaveEntry(input, item.id)} />}
              />
              <Action
                title="立即生成 20 位高强度随机密码并复制"
                icon={Icon.Wand}
                shortcut={{ modifiers: ['cmd'], key: 'g' }}
                onAction={handleQuickGeneratePassword}
              />
              <Action
                title="删除此凭据"
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

/**
 * 两个入口对应的根组件。客户端调用根组件时不传参数，靠 commands 按 featureCode 找到入口；
 * 「随机密码」入口解锁后，「新建凭据」会预先填入一个随机密码。
 */
export const commands = {
  'vault-list': () => PasswordVault({ featureCode: 'vault-list' }),
  'vault-generator': () => PasswordVault({ featureCode: 'vault-generator' })
}

export default PasswordVault
