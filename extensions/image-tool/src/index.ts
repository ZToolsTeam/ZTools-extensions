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
  useState
} from "@ztools/declarative-ui";
import {
  parseImageMetadata,
  convertImageFormat,
  PRESET_IMAGES,
  type ImageMetadata,
  type TargetFormat,
  type ConvertOptions,
  type ConversionResult
} from "./logic.js";

/**
 * 高级转换设置表单
 */
export function AdvancedSettingsForm({
  currentOptions,
  onSave
}: {
  currentOptions: ConvertOptions;
  onSave: (options: ConvertOptions) => void;
}) {
  const { pop } = useNavigation();
  const [scale, setScale] = useState<string>(String(currentOptions.scale));
  const [quality, setQuality] = useState<string>(String(currentOptions.quality));
  const [format, setFormat] = useState<string>(currentOptions.targetFormat);

  const handleSubmit = async (values: Record<string, any>) => {
    const nextScale = parseFloat(values.scale || scale) || 1.0;
    const nextQuality = parseInt(values.quality || quality, 10) || 85;
    const nextFormat = (values.targetFormat || format) as TargetFormat;

    onSave({
      scale: nextScale,
      quality: nextQuality,
      targetFormat: nextFormat
    });
    await showToast(Toast.Style.Success, "已更新转换参数", `缩放: ${nextScale * 100}%, 质量: ${nextQuality}%`);
    pop();
  };

  return Form(
    {
      navigationTitle: "高级图像转换参数",
      actions: ActionPanel({ title: "配置操作" }, [
        Action.SubmitForm({
          title: "应用转换配置",
          icon: Icon.Check,
          onSubmit: handleSubmit
        }),
        Action({
          title: "返回上一层",
          icon: Icon.ArrowLeft,
          onAction: () => pop()
        })
      ])
    },
    [
      Form.Dropdown(
        {
          id: "targetFormat",
          title: "目标输出格式",
          value: format,
          onChange: (val) => setFormat(val)
        },
        [
          Form.Dropdown.Item({ title: "WEBP - 现代化高效压缩 (推荐)", value: "webp" }),
          Form.Dropdown.Item({ title: "PNG - 无损与透明通道支持", value: "png" }),
          Form.Dropdown.Item({ title: "JPEG - 通用网络照片格式", value: "jpeg" }),
          Form.Dropdown.Item({ title: "SVG - 矢量容器包装", value: "svg" }),
          Form.Dropdown.Item({ title: "Base64 - 纯文本数据编码", value: "base64" })
        ]
      ),
      Form.Dropdown(
        {
          id: "scale",
          title: "尺寸缩放比例",
          value: scale,
          onChange: (val) => setScale(val)
        },
        [
          Form.Dropdown.Item({ title: "原尺寸 (100%)", value: "1.0" }),
          Form.Dropdown.Item({ title: "缩小至 75%", value: "0.75" }),
          Form.Dropdown.Item({ title: "缩小至 50% (半尺寸)", value: "0.5" }),
          Form.Dropdown.Item({ title: "缩小至 25% (缩略图)", value: "0.25" }),
          Form.Dropdown.Item({ title: "放大至 150%", value: "1.5" }),
          Form.Dropdown.Item({ title: "放大至 200% (双倍高清)", value: "2.0" })
        ]
      ),
      Form.Dropdown(
        {
          id: "quality",
          title: "画质与压缩率 (有损格式)",
          value: quality,
          onChange: (val) => setQuality(val)
        },
        [
          Form.Dropdown.Item({ title: "100% - 顶级无损视觉", value: "100" }),
          Form.Dropdown.Item({ title: "85% - 推荐黄金平衡点", value: "85" }),
          Form.Dropdown.Item({ title: "70% - 紧凑网络传输", value: "70" }),
          Form.Dropdown.Item({ title: "50% - 极致节省空间", value: "50" })
        ]
      )
    ]
  );
}

/**
 * 图像格式转换与元数据主视图 (纯声明式零 CSS 架构)
 */
