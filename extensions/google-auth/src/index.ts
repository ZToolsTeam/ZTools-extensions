import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  Clipboard,
  useNavigation,
  useLocale,
  useState,
  useEffect,
  useRef,
  LocalStorage,
  SecureStorage,
  confirmAlert
} from "@ztools/declarative-ui";
import {
  createAccount,
  generateTOTP,
  formatToken,
  getRemainingSeconds,
  filterAccounts,
  parseOTPAuthURL,
  inspectStoredAccounts,
  corruptBackupKey,
  mergeLegacyAccounts,
  describeSecureStorageUnavailable,
  CORRUPT_BACKUP_KEY_PATTERN,
  ACCOUNTS_STORAGE_KEY,
  type AuthAccount,
  type OTPAlgorithm
} from "./logic.js";
import { updateStorageItem } from "./host-compat.js";
import { t } from "./i18n.js";

/**
 * 添加 2FA 账号表单视图
 */
export function CreateAccountForm({ onCreated }: { onCreated: (account: AuthAccount) => Promise<boolean> }) {
  useLocale();
  const { pop } = useNavigation();
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [secret, setSecret] = useState("");
  const [digits, setDigits] = useState("6");
  const [period, setPeriod] = useState("30");
  const [algorithm, setAlgorithm] = useState<OTPAlgorithm>("SHA1");
  const [error, setError] = useState<string | undefined>(undefined);
  const [secretError, setSecretError] = useState<string | undefined>(undefined);

  const handleSecretChange = (val: string) => {
    setSecret(val);
    setSecretError(undefined);

    // 智能识别 otpauth:// 协议链接；解析不了（如 HOTP 链接）时把原因显示在密钥框下，不静默吞掉
    if (val.trim().toLowerCase().startsWith("otpauth://")) {
      try {
        const parsed = parseOTPAuthURL(val);
        setName(parsed.name);
        setIssuer(parsed.issuer);
        setSecret(parsed.secret);
        setDigits(String(parsed.digits));
        setPeriod(String(parsed.period));
        setAlgorithm(parsed.algorithm);
        showToast(Toast.Style.Success, t("toastOtpauthParsed"));
      } catch (err) {
        setSecretError(errorText(err));
      }
    }
  };

  const handleSubmit = async (values: Record<string, string | undefined>) => {
    const accountName = values.name || name;
    const accountIssuer = values.issuer || issuer;
    let accountSecret = values.secret || secret;
    const accountDigits = parseInt(values.digits || digits, 10);
    const accountPeriod = parseInt(values.period || period, 10);
    const accountAlgo = (values.algorithm || algorithm) as OTPAlgorithm;

    if (!accountName || !accountName.trim()) {
      setError(t("errEnterAccountName"));
      await showToast(Toast.Style.Failure, t("toastEnterAccountName"));
      return;
    }

    if (!accountSecret || !accountSecret.trim()) {
      setSecretError(t("errEnterSecret"));
      await showToast(Toast.Style.Failure, t("toastEnterSecret"));
      return;
    }

    try {
      if (accountSecret.trim().toLowerCase().startsWith("otpauth://")) {
        const parsed = parseOTPAuthURL(accountSecret);
        accountSecret = parsed.secret;
      }

      const newAccount = createAccount({
        name: accountName,
        issuer: accountIssuer,
        secret: accountSecret,
        digits: accountDigits,
        period: accountPeriod,
        algorithm: accountAlgo
      });

      if (!(await onCreated(newAccount))) return;
      await showToast(Toast.Style.Success, t("toastAccountAdded", { name: newAccount.name }));
      pop();
    } catch (err) {
      // 账号名称已在上面校验，这里的错误都来自密钥或链接
      setSecretError(errorText(err));
      await showToast(Toast.Style.Failure, t("toastAddFailed"), errorText(err));
    }
  };

  return Form(
    {
      navigationTitle: t("formNavTitle"),
      actions: ActionPanel({ title: t("formActionsTitle") }, [
        Action.SubmitForm({
          title: t("saveAccountAction"),
          icon: Icon.Check,
          onSubmit: handleSubmit
        }),
        Action({
          title: t("backToListAction"),
          icon: Icon.ArrowLeft,
          onAction: () => pop()
        })
      ])
    },
    [
      Form.TextField({
        id: "name",
        title: t("fieldNameTitle"),
        placeholder: t("fieldNamePlaceholder"),
        value: name,
        error,
        onChange: (val) => {
          setName(val);
          if (error) setError(undefined);
        }
      }),
      Form.TextField({
        id: "issuer",
        title: t("fieldIssuerTitle"),
        placeholder: t("fieldIssuerPlaceholder"),
        value: issuer,
        onChange: (val) => setIssuer(val)
      }),
      Form.TextField({
        id: "secret",
        title: t("fieldSecretTitle"),
        placeholder: t("fieldSecretPlaceholder"),
        value: secret,
        error: secretError,
        onChange: handleSecretChange
      }),
      Form.Dropdown(
        {
          id: "digits",
          title: t("fieldDigitsTitle"),
          value: digits,
          onChange: (val) => setDigits(val)
        },
        [
          Form.Dropdown.Item({ title: t("digits6Title"), value: "6" }),
          // 链接里给出的非常用值（如 7 位）也要能选中，否则下拉框会显示成别的值
          ...(digits !== "6" && digits !== "8" ? [Form.Dropdown.Item({ title: t("digitsCustomTitle", { digits }), value: digits })] : []),
          Form.Dropdown.Item({ title: t("digits8Title"), value: "8" })
        ]
      ),
      Form.Dropdown(
        {
          id: "period",
          title: t("fieldPeriodTitle"),
          value: period,
          onChange: (val) => setPeriod(val)
        },
        [
          Form.Dropdown.Item({ title: t("period30Title"), value: "30" }),
          Form.Dropdown.Item({ title: t("period60Title"), value: "60" }),
          ...(period !== "30" && period !== "60" ? [Form.Dropdown.Item({ title: t("periodCustomTitle", { period }), value: period })] : [])
        ]
      ),
      Form.Dropdown(
        {
          id: "algorithm",
          title: t("fieldAlgoTitle"),
          value: algorithm,
          onChange: (val) => setAlgorithm(val as OTPAlgorithm)
        },
        [
          Form.Dropdown.Item({ title: t("algoSha1Title"), value: "SHA1" }),
          Form.Dropdown.Item({ title: "SHA256", value: "SHA256" }),
          Form.Dropdown.Item({ title: "SHA512", value: "SHA512" })
        ]
      )
    ]
  );
}

