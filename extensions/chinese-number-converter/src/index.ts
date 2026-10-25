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
  numberToChinese,
  numberToTicketUppercase,
  parseChineseNumber,
  type TicketRules,
  DEFAULT_TICKET_RULES,
  ConversionError
} from "./logic.js";

interface ConversionEntry {
  id: string;
  title: string;
  subtitle: string;
  tag: string;
  icon: any;
}

const PRESET_EXAMPLES = [
  { label: "发票常规金额", value: "12345.67" },
  { label: "零头分币金额", value: "0.05" },
  { label: "大额跨级金额", value: "100200300.50" },
  { label: "中文大写反查", value: "壹万贰仟叁佰肆拾伍元陆角柒分" },
  { label: "中文简体数字", value: "三千五百二十点五" },
];

export default function ChineseNumberConverterCommand() {
  const [searchText, setSearchText] = useState<string>("");
  const [ticketRules, setTicketRules] = useState<TicketRules>(DEFAULT_TICKET_RULES);

  const trimmed = searchText.trim();

  // 执行双向转换与结果生成
  const results: ConversionEntry[] = [];
  let errorMsg: string | null = null;

  if (trimmed) {
    const isArabic = /^[+-]?[0-9,.]+$/.test(trimmed);
    const hasChineseChars = /[\u4e00-\u9fa5]/.test(trimmed);

    if (isArabic) {
      try {
        const ticketRmb = numberToTicketUppercase(trimmed, ticketRules);
        const upperChinese = numberToChinese(trimmed, "upper");
        const lowerChinese = numberToChinese(trimmed, "lower");

        results.push({
          id: "res-rmb",
          title: ticketRmb,
          subtitle: `人民币发票大写 (${ticketRules.roundingMode === "half-up" ? "四舍五入" : "截断"})`,
          tag: "发票大写",
          icon: Icon.Document,
        });
        results.push({
          id: "res-upper",
          title: upperChinese,
          subtitle: "中文大写 (财务正体)",
          tag: "中文大写",
          icon: Icon.Text,
        });
        results.push({
          id: "res-lower",
          title: lowerChinese,
          subtitle: "中文小写 (日常简体)",
          tag: "中文小写",
          icon: Icon.Text,
        });
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : "数字转换失败";
      }
    } else if (hasChineseChars) {
      try {
        const parsed = parseChineseNumber(trimmed);
        const arabicNum = parsed.value;
        const ticketRmb = numberToTicketUppercase(arabicNum, ticketRules);
        const upperChinese = numberToChinese(arabicNum, "upper");
        const lowerChinese = numberToChinese(arabicNum, "lower");

        results.push({
          id: "res-arabic",
          title: arabicNum,
          // 口语省略写法（三百五、一万五）与规范写法（三百零五）结果不同，提示用户核对理解是否正确
          subtitle: parsed.colloquial
            ? `阿拉伯数字金额 (按口语省略写法理解，${numberToChinese(arabicNum, "lower")})`
            : "阿拉伯数字金额",
          tag: "阿拉伯数字",
          icon: Icon.Text,
        });
        results.push({
          id: "res-ticket",
          title: ticketRmb,
          subtitle: "规范人民币大写",
          tag: "发票大写",
          icon: Icon.Document,
        });
        results.push({
          id: "res-upper",
          title: upperChinese,
          subtitle: "规范中文大写",
          tag: "中文大写",
          icon: Icon.Document,
        });
        results.push({
          id: "res-lower",
          title: lowerChinese,
          subtitle: "规范中文小写",
          tag: "中文小写",
          icon: Icon.Text,
        });
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : "中文数字解析失败";
      }
    } else {
      errorMsg = "请输入有效的阿拉伯数字或中文数字";
    }
  }

  const handleCopy = async (val: string, label: string) => {
    await Clipboard.copy(val);
    await showToast(Toast.Style.Success, `已复制 ${label}: ${val}`);
  };

  const handleTogglePrefix = async () => {
    setTicketRules((prev) => ({
      ...prev,
      currencyPrefix: prev.currencyPrefix === "人民币" ? "" : "人民币",
    }));
    await showToast(Toast.Style.Success, "已切换人民币前缀");
  };

  const handleToggleYuan = async () => {
    setTicketRules((prev) => ({
      ...prev,
      yuanUnit: prev.yuanUnit === "元" ? "圆" : "元",
    }));
    await showToast(Toast.Style.Success, "已切换元/圆单位");
  };

  const handleToggleWhole = async () => {
    setTicketRules((prev) => ({
      ...prev,
      wholeSuffix: prev.wholeSuffix === "整" ? "正" : "整",
    }));
    await showToast(Toast.Style.Success, "已切换整/正后缀");
  };

  const handleToggleRounding = async () => {
    setTicketRules((prev) => ({
      ...prev,
      roundingMode: prev.roundingMode === "half-up" ? "truncate" : "half-up",
    }));
    await showToast(Toast.Style.Success, "已切换舍入规则");
  };

  return List(
    {
      navigationTitle: "中文数字与金额转换",
      searchBarPlaceholder: "输入数字 (如 12345.67) 或中文大写 (如 壹万贰仟元)...",
      searchText,
      onSearchTextChange: (text: string) => setSearchText(text),
    },
    [
      // 1. 实时转换结果展示
      ...(trimmed
        ? [
            List.Section(
              { title: errorMsg ? "解析提示" : `转换结果 (${trimmed})` },
              errorMsg
                ? [
                    List.Item({
                      id: "err-item",
                      title: errorMsg,
                      subtitle: trimmed,
                      icon: Icon.ExclamationMark,
                      accessories: [{ text: "输入错误" }],
                      actions: ActionPanel({ title: "操作" }, [
                        Action({
                          title: "清空输入",
                          icon: Icon.Trash,
                          onAction: () => setSearchText(""),
                        }),
                      ]),
                    }),
                  ]
                : results.map((item) =>
                    List.Item({
                      id: item.id,
                      title: item.title,
                      subtitle: item.subtitle,
                      icon: item.icon,
                      accessories: [
                        { text: item.tag },
                        { text: "回车复制", icon: Icon.CopyClipboard },
                      ],
                      actions: ActionPanel({ title: "操作" }, [
                        Action({
                          title: `复制 ${item.tag}`,
                          icon: Icon.CopyClipboard,
                          onAction: () => handleCopy(item.title, item.tag),
                        }),
                        Action.CopyToClipboard({
                          title: "复制完整对照 (输入 = 结果)",
                          content: `${trimmed} = ${item.title}`,
                          icon: Icon.Document,
                        }),
                        ActionPanel.Submenu(
                          {
                            title: "发票规则设置",
                            icon: Icon.Gear,
                          },
                          [
                            Action({
                              key: "toggle-prefix",
                              title: `币种前缀: ${ticketRules.currencyPrefix ? "人民币" : "无 (点击切换)"}`,
                              icon: ticketRules.currencyPrefix ? Icon.Check : Icon.Circle,
                              onAction: handleTogglePrefix,
                            }),
                            Action({
                              key: "toggle-yuan",
                              title: `金额单位: ${ticketRules.yuanUnit} (点击切换)`,
                              icon: Icon.Check,
                              onAction: handleToggleYuan,
                            }),
                            Action({
                              key: "toggle-whole",
                              title: `整额后缀: ${ticketRules.wholeSuffix} (点击切换)`,
                              icon: Icon.Check,
                              onAction: handleToggleWhole,
                            }),
                            Action({
                              key: "toggle-rounding",
                              title: `分位舍入: ${ticketRules.roundingMode === "half-up" ? "四舍五入" : "直接截断"}`,
                              icon: Icon.Check,
                              onAction: handleToggleRounding,
                            }),
                          ]
                        ),
                      ]),
                    })
                  )
            ),
          ]
        : []),

      // 2. 常用示例快捷选择
      List.Section(
        { title: "常用示例 (点击带入输入框)" },
        PRESET_EXAMPLES.map((ex, idx) =>
          List.Item({
            id: `example-${idx}`,
            title: ex.value,
            subtitle: ex.label,
            icon: Icon.Star,
            accessories: [{ text: "回车填入" }],
            actions: ActionPanel({ title: "示例操作" }, [
              Action({
                title: `带入示例: ${ex.value}`,
                icon: Icon.ArrowRight,
                onAction: () => setSearchText(ex.value),
              }),
              Action({
                title: "复制此示例值",
                icon: Icon.CopyClipboard,
                onAction: () => handleCopy(ex.value, ex.label),
              }),
            ]),
          })
        )
      ),

      // 3. 票据与舍入规则当前配置
      List.Section(
        { title: "发票与票据大写当前规则" },
        [
          List.Item({
            id: "rule-prefix",
            title: `前缀设置: ${ticketRules.currencyPrefix || "无前缀"}`,
            subtitle: "可切换为前置“人民币”",
            icon: ticketRules.currencyPrefix ? Icon.Check : Icon.Circle,
            accessories: [{ text: "回车切换" }],
            actions: ActionPanel({ title: "规则调整" }, [
              Action({
                title: "切换“人民币”前缀",
                icon: Icon.Repeat,
                onAction: handleTogglePrefix,
              }),
            ]),
          }),
          List.Item({
            id: "rule-yuan",
            title: `元/圆单位: 当前使用“${ticketRules.yuanUnit}”`,
            subtitle: "符合《正确填写票据和结算凭证的基本规定》",
            icon: Icon.Check,
            accessories: [{ text: "回车切换" }],
            actions: ActionPanel({ title: "规则调整" }, [
              Action({
                title: "切换“元”或“圆”",
                icon: Icon.Repeat,
                onAction: handleToggleYuan,
              }),
            ]),
          }),
          List.Item({
            id: "rule-rounding",
            title: `分位精度处理: ${ticketRules.roundingMode === "half-up" ? "四舍五入 (Half-up)" : "直接截断 (Truncate)"}`,
            subtitle: "第三位小数及之后的舍入行为",
            icon: Icon.Check,
            accessories: [{ text: "回车切换" }],
            actions: ActionPanel({ title: "规则调整" }, [
              Action({
                title: "切换舍入模式",
                icon: Icon.Repeat,
                onAction: handleToggleRounding,
              }),
            ]),
          }),
        ]
      ),
    ]
  );
}
