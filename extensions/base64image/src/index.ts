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
} from "@ztools/declarative-ui";
import {
  parseBase64Image,
  encodeSvgOrTextToBase64,
  SAMPLE_PNG_DATA_URI,
  SAMPLE_SVG,
  type ParsedImageResult
} from "./logic.js";

export default function Base64ImageCommand() {
  const [inputText, setInputText] = useState<string>("");
  const [mode, setMode] = useState<string>("decode");

  const isEncodeMode = mode === "encode";
  const trimmed = inputText.trim();

  let parsed: ParsedImageResult;
  if (!trimmed) {
    parsed = { valid: false };
  } else if (isEncodeMode || trimmed.startsWith("<svg") || trimmed.startsWith("<?xml")) {
    parsed = encodeSvgOrTextToBase64(trimmed);
  } else {
    parsed = parseBase64Image(trimmed);
  }

  const handleCopy = async (content: string, label: string) => {
    await Clipboard.copy(content);
    await showToast(Toast.Style.Success, `已复制: ${label}`);
  };

  const handlePaste = async () => {
    try {
      const text = await Clipboard.readText();
      if (text) {
        setInputText(text);
        await showToast(Toast.Style.Success, "已从剪贴板载入文本");
      } else {
        await showToast(Toast.Style.Failure, "剪贴板无文本内容");
      }
    } catch {
      await showToast(Toast.Style.Failure, "读取剪贴板失败");
    }
  };

  return List(
    {
      navigationTitle: "Base64 图片编解码助手",
      searchBarPlaceholder: isEncodeMode
        ? "输入或粘贴 SVG 源码 / 纯文本，自动转为 Base64..."
        : "输入或粘贴 Data URL / Base64 字符串 (留空查看示例)...",
      searchText: inputText,
      onSearchTextChange: (text: string) => setInputText(text),
      searchBarAccessory: List.Dropdown(
        {
          tooltip: "处理模式",
          value: mode,
          onChange: (val: string) => setMode(val)
        },
        [
          List.Dropdown.Item({ title: "Base64 图片解码与元数据分析", value: "decode" }),
          List.Dropdown.Item({ title: "文本 / SVG 转 Base64 编码", value: "encode" })
        ]
      ),
      actions: ActionPanel({ title: "全局操作" }, [
        Action({
          title: "从剪贴板粘贴",
          icon: Icon.CopyClipboard,
          onAction: handlePaste
        }),
        Action({
          title: "载入示例 PNG 图片",
          icon: Icon.Image,
          onAction: () => {
            setInputText(SAMPLE_PNG_DATA_URI);
            setMode("decode");
          }
        }),
        Action({
          title: "载入示例 SVG 矢量源码",
          icon: Icon.Code,
          onAction: () => {
            setInputText(SAMPLE_SVG);
            setMode("encode");
          }
        }),
        Action({
          title: "清空输入",
          icon: Icon.Trash,
          onAction: () => setInputText("")
        })
      ])
    },
    [
      parsed.valid
        ? List.Section(
            { title: "图片元数据 (Metadata)" },
            [
              List.Item({
                id: "meta-format",
                title: `${parsed.format ? parsed.format.toUpperCase() : "文本/图片"} (${parsed.mimeType})`,
                subtitle: "识别图片格式与 MIME 类型",
                icon: Icon.Image,
                accessories: [{ text: parsed.format ? "合法图片" : "数据流" }],
                actions: ActionPanel({ title: "元数据操作" }, [
                  Action({
                    title: "复制 MIME 类型",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopy(parsed.mimeType || "", "MIME 类型")
                  })
                ])
              }),
              List.Item({
                id: "meta-size",
                title: `原始体积: ${parsed.formattedSize || "0 B"}`,
                subtitle: `Base64 字符串长度: ${parsed.base64Length || 0} 字符 (扩容比 ~133%)`,
                icon: Icon.HardDrive,
                accessories: [{ text: `${parsed.byteLength} 字节` }],
                actions: ActionPanel({ title: "体积操作" }, [
                  Action({
                    title: "复制文件字节数",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopy(String(parsed.byteLength), "原始字节数")
                  })
                ])
              }),
              List.Item({
                id: "meta-preview",
                title: parsed.previewSnippet || "",
                subtitle: "Base64 数据片段",
                icon: Icon.Document,
                accessories: [{ text: "预览前缀" }],
                actions: ActionPanel({ title: "数据预览" }, [
                  Action({
                    title: "复制完整 Base64 编码",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopy(parsed.encoded || "", "Base64 纯文本")
                  })
                ])
              })
            ]
          )
        : null,
      parsed.valid
        ? List.Section(
            { title: "标准导出格式 (按 Enter 即可一键复制)" },
            [
              parsed.markdown
                ? List.Item({
                    id: "export-markdown",
                    title: parsed.markdown.length > 80 ? parsed.markdown.slice(0, 80) + "..." : parsed.markdown,
                    subtitle: "Markdown 引用语法: ![image](data:...)",
                    icon: Icon.Document,
                    accessories: [{ text: "Markdown" }],
                    actions: ActionPanel({ title: "Markdown 操作" }, [
                      Action({
                        title: "复制 Markdown 图片代码",
                        icon: Icon.CopyClipboard,
                        onAction: () => handleCopy(parsed.markdown!, "Markdown 图片引用")
                      }),
                      Action.CopyToClipboard({
                        title: "直接写入剪贴板",
                        content: parsed.markdown,
                        icon: Icon.CopyClipboard
                      })
                    ])
                  })
                : null,
              parsed.html
                ? List.Item({
                    id: "export-html",
                    title: parsed.html.length > 80 ? parsed.html.slice(0, 80) + "..." : parsed.html,
                    subtitle: 'HTML 图像标签: <img src="data:..." />',
                    icon: Icon.Code,
                    accessories: [{ text: "HTML <img>" }],
                    actions: ActionPanel({ title: "HTML 操作" }, [
                      Action({
                        title: "复制 HTML 标签代码",
                        icon: Icon.CopyClipboard,
                        onAction: () => handleCopy(parsed.html!, "HTML 图像标签")
                      })
                    ])
                  })
                : null,
              parsed.cssBackground
                ? List.Item({
                    id: "export-css",
                    title: parsed.cssBackground.length > 80 ? parsed.cssBackground.slice(0, 80) + "..." : parsed.cssBackground,
                    subtitle: "CSS 背景图: background-image: url('data:...')",
                    icon: Icon.Brush,
                    accessories: [{ text: "CSS url" }],
                    actions: ActionPanel({ title: "CSS 操作" }, [
                      Action({
                        title: "复制 CSS 背景图样式",
                        icon: Icon.CopyClipboard,
                        onAction: () => handleCopy(parsed.cssBackground!, "CSS 背景图样式")
                      })
                    ])
                  })
                : null,
              parsed.dataUri
                ? List.Item({
                    id: "export-datauri",
                    title: parsed.dataUri.length > 80 ? parsed.dataUri.slice(0, 80) + "..." : parsed.dataUri,
                    subtitle: "标准 Data URL: data:image/...;base64,...",
                    icon: Icon.Globe,
                    accessories: [{ text: "Data URI" }],
                    actions: ActionPanel({ title: "Data URL 操作" }, [
                      Action({
                        title: "复制完整 Data URL",
                        icon: Icon.CopyClipboard,
                        onAction: () => handleCopy(parsed.dataUri!, "完整 Data URL")
                      })
                    ])
                  })
                : null,
              parsed.encoded
                ? List.Item({
                    id: "export-raw-base64",
                    title: parsed.encoded.length > 80 ? parsed.encoded.slice(0, 80) + "..." : parsed.encoded,
                    subtitle: "纯 Base64 字符串 (无 Data URI 协议头)",
                    icon: Icon.Terminal,
                    accessories: [{ text: "Raw Base64" }],
                    actions: ActionPanel({ title: "纯 Base64 操作" }, [
                      Action({
                        title: "复制纯 Base64 编码",
                        icon: Icon.CopyClipboard,
                        onAction: () => handleCopy(parsed.encoded!, "纯 Base64 编码")
                      })
                    ])
                  })
                : null
            ].filter(Boolean) as any[]
          )
        : null,
      !parsed.valid && trimmed
        ? List.Section(
            { title: "解析错误" },
            [
              List.Item({
                id: "item-error",
                title: parsed.error || "无法识别的 Base64 内容",
                subtitle: "请检查内容是否为标准 Base64 或图片 Data URI",
                icon: Icon.ExclamationMark,
                accessories: [{ text: "解析失败" }],
                actions: ActionPanel({ title: "错误处理" }, [
                  Action({
                    title: "清空并载入示例 PNG",
                    icon: Icon.Repeat,
                    onAction: () => {
                      setInputText(SAMPLE_PNG_DATA_URI);
                      setMode("decode");
                    }
                  }),
                  Action({
                    title: "清空输入",
                    icon: Icon.Trash,
                    onAction: () => setInputText("")
                  })
                ])
              })
            ]
          )
        : null,
      !trimmed
        ? List.Section(
            { title: "快速开始与示例" },
            [
              List.Item({
                id: "quick-sample-png",
                title: "载入示例 PNG 图片 Data URL",
                subtitle: "一键载入合法 1x1 最小 PNG 体验格式解析与导出",
                icon: Icon.Image,
                accessories: [{ text: "示例 PNG" }],
                actions: ActionPanel({ title: "示例操作" }, [
                  Action({
                    title: "载入示例 PNG",
                    icon: Icon.Check,
                    onAction: () => {
                      setInputText(SAMPLE_PNG_DATA_URI);
                      setMode("decode");
                    }
                  })
                ])
              }),
              List.Item({
                id: "quick-sample-svg",
                title: "载入示例 SVG 矢量图形源码",
                subtitle: "一键载入 SVG 矢量代码，自动转换为 Base64 与 Data URL",
                icon: Icon.Code,
                accessories: [{ text: "示例 SVG" }],
                actions: ActionPanel({ title: "示例操作" }, [
                  Action({
                    title: "载入示例 SVG",
                    icon: Icon.Check,
                    onAction: () => {
                      setInputText(SAMPLE_SVG);
                      setMode("encode");
                    }
                  })
                ])
              }),
              List.Item({
                id: "quick-paste",
                title: "从剪贴板读取并解析",
                subtitle: "直接读取系统剪贴板中的图片 Base64 或 SVG 代码",
                icon: Icon.CopyClipboard,
                accessories: [{ text: "读取剪贴板" }],
                actions: ActionPanel({ title: "剪贴板操作" }, [
                  Action({
                    title: "立即读取剪贴板",
                    icon: Icon.CopyClipboard,
                    onAction: handlePaste
                  })
                ])
              })
            ]
          )
        : null
    ].filter(Boolean) as any[]
  );
}
