import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  useState,
  useNavigation
} from "@ztools/declarative-ui";
import {
  calculateMultiHash,
  decodeBase64,
  aesEncrypt,
  aesDecrypt,
  calculateHmac,
  type HashAlgorithm,
  type MultiHashResult
} from "./logic.js";

interface HashDisplayItem {
  id: string;
  title: string;
  subtitle: string;
  value: string;
  icon: any;
}

type Mode = "hash" | "base64-decode";

/**
 * AES-256-CBC 加解密表单：结果直接显示在表单底部，可复制
 */
export function AesForm() {
  const { pop } = useNavigation();
  const [direction, setDirection] = useState<"encrypt" | "decrypt">("encrypt");
  const [text, setText] = useState("");
  const [key, setKey] = useState("");
  const [iv, setIv] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const run = async () => {
    setError(undefined);
    const res = direction === "encrypt"
      ? await aesEncrypt(text, key, { iv: iv || undefined })
      : await aesDecrypt(text, key, { iv: iv || undefined });
    if (!res.success) {
      setResult("");
      setError(res.error);
      await showToast(Toast.Style.Failure, direction === "encrypt" ? "加密失败" : "解密失败", res.error);
      return;
    }
    setResult(res.result || "");
    await showToast(Toast.Style.Success, direction === "encrypt" ? "加密完成" : "解密完成");
  };

  return Form(
    {
      navigationTitle: "AES-256-CBC 加解密",
      actions: ActionPanel({ title: "AES" }, [
        Action.SubmitForm({ title: direction === "encrypt" ? "加密" : "解密", icon: Icon.Lock, onSubmit: run }),
        ...(result
          ? [Action.CopyToClipboard({ title: "复制结果", content: result, icon: Icon.CopyClipboard })]
          : []),
        Action({ title: "返回", icon: Icon.ArrowLeft, onAction: () => pop() })
      ])
    },
    [
      Form.Dropdown(
        { id: "direction", title: "操作", value: direction, onChange: (v: string) => { setDirection(v as "encrypt" | "decrypt"); setResult(""); setError(undefined); } },
        [
          Form.Dropdown.Item({ title: "加密：明文 → Base64 密文", value: "encrypt" }),
          Form.Dropdown.Item({ title: "解密：Base64 密文 → 明文", value: "decrypt" })
        ]
      ),
      Form.TextArea({
        id: "text",
        title: direction === "encrypt" ? "明文" : "密文",
        placeholder: direction === "encrypt" ? "要加密的文字" : "粘贴 Base64 密文",
        value: text,
        error,
        onChange: (v: string) => { setText(v); setError(undefined); }
      }),
      Form.PasswordField({ id: "key", title: "口令", placeholder: "加密和解密必须使用同一个口令", value: key, onChange: (v: string) => setKey(v) }),
      Form.TextField({ id: "iv", title: "IV（可选）", placeholder: "留空则由口令派生", value: iv, onChange: (v: string) => setIv(v) }),
      Form.Description({ title: "结果", text: result || "填写后按回车执行" })
    ]
  );
}

/**
 * HMAC 计算表单：输入或口令变化时实时计算
 */
export function HmacForm() {
  const { pop } = useNavigation();
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>("sha256");
  const [text, setText] = useState("");
  const [key, setKey] = useState("");
  const value = calculateHmac(algorithm, text, key);

  return Form(
    {
      navigationTitle: "HMAC 计算",
      actions: ActionPanel({ title: "HMAC" }, [
        Action.CopyToClipboard({ title: "复制 HMAC", content: value, icon: Icon.CopyClipboard }),
        Action({ title: "返回", icon: Icon.ArrowLeft, onAction: () => pop() })
      ])
    },
    [
      Form.Dropdown(
        { id: "algorithm", title: "算法", value: algorithm, onChange: (v: string) => setAlgorithm(v as HashAlgorithm) },
        [
          Form.Dropdown.Item({ title: "HMAC-SHA256", value: "sha256" }),
          Form.Dropdown.Item({ title: "HMAC-SHA512", value: "sha512" }),
          Form.Dropdown.Item({ title: "HMAC-SHA1", value: "sha1" }),
          Form.Dropdown.Item({ title: "HMAC-MD5", value: "md5" })
        ]
      ),
      Form.TextArea({ id: "text", title: "消息", placeholder: "要签名的文字", value: text, onChange: (v: string) => setText(v) }),
      Form.PasswordField({ id: "key", title: "密钥", placeholder: "HMAC 密钥", value: key, onChange: (v: string) => setKey(v) }),
      Form.Description({ title: "结果（十六进制）", text: value })
    ]
  );
}

