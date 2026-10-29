import React, {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Form,
  useNavigation,
  useEffect,
  useMemo,
  useState
} from '@ztools/declarative-ui'
import {
  REGEX_PRESETS,
  parseAndExplainCron
} from './regex-cron-service.js'
import type { RegexCronMode, RegexPresetItem, RegexMatchResult } from './types.js'

import { runRegexInWorker } from './regex-worker.js'

export * from './types.js'
export * from './regex-cron-service.js'

export interface RegexCronCommandProps {
  featureCode?: string
  initialMode?: RegexCronMode
  initialSearchText?: string
  initialTestSample?: string
}

/** 常用模板统一用五位 Linux 写法，与占位提示、详情说明一致；默认输入“每 15 分钟”已在首项展示，不重复列为模板 */
export const CRON_TEMPLATES = [
  { id: 'cron-daily-2am', expr: '0 2 * * *', title: '每天凌晨 02:00 执行备份' },
  { id: 'cron-hourly', expr: '0 * * * *', title: '每小时整点执行一次' },
  { id: 'cron-workday-930', expr: '30 9 * * 1-5', title: '每个工作日上午 09:30 推送日报' },
  { id: 'cron-month-1st', expr: '0 0 1 * *', title: '每月 1 号零点生成月度账单' }
]

