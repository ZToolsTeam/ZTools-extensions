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
import { evaluateExpression, type HistoryItem } from "./engine.js";

const DEFAULT_HISTORY: HistoryItem[] = [
  { id: "hist-1", expression: "1024 * 768", result: "786432", timestamp: Date.now() - 3600000 },
  { id: "hist-2", expression: "sqrt(65536)", result: "256", timestamp: Date.now() - 7200000 }
];

export default function CalculatorCommand() {
  const [searchText, setSearchText] = useState<string>("");
  const [history, setHistory] = useState<HistoryItem[]>(DEFAULT_HISTORY);

  const trimmed = searchText.trim();
  const evalResult = trimmed ? evaluateExpression(trimmed) : null;

  const handleCopyAndSave = async (expr: string, res: string) => {
    await Clipboard.copy(res);
    setHistory((prev: HistoryItem[]) => [
      { id: "calc_" + Math.random().toString(36).slice(2, 9), expression: expr, result: res, timestamp: Date.now() },
      ...prev.slice(0, 19)
    ]);
    await showToast(Toast.Style.Success, "结果已复制并记录");
  };

  const handleClearHistory = async () => {
    setHistory([]);
    await showToast(Toast.Style.Success, "历史记录已清空");
  };

  return List(
    {
      navigationTitle: "极简即时计算器",
      searchBarPlaceholder: "输入算式，如 256 * 16, sqrt(144), 2^10, sin(30)...",
      searchText,
      onSearchTextChange: (text: string) => setSearchText(text)
    },
    [
      // 1. 实时计算结果区
      ...(evalResult
        ? [
            List.Section(
              { title: "实时计算结果" },
              evalResult.success
                ? [
                    List.Item({
                      id: "calc-current-result",
                      title: evalResult.formatted || "0",
                      subtitle: `= ${trimmed}`,
                      icon: Icon.Check,
                      accessories: [
                        { text: "回车复制", icon: Icon.CopyClipboard }
                      ],
                      actions: ActionPanel({ title: "操作" }, [
                        Action({
                          title: "复制计算结果",
                          icon: Icon.CopyClipboard,
                          onAction: () => handleCopyAndSave(trimmed, evalResult.formatted || "")
                        }),
                        Action.CopyToClipboard({
                          title: "复制完整算式与结果",
                          content: `${trimmed} = ${evalResult.formatted}`,
                          icon: Icon.Document
                        })
                      ])
                    })
                  ]
                : [
                    List.Item({
                      id: "calc-current-error",
                      title: evalResult.error || "算式待完善",
                      subtitle: trimmed,
                      icon: Icon.ExclamationMark,
                      accessories: [{ text: "输入中" }],
                      actions: ActionPanel({ title: "操作" }, [
                        Action({
                          title: "清空输入",
                          icon: Icon.Trash,
                          onAction: () => setSearchText("")
                        })
                      ])
                    })
                  ]
            )
          ]
        : []),

      // 2. 常用函数提示或计算历史区
      List.Section(
        { title: history.length > 0 ? "历史计算记录" : "支持的函数与运算符" },
        history.length > 0
          ? history.map((item: HistoryItem) =>
              List.Item({
                id: item.id,
                title: item.result,
                subtitle: item.expression,
                icon: Icon.Clock,
                accessories: [
                  { text: new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }
                ],
                actions: ActionPanel({ title: "历史操作" }, [
                  Action({
                    title: "复制此结果",
                    icon: Icon.CopyClipboard,
                    onAction: async () => {
                      await Clipboard.copy(item.result);
                      await showToast(Toast.Style.Success, "历史结果已复制");
                    }
                  }),
                  Action({
                    title: "将此结果带入输入框",
                    icon: Icon.ArrowRight,
                    onAction: () => setSearchText(item.result)
                  }),
                  Action({
                    title: "清空所有计算历史",
                    icon: Icon.Trash,
                    onAction: handleClearHistory
                  })
                ])
              })
            )
          : [
              List.Item({
                id: "help-1",
                title: "加减乘除与乘方: + - * / % ^",
                subtitle: "例: 2 ^ 10 * 3 + 128 / 4",
                icon: Icon.Star
              }),
              List.Item({
                id: "help-2",
                title: "开方与三角函数: sqrt, cbrt, sin, cos, tan",
                subtitle: "例: sqrt(256), sin(30)",
                icon: Icon.Pin
              }),
              List.Item({
                id: "help-3",
                title: "对数与取整: log, ln, round, floor, ceil",
                subtitle: "例: log(1000), round(3.14159)",
                icon: Icon.Pin
              })
            ]
      )
    ]
  );
}
