import React, {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Toast,
  showToast,
  useLocale,
  useMemo,
  useState
} from '@ztools/declarative-ui'
import {
  generateMockBatchUsers,
  generateMockSingleItems
} from './mock-service.js'
import type { MockDataTab } from './types.js'
import { t } from './i18n.js'

export * from './types.js'
export * from './mock-service.js'

export interface MockDataCommandProps {
  featureCode?: string
  initialTab?: MockDataTab
  initialSeed?: number
}

export function MockDataCommand(props: MockDataCommandProps = {}) {
  const locale = useLocale()
  const defaultTab: MockDataTab =
    props.initialTab ?? (props.featureCode === 'mock-batch-json' ? 'batch' : 'single')

  const [tab, setTab] = useState<MockDataTab>(defaultTab)
  const [searchText, setSearchText] = useState<string>('')
  const [seed, setSeed] = useState<number>(() => props.initialSeed ?? Date.now())

  const singleItems = useMemo(() => {
    const all = generateMockSingleItems(seed)
    const q = searchText.trim().toLowerCase()
    if (!q || tab !== 'single') return all
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.value.toLowerCase().includes(q)
    )
  }, [seed, searchText, tab, locale])

  // 条数输入不合法时按默认 10 条生成，并在界面上如实说明，不让用户误以为生成了自己输入的条数
  const { batchSize, batchInputInvalid } = useMemo(() => {
    const raw = tab === 'batch' ? searchText.trim() : ''
    if (!raw) return { batchSize: 10, batchInputInvalid: false }
    const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 500) return { batchSize: parsed, batchInputInvalid: false }
    return { batchSize: 10, batchInputInvalid: true }
  }, [tab, searchText])

  const batchUsers = useMemo(
    () => generateMockBatchUsers(batchSize, seed),
    [batchSize, seed, locale]
  )

  const batchJsonString = useMemo(
    () => JSON.stringify(batchUsers, null, 2),
    [batchUsers]
  )

  const handleRegenerate = async () => {
    setSeed((prev) => prev + 101)
    await showToast({
      style: Toast.Style.Success,
      title: t('regeneratedToast')
    })
  }

  return (
    <List
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={
        tab === 'single'
          ? t('searchPlaceholderSingle')
          : t('searchPlaceholderBatch')
      }
      searchBarAccessory={
        <List.Dropdown
          value={tab}
          onChange={(v) => { setTab(v as MockDataTab); setSearchText('') }}
          tooltip={t('modeTooltip')}
        >
          <List.Dropdown.Item title={t('modeSingle')} value="single" icon={Icon.Document} />
          <List.Dropdown.Item title={t('modeBatch')} value="batch" icon={Icon.Code} />
        </List.Dropdown>
      }
      isShowingDetail={true}
    >
      {tab === 'single' && (
        <List.Section title={t('singleSectionTitle')}>
          {singleItems.map((item) => (
            <List.Item
              key={item.id}
              id={item.id}
              icon={Icon.CheckCircle}
              title={item.label}
              subtitle={item.value}
              accessories={[{ tag: item.standard }]}
              detail={
                <List.Item.Detail
                  markdown={`### ${item.label}
\`\`\`text
${item.value}
\`\`\`

${t('detailBreakdownHeading')}
${item.breakdownMarkdown}

${t('detailAlgorithmHeading')}
> ${item.algorithmNote}

${item.hasCheckDigit ? t('detailDisclaimerWithCheck') : t('detailDisclaimerFormatOnly')}
`}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title={t('metaStandard')} text={item.standard} />
                      <List.Item.Detail.Metadata.Label title={t('metaCheckStatus')} text={item.hasCheckDigit ? t('metaCheckCalculated') : t('metaCheckFormatOnly')} />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label title={t('metaFormat')} text={item.formatType} />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title={t('copyValueAction')} content={item.value} />
                  <Action
                    title={t('regenerateSingleAction')}
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ['cmd'], key: 'r' }}
                    onAction={handleRegenerate}
                  />
                  <Action.CopyToClipboard
                    title={t('copyKvJsonAction')}
                    content={JSON.stringify(item.jsonValue ?? { [item.fieldKey]: item.value }, null, 2)}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {tab === 'batch' && (
        <List.Section title={t('batchSectionTitle')}>
          <List.Item
            id="batch-users-json"
            icon={Icon.Code}
            title={t('batchItemTitle', { count: batchUsers.length })}
            subtitle={batchInputInvalid ? t('batchInvalidSubtitle') : t('batchValidSubtitle')}
            accessories={[batchInputInvalid ? { tag: { value: t('batchInvalidTag'), color: Color.Red } } : { tag: t('batchReadyTag', { count: batchUsers.length }) }]}
            detail={
              <List.Item.Detail
                markdown={`${t('batchPreviewTitle', { count: batchUsers.length })}
\`\`\`json
${batchJsonString}
\`\`\`
`}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label
                      title={t('metaBatchCount')}
                      text={t('metaBatchCountValue', { count: batchUsers.length })}
                    />
                    <List.Item.Detail.Metadata.Label
                      title={t('metaJsonSize')}
                      text={`${(batchJsonString.length / 1024).toFixed(1)} KB`}
                    />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title={t('copyBatchJsonAction')} content={batchJsonString} />
                <Action
                  title={t('regenerateBatchAction')}
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ['cmd'], key: 'r' }}
                  onAction={handleRegenerate}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
    </List>
  )
}

export const commands = {
  'mock-quick': () => <MockDataCommand initialTab="single" />,
  'mock-batch-json': () => <MockDataCommand initialTab="batch" />
}

export default MockDataCommand
