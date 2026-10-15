import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  useNavigation,
  useState,
  useEffect
} from "@ztools/declarative-ui";
import {
  createAccount,
  generateTOTP,
  formatToken,
  getRemainingSeconds,
  filterAccounts,
  parseOTPAuthURL,
  DEFAULT_ACCOUNTS,
  type AuthAccount,
  type OTPAlgorithm
} from "./logic.js";

/**
 * 添加 2FA 账号表单视图
 */
export function CreateAccountForm({ onCreated }: { onCreated: (account: AuthAccount) => void }) {
  const { pop } = useNavigation();
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [secret, setSecret] = useState("");
  const [digits, setDigits] = useState("6");
  const [period, setPeriod] = useState("30");
  const [algorithm, setAlgorithm] = useState<OTPAlgorithm>("SHA1");
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSecretChange = (val: string) => {
    setSecret(val);
    if (error) setError(undefined);

    // 智能识别 otpauth:// 协议链接
    if (val.trim().toLowerCase().startsWith("otpauth://")) {
      try {
        const parsed = parseOTPAuthURL(val);
        setName(parsed.name);
        setIssuer(parsed.issuer);
        setSecret(parsed.secret);
        setDigits(String(parsed.digits));
        setPeriod(String(parsed.period));
        setAlgorithm(parsed.algorithm);
        showToast(Toast.Style.Success, "成功解析 otpauth:// 链接配置");
      } catch {
        // 保持原输入由提交时验证
      }
    }
  };

  const handleSubmit = async (values: Record<string, any>) => {
    const accountName = values.name || name;
    const accountIssuer = values.issuer || issuer;
    let accountSecret = values.secret || secret;
    const accountDigits = parseInt(values.digits || digits, 10);
    const accountPeriod = parseInt(values.period || period, 10);
    const accountAlgo = (values.algorithm || algorithm) as OTPAlgorithm;

    if (!accountName || !accountName.trim()) {
      setError("请输入账号标签或名称");
      await showToast(Toast.Style.Failure, "请输入账号名称");
      return;
    }

    if (!accountSecret || !accountSecret.trim()) {
      setError("请输入 Base32 密钥");
      await showToast(Toast.Style.Failure, "请输入密钥");
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

      onCreated(newAccount);
      await showToast(Toast.Style.Success, `已成功添加账号 ${newAccount.name}`);
      pop();
    } catch (err: any) {
      setError(err.message);
      await showToast(Toast.Style.Failure, "添加失败", err.message);
    }
  };

  return Form(
    {
      navigationTitle: "添加 2FA 动态口令账号",
      actions: ActionPanel({ title: "表单操作" }, [
        Action.SubmitForm({
          title: "保存账号",
          icon: Icon.Check,
          onSubmit: handleSubmit
        }),
        Action({
          title: "返回列表",
          icon: Icon.ArrowLeft,
          onAction: () => pop()
        })
      ])
    },
    [
      Form.TextField({
        id: "name",
        title: "账号名称/邮箱",
        placeholder: "例如 octocat@github.com 或 admin",
        value: name,
        error,
        onChange: (val) => {
          setName(val);
          if (error) setError(undefined);
        }
      }),
      Form.TextField({
        id: "issuer",
        title: "服务商/签发者",
        placeholder: "例如 GitHub, Google, AWS, Cloudflare",
        value: issuer,
        onChange: (val) => setIssuer(val)
      }),
      Form.TextField({
        id: "secret",
        title: "Base32 密钥或 URL",
        placeholder: "输入密钥 (如 JBSWY3DPEHPK3PXP) 或粘贴 otpauth:// 链接",
        value: secret,
        onChange: handleSecretChange
      }),
      Form.Dropdown(
        {
          id: "digits",
          title: "口令位数",
          value: digits,
          onChange: (val) => setDigits(val)
        },
        [
          Form.Dropdown.Item({ title: "6 位口令 (标准推荐)", value: "6" }),
          Form.Dropdown.Item({ title: "8 位口令", value: "8" })
        ]
      ),
      Form.Dropdown(
        {
          id: "period",
          title: "刷新周期",
          value: period,
          onChange: (val) => setPeriod(val)
        },
        [
          Form.Dropdown.Item({ title: "30 秒 (标准 RFC 6238)", value: "30" }),
          Form.Dropdown.Item({ title: "60 秒", value: "60" })
        ]
      ),
      Form.Dropdown(
        {
          id: "algorithm",
          title: "哈希加密算法",
          value: algorithm,
          onChange: (val) => setAlgorithm(val as OTPAlgorithm)
        },
        [
          Form.Dropdown.Item({ title: "SHA1 (兼容绝大多数平台)", value: "SHA1" }),
          Form.Dropdown.Item({ title: "SHA256", value: "SHA256" }),
          Form.Dropdown.Item({ title: "SHA512", value: "SHA512" })
        ]
      )
    ]
  );
}

