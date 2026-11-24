import React, {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Form,
  useNavigation,
  useEffect,
  useLocale,
  useMemo,
  useState
} from '@ztools/declarative-ui'
import {
  getRegexPresets,
  parseAndExplainCron
} from './regex-cron-service.js'
import type { RegexCronMode, RegexPresetItem, RegexMatchResult } from './types.js'
import { t } from './i18n.js'

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
const CRON_TEMPLATE_DEFS = [
  { id: 'cron-daily-2am', expr: '0 2 * * *', titleKey: 'tplDaily2am' },
  { id: 'cron-hourly', expr: '0 * * * *', titleKey: 'tplHourly' },
  { id: 'cron-workday-930', expr: '30 9 * * 1-5', titleKey: 'tplWorkday930' },
  { id: 'cron-month-1st', expr: '0 0 1 * *', titleKey: 'tplMonth1st' }
] as const

export function getCronTemplates() {
  return CRON_TEMPLATE_DEFS.map(tpl => ({ id: tpl.id, expr: tpl.expr, title: t(tpl.titleKey) }))
}

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
  if (!text) return t('emptyMatchLabel')
  const body = text.replace(/\r\n|\r|\n/g, '\\n')
  let size = 1
  for (const run of body.matchAll(/`+/g)) size = Math.max(size, run[0].length + 1)
  const ticks = '`'.repeat(size)
  const pad = size > 1 || body.startsWith('`') || body.endsWith('`') ? ' ' : ''
  return `${ticks}${pad}${body}${pad}${ticks}`
}

export function EditRegexText({ sample, onSave }: { sample: string; onSave: (value: string) => void }) {
  useLocale()
  const [value, setValue] = useState(sample)
  const { pop } = useNavigation()
  return <Form navigationTitle={t('editSampleNavTitle')} actions={<ActionPanel>
    <Action.SubmitForm title={t('startMatchSubmit')} onSubmit={() => { onSave(value); pop() }} />
  </ActionPanel>}>
    <Form.TextArea id="sample" title={t('sampleFieldTitle')} placeholder={t('sampleFieldPlaceholder')} value={value} onChange={setValue} />
  </Form>
}

export function RegexCronCommand(props: RegexCronCommandProps = {}) {
  const locale = useLocale()
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
    const presets = getRegexPresets()
    const q = searchText.trim().toLowerCase()
    if (!q) return presets
    return presets.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        item.description.toLowerCase().includes(q)
    )
  }, [searchText, locale])

  const [cronRefresh, setCronRefresh] = useState(0)
  const cronResult = useMemo(() => parseAndExplainCron(queries.cron), [queries.cron, currentMode, cronRefresh, locale])
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
          ? t('placeholderCron')
          : currentMode === 'tester'
            ? t('placeholderTester')
            : t('placeholderDict')
      }
      searchBarAccessory={
        <List.Dropdown
          value={currentMode}
          onChange={(v) => setCurrentMode(v as RegexCronMode)}
          tooltip={t('modeTooltip')}
        >
          <List.Dropdown.Item title={t('modeDict')} value="dict" icon={Icon.Document} />
          <List.Dropdown.Item title={t('modeTester')} value="tester" icon={Icon.Play} />
          <List.Dropdown.Item title={t('modeCron')} value="cron" icon={Icon.Clock} />
        </List.Dropdown>
      }
      isShowingDetail={true}
      filterBar={currentMode === 'cron' ? {
        summaryText: cronResult.calculatedAt ? t('cronSummaryAt', { at: cronResult.calculatedAt }) : t('cronSummaryDefault'),
        actions: [{ id: 'refresh-cron', title: t('cronRefreshAction'), onAction: () => setCronRefresh(value => value + 1) }]
      } : undefined}
    >
      {currentMode === 'dict' && (
        <List.Section title={t('dictSectionTitle', { count: filteredRegexList.length })}>
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

#### ${t('dictRuleHeading')}
${item.description}

#### ${t('dictValidHeading')}
${item.validExamples.map((ex) => `- \`${ex}\``).join('\n')}

#### ${t('dictInvalidHeading')}
${item.invalidExamples.map((ex) => `- \`${ex}\` ${t('dictInvalidNote')}`).join('\n')}
`}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title={t('metaCategory')} text={item.categoryLabel} />
                      <List.Item.Detail.Metadata.Label title={t('metaScope')} text={item.scope} />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label
                        title={t('metaFlags')}
                        text={item.recommendedFlags || t('metaNoFlags')}
                      />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title={t('copyRegexAction')} content={item.pattern} />
                  <Action
                    title={t('loadIntoTesterAction')}
                    icon={Icon.Play}
                    shortcut={{ modifiers: ['cmd'], key: 't' }}
                    onAction={() => handleLoadIntoTester(item)}
                  />
                  <Action.CopyToClipboard
                    title={t('copySlashLiteralAction')}
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
        <List.Section title={t('testerSectionTitle')}>
          <List.Item
            id="tester-summary"
            icon={regexMatchResult?.isValidRegex ? Icon.CheckCircle : !activeTesterPattern.trim() ? Icon.Code : Icon.XMarkCircle}
            title={
              regexMatchResult?.isValidRegex
                ? t('testerMatchedTitle', {
                    prefix: regexMatchResult.truncated ? t('testerPrefixTruncated') : t('testerPrefixTotal'),
                    count: regexMatchResult.totalMatches,
                    ms: regexMatchResult.elapsedMs
                  })
                : !activeTesterPattern.trim() ? t('testerWaitingTitle') : regexMatchResult ? t('testerIncompleteTitle') : t('testerRunningTitle')
            }
            subtitle={activeTesterPattern}
            accessories={[
              regexMatchResult?.isValidRegex
                ? { tag: t('tagValid') }
                : !activeTesterPattern.trim() ? { tag: t('tagWaiting') }
                : regexMatchResult ? { tag: { value: t('tagBlocked'), color: Color.Red } } : { tag: t('tagComputing') }
            ]}
            detail={
              <List.Item.Detail
                markdown={
                  regexMatchResult?.isValidRegex
                    ? `### ${t('testerResultHeading')}
${fencedCode(`/${regexMatchResult.pattern}/${regexMatchResult.flags}`, 'regexp')}

#### ${t('testerSampleHeading')}
${testSample ? fencedCode(testSample) : t('testerSampleEmpty')}

#### ${t('testerMatchesHeading', { count: regexMatchResult.totalMatches })}
${
  regexMatchResult.matches.length === 0
    ? t('testerNoMatches')
    : regexMatchResult.matches
        .map(
          (m) =>
            `- **Match #${m.index + 1}**: ${inlineCode(m.text)} *(${t('testerPosLabel')} [${m.start}, ${m.end}])*\n${
              m.groups.length > 0
                ? m.groups.map((g) => `  - Group ${g.groupIndex}: ${g.start < 0 ? t('testerUnmatchedGroup') : `${inlineCode(g.value)} (${t('testerPosLabel')} [${g.start}, ${g.end}])`}`).join('\n')
                : ''
            }`
        )
        .join('\n')
}
`
                    : `### ${t('testerErrorHeading')}
${!activeTesterPattern.trim() ? t('testerEmptyGuide') : regexMatchResult?.errorMessage ? fencedCode(regexMatchResult.errorMessage) : t('testerProcessing')}
`
                }
              />
            }
            actions={
              <ActionPanel>
                <Action title={t('editSampleAction')} icon={Icon.Pencil} onAction={editSample} />
                {activeTesterPattern && <Action.CopyToClipboard title={t('copyCurrentRegexAction')} content={activeTesterPattern} />}
                {regexMatchResult?.matches.some(m => m.text.length > 0) && <Action.CopyToClipboard
                  title={t('copyAllMatchesAction')}
                  content={regexMatchResult.matches.map((m) => m.text).join('\n')}
                />}
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      {currentMode === 'cron' && (
        <List.Section title={t('cronSectionTitle')}>
          <List.Item
            id="cron-live-result"
            icon={cronResult.isValid ? Icon.Clock : Icon.XMarkCircle}
            title={cronResult.chineseSummary}
            subtitle={cronResult.expression}
            accessories={[
              cronResult.isValid
                ? { tag: t('tagCronValid') }
                : { tag: { value: t('tagCronInvalid'), color: Color.Red } }
            ]}
            detail={
              <List.Item.Detail
                markdown={
                  cronResult.isValid
                    ? `### ${t('cronExplainHeading')}
> ${emphasizeLiteral(cronResult.chineseSummary)}

${t('cronDialectNote', { dialect: cronResult.dialect })}

#### ${t('cronNextRunsHeading', { tz: cronResult.timeZone })}
| ${t('cronColRun')} | ${t('cronColTime')} | ${t('cronColRelative')} |
| :--- | :--- | :--- |
${cronResult.nextRuns
  .map((r, i) => `| ${t('cronRunIndex', { n: i + 1 })} | \`${r.formattedTime} ${r.utcOffset}\` | ${r.relativeTime} |`)
  .join('\n')}

#### ${t('cronSlotsHeading')}
| ${t('cronColSlot')} | ${t('cronColValue')} | ${t('cronColMeaning')} |
| :--- | :--- | :--- |
${cronResult.slots.map((s) => `| ${s.name} | \`${s.value}\` | ${s.meaning} |`).join('\n')}
`
                    : `### ${t('cronFailedHeading')}
${t('cronErrorLine', { label: t('cronErrorReasonLabel'), reason: cronResult.errorMessage ?? '' })}
`
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title={t('copyCronAction')} content={cronResult.expression} />
                {cronResult.isValid && <Action.CopyToClipboard
                  title={t('copyNextRunsAction')}
                  content={cronResult.nextRuns.map((r) => `${r.formattedTime} ${r.utcOffset}`).join('\n')}
                />}
              </ActionPanel>
            }
          />
          {getCronTemplates().map((tpl) => (
            <List.Item
              key={tpl.id}
              id={tpl.id}
              icon={Icon.Calendar}
              title={tpl.title}
              subtitle={tpl.expr}
              accessories={[{ text: t('templateTag') }]}
              actions={
                <ActionPanel>
                  <Action
                    title={t('runTemplateAction')}
                    icon={Icon.Play}
                    onAction={() => setSearchText(tpl.expr)}
                  />
                  <Action.CopyToClipboard title={t('copyTemplateAction')} content={tpl.expr} />
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
