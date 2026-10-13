import React, {
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
import { validateJson, formatJson, minifyJson, jsonToTsInterface } from "./logic.js";

export * from "./logic.js";

const DEFAULT_SAMPLE_JSON = JSON.stringify(
  {
    name: "ZTools Platform",
    version: "1.0.0",
    features: ["Declarative UI", "Raycast Compat", "Fluent Styling"],
    author: {
      team: "ZTools Core",
      verified: true
    }
  },
  null,
  2
);

/**
 * 查看转换结果的二级详情页 (现代纯正 TSX 模式)
 */
export function JsonDetailView({
  formatted,
  tsInterface,
  stats
}: {
  formatted: string;
  tsInterface: string;
  stats?: { keys: number; depth: number; byteSize: number };
}) {
  const markdown = `
# 格式化与类型推导结果

## 格式化 JSON
\`\`\`json
${formatted}
\`\`\`

## 自动生成的 TypeScript Interface
\`\`\`typescript
${tsInterface}
\`\`\`
  `;

  return (
    <Detail
      markdown={markdown}
      navigationTitle="JSON 格式化详情"
      metadata={
        stats ? (
          <Detail.Metadata>
            <Detail.Metadata.Label title="键数量" text={String(stats.keys)} icon={Icon.Key} />
            <Detail.Metadata.Label title="最大层级" text={String(stats.depth)} icon={Icon.Pin} />
            <Detail.Metadata.Label title="文件大小" text={`${stats.byteSize} Bytes`} icon={Icon.Document} />
            <Detail.Metadata.Separator />
            <Detail.Metadata.TagList title="状态">
              <Detail.Metadata.TagList.Item text="语法合法" color={Color.Green} icon={Icon.Check} />
            </Detail.Metadata.TagList>
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel title="操作面板">
          <Action.CopyToClipboard
            title="复制格式化 JSON"
            content={formatted}
            icon={Icon.CopyClipboard}
          />
          <Action.CopyToClipboard
            title="复制 TypeScript Interface"
            content={tsInterface}
            icon={Icon.Code}
          />
          <Action.CopyToClipboard
            title="复制压缩单行 JSON"
            content={minifyJson(formatted)}
            icon={Icon.Document}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * JSON 格式化与校验主命令组件 (现代纯正 TSX 模式)
 */
export default function JsonFormatCommand() {
  const [jsonText, setJsonText] = useState(DEFAULT_SAMPLE_JSON);
  const [indent, setIndent] = useState<number>(2);
  const { push } = useNavigation();

  const validation = validateJson(jsonText);
  const formatted = validation.valid ? formatJson(jsonText, indent) : "";
  const tsInterface = validation.valid ? jsonToTsInterface(jsonText) : "";

  const handleSubmit = async (values: Record<string, any>) => {
    const text = values?.jsonInput || jsonText;
    const res = validateJson(text);
    if (!res.valid) {
      await showToast(Toast.Style.Failure, "JSON 语法错误", res.error);
      return;
    }

    const fmt = formatJson(text, indent);
    const ts = jsonToTsInterface(text);

    await showToast(Toast.Style.Success, "格式化完成");
    push(() => <JsonDetailView formatted={fmt} tsInterface={ts} stats={res.stats} />);
  };

  const handleLoadClipboard = async () => {
    const text = await Clipboard.readText();
    if (text) {
      setJsonText(text);
      await showToast(Toast.Style.Success, "已从剪贴板读取并填充");
    } else {
      await showToast(Toast.Style.Failure, "剪贴板为空");
    }
  };

  return (
    <Form
      navigationTitle="JSON 格式化与类型转换"
      actions={
        <ActionPanel title="快捷动作">
          <Action.SubmitForm
            title="格式化并查看详情"
            icon={Icon.Eye}
            onSubmit={handleSubmit}
          />
          <Action
            title="从剪贴板粘贴"
            icon={Icon.Clipboard}
            onAction={handleLoadClipboard}
          />
          <Action.CopyToClipboard
            title="复制格式化结果"
            content={formatted}
            icon={Icon.CopyClipboard}
          />
          <Action.CopyToClipboard
            title="复制 TypeScript Interface"
            content={tsInterface}
            icon={Icon.Code}
          />
          <Action
            title={indent === 2 ? "切换为 4 格缩进" : "切换为 2 格缩进"}
            icon={Icon.Repeat}
            onAction={() => setIndent(indent === 2 ? 4 : 2)}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="jsonInput"
        title="JSON 输入"
        placeholder="在此粘贴或输入待校验/格式化的 JSON 内容..."
        value={jsonText}
        onChange={(val) => setJsonText(val)}
        error={validation.valid ? undefined : validation.error}
      />
      <Form.Dropdown
        id="indentType"
        title="缩进风格"
        value={String(indent)}
        onChange={(v) => setIndent(Number(v))}
      >
        <Form.Dropdown.Item title="2 空格缩进" value="2" />
        <Form.Dropdown.Item title="4 空格缩进" value="4" />
      </Form.Dropdown>
    </Form>
  );
}
