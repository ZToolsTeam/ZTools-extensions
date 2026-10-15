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
  DEFAULT_EDITOR_STATE,
  SAMPLE_IMAGES,
  renderEditedImage,
  rotateClockwise,
  rotateCounterClockwise,
  toggleFlipH,
  toggleFlipV,
  updateScale,
  updateWatermark,
  setSourceImage,
  resetEditorState,
  type EditorState,
  type EditorImage,
  type WatermarkOptions,
  type WatermarkPosition
} from "./logic.js";

/**
 * 尺寸缩放调整表单
 */
export function ResizeForm({
  currentScale,
  onSave
}: {
  currentScale: number;
  onSave: (scale: number) => void;
}) {
  const { pop } = useNavigation();
  const [scaleStr, setScaleStr] = useState<string>(String(currentScale));

  const handleSubmit = async (values: Record<string, any>) => {
    const val = parseFloat(values.scale || scaleStr) || 1.0;
    onSave(val);
    await showToast(Toast.Style.Success, `已应用尺寸缩放: ${Math.round(val * 100)}%`);
    pop();
  };

  return Form(
    {
      navigationTitle: "调整尺寸缩放",
      actions: ActionPanel({ title: "表单操作" }, [
        Action.SubmitForm({
          title: "应用缩放比例",
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
          id: "scale",
          title: "缩放预设比例",
          value: scaleStr,
          onChange: (val) => setScaleStr(val)
        },
        [
          Form.Dropdown.Item({ title: "原比例 (100%)", value: "1.0" }),
          Form.Dropdown.Item({ title: "缩小至 75%", value: "0.75" }),
          Form.Dropdown.Item({ title: "半尺寸 (50%)", value: "0.5" }),
          Form.Dropdown.Item({ title: "缩略图 (25%)", value: "0.25" }),
          Form.Dropdown.Item({ title: "放大至 125%", value: "1.25" }),
          Form.Dropdown.Item({ title: "放大至 150%", value: "1.5" }),
          Form.Dropdown.Item({ title: "双倍放大 (200%)", value: "2.0" })
        ]
      )
    ]
  );
}

/**
 * 水印文字批注配置表单
 */
export function WatermarkForm({
  currentWatermark,
  onSave
}: {
  currentWatermark: WatermarkOptions;
  onSave: (options: Partial<WatermarkOptions>) => void;
}) {
  const { pop } = useNavigation();
  const [text, setText] = useState<string>(currentWatermark.text);
  const [position, setPosition] = useState<WatermarkPosition>(currentWatermark.position);
  const [fontSize, setFontSize] = useState<string>(String(currentWatermark.fontSize));
  const [color, setColor] = useState<string>(currentWatermark.color);
  const [opacity, setOpacity] = useState<string>(String(currentWatermark.opacity));

  const handleSubmit = async (values: Record<string, any>) => {
    const nextText = values.text !== undefined ? values.text : text;
    const nextPos = (values.position || position) as WatermarkPosition;
    const nextSize = parseInt(values.fontSize || fontSize, 10) || 32;
    const nextColor = values.color || color;
    const nextOpacity = parseFloat(values.opacity || opacity) || 0.35;

    onSave({
      text: nextText,
      position: nextPos,
      fontSize: nextSize,
      color: nextColor,
      opacity: nextOpacity
    });
    await showToast(Toast.Style.Success, "水印批注已更新", nextText ? `内容: "${nextText}"` : "已清除水印文字");
    pop();
  };

  return Form(
    {
      navigationTitle: "配置水印文字批注",
      actions: ActionPanel({ title: "水印配置" }, [
        Action.SubmitForm({
          title: "保存并应用水印",
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
      Form.TextField({
        id: "text",
        title: "水印文本内容",
        placeholder: "输入防伪或批注文字，留空则不显示...",
        value: text,
        onChange: (val) => setText(val)
      }),
      Form.Dropdown(
        {
          id: "position",
          title: "水印分布位置",
          value: position,
          onChange: (val) => setPosition(val as WatermarkPosition)
        },
        [
          Form.Dropdown.Item({ title: "斜向满铺 (防盗防截屏推荐)", value: "tiled" }),
          Form.Dropdown.Item({ title: "居中斜置突出", value: "center" }),
          Form.Dropdown.Item({ title: "右下角标", value: "bottom-right" }),
          Form.Dropdown.Item({ title: "左下角标", value: "bottom-left" }),
          Form.Dropdown.Item({ title: "右上角标", value: "top-right" }),
          Form.Dropdown.Item({ title: "左上角标", value: "top-left" })
        ]
      ),
      Form.Dropdown(
        {
          id: "fontSize",
          title: "文字字体字号",
          value: fontSize,
          onChange: (val) => setFontSize(val)
        },
        [
          Form.Dropdown.Item({ title: "18px - 精细小字", value: "18" }),
          Form.Dropdown.Item({ title: "24px - 标准正文字号", value: "24" }),
          Form.Dropdown.Item({ title: "32px - 推荐突出字号", value: "32" }),
          Form.Dropdown.Item({ title: "48px - 醒目大标题", value: "48" }),
          Form.Dropdown.Item({ title: "64px - 特大防伪字号", value: "64" })
        ]
      ),
      Form.Dropdown(
        {
          id: "color",
          title: "文字颜色",
          value: color,
          onChange: (val) => setColor(val)
        },
        [
          Form.Dropdown.Item({ title: "红色 (#ef4444) - 警示机密", value: "#ef4444" }),
          Form.Dropdown.Item({ title: "蓝色 (#3b82f6) - 商务专业", value: "#3b82f6" }),
          Form.Dropdown.Item({ title: "纯黑 (#000000) - 高清文档", value: "#000000" }),
          Form.Dropdown.Item({ title: "纯白 (#ffffff) - 深色底图", value: "#ffffff" }),
          Form.Dropdown.Item({ title: "中灰 (#6b7280) - 柔和低调", value: "#6b7280" })
        ]
      ),
      Form.Dropdown(
        {
          id: "opacity",
          title: "不透明度 (透明度)",
          value: opacity,
          onChange: (val) => setOpacity(val)
        },
        [
          Form.Dropdown.Item({ title: "15% - 极轻淡暗纹", value: "0.15" }),
          Form.Dropdown.Item({ title: "35% - 黄金平衡推荐", value: "0.35" }),
          Form.Dropdown.Item({ title: "50% - 半透明清晰", value: "0.5" }),
          Form.Dropdown.Item({ title: "75% - 高显眼防伪", value: "0.75" }),
          Form.Dropdown.Item({ title: "100% - 完全不透明", value: "1.0" })
        ]
      )
    ]
  );
}

/**
 * 切换底图或自定义输入表单
 */
export function ChangeSourceForm({
  onSelect
}: {
  onSelect: (image: EditorImage) => void;
}) {
  const { pop } = useNavigation();
  const [selectedPresetId, setSelectedPresetId] = useState<string>(SAMPLE_IMAGES[0].id);
  const [customDataUrl, setCustomDataUrl] = useState<string>("");

  const handleSubmit = async (values: Record<string, any>) => {
    const rawCustom = (values.customDataUrl || customDataUrl || "").trim();
    if (rawCustom) {
      const isDataUrl = rawCustom.startsWith("data:");
      const finalUrl = isDataUrl
        ? rawCustom
        : `data:image/png;base64,${rawCustom}`;

      onSelect({
        id: "custom-" + Date.now(),
        name: "用户自定义底图",
        description: "由剪贴板或用户输入载入的图像",
        width: 800,
        height: 600,
        dataUrl: finalUrl
      });
      await showToast(Toast.Style.Success, "已成功载入自定义图像");
      pop();
      return;
    }

    const presetId = values.presetId || selectedPresetId;
    const matched = SAMPLE_IMAGES.find((p) => p.id === presetId) || SAMPLE_IMAGES[0];
    onSelect(matched);
    await showToast(Toast.Style.Success, `已切换至预设: ${matched.name}`);
    pop();
  };

  return Form(
    {
      navigationTitle: "切换编辑底图",
      actions: ActionPanel({ title: "底图选择" }, [
        Action.SubmitForm({
          title: "确认载入此底图",
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
          id: "presetId",
          title: "选择内置参考底图",
          value: selectedPresetId,
          onChange: (val) => setSelectedPresetId(val)
        },
        SAMPLE_IMAGES.map((img) =>
          Form.Dropdown.Item({
            title: `${img.name} (${img.width}×${img.height})`,
            value: img.id
          })
        )
      ),
      Form.TextArea({
        id: "customDataUrl",
        title: "或粘贴自定义 Base64 / Data URL",
        placeholder: "粘贴 data:image/... 或纯 Base64 编码以载入自定义图片...",
        value: customDataUrl,
        onChange: (val) => setCustomDataUrl(val)
      })
    ]
  );
}

/**
 * 图片轻量编辑与批注主命令视图 (纯声明式架构)
 */
export default function ImageEditorCommand() {
  const [editorState, setEditorState] = useState<EditorState>(DEFAULT_EDITOR_STATE);
  const { push } = useNavigation();

  const result = renderEditedImage(editorState);

  const handleCopy = async (content: string, label: string) => {
    await Clipboard.copy(content);
    await showToast(Toast.Style.Success, `已复制 ${label}`);
  };

  const handleRotate = async () => {
    setEditorState((prev) => rotateClockwise(prev));
    await showToast(Toast.Style.Success, `已顺时针旋转 90° (当前: ${((editorState.rotation + 90) % 360)}°)`);
  };

  const handleFlipH = async () => {
    setEditorState((prev) => toggleFlipH(prev));
    await showToast(Toast.Style.Success, `水平镜像: ${!editorState.flipH ? "已开启" : "已关闭"}`);
  };

  const handleFlipV = async () => {
    setEditorState((prev) => toggleFlipV(prev));
    await showToast(Toast.Style.Success, `垂直镜像: ${!editorState.flipV ? "已开启" : "已关闭"}`);
  };

  const handleReset = async () => {
    setEditorState((prev) => resetEditorState(prev));
    await showToast(Toast.Style.Success, "已重置所有编辑状态为默认值");
  };

  const openResizeForm = () => {
    push(() =>
      ResizeForm({
        currentScale: editorState.scale,
        onSave: (scale) => setEditorState((prev) => updateScale(prev, scale))
      })
    );
  };

  const openWatermarkForm = () => {
    push(() =>
      WatermarkForm({
        currentWatermark: editorState.watermark,
        onSave: (opts) => setEditorState((prev) => updateWatermark(prev, opts))
      })
    );
  };

  const openChangeSourceForm = () => {
    push(() =>
      ChangeSourceForm({
        onSelect: (newImg) => setEditorState((prev) => setSourceImage(prev, newImg))
      })
    );
  };

  // 组装通用操作面板
  const createCommonActions = (primaryAction?: any) => {
    const actions: any[] = [];
    if (primaryAction) actions.push(primaryAction);

    actions.push(
      Action({
        title: "复制编辑后图片 (Data URL)",
        icon: Icon.CopyClipboard,
        onAction: () => handleCopy(result.previewDataUrl, "编辑后图片 Data URL")
      }),
      Action({
        title: "复制 SVG 矢量源码",
        icon: Icon.CopyClipboard,
        onAction: () => handleCopy(result.svgSource, "SVG 源码")
      }),
      Action({
        title: "复制 Markdown 标签",
        icon: Icon.Document,
        onAction: () => handleCopy(result.markdownSnippet, "Markdown 标签")
      }),
      Action({
        title: "顺时针旋转 90°",
        icon: Icon.Repeat,
        shortcut: { modifiers: ["cmd"], key: "r" },
        onAction: handleRotate
      }),
      Action({
        title: "水平镜像翻转",
        icon: Icon.Eye,
        shortcut: { modifiers: ["cmd"], key: "f" },
        onAction: handleFlipH
      }),
      Action({
        title: "垂直镜像翻转",
        icon: Icon.Eye,
        onAction: handleFlipV
      }),
      Action({
        title: "配置水印文字批注",
        icon: Icon.Pencil,
        shortcut: { modifiers: ["cmd"], key: "w" },
        onAction: openWatermarkForm
      }),
      Action({
        title: "调整尺寸缩放",
        icon: Icon.Maximize,
        shortcut: { modifiers: ["cmd"], key: "s" },
        onAction: openResizeForm
      }),
      Action({
        title: "切换底图或自定义载入",
        icon: Icon.Document,
        onAction: openChangeSourceForm
      }),
      Action({
        title: "重置所有编辑状态",
        icon: Icon.Trash,
        onAction: handleReset
      })
    );

    return ActionPanel({ title: "图片编辑操作" }, actions);
  };

  const renderDetailView = () => {
    const markdown = [
      `### 图片轻量编辑与批注预览`,
      `![编辑输出预览](${result.previewDataUrl})`,
      "",
      `> **当前画布状态**: 尺寸 **\`${result.width} × ${result.height}\`** (\`${Math.round(result.scale * 100)}%\`) | 旋转 **\`${result.rotation}°\`** | 镜像 **\`${result.flipSummary}\`**`,
      `> **水印批注**: **${result.watermarkSummary}**`
    ].join("\n");

    return List.Item.Detail({
      markdown,
      metadata: List.Item.Detail.Metadata([
        List.Item.Detail.Metadata.Label({
          title: "输出画布尺寸",
          text: `${result.width} × ${result.height} (原图 ${result.originalWidth}×${result.originalHeight})`,
          icon: Icon.Maximize
        }),
        List.Item.Detail.Metadata.Label({
          title: "缩放比例",
          text: `${Math.round(result.scale * 100)}%`,
          icon: Icon.MagnifyingGlass
        }),
        List.Item.Detail.Metadata.Label({
          title: "旋转角度",
          text: `${result.rotation}°`,
          icon: Icon.Repeat
        }),
        List.Item.Detail.Metadata.Label({
          title: "镜像状态",
          text: result.flipSummary,
          icon: Icon.Eye
        }),
        List.Item.Detail.Metadata.Separator(),
        List.Item.Detail.Metadata.Label({
          title: "水印文字",
          text: result.watermark.text || "无水印",
          icon: Icon.Text
        }),
        List.Item.Detail.Metadata.Label({
          title: "水印分布位置",
          text: result.watermark.position,
          icon: Icon.Pencil
        }),
        List.Item.Detail.Metadata.Label({
          title: "水印不透明度",
          text: `${Math.round(result.watermark.opacity * 100)}%`,
          icon: Icon.Circle
        }),
        List.Item.Detail.Metadata.Label({
          title: "预估文件体积",
          text: result.formattedSize,
          icon: Icon.HardDrive
        }),
        List.Item.Detail.Metadata.Label({
          title: "当前底图",
          text: result.sourceName,
          icon: Icon.Document
        })
      ])
    });
  };

  const detailView = renderDetailView();

  return List(
    {
      navigationTitle: "图片轻量编辑与批注",
      searchBarPlaceholder: "选择下方编辑功能，或通过快捷键快速处理...",
      isShowingDetail: true,
      actions: createCommonActions()
    },
    [
      List.Section(
        { title: "核心图层与实时预览" },
        [
          List.Item({
            id: "layer-preview",
            title: "当前实时合成预览",
            subtitle: `${result.width}×${result.height} · ${result.rotation}° · ${result.formattedSize}`,
            icon: Icon.Check,
            detail: detailView,
            actions: createCommonActions(
              Action({
                title: "复制编辑后图片 (Data URL)",
                icon: Icon.CopyClipboard,
                onAction: () => handleCopy(result.previewDataUrl, "编辑后图片 Data URL")
              })
            )
          })
        ]
      ),
      List.Section(
        { title: "轻量编辑工具箱" },
        [
          List.Item({
            id: "tool-rotate",
            title: "顺时针旋转 90°",
            subtitle: `当前旋转角度: ${result.rotation}° (按 Enter 立即旋转)`,
            icon: Icon.Repeat,
            detail: detailView,
            actions: createCommonActions(
              Action({
                title: "执行顺时针旋转 90°",
                icon: Icon.Repeat,
                onAction: handleRotate
              })
            )
          }),
          List.Item({
            id: "tool-flip-h",
            title: "水平镜像翻转",
            subtitle: `当前状态: ${editorState.flipH ? "已水平镜像" : "正常"}`,
            icon: Icon.Eye,
            detail: detailView,
            actions: createCommonActions(
              Action({
                title: "切换水平镜像翻转",
                icon: Icon.Eye,
                onAction: handleFlipH
              })
            )
          }),
          List.Item({
            id: "tool-flip-v",
            title: "垂直镜像翻转",
            subtitle: `当前状态: ${editorState.flipV ? "已垂直镜像" : "正常"}`,
            icon: Icon.Eye,
            detail: detailView,
            actions: createCommonActions(
              Action({
                title: "切换垂直镜像翻转",
                icon: Icon.Eye,
                onAction: handleFlipV
              })
            )
          }),
          List.Item({
            id: "tool-resize",
            title: "调整尺寸缩放比例",
            subtitle: `当前缩放倍率: ${Math.round(editorState.scale * 100)}%`,
            icon: Icon.Maximize,
            detail: detailView,
            actions: createCommonActions(
              Action({
                title: "打开尺寸调整表单",
                icon: Icon.Maximize,
                onAction: openResizeForm
              })
            )
          }),
          List.Item({
            id: "tool-watermark",
            title: "配置水印文字批注",
            subtitle: result.watermarkSummary,
            icon: Icon.Pencil,
            detail: detailView,
            actions: createCommonActions(
              Action({
                title: "打开水印配置表单",
                icon: Icon.Pencil,
                onAction: openWatermarkForm
              })
            )
          }),
          List.Item({
            id: "tool-change-source",
            title: "切换底图或自定义输入",
            subtitle: `当前项目底图: ${editorState.sourceImage.name}`,
            icon: Icon.Document,
            detail: detailView,
            actions: createCommonActions(
              Action({
                title: "打开底图切换表单",
                icon: Icon.Document,
                onAction: openChangeSourceForm
              })
            )
          }),
          List.Item({
            id: "tool-reset",
            title: "重置所有编辑状态",
            subtitle: "恢复原始缩放 (100%)、0° 旋转与默认水印",
            icon: Icon.Trash,
            detail: detailView,
            actions: createCommonActions(
              Action({
                title: "确认重置编辑状态",
                icon: Icon.Trash,
                onAction: handleReset
              })
            )
          })
        ]
      )
    ]
  );
}