/**
 * 2FA 动态口令验证器主入口
 */
export default function GoogleAuthCommand() {
  const [accounts, setAccounts] = useState<AuthAccount[]>(DEFAULT_ACCOUNTS);
  const [searchQuery, setSearchQuery] = useState("");
  const [tick, setTick] = useState(0);
  const { push } = useNavigation();

  // 1 秒心跳定时器刷新倒计时与动态口令
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const filtered = filterAccounts(accounts, searchQuery);

  const handleOpenAddForm = () => {
    push(() =>
      CreateAccountForm({
        onCreated: (item) => {
          setAccounts((prev) => [item, ...prev]);
        }
      })
    );
  };

  const handleDeleteAccount = async (id: string, name: string) => {
    setAccounts((prev) => prev.filter((acc) => acc.id !== id));
    await showToast(Toast.Style.Success, `已删除账号 ${name}`);
  };

  const handleCopyCode = async (code: string, name: string) => {
    await Clipboard.copy(code);
    await showToast(Toast.Style.Success, `已复制 ${name} 动态口令: ${code}`);
  };

  return List(
    {
      navigationTitle: "2FA 动态口令验证器",
      searchBarPlaceholder: "搜索 2FA 账号名称或服务提供商...",
      searchText: searchQuery,
      onSearchTextChange: (val) => setSearchQuery(val),
      actions: ActionPanel({ title: "全局操作" }, [
        Action({
          title: "添加 2FA 账号",
          icon: Icon.Plus,
          onAction: handleOpenAddForm
        }),
        Action({
          title: "手动刷新口令",
          icon: Icon.Repeat,
          onAction: () => setTick((t) => t + 1)
        })
      ])
    },
    [
      List.Section(
        {
          title: `已配置账号 (${filtered.length})`
        },
        filtered.length > 0
          ? filtered.map((account) => {
              const remaining = getRemainingSeconds(account.period);
              let token = "000000";
              try {
                token = generateTOTP(account.secret, {
                  period: account.period,
                  digits: account.digits,
                  algorithm: account.algorithm
                });
              } catch (err: any) {
                token = "ERR";
              }
              const displayToken = formatToken(token);

              return List.Item({
                id: account.id,
                title: `${account.name}  —  ${displayToken}`,
                subtitle: account.issuer ? `[${account.issuer}]` : undefined,
                icon: Icon.Shield,
                accessories: [
                  {
                    text: `${remaining}s 刷新`
                  },
                  {
                    text: `${account.algorithm} • ${account.digits}位`
                  }
                ],
                actions: ActionPanel({ title: `${account.name} 动作` }, [
                  Action.CopyToClipboard({
                    title: `复制动态口令 (${token})`,
                    content: token,
                    icon: Icon.CopyClipboard
                  }),
                  Action({
                    title: "一键复制并提示",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopyCode(token, account.name)
                  }),
                  Action.CopyToClipboard({
                    title: "复制 Base32 密钥",
                    content: account.secret,
                    icon: Icon.Key
                  }),
                  Action({
                    title: "添加新账号",
                    icon: Icon.Plus,
                    onAction: handleOpenAddForm
                  }),
                  Action({
                    title: "删除该账号",
                    icon: Icon.Trash,
                    onAction: () => handleDeleteAccount(account.id, account.name)
                  })
                ])
              });
            })
          : [
              List.Item({
                id: "empty-auth",
                title: "未找到匹配的 2FA 账号",
                subtitle: "按回车或点此添加新的 2FA 认证账号",
                icon: Icon.Document,
                actions: ActionPanel({ title: "操作" }, [
                  Action({
                    title: "立即添加 2FA 账号",
                    icon: Icon.Plus,
                    onAction: handleOpenAddForm
                  })
                ])
              })
            ]
      )
    ]
  );
}
