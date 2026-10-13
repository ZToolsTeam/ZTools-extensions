import React, {
  List,
  Detail,
  Form,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  useNavigation,
  useState
} from "@ztools/raycast-compat";
import { generateQrSvg, type QrErrorCorrectionLevel } from "./qr-generator.js";

export * from "./qr-generator.js";

export interface QrItem {
  id: string;
  title: string;
  content: string;
  level: QrErrorCorrectionLevel;
  createdAt: string;
}

const INITIAL_ITEMS: QrItem[] = [
  {
    id: "qr-1",
    title: "ZTools 官方主页",
    content: "https://ztools.dev",
    level: "M",
    createdAt: new Date().toLocaleTimeString()
  },
  {
    id: "qr-2",
    title: "Raycast API 规范",
    content: "https://developers.raycast.com",
    level: "H",
    createdAt: new Date().toLocaleTimeString()
  }
];

/**
 * 二维码详情视图 (现代纯正 TSX 模式)
 */
export function QrDetailView({ item }: { item: QrItem }) {
  const { svg, dataUrl } = generateQrSvg(item.content, {
    size: 280,
    errorCorrectionLevel: item.level
  });

  const isUrl = /^https?:\/\//i.test(item.content);

  const markdown = `
# ${item.title}

![二维码](${dataUrl})

**内容文本：**
\`\`\`
${item.content}
\`\`\`
  `;

  return (
    <Detail
      markdown={markdown}
      navigationTitle={item.title}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="字符长度" text={`${item.content.length} 字符`} icon={Icon.Text} />
          <Detail.Metadata.Label title="纠错级别" text={`Level ${item.level}`} icon={Icon.Key} />
          <Detail.Metadata.Label title="生成时间" text={item.createdAt} icon={Icon.Clock} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title="类型">
            <Detail.Metadata.TagList.Item
              text={isUrl ? "Web URL" : "Plain Text"}
              color={isUrl ? Color.Blue : Color.Green}
              icon={isUrl ? Icon.Globe : Icon.Document}
            />
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title="二维码操作">
          <Action.CopyToClipboard title="复制二维码 SVG" content={svg} icon={Icon.CopyClipboard} />
          <Action.CopyToClipboard title="复制文本内容" content={item.content} icon={Icon.Clipboard} />
          {isUrl && (
            <Action.OpenInBrowser title="在浏览器中打开" url={item.content} icon={Icon.Globe} />
          )}
        </ActionPanel>
      }
    />
  );
}

/**
 * 新建二维码表单视图 (现代纯正 TSX 模式)
 */
export function CreateQrForm({ onCreated }: { onCreated: (newItem: QrItem) => void }) {
  const { pop } = useNavigation();
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<QrErrorCorrectionLevel>("M");

  const handleSubmit = async (values: Record<string, any>) => {
    const text = values?.qrText || content;
    const itemTitle = values?.qrTitle || title || (text.slice(0, 16) + "...");

    if (!text || !text.trim()) {
      await showToast(Toast.Style.Failure, "请输入内容");
      return;
    }

    const newItem: QrItem = {
      id: "qr-" + Date.now(),
      title: itemTitle,
      content: text.trim(),
      level: (values?.level as QrErrorCorrectionLevel) || level,
      createdAt: new Date().toLocaleTimeString()
    };

    onCreated(newItem);
    await showToast(Toast.Style.Success, "二维码创建成功");
    pop();
  };

  return (
    <Form
      navigationTitle="新建二维码"
      actions={
        <ActionPanel title="创建操作">
          <Action.SubmitForm
            title="立即生成二维码"
            icon={Icon.QrCode}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="qrTitle"
        title="标题"
        placeholder="输入二维码标题（选填）..."
        value={title}
        onChange={(v) => setTitle(v)}
      />
      <Form.TextArea
        id="qrText"
        title="文本 / URL"
        placeholder="输入或粘贴待生成二维码的文本或 URL..."
        value={content}
        onChange={(v) => setContent(v)}
      />
      <Form.Dropdown
        id="level"
        title="纠错级别"
        value={level}
        onChange={(v) => setLevel(v as QrErrorCorrectionLevel)}
      >
        <Form.Dropdown.Item title="Low (7%)" value="L" />
        <Form.Dropdown.Item title="Medium (15%)" value="M" />
        <Form.Dropdown.Item title="Quartile (25%)" value="Q" />
        <Form.Dropdown.Item title="High (30%)" value="H" />
      </Form.Dropdown>
    </Form>
  );
}

/**
 * 二维码管理主命令组件 (现代纯正 TSX 模式)
 */
export default function QrCodeCommand() {
  const [items, setItems] = useState<QrItem[]>(INITIAL_ITEMS);
  const [searchText, setSearchText] = useState("");
  const { push } = useNavigation();

  const filteredItems = items.filter(
    (item) =>
      item.title.toLowerCase().includes(searchText.toLowerCase()) ||
      item.content.toLowerCase().includes(searchText.toLowerCase())
  );

  const handlePasteClipboard = async () => {
    const text = await Clipboard.readText();
    if (!text) {
      await showToast(Toast.Style.Failure, "剪贴板为空");
      return;
    }
    const newItem: QrItem = {
      id: "qr-" + Date.now(),
      title: "剪贴板二维码",
      content: text,
      level: "M",
      createdAt: new Date().toLocaleTimeString()
    };
    setItems((prev) => [newItem, ...prev]);
    await showToast(Toast.Style.Success, "已根据剪贴板快速生成二维码");
  };

  const handleOpenCreate = () => {
    push(() => (
      <CreateQrForm
        onCreated={(item) => {
          setItems((prev) => [item, ...prev]);
        }}
      />
    ));
  };

  return (
    <List
      navigationTitle="二维码生成器"
      searchBarPlaceholder="搜索二维码历史..."
      searchText={searchText}
      onSearchTextChange={(txt) => setSearchText(txt)}
      actions={
        <ActionPanel title="全局操作">
          <Action title="新建二维码" icon={Icon.Plus} onAction={handleOpenCreate} />
          <Action title="从剪贴板创建" icon={Icon.Clipboard} onAction={handlePasteClipboard} />
        </ActionPanel>
      }
    >
      <List.Section title={`二维码历史 (${filteredItems.length})`}>
        {filteredItems.map((item) => {
          const isUrl = /^https?:\/\//i.test(item.content);
          return (
            <List.Item
              key={item.id}
              id={item.id}
              title={item.title}
              subtitle={item.content}
              icon={Icon.QrCode}
              accessories={[
                { text: `Level ${item.level}` },
                { text: item.createdAt }
              ]}
              actions={
                <ActionPanel title={item.title}>
                  <Action.Push
                    title="查看二维码详情"
                    icon={Icon.Eye}
                    target={() => <QrDetailView item={item} />}
                  />
                  <Action.CopyToClipboard
                    title="复制文本内容"
                    content={item.content}
                    icon={Icon.CopyClipboard}
                  />
                  {isUrl && (
                    <Action.OpenInBrowser
                      title="在浏览器中打开"
                      url={item.content}
                      icon={Icon.Globe}
                    />
                  )}
                  <Action
                    title="新建二维码"
                    icon={Icon.Plus}
                    onAction={handleOpenCreate}
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}
