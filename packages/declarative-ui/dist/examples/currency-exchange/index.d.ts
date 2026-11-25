import { ConversionItem } from "./rates.js";
export * from "./rates.js";
/**
 * 货币与汇率趋势详情视图 (现代纯正 TSX 模式)
 */
export declare function CurrencyDetailView({ fromCode, item, amount }: {
    fromCode: string;
    item: ConversionItem;
    amount: number;
}): JSX.Element;
/**
 * 汇率换算主命令 (现代纯正 TSX 模式)
 */
export default function CurrencyExchangeCommand(): JSX.Element;
