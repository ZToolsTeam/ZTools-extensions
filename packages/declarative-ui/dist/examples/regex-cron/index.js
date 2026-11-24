import React, { Action, ActionPanel, Color, Icon, List, useMemo, useState } from '../../index.js';
import { REGEX_PRESETS, parseAndExplainCron, runSafeRegexMatch } from './regex-cron-service.js';
export * from './types.js';
export * from './regex-cron-service.js';
const CRON_TEMPLATES = [
    { id: 'cron-daily-2am', expr: '0 0 2 * * ?', title: '每天凌晨 02:00:00 执行备份' },
    { id: 'cron-every-15m', expr: '*/15 * * * *', title: '每隔 15 分钟轮询同步一次' },
    { id: 'cron-workday-930', expr: '0 30 9 ? * MON-FRI', title: '每个工作日上午 09:30:00 推送日报' },
    { id: 'cron-month-1st', expr: '0 0 0 1 * ?', title: '每月 1 号零点生成月度账单' }
];
export function RegexCronCommand(props = {}) {
    const defaultMode = props.initialMode ??
        (props.featureCode === 'regex-tester'
            ? 'tester'
            : props.featureCode === 'cron-explainer'
                ? 'cron'
                : 'dict');
    const [currentMode, setCurrentMode] = useState(defaultMode);
    const [searchText, setSearchText] = useState(props.initialSearchText ?? '');
    const [testSample, setTestSample] = useState(props.initialTestSample ??
        '联系人手机：13800138000，备用号：18612345678，身份证：11010519900307281X，车牌：京AD12345');
    const filteredRegexList = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        if (!q)
            return REGEX_PRESETS;
        return REGEX_PRESETS.filter((item) => item.title.toLowerCase().includes(q) ||
            item.categoryLabel.toLowerCase().includes(q) ||
            item.tags.some((t) => t.toLowerCase().includes(q)) ||
            item.description.toLowerCase().includes(q));
    }, [searchText]);
    const activeTesterPattern = currentMode === 'tester' && searchText.trim()
        ? searchText.trim()
        : '1(?:3\\d|4[5-9]|5[0-35-9]|6[2567]|7[0-8]|8\\d|9[0-35-9])\\d{8}';
    const regexMatchResult = useMemo(() => runSafeRegexMatch(activeTesterPattern, testSample, 'g'), [activeTesterPattern, testSample]);
    const activeCronExpr = currentMode === 'cron' && searchText.trim() ? searchText.trim() : '0 0 2 * * ?';
    const cronResult = useMemo(() => parseAndExplainCron(activeCronExpr), [activeCronExpr]);
    const handleLoadIntoTester = (item) => {
        setCurrentMode('tester');
        setSearchText(item.pattern);
        if (item.validExamples.length > 0) {
            setTestSample(item.validExamples.join('  |  '));
        }
    };
    return (React.createElement(List, { searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: currentMode === 'cron'
            ? '输入 5/6 位 Cron 表达式（如 0 0 2 * * ? 或 */15 * * * *）...'
            : currentMode === 'tester'
                ? '输入待测试正则表达式（如 /1[3-9]\\d{9}/g）...'
                : '搜索常用中国本土正则（如：身份证、手机号、信用代码、新能源车牌）...', searchBarAccessory: React.createElement(List.Dropdown, { value: currentMode, onChange: (v) => setCurrentMode(v), tooltip: "\u5207\u6362\u5DE5\u4F5C\u6A21\u5F0F" },
            React.createElement(List.Dropdown.Item, { title: "\u4E2D\u56FD\u5E38\u7528\u6B63\u5219\u5B57\u5178", value: "dict", icon: Icon.Document }),
            React.createElement(List.Dropdown.Item, { title: "\u5B9E\u65F6\u6B63\u5219\u6D4B\u8BD5\u5668", value: "tester", icon: Icon.Play }),
            React.createElement(List.Dropdown.Item, { title: "Cron \u4E2D\u6587\u7FFB\u8BD1\u4E0E\u63A8\u7B97", value: "cron", icon: Icon.Clock })), isShowingDetail: true },
        currentMode === 'dict' && (React.createElement(List.Section, { title: `常用本土业务正则库（共 ${filteredRegexList.length} 项）` }, filteredRegexList.map((item) => (React.createElement(List.Item, { key: item.id, id: item.id, icon: Icon.Code, title: item.title, subtitle: item.categoryLabel, accessories: [{ tag: item.tags[0] || item.categoryLabel }], detail: React.createElement(List.Item.Detail, { markdown: `### ${item.title}
\`\`\`regexp
${item.pattern}
\`\`\`

#### 规则说明
${item.description}

#### 合规通过用例 (Pass)
${item.validExamples.map((ex) => `- \`${ex}\``).join('\n')}

#### 拦截反例用例 (Reject)
${item.invalidExamples.map((ex) => `- \`${ex}\` *(不匹配)*`).join('\n')}
`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u4E1A\u52A1\u5206\u7C7B", text: item.categoryLabel }),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u9002\u7528\u8303\u56F4", text: item.scope }),
                    React.createElement(List.Item.Detail.Metadata.Separator, null),
                    React.createElement(List.Item.Detail.Metadata.Label, { title: "\u63A8\u8350\u4FEE\u9970\u7B26", text: item.recommendedFlags || '无 (默认精准匹配)' })) }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6B63\u5219\u8868\u8FBE\u5F0F", content: item.pattern }),
                React.createElement(Action, { title: "\u8F7D\u5165\u5230\u5B9E\u65F6\u6B63\u5219\u6D4B\u8BD5\u5668", icon: Icon.Play, shortcut: { modifiers: ['cmd'], key: 't' }, onAction: () => handleLoadIntoTester(item) }),
                React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5E26\u659C\u6760\u5B57\u9762\u91CF", content: `/${item.pattern}/${item.recommendedFlags || ''}`, shortcut: { modifiers: ['cmd'], key: 'c' } })) }))))),
        currentMode === 'tester' && (React.createElement(List.Section, { title: "\u5B9E\u65F6\u6B63\u5219\u5339\u914D\u4E0E\u6355\u83B7\u7EC4\u900F\u89C6" },
            React.createElement(List.Item, { id: "tester-summary", icon: regexMatchResult.isValidRegex ? Icon.CheckCircle : Icon.XMarkCircle, title: regexMatchResult.isValidRegex
                    ? `共命中 ${regexMatchResult.totalMatches} 处匹配（耗时 ${regexMatchResult.elapsedMs}ms）`
                    : '正则表达式语法错误或已触发安全熔断', subtitle: activeTesterPattern, accessories: [
                    regexMatchResult.isValidRegex
                        ? { tag: '语法有效' }
                        : { tag: { value: '异常拦截', color: Color.Red } }
                ], detail: React.createElement(List.Item.Detail, { markdown: regexMatchResult.isValidRegex
                        ? `### 实时测试结果
\`\`\`regexp
/${activeTesterPattern}/g
\`\`\`

#### 待测样本原文
\`\`\`text
${testSample}
\`\`\`

#### 命中片段与捕获组清单 (${regexMatchResult.totalMatches} 项)
${regexMatchResult.matches.length === 0
                            ? '*当前样本未命中任何匹配项*'
                            : regexMatchResult.matches
                                .map((m) => `- **Match #${m.index + 1}**: \`${m.text}\` *(位置 [${m.start}, ${m.end}])*\n${m.groups.length > 0
                                ? m.groups.map((g) => `  - Group ${g.groupIndex}: \`${g.value}\``).join('\n')
                                : ''}`)
                                .join('\n')}
`
                        : `### 正则异常诊断
> **错误详情**：${regexMatchResult.errorMessage}
` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5F53\u524D\u6B63\u5219\u8868\u8FBE\u5F0F", content: activeTesterPattern }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5168\u90E8\u547D\u4E2D\u7ED3\u679C", content: regexMatchResult.matches.map((m) => m.text).join('\n') })) }))),
        currentMode === 'cron' && (React.createElement(List.Section, { title: "Cron \u8BED\u4E49\u76F4\u8BD1\u4E0E\u672A\u6765 5 \u6B21\u89E6\u53D1\u65F6\u95F4\u63A8\u7B97" },
            React.createElement(List.Item, { id: "cron-live-result", icon: cronResult.isValid ? Icon.Clock : Icon.XMarkCircle, title: cronResult.chineseSummary, subtitle: cronResult.expression, accessories: [
                    cronResult.isValid
                        ? { tag: '解析成功' }
                        : { tag: { value: '表达式有误', color: Color.Red } }
                ], detail: React.createElement(List.Item.Detail, { markdown: cronResult.isValid
                        ? `### Cron 自然语言直译
> **${cronResult.chineseSummary}**

#### 未来 5 次执行时间推算 (Asia/Shanghai)
| 批次 | 触发绝对时间 | 相对倒计时 |
| :--- | :--- | :--- |
${cronResult.nextRuns
                            .map((r, i) => `| 第 ${i + 1} 次 | \`${r.formattedTime}\` | ${r.relativeTime} |`)
                            .join('\n')}

#### 槽位字段拆解
| 槽位 | 当前值 | 语义说明 |
| :--- | :--- | :--- |
${cronResult.slots.map((s) => `| ${s.name} | \`${s.value}\` | ${s.meaning} |`).join('\n')}
`
                        : `### Cron 解析失败
> **错误原因**：${cronResult.errorMessage}
` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 Cron \u8868\u8FBE\u5F0F", content: cronResult.expression }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u672A\u6765 5 \u6B21\u6267\u884C\u65F6\u95F4", content: cronResult.nextRuns.map((r) => r.formattedTime).join('\n') })) }),
            CRON_TEMPLATES.map((tpl) => (React.createElement(List.Item, { key: tpl.id, id: tpl.id, icon: Icon.Calendar, title: tpl.title, subtitle: tpl.expr, accessories: [{ text: '常用模板' }], actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: "\u63A8\u7B97\u6B64 Cron \u6A21\u677F", icon: Icon.Play, onAction: () => setSearchText(tpl.expr) }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u6A21\u677F\u8868\u8FBE\u5F0F", content: tpl.expr })) })))))));
}
export default RegexCronCommand;