/**
 * 已保存账号的读取状态：只有 ready 时才允许把账号列表写回存储，
 * 避免读取中、读取失败或数据损坏时用界面上的空列表覆盖原有数据；
 * readonly：系统加密存储不可用（或迁移失败），只显示旧的明文账号，禁止任何写入（不得改写明文）
 */
type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "damaged"; corrupt: boolean; dropped: number; backupKey?: string }
  | { status: "readonly"; reason: string }
  | { status: "error"; message: string };

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * 把旧版明文账号迁移进加密存储，返回加密存储里的账号原始值。
 * 两边都有且内容不同（迁移中途崩溃后重入、或降级到旧版又写了明文）时以加密存储为准合并明文里新增的账号，
 * 写回成功后才删除明文；合并写入失败时保留明文、照常使用加密存储里的账号，下次打开再合并。
 */
async function migrateAccounts(): Promise<{ raw: unknown; warning?: string }> {
  const result = await SecureStorage.importFromLocalStorage(ACCOUNTS_STORAGE_KEY);
  if (result.legacyValue === undefined) return { raw: result.value };
  // 加密存储里的数据本身无法读取：先走损坏数据流程，明文保留到下次再合并
  if (!Array.isArray(result.value)) return { raw: result.value };
  const legacy = inspectStoredAccounts(result.legacyValue);
  let raw: unknown = result.value;
  try {
    // 明文里有读不出的部分：先原样备份进加密存储，再删除明文
    if (legacy.corrupt || legacy.dropped > 0) {
      await SecureStorage.setItem(corruptBackupKey(result.legacyValue), result.legacyValue);
    }
    raw = await updateStorageItem(SecureStorage, ACCOUNTS_STORAGE_KEY, current => {
      if (!Array.isArray(current)) throw new Error(t("errSecureStorageChanged"));
      return mergeLegacyAccounts(current, legacy.accounts).merged;
    });
  } catch (err) {
    return { raw: result.value, warning: t("warnLegacyMergeFailed", { error: errorText(err) }) };
  }
  try {
    await SecureStorage.discardLocalStorage(ACCOUNTS_STORAGE_KEY);
  } catch (err) {
    return { raw, warning: t("warnLegacyDeleteFailed", { error: errorText(err) }) };
  }
  return { raw };
}

