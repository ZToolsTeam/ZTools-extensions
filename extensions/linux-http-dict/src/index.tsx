import React, {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  useLocale,
  useMemo,
  useState
} from '@ztools/declarative-ui'
import {
  portCheckCommands,
  searchCommonPorts,
  searchHttpStatus,
  searchLinuxCommands
} from './dict-service.js'
import { t } from './i18n.js'
import type { DictCategory } from './types'

export * from './types.js'
export * from './dict-service.js'

export interface LinuxHttpDictCommandProps {
  featureCode?: string
  initialCategory?: DictCategory
  initialSearchText?: string
}

export function LinuxHttpDictCommand(props: LinuxHttpDictCommandProps = {}) {
  const defaultCategory: DictCategory =
    props.initialCategory ??
    (props.featureCode === 'http-status'
      ? 'http'
      : props.featureCode === 'port-dict'
        ? 'port'
        : 'linux')

  const locale = useLocale()
  const [category, setCategory] = useState<DictCategory>(defaultCategory)
  const [searchText, setSearchText] = useState<string>(props.initialSearchText ?? '')

  const filteredCommands = useMemo(() => searchLinuxCommands(searchText), [searchText, locale])
  const filteredHttpStatus = useMemo(() => searchHttpStatus(searchText), [searchText, locale])
  const filteredPorts = useMemo(() => searchCommonPorts(searchText), [searchText, locale])

  const hasQuery = searchText.trim().length > 0
  const showLinux =
    category === 'linux' ||
    (category === 'all' && filteredCommands.length > 0) ||
    (hasQuery && filteredCommands.length > 0)
  const showHttp =
    category === 'http' ||
    (category === 'all' && filteredHttpStatus.length > 0) ||
    (hasQuery && filteredHttpStatus.length > 0)
  const showPort =
    category === 'port' ||
    (category === 'all' && filteredPorts.length > 0) ||
    (hasQuery && filteredPorts.length > 0)

  const sectionOrder: Array<'linux' | 'http' | 'port'> =
    category === 'http'
      ? ['http', 'linux', 'port']
      : category === 'port'
        ? ['port', 'linux', 'http']
        : ['linux', 'http', 'port']

  const renderLinuxSection = () =>
    showLinux && filteredCommands.length > 0 ? (
      <List.Section key="sec-linux" title={t('secLinuxTitle', { count: filteredCommands.length })}>
        {filteredCommands.map((item) => (
          <List.Item
            key={`linux-${item.id}`}
            id={item.id}
            icon={Icon.Terminal}
            title={item.name}
            subtitle={item.description}
            accessories={[{ tag: item.groupLabel }]}
            detail={
              <List.Item.Detail
                markdown={`${t('linuxExamplesHeader')}
${item.examples
  .map(
    (ex) => `##### ${ex.title}
\`\`\`bash
${ex.cmd}
\`\`\`
${ex.note ? `*${ex.note}*` : ''}`
  )
  .join('\n\n')}

${t('linuxParamsHeader')}
${item.params.map((p) => `| \`${p.flag}\` | ${p.desc} |`).join('\n')}
`}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title={t('metaStarsTitle')} text={item.stars} />
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label
                      title={t('metaPackageTitle')}
                      text={item.package || item.name}
                    />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title={t('actionCopyPrimaryCmd')}
                  content={item.examples[0]?.cmd || item.name}
                />
                <Action.CopyToClipboard
                  title={t('actionCopyAllExamples')}
                  content={item.examples.map((e) => `# ${e.title}\n${e.cmd}`).join('\n\n')}
                  shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    ) : null

  const renderHttpSection = () =>
    showHttp && filteredHttpStatus.length > 0 ? (
      <List.Section key="sec-http" title={t('secHttpTitle', { count: filteredHttpStatus.length })}>
        {filteredHttpStatus.map((item) => (
          <List.Item
            key={`http-${item.code}`}
            id={String(item.code)}
            icon={Icon.Globe}
            title={`${item.code} ${item.phrase}`}
            subtitle={item.meaning}
            accessories={[
              item.code >= 500
                ? { tag: { value: t('httpTag5xx'), color: Color.Red } }
                : item.code >= 400
                  ? { tag: t('httpTag4xx') }
                  : { tag: t('httpTagOther') }
            ]}
            detail={
              <List.Item.Detail
                markdown={`${t('httpCausesHeader')}
${item.causes.map((c) => `- ${c}`).join('\n')}

${t('httpStepsHeader')}
${item.troubleshooting.map((stepItem, i) => `${i + 1}. **${stepItem.step}**: ${stepItem.action}`).join('\n')}

${t('httpArchHeader')}
${item.architectureNotes}
`}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title={t('metaRfcTitle')} text={item.rfc} />
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label
                      title={t('metaRetryTitle')}
                      text={item.isRetryable ? t('retrySafeText') : t('retryUnsafeText')}
                    />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title={t('actionCopyHttpSummary')}
                  content={`HTTP ${item.code} ${item.phrase}: ${item.meaning}\n${item.troubleshooting.map((stepItem) => `- ${stepItem.step}: ${stepItem.action}`).join('\n')}`}
                />
                <Action.CopyToClipboard
                  title={t('actionCopyHttpCode')}
                  content={String(item.code)}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    ) : null

  const renderPortSection = () =>
    showPort && filteredPorts.length > 0 ? (
      <List.Section key="sec-port" title={t('secPortTitle', { count: filteredPorts.length })}>
        {filteredPorts.map((item) => (
          <List.Item
            key={`port-${item.port}`}
            id={String(item.port)}
            icon={Icon.Wifi}
            title={t('portTitlePrefix', { port: item.port, service: item.service })}
            subtitle={item.description}
            accessories={[{ tag: `${item.protocol} · ${item.category}` }]}
            detail={
              <List.Item.Detail
                markdown={`${t('portSecurityHeader')}
> ${item.securityNotice}

${t('portCheckHeader')}
Linux:
\`\`\`bash
${portCheckCommands(item).linux}
\`\`\`
macOS:
\`\`\`bash
${portCheckCommands(item).macos}
\`\`\`
Windows:
\`\`\`bat
${portCheckCommands(item).windows}
\`\`\`
`}
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title={t('actionCopyPort')} content={String(item.port)} />
                <Action.CopyToClipboard
                  title={t('actionCopyLinuxPort')}
                  content={portCheckCommands(item).linux}
                />
                <Action.CopyToClipboard
                  title={t('actionCopyMacPort')}
                  content={portCheckCommands(item).macos}
                />
                <Action.CopyToClipboard
                  title={t('actionCopyWinPort')}
                  content={portCheckCommands(item).windows}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    ) : null

  return (
    <List
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={
        category === 'all'
          ? t('searchAllPlaceholder')
          : category === 'linux'
            ? t('searchLinuxPlaceholder')
            : category === 'http'
              ? t('searchHttpPlaceholder')
              : t('searchPortPlaceholder')
      }
      searchBarAccessory={
        <List.Dropdown
          value={category}
          onChange={(v) => {
            setCategory(v as DictCategory)
            setSearchText('')
          }}
          tooltip={t('dropdownTooltip')}
        >
          <List.Dropdown.Item title={t('modeAllTitle')} value="all" icon={Icon.MagnifyingGlass} />
          <List.Dropdown.Item title={t('modeLinuxTitle')} value="linux" icon={Icon.Terminal} />
          <List.Dropdown.Item title={t('modeHttpTitle')} value="http" icon={Icon.Globe} />
          <List.Dropdown.Item title={t('modePortTitle')} value="port" icon={Icon.Wifi} />
        </List.Dropdown>
      }
      isShowingDetail={true}
    >
      {sectionOrder.map((sec) =>
        sec === 'linux' ? renderLinuxSection() : sec === 'http' ? renderHttpSection() : renderPortSection()
      )}
    </List>
  )
}

export default LinuxHttpDictCommand

export const commands = {
  'linux-commands': () => React.createElement(LinuxHttpDictCommand, { initialCategory: 'linux' }),
  'http-status': () => React.createElement(LinuxHttpDictCommand, { initialCategory: 'http' }),
  'port-dict': () => React.createElement(LinuxHttpDictCommand, { initialCategory: 'port' })
}
