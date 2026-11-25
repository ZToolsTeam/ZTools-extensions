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
  GITIGNORE_STACK_TEMPLATES,
  buildConventionalCommit,
  buildEmergencyGuide,
  generateGitignoreContent,
  getCommitTypes,
  getGitignoreStackTemplates,
  parseCommitInput,
  searchGitEmergencies
} from './git-helper-service.js'
import { t } from './i18n.js'
import type { GitHelperMode } from './types.js'

export * from './types.js'
export * from './git-helper-service.js'

export interface GitHelperCommandProps {
  featureCode?: string
  initialMode?: GitHelperMode
  initialSearchText?: string
  initialSelectedStacks?: string[]
}

const isMacPlatform = () => {
  try {
    const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator
    return /Mac/i.test(nav?.platform || nav?.userAgent || '')
  } catch {
    return false
  }
}

/** .gitignore 默认勾选：只勾当前系统的隐藏文件模板，加上常用 IDE 配置目录 */
export const defaultGitignoreStacks = (): string[] => [isMacPlatform() ? 'macOS' : 'Windows', 'IDEs']

/** 把模板 ID（如 ReactVue）换成界面上显示的名称 */
const stackDisplayName = (id: string) =>
  getGitignoreStackTemplates().find((tpl) => tpl.id === id)?.name ??
  GITIGNORE_STACK_TEMPLATES.find((tpl) => tpl.id === id)?.name ??
  id