export default function CryptoToolCommand() {
  const [inputText, setInputText] = useState<string>("");
  const [mode, setMode] = useState<Mode>("hash");
  const { push } = useNavigation();

  const globalActions = [
    Action({ title: "AES 加解密…", icon: Icon.Lock, onAction: () => push(() => AesForm()) }),
    Action({ title: "HMAC 计算…", icon: Icon.Key, onAction: () => push(() => HmacForm()) })
  ];

  const commonItemActions = (value: string, label: string) =>
    ActionPanel({ title: label }, [
      Action.CopyToClipboard({ title: "复制", content: value, icon: Icon.CopyClipboard }),
      ...globalActions,
      Action({ title: "清空输入", icon: Icon.Trash, onAction: () => setInputText("") })
    ]);

  let items: any[];
  if (mode === "base64-decode") {
    const decoded = decodeBase64(inputText);
    items = !inputText.trim()
      ? [List.Item({ id: "empty", title: "在上方粘贴 Base64 字符串", subtitle: "支持标准与 URL-safe 两种写法", icon: Icon.Text, actions: ActionPanel({ title: "操作" }, globalActions) })]
      : decoded.success
        ? [List.Item({ id: "decoded", title: decoded.result || "（空文本）", subtitle: "Base64 解码结果（UTF-8）", icon: Icon.Text, accessories: [{ text: `${(decoded.result || "").length} 字符` }], actions: commonItemActions(decoded.result || "", "解码结果") })]
        : [List.Item({ id: "decode-error", title: "无法解码", subtitle: decoded.error, icon: Icon.ExclamationMark, actions: ActionPanel({ title: "操作" }, globalActions) })];
  } else if (!inputText) {
    items = [
      List.Item({
        id: "empty",
        title: "在上方输入文字，实时计算 MD5 / SHA / Base64",
        subtitle: "AES 加解密和 HMAC 请按 Ctrl+K 打开动作面板",
        icon: Icon.Key,
        actions: ActionPanel({ title: "操作" }, globalActions)
      })
    ];
  } else {
    const multiHash: MultiHashResult = calculateMultiHash(inputText);
    const hashItems: HashDisplayItem[] = [
      { id: "md5-lower", title: multiHash.md5, subtitle: "MD5（32 位小写）", value: multiHash.md5, icon: Icon.Key },
      { id: "md5-upper", title: multiHash.md5Upper, subtitle: "MD5（32 位大写）", value: multiHash.md5Upper, icon: Icon.Key },
      { id: "md5-16", title: multiHash.md5_16, subtitle: "MD5（16 位）", value: multiHash.md5_16, icon: Icon.Key },
      { id: "sha1", title: multiHash.sha1, subtitle: "SHA-1", value: multiHash.sha1, icon: Icon.Lock },
      { id: "sha256", title: multiHash.sha256, subtitle: "SHA-256", value: multiHash.sha256, icon: Icon.Lock },
      { id: "sha512", title: multiHash.sha512, subtitle: "SHA-512", value: multiHash.sha512, icon: Icon.Lock },
      { id: "base64", title: multiHash.base64, subtitle: "Base64 编码", value: multiHash.base64, icon: Icon.Text },
      { id: "url-encoded", title: multiHash.urlEncoded, subtitle: "URL 编码", value: multiHash.urlEncoded, icon: Icon.Globe }
    ];
    items = hashItems.map((item) =>
      List.Item({
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        icon: item.icon,
        accessories: [{ text: `${item.value.length} 字符` }],
        actions: commonItemActions(item.value, item.subtitle)
      })
    );
  }

  return List(
    {
      navigationTitle: "加解密与散列助手",
      searchBarPlaceholder: mode === "hash" ? "输入要计算散列或编码的文字..." : "粘贴要解码的 Base64...",
      searchText: inputText,
      onSearchTextChange: (text: string) => setInputText(text),
      searchBarAccessory: List.Dropdown(
        { tooltip: "模式", value: mode, onChange: (v: string) => setMode(v as Mode) },
        [
          List.Dropdown.Item({ title: "散列与编码", value: "hash" }),
          List.Dropdown.Item({ title: "Base64 解码", value: "base64-decode" })
        ]
      ),
      actions: ActionPanel({ title: "全局操作" }, globalActions)
    },
    [List.Section({ title: mode === "hash" ? `散列与编码（输入 ${inputText.length} 字符）` : "Base64 解码" }, items)]
  );
}
