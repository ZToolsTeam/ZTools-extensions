import React from "@ztools/declarative-ui";
import {
  Detail,
  Form,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  useNavigation
} from "@ztools/declarative-ui";
import { useMemo } from "@ztools/declarative-ui";
import {
  validateJson,
  formatJson,
  minifyJson,
  jsonToTsInterface,
  jsonToRustStruct,
  jsonToGoStruct,
  extractJsonPaths,
  fencedCode,
  JsonStats,
  JsonPathItem
} from "./logic.js";
import { usePopoutValue } from "./popout-state.js";

/** JSONPath 索引在详情页里只展示前 N 项，取值过长时截断（复制动作给全量） */
const PATH_PREVIEW_LIMIT = 15;
const PATH_VALUE_MAX = 60;

/** 等宽字体下的显示宽度：中日韩等全角字符占两格，用于对齐路径列 */
function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return w;
}

function pathIndexBlock(paths: JsonPathItem[]): string {
  const shown = paths.slice(0, PATH_PREVIEW_LIMIT);
  const width = Math.max(...shown.map((p) => displayWidth(p.path)));
  const lines = shown.map((p) => {
    const value = p.displayValue.length > PATH_VALUE_MAX ? p.displayValue.slice(0, PATH_VALUE_MAX) + "..." : p.displayValue;
    return `${p.path}${" ".repeat(width - displayWidth(p.path))}  ${p.type.padEnd(7)}  ${value}`;
  });
  return `## 常用 JSONPath 路径索引 (前 ${shown.length} 项)\n${fencedCode(lines.join("\n"), "text")}`;
}

/**
 * 查看转换结果的二级详情页 (展示 JSON、TypeScript、Rust、Go 及 JSONPath)
 */
