import { TranslationResult } from "./translate.js";
export * from "./languages.js";
export * from "./translate.js";
/**
 * 翻译详情视图 (现代纯正 TSX 模式)
 */
export declare function TranslateDetailView({ item }: {
    item: TranslationResult;
}): JSX.Element;
/**
 * Google 翻译主命令 (现代纯正 TSX 模式)
 */
export default function GoogleTranslateCommand(): JSX.Element;
