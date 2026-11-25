import { DictWordEntry } from "./types.js";
export * from "./types.js";
export * from "./data.js";
export * from "./storage.js";
/**
 * 单词全屏详情视图
 */
export declare function WordDetailView({ entry }: {
    entry: DictWordEntry;
}): JSX.Element;
/**
 * 词典释义主入口
 * 输入单词即查，展示音标、释义、例句与同义词
 */
export default function DictionaryCommand(): JSX.Element;
