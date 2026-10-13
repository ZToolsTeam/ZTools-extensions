import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  useState
} from "@ztools/raycast-compat";
import {
  calculateMultiHash,
  type MultiHashResult
} from "./logic.js";

interface HashDisplayItem {
  id: string;
  title: string;
  subtitle: string;
  value: string;
  icon: any;
}

export default function CryptoToolCommand() {
  const [inputText, setInputText] = useState<string>("Hello ZTools");

  const multiHash: MultiHashResult = calculateMultiHash(inputText);

  const hashItems: HashDisplayItem[] = [
    {
      id: "md5-lower",
      title: multiHash.md5,
      subtitle: "MD5 (32位小写)",
      value: multiHash.md5,
      icon: Icon.Key
    },
    {
      id: "md5-upper",
      title: multiHash.md5Upper,
      subtitle: "MD5 (32位大写)",
      value: multiHash.md5Upper,
      icon: Icon.Key
    },
    {
      id: "md5-16",
      title: multiHash.md5_16,
      subtitle: "MD5 (16位中截小写)",
      value: multiHash.md5_16,
      icon: Icon.Key
    },
    {
      id: "sha1",
      title: multiHash.sha1,
      subtitle: "SHA-1 (40位摘要)",
      value: multiHash.sha1,
      icon: Icon.Lock
    },
    {
      id: "sha256",
      title: multiHash.sha256,
      subtitle: "SHA-256 (64位高安全散列)",
      value: multiHash.sha256,
      icon: Icon.Checkmark
    },
    {
      id: "sha512",
      title: multiHash.sha512,
      subtitle: "SHA-512 (128位长散列)",
      value: multiHash.sha512,
      icon: Icon.Shield
    },
    {
      id: "base64",
      title: multiHash.base64,
      subtitle: "Base64 编码",
      value: multiHash.base64,
      icon: Icon.Text
    },
    {
      id: "url-encoded",
      title: multiHash.urlEncoded,
      subtitle: "URL Percent-Encoded",
      value: multiHash.urlEncoded,
      icon: Icon.Globe
    }
  ];

  const handleCopy = async (val: string, label: string) => {
    await Clipboard.copy(val);
    await showToast(Toast.Style.Success, `已复制 ${label}`);
  };

  return List(
    {
      navigationTitle: "哈希与加密工具",
      searchBarPlaceholder: "输入欲计算散列或编码的文本...",
      searchText: inputText,
      onSearchTextChange: (text: string) => setInputText(text)
    },
    [
      List.Section(
        { title: `多散列与编码对比 (输入长度: ${inputText.length} 字符)` },
        hashItems.map((item) =>
          List.Item({
            id: item.id,
            title: item.title,
            subtitle: item.subtitle,
            icon: item.icon,
            accessories: [
              { text: `${item.value.length} 字符` }
            ],
            actions: ActionPanel({ title: item.subtitle }, [
              Action.CopyToClipboard({
                title: "复制该哈希/编码值",
                content: item.value,
                icon: Icon.CopyClipboard
              }),
              Action.CopyToClipboard({
                title: "复制原始文本",
                content: inputText,
                icon: Icon.Document
              }),
              Action({
                title: "清空输入框",
                icon: Icon.Trash,
                onAction: () => setInputText("")
              })
            ])
          })
        )
      )
    ]
  );
}
