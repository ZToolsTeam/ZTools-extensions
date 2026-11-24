import type { CronParseResult, RegexMatchResult, RegexPresetItem } from './types.js';
export declare const REGEX_PRESETS: RegexPresetItem[];
/**
 * 静态检测是否存在恶性嵌套量词（如 `(a+)+`, `([a-z]+)*`）导致灾难性回溯 ReDoS
 */
export declare function hasCatastrophicBacktracking(pattern: string): boolean;
/**
 * 解析形如 `/pattern/flags` 或纯 `pattern` 字符串
 */
export declare function parseRegexInput(rawInput: string, defaultFlags?: string): {
    pattern: string;
    flags: string;
};
/**
 * 安全执行正则匹配与捕获组拆解（含 ReDoS 拦截与超长文本保护）
 */
export declare function runSafeRegexMatch(rawPatternInput: string, testText: string, explicitFlags?: string): RegexMatchResult;
/**
 * 解析 5 位（Linux Crontab）或 6 位（Spring/Quartz）Cron 表达式，输出中文语义与未来 5 次触发时间
 */
export declare function parseAndExplainCron(rawExpression: string, baseDate?: Date, count?: number): CronParseResult;