export default function ImageToolCommand() {
  const [inputText, setInputText] = useState<string>("");
  const [targetFormat, setTargetFormat] = useState<TargetFormat>("webp");
  const [convertOptions, setConvertOptions] = useState<ConvertOptions>({
    targetFormat: "webp",
    quality: 85,
    scale: 1.0
  });
  const { push } = useNavigation();

  // 同步格式选项
  const effectiveOptions: ConvertOptions = {
    ...convertOptions,
    targetFormat
  };

  const handleCopy = async (text: string, label: string) => {
    await Clipboard.copy(text);
    await showToast(Toast.Style.Success, `已复制 ${label}`);
  };

  const openSettings = () => {
    push(() =>
      AdvancedSettingsForm({
        currentOptions: effectiveOptions,
        onSave: (newOpts) => {
          setConvertOptions(newOpts);
          setTargetFormat(newOpts.targetFormat);
        }
      })
    );
  };

  // 生成指定图片的详情与视图模型
  const renderItemDetail = (meta: ImageMetadata, conv: ConversionResult) => {
    const markdown = [
      `### 转换实时预览 (${conv.targetFormat.toUpperCase()})`,
      `![预览](${conv.previewDataUrl})`,
      "",
      `> **转换通道**: \`${meta.format}\` ➔ \`${conv.targetFormat.toUpperCase()}\` | **目标尺寸**: \`${conv.targetWidth} × ${conv.targetHeight}\` | **体积变化**: **${conv.compressionRatio}**`
    ].join("\n");

    return List.Item.Detail({
      markdown,
      metadata: List.Item.Detail.Metadata([
        List.Item.Detail.Metadata.Label({
          title: "原图格式",
          text: `${meta.format} (${meta.mimeType})`,
          icon: Icon.Document
        }),
        List.Item.Detail.Metadata.Label({
          title: "原图分辨率",
          text: `${meta.width} × ${meta.height} (${meta.aspectRatio})`,
          icon: Icon.Maximize
        }),
        List.Item.Detail.Metadata.Label({
          title: "色彩与位深",
          text: meta.colorDepth,
          icon: Icon.Eye
        }),
        List.Item.Detail.Metadata.Label({
          title: "透明通道 (Alpha)",
          text: meta.hasAlpha ? "支持透明通道" : "不含透明通道",
          icon: meta.hasAlpha ? Icon.Check : Icon.Circle
        }),
        List.Item.Detail.Metadata.Label({
          title: "原图物理体积",
          text: `${meta.formattedSize} (${meta.sizeInBytes.toLocaleString()} B)`,
          icon: Icon.HardDrive
        }),
        List.Item.Detail.Metadata.Separator(),
        List.Item.Detail.Metadata.Label({
          title: "目标转换格式",
          text: conv.targetFormat.toUpperCase(),
          icon: Icon.Repeat
        }),
        List.Item.Detail.Metadata.Label({
          title: "转换后预估体积",
          text: `${conv.formattedTargetSize} (${conv.compressionRatio})`,
          icon: Icon.Key
        }),
        List.Item.Detail.Metadata.Label({
          title: "像素总量",
          text: meta.megapixels,
          icon: Icon.Star
        })
      ])
    });
  };

  const hasCustomInput = Boolean(inputText && inputText.trim());
  const customMeta = hasCustomInput ? parseImageMetadata(inputText) : null;
  const customConv = customMeta ? convertImageFormat(customMeta, effectiveOptions) : null;

  return List(
    {
      navigationTitle: "图像转换与元数据分析",
      searchBarPlaceholder: "输入/粘贴图片 Base64、DataURL、本地路径，或选择下方预设...",
      searchText: inputText,
      onSearchTextChange: (text: string) => setInputText(text),
      isShowingDetail: true,
      searchBarAccessory: List.Dropdown(
        {
          tooltip: "快速切换目标格式",
          value: targetFormat,
          onChange: (val: string) => setTargetFormat(val as TargetFormat)
        },
        [
          List.Dropdown.Item({ title: "转为 WEBP (高压缩)", value: "webp" }),
          List.Dropdown.Item({ title: "转为 PNG (无损透明)", value: "png" }),
          List.Dropdown.Item({ title: "转为 JPEG (通用格式)", value: "jpeg" }),
          List.Dropdown.Item({ title: "转为 SVG (矢量包装)", value: "svg" }),
          List.Dropdown.Item({ title: "转为 Base64 编码", value: "base64" })
        ]
      ),
      actions: ActionPanel({ title: "图像全局操作" }, [
        Action({
          title: "配置高级参数 (尺寸/画质)",
          icon: Icon.Gear,
          onAction: openSettings
        }),
        Action({
          title: "清空当前输入",
          icon: Icon.Trash,
          onAction: () => setInputText("")
        })
      ])
    },
    [
      // 自定义输入项
      ...(hasCustomInput && customMeta && customConv
        ? [
            List.Section(
              { title: "当前输入图片分析与转换" },
              [
                List.Item({
                  id: "custom-input-image",
                  title: customMeta.fileName || "用户输入图片",
                  subtitle: `${customMeta.format} · ${customMeta.width}×${customMeta.height} · ${customMeta.formattedSize}`,
                  icon: Icon.Document,
                  detail: renderItemDetail(customMeta, customConv),
                  actions: ActionPanel({ title: "操作" }, [
                    Action({
                      title: "复制转换 Data URL",
                      icon: Icon.CopyClipboard,
                      onAction: () => handleCopy(customConv.previewDataUrl, "转换后的 Data URL")
                    }),
                    Action({
                      title: "复制纯 Base64 编码",
                      icon: Icon.CopyClipboard,
                      onAction: () => handleCopy(customConv.base64Output, "Base64 编码")
                    }),
                    Action({
                      title: "复制 Markdown 标签",
                      icon: Icon.Document,
                      onAction: () => handleCopy(customConv.markdownSnippet, "Markdown 标签")
                    }),
                    Action({
                      title: "复制元数据 JSON",
                      icon: Icon.Document,
                      onAction: () => handleCopy(JSON.stringify(customMeta, null, 2), "元数据 JSON")
                    }),
                    Action({
                      title: "高级转换参数配置",
                      icon: Icon.Gear,
                      onAction: openSettings
                    }),
                    Action({
                      title: "清空输入重置",
                      icon: Icon.Trash,
                      onAction: () => setInputText("")
                    })
                  ])
                })
              ]
            )
          ]
        : []),

      // 内置高保真预设样本项
      List.Section(
        { title: `内置参考预设样本 (${PRESET_IMAGES.length})` },
        PRESET_IMAGES.map((preset) => {
          const meta = parseImageMetadata(preset.id);
          const conv = convertImageFormat(meta, effectiveOptions);

          return List.Item({
            id: preset.id,
            title: preset.name,
            subtitle: `${preset.width}×${preset.height} · ${meta.formattedSize}`,
            icon: Icon.Circle,
            detail: renderItemDetail(meta, conv),
            actions: ActionPanel({ title: "预设操作" }, [
              Action({
                title: "复制转换 Data URL",
                icon: Icon.CopyClipboard,
                onAction: () => handleCopy(conv.previewDataUrl, "转换后的 Data URL")
              }),
              Action({
                title: "复制纯 Base64 编码",
                icon: Icon.CopyClipboard,
                onAction: () => handleCopy(conv.base64Output, "Base64 编码")
              }),
              Action({
                title: "复制 Markdown 图片标签",
                icon: Icon.Document,
                onAction: () => handleCopy(conv.markdownSnippet, "Markdown 标签")
              }),
              Action({
                title: "复制元数据 JSON",
                icon: Icon.Document,
                onAction: () => handleCopy(JSON.stringify(meta, null, 2), "元数据 JSON")
              }),
              Action({
                title: "高级转换参数配置",
                icon: Icon.Gear,
                onAction: openSettings
              })
            ])
          });
        })
      )
    ]
  );
}