export function JsonDetailView({
  formatted,
  tsInterface,
  rustStruct,
  goStruct,
  stats,
  jsonPaths
}: {
  formatted: string;
  tsInterface: string;
  rustStruct?: string;
  goStruct?: string;
  stats?: JsonStats;
  jsonPaths?: JsonPathItem[];
}) {
  const rustCode = rustStruct || jsonToRustStruct(formatted);
  const goCode = goStruct || jsonToGoStruct(formatted);
  const paths = jsonPaths || extractJsonPaths(formatted);

  // 用户数据可能含 ```（如大模型返回的代码片段），围栏长度按内容动态选择，避免代码块被提前截断
  const markdown = [
    "# JSON 瑞士军刀与全栈类型推导",
    "## 格式化 JSON",
    fencedCode(formatted, "json"),
    "## 自动生成的 TypeScript Interface",
    fencedCode(tsInterface, "typescript"),
    "## 自动生成的 Rust Struct (serde)",
    fencedCode(rustCode, "rust"),
    "## 自动生成的 Go Struct",
    fencedCode(goCode, "go"),
    ...(paths.length > 0 ? [pathIndexBlock(paths)] : [])
  ].join("\n\n");

  return (
    <Detail
      markdown={markdown}
      navigationTitle="JSON 格式化详情"
      metadata={
        stats ? (
          <Detail.Metadata>
            <Detail.Metadata.Label title="键数量" text={`${stats.keys} 个`} icon={Icon.Key} />
            <Detail.Metadata.Label title="最大层级" text={`${stats.depth} 层`} icon={Icon.Pin} />
            <Detail.Metadata.Label title="原始字节" text={`${stats.byteSize} Bytes`} icon={Icon.Document} />
            <Detail.Metadata.Label title="压缩体积" text={`${stats.minifiedSize} Bytes`} icon={Icon.Minus} />
            <Detail.Metadata.Label title="空间节省" text={`${stats.compressionRatio}%`} icon={Icon.Checkmark} />
            <Detail.Metadata.Separator />
            <Detail.Metadata.TagList title="语法校验">
              <Detail.Metadata.TagList.Item text="语法合法" color={Color.Green} icon={Icon.Check} />
            </Detail.Metadata.TagList>
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel title="操作面板">
          <Action.CopyToClipboard
            title="复制格式化 JSON (2 格)"
            content={formatted}
            icon={Icon.CopyClipboard}
          />
          <Action.CopyToClipboard
            title="复制 TypeScript Interface"
            content={tsInterface}
            icon={Icon.Code}
          />
          <Action.CopyToClipboard
            title="复制 Rust Struct"
            content={rustCode}
            icon={Icon.Terminal}
          />
          <Action.CopyToClipboard
            title="复制 Go Struct"
            content={goCode}
            icon={Icon.Globe}
          />
          <Action.CopyToClipboard
            title="复制压缩单行 JSON"
            content={minifyJson(formatted)}
            icon={Icon.Document}
          />
          {paths.length > 0 && (
            <Action.CopyToClipboard
              title="复制全部 JSONPath 列表"
              content={paths.map((p) => `${p.path} = ${p.displayValue}`).join("\n")}
              icon={Icon.List}
            />
          )}
        </ActionPanel>
      }
    />
  );
}

type IndentStyle = 2 | 4 | "tab";

const isText = (v: unknown): v is string => typeof v === "string";
const isIndentStyle = (v: unknown): v is IndentStyle => v === 2 || v === 4 || v === "tab";

/**
 * JSON 格式化与校验主命令组件
 */
export default function JsonFormatCommand() {
  // 输入与缩进风格随「独立窗口」一起带走；带来的值不合法（如旧版本存下的形状）时用默认值
  const [jsonText, setJsonText] = usePopoutValue("jsonText", () => "", isText);
  const [indent, setIndent] = usePopoutValue<IndentStyle>("indent", () => 2, isIndentStyle);
  const { push } = useNavigation();

  // 只在输入变化时重新校验与推导，避免切换缩进等重渲染时重复解析大段 JSON
  const derived = useMemo(() => {
    const validation = validateJson(jsonText);
    if (!validation.valid) return { validation, outputs: null };
    return {
      validation,
      outputs: {
        indent2: formatJson(jsonText, 2),
        indent4: formatJson(jsonText, 4),
        minified: minifyJson(jsonText),
        ts: jsonToTsInterface(jsonText),
        rust: jsonToRustStruct(jsonText),
        go: jsonToGoStruct(jsonText)
      }
    };
  }, [jsonText]);
  const { validation, outputs } = derived;

  const handleSubmit = async (values: Record<string, any>) => {
    const text = typeof values.jsonInput === "string" ? values.jsonInput : jsonText;
    const res = validateJson(text);
    if (!res.valid) {
      await showToast(Toast.Style.Failure, "JSON 语法错误", res.error);
      return;
    }

    const fmt = formatJson(text, indent);
    const ts = jsonToTsInterface(text);
    const rust = jsonToRustStruct(text);
    const go = jsonToGoStruct(text);
    const paths = extractJsonPaths(text);

    await showToast(Toast.Style.Success, "格式化与类型推导完成");
    push(() => (
      <JsonDetailView
        formatted={fmt}
        tsInterface={ts}
        rustStruct={rust}
        goStruct={go}
        stats={res.stats}
        jsonPaths={paths}
      />
    ));
  };

  const handleLoadClipboard = async () => {
    let text = "";
    try {
      text = await Clipboard.readText();
    } catch (err: any) {
      await showToast(Toast.Style.Failure, "读取剪贴板失败", err?.message || String(err));
      return;
    }
    if (!text || !text.trim()) {
      await showToast(Toast.Style.Failure, "剪贴板为空");
      return;
    }
    const res = validateJson(text);
    // 已有输入时只用合法 JSON 覆盖，避免误触把正在编辑的内容换成剪贴板里的无关文字
    if (!res.valid && jsonText.trim() && text !== jsonText) {
      await showToast(Toast.Style.Failure, "剪贴板不是合法 JSON，已保留当前输入", res.error);
      return;
    }
    setJsonText(text);
    if (res.valid) {
      await showToast(Toast.Style.Success, "已从剪贴板读取并成功校验");
    } else {
      await showToast(Toast.Style.Failure, "剪贴板内容存在语法错误", res.error);
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
          {/* 复制类动作只在 JSON 合法时出现：非法或为空时没有可复制的结果，不能假装复制成功 */}
          {outputs && (
            <Action.CopyToClipboard
              title="复制 2 格格式化结果"
              content={outputs.indent2}
              icon={Icon.CopyClipboard}
            />
          )}
          {outputs && (
            <Action.CopyToClipboard
              title="复制 4 格格式化结果"
              content={outputs.indent4}
              icon={Icon.CopyClipboard}
            />
          )}
          {outputs && (
            <Action.CopyToClipboard
              title="复制压缩单行 (Minify)"
              content={outputs.minified}
              icon={Icon.Minus}
            />
          )}
          {outputs && (
            <Action.CopyToClipboard
              title="复制 TypeScript Interface"
              content={outputs.ts}
              icon={Icon.Code}
            />
          )}
          {outputs && (
            <Action.CopyToClipboard
              title="复制 Rust Struct"
              content={outputs.rust}
              icon={Icon.Terminal}
            />
          )}
          {outputs && (
            <Action.CopyToClipboard
              title="复制 Go Struct"
              content={outputs.go}
              icon={Icon.Globe}
            />
          )}
          <Action
            title="从剪贴板粘贴并校验"
            icon={Icon.Clipboard}
            onAction={handleLoadClipboard}
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
        error={
          validation.valid || !jsonText.trim()
            ? undefined
            : validation.errorInfo
            ? `[第 ${validation.errorInfo.line} 行, 列 ${validation.errorInfo.column}] ${validation.errorInfo.message}`
            : validation.error
        }
      />
      <Form.Dropdown
        id="indentType"
        title="缩进风格"
        value={String(indent)}
        onChange={(v) => setIndent(v === "tab" ? "tab" : v === "4" ? 4 : 2)}
      >
        <Form.Dropdown.Item title="2 空格缩进" value="2" />
        <Form.Dropdown.Item title="4 空格缩进" value="4" />
        <Form.Dropdown.Item title="Tab 制表符缩进" value="tab" />
      </Form.Dropdown>
    </Form>
  );
}
