import {
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  Clipboard,
  useState,
  useEffect,
  useRef,
  useLocale
} from "@ztools/declarative-ui";
import { t } from "./i18n.js";
import {
  parseBase64Image,
  encodeSvgOrTextToBase64,
  isSvgSource,
  SAMPLE_PNG_DATA_URI,
  type Base64ImageFormat,
  type ParsedImageResult
} from "./logic.js";
import { pickImageFile, readClipboardImage, readClipboardImageFile, readDroppedImageFile, saveEncodedText, saveDecodedImage, HostError } from "./host.js";
import { createCompatFileInputProps, isDeclarativeFileInputSupported } from "./host-compat.js";
import { resolveErrorMessage } from './error-i18n.js'

export const MAX_COPY_BYTES = 8 * 1024 * 1024;

interface LoadedSource {
  name: string;
  dataUri: string;
}

export default function Base64ImageCommand() {
  useLocale();
  const [inputText, setInputText] = useState<string>("");
  const [loaded, setLoaded] = useState<LoadedSource | null>(null);
  const [busy, setBusy] = useState(false);
  // 渲染闭包里的 busy 可能是旧值，用 ref 做真正的互斥
  const busyRef = useRef(false);

  const source = loaded ? loaded.dataUri : inputText.trim();
  let parsed: ParsedImageResult = { valid: false };
  if (source) {
    parsed = isSvgSource(source)
      ? encodeSvgOrTextToBase64(source)
      : /^\s*</.test(source)
        // XML / HTML 但根元素不是 <svg>：不能当成图片编码（否则会生成 text/plain 的“图片”写法）
        ? { valid: false, error: t("notSvgError") }
        : parseBase64Image(source);
  }

  const handleCopy = async (content: string, label: string) => {
    try {
      if (new TextEncoder().encode(content).byteLength > MAX_COPY_BYTES) throw new Error(t("overMaxCopyError"));
      await Clipboard.copy(content);
      await showToast(Toast.Style.Success, t("copiedToast", { label }));
    } catch (err: unknown) {
      await showToast(Toast.Style.Failure, t("copyFailed"), err instanceof Error ? err.message : String(err));
    }
  };

  const handleSave = (content: string, name: string) => runExclusive(async () => {
    try {
      const path = await saveEncodedText(content, `${name}.txt`);
      if (path) await showToast(Toast.Style.Success, t("savedToast"), path);
    } catch (err: unknown) {
      await showToast(Toast.Style.Failure, t("saveFailed"), err instanceof Error ? err.message : String(err));
    }
  });

  const handleSaveImage = (encoded: string, format: Base64ImageFormat) => runExclusive(async () => {
    try {
      const path = await saveDecodedImage(encoded, format, loaded?.name);
      if (path) await showToast(Toast.Style.Success, t("savedImageToast"), path);
    } catch (err: unknown) {
      await showToast(Toast.Style.Failure, t("saveImageFailed"), err instanceof Error ? err.message : String(err));
    }
  });

  // 校验图片格式后展示
  const showImage = async (image: { name: string; base64: string }) => {
    const check = parseBase64Image(image.base64);
    if (!check.valid || !check.dataUri) {
      await showToast(Toast.Style.Failure, t("unsupportedImage"), check.error);
      return;
    }
    setLoaded({ name: image.name, dataUri: check.dataUri });
    setInputText("");
    await showToast(Toast.Style.Success, t("convertedToast", { name: image.name }), check.formattedSize);
  };

  // 读取期间加锁，避免连按触发并发读取
  const runExclusive = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handlePickFile = () =>
    runExclusive(async () => {
      try {
        const image = await pickImageFile();
        if (image) await showImage(image);
      } catch (err: unknown) {
        await showToast(Toast.Style.Failure, t("readImgFailed"), err instanceof Error ? err.message : String(err));
      }
    });

  useEffect(() => {
    if (isDeclarativeFileInputSupported()) return () => {};
    const events = (globalThis as {
      window?: {
        ztools?: {
          events?: {
            on?: (event: string, cb: (payload: unknown) => void) => (() => void) | void;
            off?: (event: string, cb: (payload: unknown) => void) => void;
          };
        };
      };
    }).window?.ztools?.events;
    if (!events || typeof events.on !== "function") return undefined;
    const handleFilesDropped = (envelopeOrPayload: unknown) => {
      void runExclusive(async () => {
        try {
          const image = await readDroppedImageFile(envelopeOrPayload);
          if (image) await showImage(image);
        } catch (err: unknown) {
          await showToast(Toast.Style.Failure, t("readDroppedFailed"), err instanceof Error ? err.message : String(err));
        }
      });
    };
    const dispose = events.on("plugin_files_dropped", handleFilesDropped);
    return () => {
      if (typeof dispose === "function") dispose();
      else if (typeof events.off === "function") events.off("plugin_files_dropped", handleFilesDropped);
    };
  }, []);

  const fileInputProps = createCompatFileInputProps(
    (files, payload) => {
      void runExclusive(async () => {
        try {
          const image = await readDroppedImageFile({ files });
          if (image) await showImage(image);
        } catch (err: unknown) {
          const title = payload.source === "paste" ? t("readPastedFailed") : t("readDroppedFailed");
          await showToast(Toast.Style.Failure, title, err instanceof Error ? err.message : String(err));
        }
      });
    },
    {
      extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".ico", ".avif"],
      allowClipboardImage: true,
      onTextPaste: (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setLoaded(null);
        setInputText(trimmed);
      }
    }
  );

  // 剪贴板读取顺序：复制的图片文件（保留原文件字节）→ 图片（截图）→ 文字（Base64 / Data URL / SVG 源码）。
  // 读文件或图片出错时直接提示真实原因，不再落到“没有图片或文字”。
  const handlePaste = () =>
    runExclusive(async () => {
      let image: { name: string; base64: string } | null;
      try {
        image = await readClipboardImageFile();
      } catch (err: unknown) {
        await showToast(Toast.Style.Failure, t("readClipFileFailed"), err instanceof Error ? err.message : String(err));
        return;
      }
      if (!image) {
        try {
          image = await readClipboardImage();
        } catch (err: unknown) {
          // 截图 / 复制的图片会被系统重新编码成 PNG，体积可能远大于原文件，原文件可改用选择文件
          const detail = err instanceof Error ? err.message : String(err);
          await showToast(
            Toast.Style.Failure,
            t("readClipImgFailed"),
            err instanceof HostError && err.code === "FILE_TOO_LARGE" ? t("clipImgTooLargeHint", { detail }) : detail
          );
          return;
        }
      }
      if (image) {
        await showImage(image);
        return;
      }
      try {
        const text = await Clipboard.readText();
        if (text && text.trim()) {
          setLoaded(null);
          setInputText(text.trim());
          return;
        }
        await showToast(Toast.Style.Failure, t("clipEmpty"));
      } catch (err: unknown) {
        await showToast(Toast.Style.Failure, t("readClipFailed"), err instanceof Error ? err.message : String(err));
      }
    });

  const clearAll = () => {
    setLoaded(null);
    setInputText("");
  };

  const sourceActions = [
    Action({ title: t("pickFileAction"), icon: Icon.Image, onAction: handlePickFile }),
    Action({ title: t("pasteAction"), icon: Icon.CopyClipboard, onAction: handlePaste }),
    Action({ title: t("clearAction"), icon: Icon.Trash, onAction: clearAll })
  ];

  const previewDetail = parsed.valid && parsed.dataUri && parsed.format
    ? List.Item.Detail({
        markdown: t("previewMd", {
          uri: parsed.dataUri,
          name: loaded ? loaded.name : t("inputContentLabel"),
          format: parsed.format.toUpperCase(),
          mime: parsed.mimeType ?? "",
          size: parsed.formattedSize ?? "",
          len: parsed.base64Length ?? 0
        })
      })
    : undefined;

  const saveImageAction = parsed.valid && parsed.encoded && parsed.format
    ? Action({
        title: t("saveImageAction"),
        icon: Icon.Download,
        onAction: () => handleSaveImage(parsed.encoded as string, parsed.format as Base64ImageFormat)
      })
    : null;

  const exportItem = (id: string, title: string, value: string | undefined, label: string, icon: typeof Icon[keyof typeof Icon]) =>
    value
      ? List.Item({
          id,
          title,
          subtitle: value.length > MAX_COPY_BYTES ? t("overLimitSub") : value.length > 60 ? value.slice(0, 60) + "…" : value,
          icon,
          detail: previewDetail,
          actions: ActionPanel({ title: label }, [
            ...(value.length <= MAX_COPY_BYTES ? [Action({ title: t("copyLabelAction", { label }), icon: Icon.CopyClipboard, onAction: () => handleCopy(value, label) })] : []),
            Action({ title: t("saveTextFileAction"), icon: Icon.Document, onAction: () => handleSave(value, id) }),
            ...(saveImageAction ? [saveImageAction] : []),
            ...sourceActions
          ])
        })
      : null;

  const saveImageItem = parsed.valid && parsed.encoded && parsed.format && saveImageAction
    ? List.Item({
        id: "export-image-file",
        title: t("saveImageItemTitle"),
        subtitle: t("saveImageItemSub", { format: parsed.format.toUpperCase(), size: parsed.formattedSize ?? "" }),
        icon: Icon.Download,
        detail: previewDetail,
        actions: ActionPanel({ title: t("saveImageItemTitle") }, [
          saveImageAction,
          ...sourceActions
        ])
      })
    : null;

  let sections: ReturnType<typeof List.Section>[];
  if (parsed.valid) {
    sections = [
      List.Section({ title: loaded ? t("sectionLoaded", { name: loaded.name }) : t("sectionResults") }, [
        exportItem("export-datauri", "Data URL", parsed.dataUri, " Data URL", Icon.Globe),
        exportItem("export-raw-base64", t("rawBase64Title"), parsed.encoded, t("rawBase64Label"), Icon.Terminal),
        exportItem("export-markdown", "Markdown", parsed.markdown, " Markdown", Icon.Document),
        exportItem("export-html", "HTML <img>", parsed.html, " HTML", Icon.Code),
        exportItem("export-css", t("cssBgTitle"), parsed.cssBackground, " CSS", Icon.Brush),
        saveImageItem
      ].filter((item): item is ReturnType<typeof List.Item> => item !== null))
    ];
  } else if (source) {
    sections = [
      List.Section({ title: t("sectionInvalid") }, [
        List.Item({
          id: "item-error",
          title: resolveErrorMessage(parsed, t("invalidFallback")),
          subtitle: t("invalidSub"),
          icon: Icon.ExclamationMark,
          actions: ActionPanel({ title: t("actionsTitle") }, sourceActions)
        })
      ])
    ];
  } else {
    sections = [
      List.Section({ title: t("sectionStart") }, [
        List.Item({
          id: "start-pick",
          title: busy ? t("loadingTitle") : t("pickStartTitle"),
          subtitle: t("pickStartSub"),
          icon: Icon.Image,
          actions: ActionPanel({ title: t("sectionStart") }, sourceActions)
        }),
        List.Item({
          id: "start-paste",
          title: t("pasteStartTitle"),
          subtitle: t("pasteStartSub"),
          icon: Icon.CopyClipboard,
          actions: ActionPanel({ title: t("sectionStart") }, [sourceActions[1], sourceActions[0]])
        }),
        List.Item({
          id: "start-sample",
          title: t("sampleStartTitle"),
          subtitle: t("sampleStartSub"),
          icon: Icon.Eye,
          actions: ActionPanel({ title: t("samplePanelTitle") }, [
            Action({ title: t("loadSampleAction"), icon: Icon.Eye, onAction: () => { setLoaded({ name: t("sampleName"), dataUri: SAMPLE_PNG_DATA_URI }); setInputText(""); } })
          ])
        })
      ])
    ];
  }

  return List(
    {
      ...fileInputProps,
      navigationTitle: t("navTitle"),
      isLoading: busy,
      isShowingDetail: Boolean(previewDetail),
      searchBarPlaceholder: t("searchPlaceholder"),
      searchText: inputText,
      onSearchTextChange: (text: string) => {
        setInputText(text);
        if (text) setLoaded(null);
      },
      actions: ActionPanel({ title: t("globalActions") }, sourceActions)
    },
    sections
  );
}