export function GitHelperCommand(props: GitHelperCommandProps = {}) {
  const locale = useLocale()
  const defaultMode: GitHelperMode =
    props.initialMode ??
    (props.featureCode === 'git-commit-builder'
      ? 'commit'
      : props.featureCode === 'gitignore-generator'
        ? 'gitignore'
        : 'emergency')

  const [mode, setMode] = useState<GitHelperMode>(defaultMode)
  const [searchText, setSearchText] = useState<string>(props.initialSearchText ?? '')
  const [isBreaking, setIsBreaking] = useState<boolean>(false)
  const [selectedStacks, setSelectedStacks] = useState<string[]>(
    props.initialSelectedStacks ?? defaultGitignoreStacks
  )

  const filteredEmergencies = useMemo(() => searchGitEmergencies(searchText), [searchText, locale])
  const commitTypes = useMemo(() => getCommitTypes(), [locale])
  const stackTemplates = useMemo(() => getGitignoreStackTemplates(), [locale])

  const parsedCommitInput = useMemo(() => parseCommitInput(searchText), [searchText])

  const gitignoreOutput = useMemo(
    () => generateGitignoreContent(selectedStacks),
    [selectedStacks, locale]
  )

  const toggleStack = (stackId: string) => {
    setSelectedStacks((prev) =>
      prev.includes(stackId) ? prev.filter((id) => id !== stackId) : [...prev, stackId]
    )
  }

  return (
    <List
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={
        mode === 'emergency'
          ? t('searchEmergencyPlaceholder')
          : mode === 'commit'
            ? t('searchCommitPlaceholder')
            : t('searchGitignorePlaceholder')
      }
      searchBarAccessory={
        <List.Dropdown
          value={mode}
          onChange={(v) => setMode(v as GitHelperMode)}
          tooltip={t('dropdownTooltip')}
        >
          <List.Dropdown.Item title={t('modeEmergency')} value="emergency" icon={Icon.Shield} />
          <List.Dropdown.Item title={t('modeCommit')} value="commit" icon={Icon.Pencil} />
          <List.Dropdown.Item title={t('modeGitignore')} value="gitignore" icon={Icon.Document} />
        </List.Dropdown>
      }
      actions={
        mode === 'gitignore' ? (
          <ActionPanel>
            <Action.CopyToClipboard
              title={t('copyMergedGitignore')}
              content={gitignoreOutput.content}
              shortcut={{ modifiers: ['ctrl'], key: 'enter' }}
            />
          </ActionPanel>
        ) : undefined
      }
      isShowingDetail={true}
    >
      {mode === 'emergency' && (
        <List.Section title={t('emergencySectionTitle', { count: filteredEmergencies.length })}>
          {filteredEmergencies.map((item) => {
            // 首选命令已是某一步时，只在那一步标注“回车复制”，不再单独重复一遍
            const primaryStep = item.steps.findIndex((s) => s.cmd === item.primaryCommand)
            const primarySection =
              primaryStep >= 0
                ? ''
                : `${t('primaryCommandHeader')}
\`\`\`bash
${item.primaryCommand}
\`\`\`

`

            return (
              <List.Item
                key={item.id}
                id={item.id}
                icon={Icon.Shield}
                title={item.title}
                subtitle={item.primaryCommand}
                accessories={[
                  item.safetyKind === 'danger'
                    ? { tag: { value: item.safetyLevel, color: Color.Red } }
                    : { tag: item.safetyLevel }
                ]}
                detail={
                  <List.Item.Detail
                    markdown={`${t('incidentPrefix', { title: item.title })}

${primarySection}${t('stepsHeader')}
${item.steps
  .map(
    (s, i) => `${i + 1}. **${s.title}**${i === primaryStep ? t('enterToCopySuffix') : ''}
\`\`\`bash
${s.cmd}
\`\`\`
*${s.explain}*`
  )
  .join('\n\n')}

${t('principleHeader')}
> ${item.principle}
`}
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label title={t('metaCategoryTitle')} text={item.categoryLabel} />
                        <List.Item.Detail.Metadata.Separator />
                        <List.Item.Detail.Metadata.Label title={t('metaDifficultyTitle')} text={item.difficulty} />
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
                actions={
                  <ActionPanel>
                    <Action.CopyToClipboard title={t('copyPrimaryCommand')} content={item.primaryCommand} />
                    <Action.CopyToClipboard
                      title={t('copyGuideWithNotes')}
                      content={buildEmergencyGuide(item)}
                    />
                  </ActionPanel>
                }
              />
            )
          })}
        </List.Section>
      )}

      {mode === 'commit' && (
        <List.Section title={isBreaking ? t('commitSectionTitleBreaking') : t('commitSectionTitle')}>
          {commitTypes.map((ct) => {
            const built = buildConventionalCommit({
              type: ct.type,
              scope: parsedCommitInput.scope,
              subject: parsedCommitInput.subject,
              breaking: isBreaking
            })
            const prefixType = isBreaking ? `${ct.type}!` : ct.type
            return (
              <List.Item
                key={ct.type}
                id={ct.type}
                icon={Icon.Pencil}
                title={`${ct.type}: ${ct.chineseMeaning}`}
                subtitle={ct.description}
                accessories={
                  isBreaking ? [{ tag: { value: t('commitBreakingBadge'), color: Color.Red } }] : undefined
                }
                detail={
                  <List.Item.Detail
                    markdown={`${t('commitPreviewHeader')}
\`\`\`bash
${built.gitCommand || `# ${built.validationHint ?? t('commitInputHintDefault')}`}
\`\`\`

${t('commitMessageHeader')}
> **${built.message}**

${t('commitTypeInfoHeader', { type: ct.type })}
${t('commitMeaningLabel', { meaning: ct.chineseMeaning })}
${t('commitScopeLabel', { description: ct.description })}

${t('commitExamplesHeader')}
${ct.examples.map((ex) => `- \`${ex}\``).join('\n')}
`}
                  />
                }
                actions={
                  built.isValid ? (
                    <ActionPanel>
                      <Action.CopyToClipboard title={t('copyFullGitCommit')} content={built.gitCommand} />
                      <Action.CopyToClipboard title={t('copyCommitMessageOnly')} content={built.message} />
                      <Action
                        title={isBreaking ? t('toggleBreakingOff') : t('toggleBreakingOn')}
                        icon={isBreaking ? Icon.CheckCircle : Icon.ExclamationMark}
                        shortcut={{ modifiers: ['ctrl'], key: 'b' }}
                        onAction={() => setIsBreaking((prev) => !prev)}
                      />
                    </ActionPanel>
                  ) : (
                    <ActionPanel>
                      {/* 还没写说明：主动作复制类型前缀，先把前缀贴进编辑器再补说明 */}
                      <Action.CopyToClipboard
                        title={t('copyTypePrefix', { type: prefixType })}
                        content={`${prefixType}: `}
                      />
                      <Action
                        title={isBreaking ? t('toggleBreakingOff') : t('toggleBreakingOn')}
                        icon={isBreaking ? Icon.CheckCircle : Icon.ExclamationMark}
                        shortcut={{ modifiers: ['ctrl'], key: 'b' }}
                        onAction={() => setIsBreaking((prev) => !prev)}
                      />
                    </ActionPanel>
                  )
                }
              />
            )
          })}
        </List.Section>
      )}

      {mode === 'gitignore' && (
        <List.Section
          title={t('gitignoreSectionTitle', {
            stacks: selectedStacks.length,
            rules: gitignoreOutput.totalUniqueRules
          })}
        >
          {stackTemplates
            .filter((tpl) =>
              `${tpl.id} ${tpl.name} ${tpl.category}`.toLowerCase().includes(searchText.trim().toLowerCase())
            )
            .map((tpl) => {
              const checked = selectedStacks.includes(tpl.id)
              return (
                <List.Item
                  key={tpl.id}
                  id={tpl.id}
                  icon={checked ? Icon.CheckCircle : Icon.Circle}
                  title={tpl.name}
                  subtitle={t('gitignoreItemSubtitle', { category: tpl.category, count: tpl.rules.length })}
                  accessories={[
                    {
                      tag: checked ? t('gitignoreTagChecked') : t('gitignoreTagUnchecked')
                    }
                  ]}
                  detail={
                    <List.Item.Detail
                      markdown={`${t('gitignorePreviewHeader')}
\`\`\`gitignore
${gitignoreOutput.content}
\`\`\`
`}
                      metadata={
                        <List.Item.Detail.Metadata>
                          <List.Item.Detail.Metadata.Label
                            title={t('metaSelectedStacksTitle')}
                            text={gitignoreOutput.selectedStacks.map(stackDisplayName).join(', ') || t('metaNoneSelected')}
                          />
                          <List.Item.Detail.Metadata.Label
                            title={t('metaTotalRulesTitle')}
                            text={t('metaTotalRulesText', { count: gitignoreOutput.totalUniqueRules })}
                          />
                        </List.Item.Detail.Metadata>
                      }
                    />
                  }
                  actions={
                    <ActionPanel>
                      <Action
                        title={checked ? t('actionUncheck') : t('actionCheck')}
                        icon={checked ? Icon.XMarkCircle : Icon.CheckCircle}
                        onAction={() => toggleStack(tpl.id)}
                      />
                      <Action.CopyToClipboard
                        title={t('copyMergedGitignore')}
                        content={gitignoreOutput.content}
                        shortcut={{ modifiers: ['ctrl'], key: 'enter' }}
                      />
                    </ActionPanel>
                  }
                />
              )
            })}
        </List.Section>
      )}
    </List>
  )
}

export const commands = {
  'git-emergency': () => <GitHelperCommand initialMode="emergency" />,
  'git-commit-builder': () => <GitHelperCommand initialMode="commit" />,
  'gitignore-generator': () => <GitHelperCommand initialMode="gitignore" />
}

export default GitHelperCommand
