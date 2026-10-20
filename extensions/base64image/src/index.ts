import {
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  Clipboard,
  useState
} from "@ztools/declarative-ui";
import {
  parseBase64Image,
  encodeSvgOrTextToBase64,
  SAMPLE_PNG_DATA_URI,
  type ParsedImageResult
} from "./logic.js";
import { pickImageFile, readClipboardImage } from "./host.js";

interface LoadedSource {
  name: string;
  dataUri: string;
}

export default function Base64ImageCommand() {
  const [inputText, setInputText] = useState<string>("");
  const [loaded, setLoaded] = useState<LoadedSource | null>(null);
  const [busy, setBusy] = useState(false);

  const source = loaded ? loaded.dataUri : inputText.trim();
  let parsed: ParsedImageResult = { valid: false };
  if (source) {
    parsed = source.startsWith("<svg") || source.startsWith("<?xml")
      ? encodeSvgOrTextToBase64(source)
      : parseBase64Image(source);
  }

  const handleCopy = async (content: string, label: string) => {
    await Clipboard.copy(content);
    await showToast(Toast.Style.Success, `已复制 ${label}`);
  };

  // 选择图片文件 / 读取剪贴板图片的公共处理：校验图片格式后展示
  const loadImage = async (loader: () => Promise<{ name: string; base64: string } | null>, emptyMessage: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const image = await loader();
      if (!image) {
        if (emptyMessage) await showToast(Toast.Style.Failure, emptyMessage);
        return;
      }
      const check = parseBase64Image(image.base64);
      if (!check.valid || !check.dataUri) {
        await showToast(Toast.Style.Failure, "不是支持的图片", check.error);
        return;
      }
      setLoaded({ name: image.name, dataUri: check.dataUri });
      setInputText("");
      await showToast(Toast.Style.Success, `已转换 ${image.name}`, check.formattedSize);
    } catch (err: any) {
      await showToast(Toast.Style.Failure, "读取图片失败", err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePickFile = () => loadImage(pickImageFile, "");

  // 剪贴板优先读图片（截图），没有图片时再读文字（Base64 / Data URL / SVG 源码）
  const handlePaste = async () => {
    try {
      const image = await readClipboardImage();
      if (image) {
        await loadImage(async () => image, "");
        return;
      }
    } catch {
      // 读图片失败时继续尝试读文字
    }
    try {
      const text = await Clipboard.readText();
      if (text && text.trim()) {
        setLoaded(null);
        setInputText(text.trim());
        return;
      }
      await showToast(Toast.Style.Failure, "剪贴板里没有图片或文字");
    } catch (err: any) {
      await showToast(Toast.Style.Failure, "读取剪贴板失败", err?.message || String(err));
    }
  };

  const clearAll = () => {
    setLoaded(null);
    setInputText("");
  };

  const sourceActions = [
    Action({ title: "选择图片文件…", icon: Icon.Image, onAction: handlePickFile }),
    Action({ title: "粘贴剪贴板图片或文字", icon: Icon.CopyClipboard, onAction: handlePaste }),
    Action({ title: "清空", icon: Icon.Trash, onAction: clearAll })
  ];

  const previewDetail = parsed.valid && parsed.dataUri && parsed.format
    ? List.Item.Detail({
        markdown: `![preview](${parsed.dataUri})\n\n**${loaded ? loaded.name : "输入内容"}**\n\n- 格式：${parsed.format.toUpperCase()}（${parsed.mimeType}）\n- 原始大小：${parsed.formattedSize}\n- Base64 长度：${parsed.base64Length} 字符`
      })
    : undefined;

  const exportItem = (id: string, title: string, value: string | undefined, label: string, icon: any) =>
    value
      ? List.Item({
          id,
          title,
          subtitle: value.length > 60 ? value.slice(0, 60) + "…" : value,
          icon,
          detail: previewDetail,
          actions: ActionPanel({ title: label }, [
            Action({ title: `复制${label}`, icon: Icon.CopyClipboard, onAction: () => handleCopy(value, label) }),
            ...sourceActions
          ])
        })
      : null;

  let sections: any[];
  if (parsed.valid) {
    sections = [
      List.Section({ title: loaded ? `已载入 ${loaded.name}` : "转换结果（按回车复制）" }, [
        exportItem("export-datauri", "Data URL", parsed.dataUri, " Data URL", Icon.Globe),
        exportItem("export-raw-base64", "纯 Base64", parsed.encoded, "纯 Base64", Icon.Terminal),
        exportItem("export-markdown", "Markdown", parsed.markdown, " Markdown", Icon.Document),
        exportItem("export-html", "HTML <img>", parsed.html, " HTML", Icon.Code),
        exportItem("export-css", "CSS 背景图", parsed.cssBackground, " CSS", Icon.Brush)
      ].filter(Boolean) as any[])
    ];
  } else if (source) {
    sections = [
      List.Section({ title: "无法识别" }, [
        List.Item({
          id: "item-error",
          title: parsed.error || "无法识别的内容",
          subtitle: "支持：图片文件、截图、Base64 字符串、data:image/... 链接、SVG 源码",
          icon: Icon.ExclamationMark,
          actions: ActionPanel({ title: "操作" }, sourceActions)
        })
      ])
    ];
  } else {
    sections = [
      List.Section({ title: "开始" }, [
        List.Item({
          id: "start-pick",
          title: busy ? "正在读取…" : "选择图片文件，转成 Base64",
          subtitle: "PNG、JPG、GIF、WebP、SVG，单张不超过 10 MB",
          icon: Icon.Image,
          actions: ActionPanel({ title: "开始" }, sourceActions)
        }),
        List.Item({
          id: "start-paste",
          title: "粘贴截图或复制的图片",
          subtitle: "也可以粘贴 Base64 字符串，还原成图片",
          icon: Icon.CopyClipboard,
          actions: ActionPanel({ title: "开始" }, [sourceActions[1], sourceActions[0]])
        }),
        List.Item({
          id: "start-sample",
          title: "看一个示例",
          subtitle: "载入一张 1×1 的示例 PNG",
          icon: Icon.Eye,
          actions: ActionPanel({ title: "示例" }, [
            Action({ title: "载入示例", icon: Icon.Eye, onAction: () => { setLoaded({ name: "示例 PNG", dataUri: SAMPLE_PNG_DATA_URI }); setInputText(""); } })
          ])
        })
      ])
    ];
  }

  return List(
    {
      navigationTitle: "Base64 图片编解码",
      isLoading: busy,
      isShowingDetail: Boolean(previewDetail),
      searchBarPlaceholder: "粘贴 Base64 / Data URL / SVG 源码，或按回车选择图片文件…",
      searchText: inputText,
      onSearchTextChange: (text: string) => {
        setInputText(text);
        if (text) setLoaded(null);
      },
      actions: ActionPanel({ title: "全局操作" }, sourceActions)
    },
    sections
  );
}
