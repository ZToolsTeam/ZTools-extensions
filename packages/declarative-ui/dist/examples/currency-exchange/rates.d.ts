export interface CurrencyInfo {
    code: string;
    name: string;
    symbol: string;
    flag: string;
    centralBank: string;
}
export declare const SUPPORTED_CURRENCIES: CurrencyInfo[];
export declare const USD_RATES: Record<string, number>;
export declare const STORAGE_KEY_RATES_CACHE = "currency_rates_cache";
export interface RatesCacheData {
    rates: Record<string, number>;
    lastUpdated: string;
}
export declare function getRatesCache(): Promise<RatesCacheData>;
export declare function refreshRates(): Promise<RatesCacheData>;
export interface ConversionItem {
    code: string;
    name: string;
    symbol: string;
    flag: string;
    rateAgainstBase: number;
    inverseRate: number;
    convertedAmount: number;
    formattedAmount: string;
    change24h: string;
}
export declare function parseAmountAndCurrency(input: string, defaultCurrency?: string): {
    amount: number;
    currency: string;
};
export declare function convertCurrency(amount: number, fromCode: string, toCode: string, ratesOverride?: Record<string, number>): number;
export declare function calculateAllConversions(amount: number, baseCurrency: string, ratesOverride?: Record<string, number>): ConversionItem[];