/** 旧版写在明文里的损坏数据备份逐个迁移到加密存储的同名键；返回未能迁移的份数 */
async function migrateCorruptBackups(): Promise<number> {
  let keys: string[];
  try {
    keys = Object.keys((await LocalStorage.allItems()) || {}).filter((key) => CORRUPT_BACKUP_KEY_PATTERN.test(key));
  } catch {
    return 1;
  }
  let failed = 0;
  for (const key of keys) {
    try {
      const result = await SecureStorage.importFromLocalStorage(key);
      if (result.legacyValue === undefined) continue;
      // 同名键在加密存储里内容不同：按明文内容另存一份再删明文；算出来仍是同一个键则保留明文
      const altKey = corruptBackupKey(result.legacyValue);
      if (altKey === key) {
        failed++;
        continue;
      }
      await SecureStorage.setItem(altKey, result.legacyValue);
      await SecureStorage.discardLocalStorage(key);
    } catch {
      failed++;
    }
  }
  return failed;
}

/**
 * 2FA 动态口令验证器主入口
 */
export default function GoogleAuthCommand() {
  useLocale();
  const [accounts, setAccountsState] = useState<AuthAccount[]>([]);
  const [load, setLoadState] = useState<LoadState>({ status: "loading" });
  const [reloadSeq, setReloadSeq] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [, setTick] = useState(0);
  const { push } = useNavigation();
  // 表单回调与异步流程读取最新值，不依赖打开表单那一刻捕获的旧闭包
  const accountsRef = useRef<AuthAccount[]>([]);
  const loadRef = useRef<LoadState>({ status: "loading" });
  const damagedSnapshot = useRef<string | undefined>(undefined);
  const allowDamagedSnapshot = useRef(false);

  const setAccounts = (next: AuthAccount[]) => {
    accountsRef.current = next;
    setAccountsState(next);
  };
  const setLoad = (next: LoadState) => {
    loadRef.current = next;
    setLoadState(next);
  };

  // 打开时（以及用户选择重新读取时）读回账号：密钥只保存在系统加密存储，旧版明文首次读取时迁移并删除
  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    damagedSnapshot.current = undefined;
    allowDamagedSnapshot.current = false;

    // 加密存储不可用（readonly）或暂时读不了（error，可重新读取）：只显示旧的明文账号，不写任何东西
    const loadReadOnly = async (reason: string, retryable = false) => {
      let raw: unknown;
      try {
        raw = await LocalStorage.getItem(ACCOUNTS_STORAGE_KEY);
      } catch (err) {
        if (cancelled) return;
        setAccounts([]);
        setLoad({ status: "error", message: t("errLoadLegacyToo", { reason, error: errorText(err) }) });
        await showToast(Toast.Style.Failure, t("toastReadFailed"), t("toastReadFailedDesc"));
        return;
      }
      if (cancelled) return;
      setAccounts(inspectStoredAccounts(raw).accounts);
      if (retryable) {
        setLoad({ status: "error", message: reason });
        await showToast(Toast.Style.Failure, t("toastReadFailed"), t("toastReadFailedDesc"));
        return;
      }
      setLoad({ status: "readonly", reason });
      await showToast(Toast.Style.Failure, t("toastReadonlyTitle"), reason);
    };

    (async () => {
      // 首次访问系统钥匙串可能要等用户在系统弹窗里授权，期间保持加载态
      let status: Awaited<ReturnType<typeof SecureStorage.status>>;
      try {
        status = await SecureStorage.status();
      } catch (err) {
        if (cancelled) return;
        await loadReadOnly(t("errCheckSecStatus", { error: errorText(err) }), true);
        return;
      }
      if (cancelled) return;
      if (!status.available) {
        await loadReadOnly(describeSecureStorageUnavailable(status.reason));
        return;
      }

      let migrated: { raw: unknown; warning?: string };
      try {
        migrated = await migrateAccounts();
      } catch (err) {
        if (cancelled) return;
        await loadReadOnly(t("errReadSecFailed", { error: errorText(err) }), true);
        return;
      }
      const failedBackups = await migrateCorruptBackups();
      if (cancelled) return;
      if (migrated.warning) await showToast(Toast.Style.Failure, t("toastLegacyMigrationIncomplete"), migrated.warning);
      if (failedBackups > 0) {
        await showToast(Toast.Style.Failure, t("toastBackupMigrationFailed"), t("toastBackupMigrationFailedDesc"));
      }
      if (cancelled) return;

      const raw = migrated.raw;
      const inspected = inspectStoredAccounts(raw);
      if (inspected.corrupt || inspected.dropped > 0) damagedSnapshot.current = JSON.stringify(raw);
      if (!inspected.corrupt && inspected.dropped === 0) {
        setAccounts(inspected.accounts);
        setLoad({ status: "ready" });
        return;
      }

      // 有损坏数据：先把原值原样备份到加密存储的单独键，再决定是否允许写入
      let backupKey: string | undefined = corruptBackupKey(raw);
      try {
        await SecureStorage.setItem(backupKey, raw);
      } catch {
        backupKey = undefined;
      }
      if (cancelled) return;
      setAccounts(inspected.accounts);
      const backupNote = backupKey ? t("backupNoteSaved", { key: backupKey }) : t("backupNoteFailed");
      if (inspected.corrupt) {
        setLoad({ status: "damaged", corrupt: true, dropped: 0, backupKey });
        await showToast(Toast.Style.Failure, t("toastCorruptAccounts"), backupNote);
      } else {
        // 部分条目损坏：备份成功后照常使用其余账号；备份失败则写入前需要确认
        allowDamagedSnapshot.current = Boolean(backupKey);
        setLoad(backupKey ? { status: "ready" } : { status: "damaged", corrupt: false, dropped: inspected.dropped });
        await showToast(Toast.Style.Failure, t("toastDroppedAccounts", { count: inspected.dropped }), backupNote);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadSeq]);

  // 1 秒心跳定时器刷新倒计时与动态口令
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const filtered = filterAccounts(accounts, searchQuery);

  /**
   * 写入前的门禁：读取中或读取失败时拒绝；数据损坏时必须由用户确认后才允许覆盖
   */
  const ensureWritable = async (): Promise<boolean> => {
    const current = loadRef.current;
    if (current.status === "ready") return true;
    if (current.status === "loading") {
      await showToast(Toast.Style.Failure, t("toastLoadingWait"));
      return false;
    }
    if (current.status === "error") {
      await showToast(Toast.Style.Failure, t("toastLoadErrorNoWrite"), t("toastLoadErrorNoWriteDesc"));
      return false;
    }
    if (current.status === "readonly") {
      await showToast(Toast.Style.Failure, t("toastReadonlyTitle"), current.reason);
      return false;
    }
    const confirmed = await confirmAlert({
      title: current.corrupt ? t("confirmReplaceCorruptTitle") : t("confirmDiscardDamagedTitle"),
      message: current.backupKey
        ? t("confirmBackupSavedMsg", { key: current.backupKey })
        : t("confirmBackupLostMsg"),
      primaryAction: { title: t("confirmContinue"), style: "destructive" },
      dismissAction: { title: t("confirmCancel") }
    });
    // 确认期间状态变了（例如用户触发了重新读取），以新状态为准，本次不写
    if (!confirmed || loadRef.current !== current) return false;
    allowDamagedSnapshot.current = true;
    setLoad({ status: "ready" });
    return true;
  };

  // 先写入存储再更新界面：写入失败时界面保持原样，避免用户以为已保存
  const persist = async (mutate: (current: AuthAccount[]) => AuthAccount[]): Promise<boolean> => {
    if (loadRef.current.status !== "ready") {
      await showToast(Toast.Style.Failure, t("toastSaveFailed"), t("toastSaveNotReadyDesc"));
      return false;
    }
    try {
      const next = await updateStorageItem(SecureStorage, ACCOUNTS_STORAGE_KEY, raw => {
        const inspected = inspectStoredAccounts(raw);
        if ((inspected.corrupt || inspected.dropped > 0) &&
            !(allowDamagedSnapshot.current && JSON.stringify(raw) === damagedSnapshot.current)) {
          throw new Error(t("errAccountsChangedOrDamaged"));
        }
        return mutate(inspected.accounts);
      });
      damagedSnapshot.current = undefined;
      allowDamagedSnapshot.current = false;
      setAccounts(next);
      return true;
    } catch (err) {
      await showToast(Toast.Style.Failure, t("toastSaveFailed"), errorText(err));
      return false;
    }
  };

  const handleOpenAddForm = async () => {
    if (!(await ensureWritable())) return;
    push(() =>
      CreateAccountForm({
        onCreated: (item) => persist(current => [item, ...current])
      })
    );
  };

  const handleReload = () => setReloadSeq((n) => n + 1);

  // 从剪贴板读取 otpauth:// 链接直接保存，省去打开表单再粘贴的一步；剪贴板里不是链接或解析失败时如实提示，不写入
  const handleImportFromClipboard = async () => {
    if (!(await ensureWritable())) return;
    let text: string;
    try {
      text = String((await Clipboard.readText()) ?? "").trim();
    } catch (err) {
      await showToast(Toast.Style.Failure, t("toastReadClipboardFailed"), errorText(err));
      return;
    }
    if (!text.toLowerCase().startsWith("otpauth://")) {
      await showToast(Toast.Style.Failure, t("toastNoOtpauthInClipboard"), t("toastNoOtpauthDesc"));
      return;
    }
    let account: AuthAccount;
    try {
      const parsed = parseOTPAuthURL(text);
      account = createAccount({
        name: parsed.name,
        issuer: parsed.issuer,
        secret: parsed.secret,
        digits: parsed.digits,
        period: parsed.period,
        algorithm: parsed.algorithm
      });
    } catch (err) {
      await showToast(Toast.Style.Failure, t("toastParseClipboardFailed"), errorText(err));
      return;
    }
    if (await persist(current => [account, ...current])) {
      await showToast(Toast.Style.Success, t("toastAccountAddedSimple", { name: account.name }));
    }
  };

  const addAction = () =>
    Action({
      title: t("addAccountAction"),
      icon: Icon.Plus,
      onAction: handleOpenAddForm
    });
  const importAction = () =>
    Action({
      title: t("importClipboardAction"),
      icon: Icon.CopyClipboard,
      onAction: handleImportFromClipboard
    });

  const handleDeleteAccount = async (id: string, name: string) => {
    if (!(await ensureWritable())) return;
    const confirmed = await confirmAlert({
      title: t("confirmDeleteTitle", { name }),
      message: t("confirmDeleteMsg"),
      primaryAction: { title: t("confirmDeleteAction"), style: "destructive" },
      dismissAction: { title: t("confirmCancel") }
    });
    if (!confirmed) return;
    if (await persist(current => current.filter((acc) => acc.id !== id))) {
      await showToast(Toast.Style.Success, t("toastDeletedAccount", { name }));
    }
  };

  // 复制时按当下时间重新计算，避免在刷新边界复制到刚过期的口令
  const handleCopyCode = async (account: AuthAccount) => {
    let code: string;
    try {
      code = generateTOTP(account.secret, { period: account.period, digits: account.digits, algorithm: account.algorithm });
    } catch (err) {
      await showToast(Toast.Style.Failure, t("toastGenCodeFailed"), errorText(err));
      return;
    }
    try {
      await Clipboard.copy(code);
    } catch (err) {
      await showToast(Toast.Style.Failure, t("toastCopyFailed"), errorText(err));
      return;
    }
    await showToast(
      Toast.Style.Success,
      t("toastCopiedCode", { name: account.name }),
      t("toastRefreshInSec", { sec: getRemainingSeconds(account.period) })
    );
  };

  // 密钥一旦进入剪贴板，可能被剪贴板历史或其他程序记录，复制前确认
  const handleCopySecret = async (account: AuthAccount) => {
    const confirmed = await confirmAlert({
      title: t("confirmCopySecretTitle", { name: account.name }),
      message: t("confirmCopySecretMsg"),
      primaryAction: { title: t("confirmCopySecretAction") },
      dismissAction: { title: t("confirmCancel") }
    });
    if (!confirmed) return;
    try {
      await Clipboard.copy(account.secret);
    } catch (err) {
      await showToast(Toast.Style.Failure, t("toastCopyFailed"), errorText(err));
      return;
    }
    await showToast(Toast.Style.Success, t("toastCopiedSecret"), t("toastClearClipboardHint"));
  };

  const reloadAction = () =>
    Action({
      title: t("reloadAction"),
      icon: Icon.Repeat,
      onAction: handleReload
    });

  // 列表为空时的占位项：按读取状态说明原因，读取失败或数据损坏时不显示「还没有 2FA 账号」误导用户
  const emptyItem = () => {
    if (load.status === "loading") {
      return List.Item({
        id: "empty-auth",
        title: t("emptyLoadingTitle"),
        subtitle: t("emptyLoadingSubtitle"),
        icon: Icon.Document
      });
    }
    if (load.status === "error") {
      return List.Item({
        id: "empty-auth",
        title: t("emptyErrorTitle"),
        subtitle: t("emptyErrorSubtitle", { message: load.message }),
        icon: Icon.Document,
        actions: ActionPanel({ title: t("actionsPanelTitle") }, [reloadAction()])
      });
    }
    if (load.status === "readonly" && accounts.length === 0) {
      return List.Item({
        id: "empty-auth",
        title: t("emptyReadonlyTitle"),
        subtitle: load.reason,
        icon: Icon.Document,
        actions: ActionPanel({ title: t("actionsPanelTitle") }, [reloadAction()])
      });
    }
    if (load.status === "damaged" && accounts.length === 0) {
      return List.Item({
        id: "empty-auth",
        title: t("emptyDamagedTitle"),
        subtitle: load.backupKey
          ? t("emptyDamagedSubtitleSaved", { key: load.backupKey })
          : t("emptyDamagedSubtitleUnsaved"),
        icon: Icon.Document,
        actions: ActionPanel({ title: t("actionsPanelTitle") }, [
          reloadAction(),
          Action({
            title: t("discardAndAddAction"),
            icon: Icon.Plus,
            onAction: handleOpenAddForm
          })
        ])
      });
    }
    return List.Item({
      id: "empty-auth",
      title: accounts.length === 0 ? t("emptyNoAccountsTitle") : t("emptyNoMatchTitle"),
      subtitle: accounts.length === 0 ? t("emptyNoAccountsSub") : t("emptyNoMatchSub"),
      icon: Icon.Document,
      actions: ActionPanel({ title: t("actionsPanelTitle") }, [addAction(), importAction()])
    });
  };

  return List(
    {
      navigationTitle: t("navTitle"),
      searchBarPlaceholder: t("searchPlaceholder"),
      searchText: searchQuery,
      onSearchTextChange: (val) => setSearchQuery(val),
      actions: ActionPanel({ title: t("globalActionsTitle") }, [
        addAction(),
        importAction(),
        Action({
          title: t("refreshTokensAction"),
          icon: Icon.Repeat,
          onAction: () => setTick((prev) => prev + 1)
        })
      ])
    },
    [
      List.Section(
        {
          title:
            load.status === "readonly"
              ? t("sectionTitleReadonly", { count: filtered.length, reason: load.reason })
              : t("sectionTitleNormal", { count: filtered.length })
        },
        filtered.length > 0
          ? filtered.map((account) => {
              const remaining = getRemainingSeconds(account.period);
              let token = "";
              let tokenError = "";
              try {
                token = generateTOTP(account.secret, {
                  period: account.period,
                  digits: account.digits,
                  algorithm: account.algorithm
                });
              } catch (err) {
                tokenError = errorText(err) || t("invalidSecretLabel");
              }
              const displayToken = tokenError ? t("invalidSecretLabel") : formatToken(token);

              return List.Item({
                id: account.id,
                title: `${account.name}  —  ${displayToken}`,
                subtitle: tokenError || account.issuer || undefined,
                icon: Icon.Shield,
                accessories: [
                  {
                    text: t("refreshInSecAccessory", { sec: remaining })
                  },
                  {
                    text: t("algoDigitsAccessory", { algo: account.algorithm, digits: account.digits })
                  }
                ],
                actions: ActionPanel({ title: t("itemActionsTitle", { name: account.name }) }, [
                  // 密钥无效时没有口令可复制，不提供复制动作，避免复制空内容还提示成功
                  ...(tokenError
                    ? []
                    : [
                        Action({
                          title: t("copyTokenAction"),
                          icon: Icon.CopyClipboard,
                          onAction: () => handleCopyCode(account)
                        })
                      ]),
                  Action({
                    title: t("addNewAccountAction"),
                    icon: Icon.Plus,
                    onAction: handleOpenAddForm
                  }),
                  Action({
                    title: t("copySecretAction"),
                    icon: Icon.Key,
                    onAction: () => handleCopySecret(account)
                  }),
                  Action({
                    title: t("deleteAccountAction"),
                    icon: Icon.Trash,
                    onAction: () => handleDeleteAccount(account.id, account.name)
                  })
                ])
              });
            })
          : [emptyItem()]
      )
    ]
  );
}
