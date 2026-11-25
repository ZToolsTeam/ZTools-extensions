import React from "../../index.js";
import { List, Detail, ActionPanel, Action, Icon, Color, showToast, Toast, useNavigation } from "../../index.js";
import { useState, useEffect } from "../../runtime/hooks.js";
import { SUPPORTED_CURRENCIES, calculateAllConversions, parseAmountAndCurrency, getRatesCache, refreshRates } from "./rates.js";
export * from "./rates.js";
/**
 * 货币与汇率趋势详情视图 (现代纯正 TSX 模式)
 */
export function CurrencyDetailView({ fromCode, item, amount }) {
    const rateStr = `1 ${fromCode} = ${item.rateAgainstBase} ${item.code}`;
    const inverseStr = `1 ${item.code} = ${item.inverseRate} ${fromCode}`;
    const markdown = `
# ${item.flag} ${item.name}

> **换算总额**: \`${amount} ${fromCode}\` ➔ **\`${item.formattedAmount}\`**  
> **基准汇率**: \`${rateStr}\` | **反向汇率**: \`${inverseStr}\`

---

### 近期汇率走势模拟 (7-Day Trend)
| 日期 | 汇率 (对 ${fromCode}) | 涨跌幅 |
| :--- | :--- | :--- |
| **今日 (最新)** | \`${item.rateAgainstBase}\` | \`${item.change24h}\` |
| **昨日** | \`${(item.rateAgainstBase * 0.998).toFixed(4)}\` | \`+0.20%\` |
| **3 天前** | \`${(item.rateAgainstBase * 0.995).toFixed(4)}\` | \`-0.12%\` |
| **5 天前** | \`${(item.rateAgainstBase * 0.991).toFixed(4)}\` | \`+0.35%\` |
| **7 天前** | \`${(item.rateAgainstBase * 0.988).toFixed(4)}\` | \`+0.08%\` |

---

### 换算计算公式
\`\`\`
${amount} ${fromCode} × ${item.rateAgainstBase} = ${item.convertedAmount} ${item.code}
\`\`\`
  `;
    return (React.createElement(Detail, { markdown: markdown, navigationTitle: `${fromCode} ➔ ${item.code} 汇率详情`, metadata: React.createElement(Detail.Metadata, null,
            React.createElement(Detail.Metadata.Label, { title: "\u57FA\u51C6\u8D27\u5E01", text: fromCode, icon: Icon.Circle }),
            React.createElement(Detail.Metadata.Label, { title: "\u76EE\u6807\u8D27\u5E01", text: item.code, icon: Icon.ArrowRight }),
            React.createElement(Detail.Metadata.Label, { title: "\u5B9E\u65F6\u6C47\u7387", text: rateStr, icon: Icon.Clock }),
            React.createElement(Detail.Metadata.Label, { title: "\u53CD\u5411\u6BD4\u7387", text: inverseStr, icon: Icon.Repeat }),
            React.createElement(Detail.Metadata.Separator, null),
            React.createElement(Detail.Metadata.TagList, { title: "24h \u6CE2\u52A8" },
                React.createElement(Detail.Metadata.TagList.Item, { text: item.change24h, color: item.change24h.startsWith("+") ? Color.Green : Color.Red }))), actions: React.createElement(ActionPanel, { title: "\u6C47\u7387\u64CD\u4F5C" },
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6362\u7B97\u91D1\u989D", content: item.formattedAmount, icon: Icon.CopyClipboard }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u7EAF\u6570\u5B57\u91D1\u989D", content: String(item.convertedAmount), icon: Icon.CopyClipboard }),
            React.createElement(Action.Paste, { title: "\u7C98\u8D34\u5230\u524D\u53F0\u5E94\u7528", content: item.formattedAmount, icon: Icon.Clipboard }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5B8C\u6574\u6362\u7B97\u8BED\u53E5", content: `${amount} ${fromCode} = ${item.formattedAmount} (${item.code})`, icon: Icon.Document })) }));
}
/**
 * 汇率换算主命令 (现代纯正 TSX 模式)
 */
export default function CurrencyExchangeCommand() {
    const [baseCurrency, setBaseCurrency] = useState("USD");
    const [inputText, setInputText] = useState("100");
    const [ratesCache, setRatesCache] = useState(null);
    const { push } = useNavigation();
    useEffect(() => {
        getRatesCache().then((data) => setRatesCache(data));
    }, []);
    const { amount } = parseAmountAndCurrency(inputText, baseCurrency);
    const items = calculateAllConversions(amount, baseCurrency, ratesCache?.rates);
    const handleRefresh = async () => {
        const updated = await refreshRates();
        setRatesCache(updated);
        await showToast(Toast.Style.Success, `汇率已刷新 (${updated.lastUpdated})`);
    };
    return (React.createElement(List, { navigationTitle: "\u5168\u7403\u591A\u5E01\u79CD\u5B9E\u65F6\u6C47\u7387\u6362\u7B97", searchBarPlaceholder: "\u8F93\u5165\u6362\u7B97\u91D1\u989D (\u4F8B\u5982: 100, 2500, 50 EUR, $888)...", searchText: inputText, onSearchTextChange: (val) => setInputText(val), searchBarAccessory: React.createElement(List.Dropdown, { tooltip: "\u9009\u62E9\u57FA\u51C6\u8D27\u5E01", value: baseCurrency, onChange: (newVal) => setBaseCurrency(newVal) }, SUPPORTED_CURRENCIES.map((c) => (React.createElement(List.Dropdown.Item, { key: c.code, title: `${c.flag} ${c.code} - ${c.name}`, value: c.code })))), actions: React.createElement(ActionPanel, { title: "\u5168\u5C40\u64CD\u4F5C" },
            React.createElement(Action, { title: "\u5237\u65B0\u6700\u65B0\u6C47\u7387 (Refresh Rates)", icon: Icon.Repeat, onAction: handleRefresh })) },
        React.createElement(List.Section, { title: `折算结果 (基准: ${amount} ${baseCurrency})` }, items.map((item) => {
            const isBase = item.code === baseCurrency;
            const statement = `${amount} ${baseCurrency} = ${item.formattedAmount} (${item.code})`;
            return (React.createElement(List.Item, { key: item.code, id: `cur_${item.code}`, title: `${item.flag} ${item.code} — ${item.formattedAmount}`, subtitle: `1 ${baseCurrency} = ${item.rateAgainstBase} ${item.code} • ${item.name}`, icon: isBase ? Icon.Checkmark : Icon.Circle, accessories: [
                    { text: item.change24h },
                    { text: isBase ? "基准货币" : `反向: ${item.inverseRate}` }
                ], actions: React.createElement(ActionPanel, { title: item.formattedAmount },
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6362\u7B97\u91D1\u989D", content: item.formattedAmount, icon: Icon.CopyClipboard }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u7EAF\u6570\u5B57\u91D1\u989D", content: String(item.convertedAmount), icon: Icon.CopyClipboard }),
                    React.createElement(Action.Paste, { title: "\u7C98\u8D34\u5230\u524D\u53F0\u5E94\u7528", content: item.formattedAmount, icon: Icon.Clipboard }),
                    !isBase && (React.createElement(Action, { title: "\u8BBE\u4E3A\u57FA\u51C6\u8D27\u5E01", icon: Icon.Repeat, onAction: () => setBaseCurrency(item.code) })),
                    React.createElement(Action.Push, { title: "\u67E5\u770B\u6C47\u7387\u8D8B\u52BF\u4E0E\u8BE6\u60C5", icon: Icon.Eye, target: () => (React.createElement(CurrencyDetailView, { fromCode: baseCurrency, item: item, amount: amount })) }),
                    React.createElement(Action, { title: "\u5237\u65B0\u6700\u65B0\u6C47\u7387", icon: Icon.Repeat, onAction: handleRefresh })) }));
        }))));
}
