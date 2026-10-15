import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  useState,
  useEffect
} from "@ztools/declarative-ui";
import {
  translateText,
  fetchLiveTranslation,
  SUPPORTED_LANGUAGES,
  type TranslationResult,
  type TranslationHistoryItem
} from "./logic.js";

const DEFAULT_HISTORY: TranslationHistoryItem[] = [
  { id: "trans-1", sourceText: "declarative", translatedText: "声明式的，陈述的", sourceLang: "en", targetLang: "zh", timestamp: Date.now() - 1800000 },
  { id: "trans-2", sourceText: "你好", translatedText: "Hello / Hi", sourceLang: "zh", targetLang: "en", timestamp: Date.now() - 3600000 }
];

export default function TranslatorCommand() {
  const [searchText, setSearchText] = useState<string>("Hello world");
  const [targetLang, setTargetLang] = useState<string>("zh");
  const [result, setResult] = useState<TranslationResult | null>(() => {
    return translateText("Hello world", "zh");
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [history, setHistory] = useState<TranslationHistoryItem[]>(DEFAULT_HISTORY);

  // 监听输入与目标语言变化，触发真实在线网络翻译
  useEffect(() => {
    const trimmed = searchText.trim();
    if (!trimmed) {
      setResult(null);
      setIsLoading(false);
      return;
    }

    // 先展示快速同步词典/预览结果
    const initialSync = translateText(trimmed, targetLang);
    setResult(initialSync);
    setIsLoading(true);

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const live = await fetchLiveTranslation(trimmed, targetLang, controller.signal);
        if (live) {
          setResult(live);
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          // ignore or keep initialSync
        }
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchText, targetLang]);

  const handleCopyAndSave = async (source: string, trans: string, sLang: string, tLang: string) => {
    await Clipboard.copy(trans);
    setHistory((prev: TranslationHistoryItem[]) => [
      {
        id: "trans_" + Math.random().toString(36).slice(2, 9),
        sourceText: source,
        translatedText: trans,
        sourceLang: sLang,
        targetLang: tLang,
        timestamp: Date.now()
      },
      ...prev.filter((item: TranslationHistoryItem) => item.sourceText.toLowerCase() !== source.toLowerCase()).slice(0, 19)
    ]);
    await showToast(Toast.Style.Success, "译文已复制并记入历史");
  };

  const handleClearHistory = async () => {
    setHistory([]);
    await showToast(Toast.Style.Success, "翻译历史已清空");
  };

  return List(
    {
      navigationTitle: "多语言即时翻译",
      searchBarPlaceholder: "输入待翻译的单词或语句 (中/英/日/韩/法/德/西/俄)...",
      searchText,
      isLoading,
      onSearchTextChange: (text: string) => setSearchText(text),
      searchBarAccessory: List.Dropdown(
        {
          tooltip: "选择目标语言",
          value: targetLang,
          onChange: (newLang: string) => setTargetLang(newLang)
        },
        ...SUPPORTED_LANGUAGES.map((lang) =>
          List.Dropdown.Item({
            key: lang.code,
            title: `${lang.flag} ${lang.name}`,
            value: lang.code
          })
        )
      )
    },
    [
      ...(result
        ? [
            List.Section(
              { title: `翻译结果 (${result.sourceLang.toUpperCase()} → ${result.targetLang.toUpperCase()})` },
              [
                List.Item({
                  id: "trans-main-result",
                  title: result.translatedText,
                  subtitle: result.phonetic ? `${result.phonetic} · ${result.sourceText}` : result.sourceText,
                  icon: Icon.Globe,
                  accessories: [{ text: `${result.sourceLang} → ${result.targetLang}` }],
                  actions: ActionPanel({ title: "操作" }, [
                    Action({
                      title: "复制译文",
                      icon: Icon.CopyClipboard,
                      onAction: () => handleCopyAndSave(result.sourceText, result.translatedText, result.sourceLang, result.targetLang)
                    }),
                    Action.CopyToClipboard({
                      title: "复制双语对照",
                      content: `${result.sourceText} - ${result.translatedText}`,
                      icon: Icon.Document
                    })
                  ])
                })
              ]
            ),
            ...(result.definitions && result.definitions.length > 0
              ? [
                  List.Section(
                    { title: "词典释义" },
                    result.definitions.map((def, idx) =>
                      List.Item({
                        id: `def-${idx}`,
                        title: def.meaning,
                        subtitle: `词性: ${def.pos}`,
                        icon: Icon.Document,
                        actions: ActionPanel({ title: "释义操作" }, [
                          Action.CopyToClipboard({
                            title: "复制释义",
                            content: `${def.pos} ${def.meaning}`,
                            icon: Icon.CopyClipboard
                          })
                        ])
                      })
                    )
                  )
                ]
              : []),
            ...(result.examples && result.examples.length > 0
              ? [
                  List.Section(
                    { title: "例句参考" },
                    result.examples.map((ex, idx) =>
                      List.Item({
                        id: `ex-${idx}`,
                        title: ex.target,
                        subtitle: ex.source,
                        icon: Icon.Check,
                        actions: ActionPanel({ title: "例句操作" }, [
                          Action.CopyToClipboard({
                            title: "复制例句",
                            content: `${ex.source}\n${ex.target}`,
                            icon: Icon.CopyClipboard
                          })
                        ])
                      })
                    )
                  )
                ]
              : [])
          ]
        : [
            List.Section(
              { title: history.length > 0 ? "翻译历史记录" : "快速指南" },
              history.length > 0
                ? history.map((item: TranslationHistoryItem) =>
                    List.Item({
                      id: item.id,
                      title: item.translatedText,
                      subtitle: `${item.sourceText} (${item.sourceLang} → ${item.targetLang})`,
                      icon: Icon.Clock,
                      accessories: [
                        { text: new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }
                      ],
                      actions: ActionPanel({ title: "历史操作" }, [
                        Action({
                          title: "复制此译文",
                          icon: Icon.CopyClipboard,
                          onAction: async () => {
                            await Clipboard.copy(item.translatedText);
                            await showToast(Toast.Style.Success, "历史译文已复制");
                          }
                        }),
                        Action({
                          title: "重新查词",
                          icon: Icon.ArrowRight,
                          onAction: () => setSearchText(item.sourceText)
                        }),
                        Action({
                          title: "清空所有翻译历史",
                          icon: Icon.Trash,
                          onAction: handleClearHistory
                        })
                      ])
                    })
                  )
                : [
                    List.Item({
                      id: "guide-1",
                      title: "中英自动互译",
                      subtitle: "直接输入中文词句或英文单词，自动感应互译",
                      icon: Icon.Star
                    }),
                    List.Item({
                      id: "guide-2",
                      title: "多国语言自由切换",
                      subtitle: "右上角下拉框支持中、英、日、韩、法、德、西、俄等",
                      icon: Icon.Globe
                    })
                  ]
            )
          ])
    ]
  );
}