/** 用户输入只能作为代码原文显示：围栏比内容中最长的反引号串更长，内容里的 ``` 不会提前结束代码块 */
export function fencedCode(content: string, language = 'text'): string {
  const body = content.replace(/\r\n?/g, '\n')
  let size = 3
  for (const run of body.matchAll(/`+/g)) size = Math.max(size, run[0].length + 1)
  const fence = '`'.repeat(size)
  return `${fence}${language}\n${body}\n${fence}`
}

/**
 * 自然语言摘要里可能含 *、_、~（如日期字段的步长写法），客户端 Markdown 不支持反斜杠转义，
 * 含这些字符时改用行内代码原样显示，否则加粗显示，避免星号被当成格式吃掉。
 */
export function emphasizeLiteral(text: string): string {
  return /[*_~`]/.test(text) ? inlineCode(text) : `**${text}**`
}

/** 行内代码：换行显示为 \n，含反引号时加长定界符，空串明确标注 */
export function inlineCode(text: string): string {
  if (!text) return '（空匹配）'
  const body = text.replace(/\r\n|\r|\n/g, '\\n')
  let size = 1
  for (const run of body.matchAll(/`+/g)) size = Math.max(size, run[0].length + 1)
  const ticks = '`'.repeat(size)
  const pad = size > 1 || body.startsWith('`') || body.endsWith('`') ? ' ' : ''
  return `${ticks}${pad}${body}${pad}${ticks}`
}

export function EditRegexText({ sample, onSave }: { sample: string; onSave: (value: string) => void }) {
  const [value, setValue] = useState(sample)
  const { pop } = useNavigation()
  return <Form navigationTitle="编辑待测文本" actions={<ActionPanel>
    <Action.SubmitForm title="开始匹配" onSubmit={() => { onSave(value); pop() }} />
  </ActionPanel>}>
    <Form.TextArea id="sample" title="待测文本" placeholder="粘贴需要匹配的文本，支持多行" value={value} onChange={setValue} />
  </Form>
}

export function RegexCronCommand(props: RegexCronCommandProps = {}) {
  const defaultMode: RegexCronMode =
    props.initialMode ??
    (props.featureCode === 'regex-tester'
      ? 'tester'
      : props.featureCode === 'cron-explainer'
        ? 'cron'
        : 'dict')

  const [currentMode, setCurrentMode] = useState<RegexCronMode>(defaultMode)
  const [queries, setQueries] = useState<Record<RegexCronMode, string>>({
    dict: '', tester: '', cron: '*/15 * * * *',
    [defaultMode]: props.initialSearchText ?? (defaultMode === 'cron' ? '*/15 * * * *' : '')
  })
  const searchText = queries[currentMode]
  const setSearchText = (value: string) => setQueries(prev => ({ ...prev, [currentMode]: value }))
  const [testSample, setTestSample] = useState(props.initialTestSample ?? '')
  const { push } = useNavigation()
  const [completed, setCompleted] = useState<{ pattern: string; text: string; result: RegexMatchResult } | null>(null)
  const activeTesterPattern = queries.tester
  const regexMatchResult = completed?.pattern === activeTesterPattern && completed?.text === testSample ? completed.result : null
  useEffect(() => {
    if (currentMode !== 'tester') return
    const controller = new AbortController()
    setCompleted(null)
    const timer = setTimeout(() => {
      void runRegexInWorker(activeTesterPattern, testSample, { signal: controller.signal }).then(result => {
        if (!controller.signal.aborted) setCompleted({ pattern: activeTesterPattern, text: testSample, result })
      })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [currentMode, activeTesterPattern, testSample])
  const editSample = () => push(() => <EditRegexText sample={testSample} onSave={setTestSample} />)

  const filteredRegexList = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (!q) return REGEX_PRESETS
    return REGEX_PRESETS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        item.description.toLowerCase().includes(q)
    )
  }, [searchText])

  const [cronRefresh, setCronRefresh] = useState(0)
  const cronResult = useMemo(() => parseAndExplainCron(queries.cron), [queries.cron, currentMode, cronRefresh])
  const handleLoadIntoTester = (item: RegexPresetItem) => {
    setQueries(prev => ({ ...prev, tester: `/${item.pattern}/${item.recommendedFlags || ''}` }))
    setTestSample(item.validExamples[0] ?? '')
    setCurrentMode('tester')
  }

  return (
    <List
      isLoading={currentMode === 'tester' && !regexMatchResult}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={
        currentMode === 'cron'
          ? '输入五位 Cron 表达式（如 30 9 * * 1-5），也支持六位 Spring 写法'
          : currentMode === 'tester'
            ? '输入待测试正则表达式（如 /1[3-9]\\d{9}/g）...'
            : '搜索常用中国本土正则（如：身份证、手机号、信用代码、新能源车牌）...'
      }
      searchBarAccessory={
        <List.Dropdown
          value={currentMode}
          onChange={(v) => setCurrentMode(v as RegexCronMode)}
          tooltip="切换工作模式"
        >
          <List.Dropdown.Item title="中国常用正则字典" value="dict" icon={Icon.Document} />
          <List.Dropdown.Item title="实时正则测试器" value="tester" icon={Icon.Play} />
          <List.Dropdown.Item title="Cron 中文翻译与推算" value="cron" icon={Icon.Clock} />
        </List.Dropdown>
      }
      isShowingDetail={true}
      filterBar={currentMode === 'cron' ? {
        summaryText: cronResult.calculatedAt ? `计算起点 ${cronResult.calculatedAt}` : '支持五位 Linux 与六位 Spring 基础语法',
        actions: [{ id: 'refresh-cron', title: '重新推算', onAction: () => setCronRefresh(value => value + 1) }]
      } : undefined}
    >
      {currentMode === 'dict' && (
        <List.Section title={`常用本土业务正则库（共 ${filteredRegexList.length} 项）`}>
          {filteredRegexList.map((item) => (
            <List.Item
              key={item.id}
              id={item.id}
              icon={Icon.Code}
              title={item.title}
              subtitle={item.categoryLabel}
              accessories={[{ tag: item.tags[0] || item.categoryLabel }]}
              detail={
                <List.Item.Detail
                  markdown={`### ${item.title}
${inlineCode(item.pattern)}

#### 规则说明
${item.description}

#### 合规通过用例
${item.validExamples.map((ex) => `- \`${ex}\``).join('\n')}

#### 拦截反例用例
${item.invalidExamples.map((ex) => `- \`${ex}\` *(不匹配)*`).join('\n')}
`}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="业务分类" text={item.categoryLabel} />
                      <List.Item.Detail.Metadata.Label title="适用范围" text={item.scope} />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label
                        title="推荐修饰符"
                        text={item.recommendedFlags || '无（默认精准匹配）'}
                      />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title="复制正则表达式" content={item.pattern} />
                  <Action
                    title="载入到实时正则测试器"
                    icon={Icon.Play}
                    shortcut={{ modifiers: ['cmd'], key: 't' }}
                    onAction={() => handleLoadIntoTester(item)}
                  />
                  <Action.CopyToClipboard
                    title="复制带斜杠字面量"
                    content={`/${item.pattern}/${item.recommendedFlags || ''}`}
                    shortcut={{ modifiers: ['cmd'], key: 'c' }}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {currentMode === 'tester' && (
        <List.Section title="实时正则匹配与捕获组透视">
          <List.Item
            id="tester-summary"
            icon={regexMatchResult?.isValidRegex ? Icon.CheckCircle : !activeTesterPattern.trim() ? Icon.Code : Icon.XMarkCircle}
            title={
              regexMatchResult?.isValidRegex
                ? `${regexMatchResult.truncated ? '仅显示前' : '共命中'} ${regexMatchResult.totalMatches} 处匹配（耗时 ${regexMatchResult.elapsedMs}ms）`
                : !activeTesterPattern.trim() ? '等待输入正则表达式' : regexMatchResult ? '正则匹配未完成' : '正在匹配…'
            }
            subtitle={activeTesterPattern}
            accessories={[
              regexMatchResult?.isValidRegex
                ? { tag: '语法有效' }
                : !activeTesterPattern.trim() ? { tag: '待输入' }
                : regexMatchResult ? { tag: { value: '异常拦截', color: Color.Red } } : { tag: '计算中' }
            ]}
            detail={
              <List.Item.Detail
                markdown={
                  regexMatchResult?.isValidRegex
                    ? `### 实时测试结果
${fencedCode(`/${regexMatchResult.pattern}/${regexMatchResult.flags}`, 'regexp')}

#### 待测样本原文
${testSample ? fencedCode(testSample) : '*待测文本为空，按 Enter 编辑*'}

#### 命中片段与捕获组清单 (${regexMatchResult.totalMatches} 项)
${
  regexMatchResult.matches.length === 0
    ? '*当前样本未命中任何匹配项*'
    : regexMatchResult.matches
        .map(
          (m) =>
            `- **Match #${m.index + 1}**: ${inlineCode(m.text)} *(位置 [${m.start}, ${m.end}])*\n${
              m.groups.length > 0
                ? m.groups.map((g) => `  - Group ${g.groupIndex}: ${g.start < 0 ? '未匹配' : `${inlineCode(g.value)} (位置 [${g.start}, ${g.end}])`}`).join('\n')
                : ''
            }`
        )
        .join('\n')
}
`
                    : `### 正则匹配
${!activeTesterPattern.trim() ? '在搜索框输入正则，例如 `/\\d+/g`；按 Enter 编辑待测文本。' : regexMatchResult?.errorMessage ? fencedCode(regexMatchResult.errorMessage) : '正在处理…'}
`
                }
              />
            }
            actions={
              <ActionPanel>
                <Action title="编辑待测文本…" icon={Icon.Pencil} onAction={editSample} />
                {activeTesterPattern && <Action.CopyToClipboard title="复制当前正则表达式" content={activeTesterPattern} />}
                {regexMatchResult?.matches.some(m => m.text.length > 0) && <Action.CopyToClipboard
                  title="复制全部命中结果"
                  content={regexMatchResult.matches.map((m) => m.text).join('\n')}
                />}
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      {currentMode === 'cron' && (
        <List.Section title="Cron 语义直译与未来 5 次触发时间推算">
          <List.Item
            id="cron-live-result"
            icon={cronResult.isValid ? Icon.Clock : Icon.XMarkCircle}
            title={cronResult.chineseSummary}
            subtitle={cronResult.expression}
            accessories={[
              cronResult.isValid
                ? { tag: '解析成功' }
                : { tag: { value: '表达式有误', color: Color.Red } }
            ]}
            detail={
              <List.Item.Detail
                markdown={
                  cronResult.isValid
                    ? `### Cron 自然语言直译
> ${emphasizeLiteral(cronResult.chineseSummary)}

${cronResult.dialect}；使用本机时区，不支持 Quartz 编号及 L/W/# 扩展。

#### 未来 5 次执行时间推算 (${cronResult.timeZone})
| 批次 | 触发时间及偏移 | 距起算时刻 |
| :--- | :--- | :--- |
${cronResult.nextRuns
  .map((r, i) => `| 第 ${i + 1} 次 | \`${r.formattedTime} ${r.utcOffset}\` | ${r.relativeTime} |`)
  .join('\n')}

#### 槽位字段拆解
| 槽位 | 当前值 | 语义说明 |
| :--- | :--- | :--- |
${cronResult.slots.map((s) => `| ${s.name} | \`${s.value}\` | ${s.meaning} |`).join('\n')}
`
                    : `### Cron 解析失败
> **错误原因**：${cronResult.errorMessage}
`
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="复制 Cron 表达式" content={cronResult.expression} />
                {cronResult.isValid && <Action.CopyToClipboard
                  title="复制未来 5 次执行时间"
                  content={cronResult.nextRuns.map((r) => `${r.formattedTime} ${r.utcOffset}`).join('\n')}
                />}
              </ActionPanel>
            }
          />
          {CRON_TEMPLATES.map((tpl) => (
            <List.Item
              key={tpl.id}
              id={tpl.id}
              icon={Icon.Calendar}
              title={tpl.title}
              subtitle={tpl.expr}
              accessories={[{ text: '常用模板' }]}
              actions={
                <ActionPanel>
                  <Action
                    title="推算此 Cron 模板"
                    icon={Icon.Play}
                    onAction={() => setSearchText(tpl.expr)}
                  />
                  <Action.CopyToClipboard title="复制模板表达式" content={tpl.expr} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  )
}

// 宿主按 manifest 中的功能码选择导出命令，默认组件不会自动收到 featureCode 属性。
export const commands = {
  'regex-dict': () => <RegexCronCommand initialMode="dict" />,
  'regex-tester': () => <RegexCronCommand initialMode="tester" />,
  'cron-explainer': () => <RegexCronCommand initialMode="cron" />
}

export default RegexCronCommand
