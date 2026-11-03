import React, {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  useMemo,
  useState
} from '@ztools/declarative-ui'
import {
  COMMIT_TYPES,
  GITIGNORE_STACK_TEMPLATES,
  buildConventionalCommit,
  buildEmergencyGuide,
  generateGitignoreContent,
  parseCommitInput,
  searchGitEmergencies
} from './git-helper-service.js'
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
const stackDisplayName = (id: string) => GITIGNORE_STACK_TEMPLATES.find((t) => t.id === id)?.name ?? id

export function GitHelperCommand(props: GitHelperCommandProps = {}) {
  const defaultMode: GitHelperMode =
    props.initialMode ??
    (props.featureCode === 'git-commit-builder'
      ? 'commit'
      : props.featureCode === 'gitignore-generator'
        ? 'gitignore'
        : 'emergency')

  const [mode, setMode] = useState<GitHelperMode>(defaultMode)
  const [searchText, setSearchText] = useState<string>(props.initialSearchText ?? '')
  const [selectedStacks, setSelectedStacks] = useState<string[]>(
    props.initialSelectedStacks ?? defaultGitignoreStacks
  )

  const filteredEmergencies = useMemo(() => searchGitEmergencies(searchText), [searchText])

  const parsedCommitInput = useMemo(() => parseCommitInput(searchText), [searchText])

  const gitignoreOutput = useMemo(
    () => generateGitignoreContent(selectedStacks),
    [selectedStacks]
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
          ? '输入大白话翻车场景（如：撤销提交、漏提文件、恢复误删分支、撤销pull）...'
          : mode === 'commit'
            ? '输入改动说明（支持 scope:描述 格式，如 auth:修复登录态刷新失败）...'
            : '搜索技术栈或系统模板（如：Node、Python、Go、Rust、macOS）...'
      }
      searchBarAccessory={
        <List.Dropdown
          value={mode}
          onChange={(v) => setMode(v as GitHelperMode)}
          tooltip="切换 Git 助手工作模式"
        >
          <List.Dropdown.Item title="Git 翻车自救锦囊" value="emergency" icon={Icon.Shield} />
          <List.Dropdown.Item title="规范提交生成器" value="commit" icon={Icon.Pencil} />
          <List.Dropdown.Item title=".gitignore 模板合成" value="gitignore" icon={Icon.Document} />
        </List.Dropdown>
      }
      isShowingDetail={true}
    >
      {mode === 'emergency' && (
        <List.Section title={`高频翻车现场与自救指南（共 ${filteredEmergencies.length} 项）`}>
          {filteredEmergencies.map((item) => {
            // 首选命令已是某一步时，只在那一步标注“回车复制”，不再单独重复一遍
            const primaryStep = item.steps.findIndex((s) => s.cmd === item.primaryCommand)
            const primarySection = primaryStep >= 0 ? '' : `#### 首选命令（回车复制）
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
                item.safetyLevel === '有损警告'
                  ? { tag: { value: item.safetyLevel, color: Color.Red } }
                  : { tag: item.safetyLevel }
              ]}
              detail={
                <List.Item.Detail
                  markdown={`### 事故现场：${item.title}

${primarySection}#### 操作指引（按所处情形选择，不要整段连续执行）
${item.steps
  .map(
    (s, i) => `${i + 1}. **${s.title}**${i === primaryStep ? '（回车复制）' : ''}
\`\`\`bash
${s.cmd}
\`\`\`
*${s.explain}*`
  )
  .join('\n\n')}

#### 底层 Git 原理与防坑说明
> ${item.principle}
`}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="场景分类" text={item.categoryLabel} />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label title="上手难度" text={item.difficulty} />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title="复制首选救命命令" content={item.primaryCommand} />
                  <Action.CopyToClipboard
                    title="复制带说明的操作指南"
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
        <List.Section title="选择 Conventional Commits 提交类型">
          {COMMIT_TYPES.map((t) => {
            const built = buildConventionalCommit({
              type: t.type,
              scope: parsedCommitInput.scope,
              subject: parsedCommitInput.subject
            })
            return (
              <List.Item
                key={t.type}
                id={t.type}
                icon={Icon.Pencil}
                title={`${t.type}: ${t.chineseMeaning}`}
                subtitle={t.description}
                detail={
                  <List.Item.Detail
                    markdown={`### 规范提交命令预览（Bash / zsh / Git Bash）
\`\`\`bash
${built.gitCommand || `# ${built.validationHint ?? '请先输入提交说明'}`}
\`\`\`

#### 生成的 Commit Message
> **${built.message}**

#### 类型说明（\`${t.type}\`）
- **含义**：${t.chineseMeaning}
- **适用边界**：${t.description}

#### 示例
${t.examples.map((ex) => `- \`${ex}\``).join('\n')}
`}
                  />
                }
                actions={
                  built.isValid ? <ActionPanel>
                    <Action.CopyToClipboard
                      title="复制完整 git commit 命令"
                      content={built.gitCommand}
                    />
                    <Action.CopyToClipboard
                      title="仅复制提交说明"
                      content={built.message}
                    />
                  </ActionPanel> : <ActionPanel>
                    {/* 还没写说明：主动作复制类型前缀，先把前缀贴进编辑器再补说明 */}
                    <Action.CopyToClipboard
                      title={`复制类型前缀 ${t.type}:`}
                      content={`${t.type}: `}
                    />
                  </ActionPanel>
                }
              />
            )
          })}
        </List.Section>
      )}

      {mode === 'gitignore' && (
        <List.Section
          title={`.gitignore 模板多选合成（已选 ${selectedStacks.length} 个栈，去重后 ${gitignoreOutput.totalUniqueRules} 条规则）`}
        >
          {GITIGNORE_STACK_TEMPLATES.filter(tpl => `${tpl.id} ${tpl.name} ${tpl.category}`.toLowerCase().includes(searchText.trim().toLowerCase())).map((tpl) => {
            const checked = selectedStacks.includes(tpl.id)
            return (
              <List.Item
                key={tpl.id}
                id={tpl.id}
                icon={checked ? Icon.CheckCircle : Icon.Circle}
                title={tpl.name}
                subtitle={`${tpl.category} · 含 ${tpl.rules.length} 条忽略规则`}
                accessories={[
                  {
                    tag: checked ? '已勾选合并' : '未选'
                  }
                ]}
                detail={
                  <List.Item.Detail
                    markdown={`### 合成后的 \`.gitignore\` 预览（自动去重）
\`\`\`gitignore
${gitignoreOutput.content}
\`\`\`
`}
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label
                          title="已合并技术栈"
                          text={gitignoreOutput.selectedStacks.map(stackDisplayName).join('、') || '未选择'}
                        />
                        <List.Item.Detail.Metadata.Label
                          title="去重后规则总数"
                          text={`${gitignoreOutput.totalUniqueRules} 条`}
                        />
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
                actions={
                  <ActionPanel>
                    <Action.CopyToClipboard
                      title="复制合成后的 .gitignore 全文"
                      content={gitignoreOutput.content}
                    />
                    <Action
                      title={checked ? '取消勾选' : '勾选'}
                      icon={checked ? Icon.XMarkCircle : Icon.CheckCircle}
                      onAction={() => toggleStack(tpl.id)}
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
