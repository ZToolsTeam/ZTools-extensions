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
  portCheckCommands,
  searchCommonPorts,
  searchHttpStatus,
  searchLinuxCommands
} from './dict-service.js'
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

  const [category, setCategory] = useState<DictCategory>(defaultCategory)
  const [searchText, setSearchText] = useState<string>(props.initialSearchText ?? '')

  const filteredCommands = useMemo(() => searchLinuxCommands(searchText), [searchText])
  const filteredHttpStatus = useMemo(() => searchHttpStatus(searchText), [searchText])
  const filteredPorts = useMemo(() => searchCommonPorts(searchText), [searchText])

  return (
    <List
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={
        category === 'linux'
          ? '搜索 Linux 命令或中文场景（如：tar、解压、端口占用、查找文件、awk）...'
          : category === 'http'
            ? '输入 HTTP 状态码或故障现象（如：502、504、499、403、网关超时）...'
            : '输入端口号或服务名称（如：6379、3306、redis、mysql、nacos）...'
      }
      searchBarAccessory={
        <List.Dropdown
          value={category}
          onChange={(v) => {
            setCategory(v as DictCategory)
            setSearchText('')
          }}
          tooltip="切换速查字典类别"
        >
          <List.Dropdown.Item title="Linux 高频命令实例" value="linux" icon={Icon.Terminal} />
          <List.Dropdown.Item title="HTTP 状态码与排障" value="http" icon={Icon.Globe} />
          <List.Dropdown.Item title="知名服务默认端口" value="port" icon={Icon.Wifi} />
        </List.Dropdown>
      }
      isShowingDetail={true}
    >
      {category === 'linux' && (
        <List.Section title={`Linux 高频实战命令库（共 ${filteredCommands.length} 项）`}>
          {filteredCommands.map((item) => (
            <List.Item
              key={item.id}
              id={item.id}
              icon={Icon.Terminal}
              title={item.name}
              subtitle={item.description}
              accessories={[{ tag: item.groupLabel }]}
              detail={
                <List.Item.Detail
                  markdown={`#### 生产高频场景实例
${item.examples
  .map(
    (ex) => `##### ${ex.title}
\`\`\`bash
${ex.cmd}
\`\`\`
${ex.note ? `*${ex.note}*` : ''}`
  )
  .join('\n\n')}

#### 常用核心参数说明
| 参数选项 | 作用说明 |
| :--- | :--- |
${item.params.map((p) => `| \`${p.flag}\` | ${p.desc} |`).join('\n')}
`}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="高频评级" text={item.stars} />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label
                        title="软件包名"
                        text={item.package || item.name}
                      />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard
                    title="复制首选推荐命令"
                    content={item.examples[0]?.cmd || item.name}
                  />
                  <Action.CopyToClipboard
                    title="复制全部示例命令"
                    content={item.examples.map((e) => `# ${e.title}\n${e.cmd}`).join('\n\n')}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {category === 'http' && (
        <List.Section title={`HTTP 状态码排障指南（共 ${filteredHttpStatus.length} 项）`}>
          {filteredHttpStatus.map((item) => (
            <List.Item
              key={String(item.code)}
              id={String(item.code)}
              icon={Icon.Globe}
              title={`${item.code} ${item.phrase}`}
              subtitle={item.meaning}
              accessories={[
                item.code >= 500
                  ? { tag: { value: '服务端错误', color: Color.Red } }
                  : item.code >= 400
                    ? { tag: '客户端/网关异常' }
                    : { tag: '正常/重定向' }
              ]}
              detail={
                <List.Item.Detail
                  markdown={`#### 常见原因
${item.causes.map((c) => `- ${c}`).join('\n')}

#### 排障自查清单
${item.troubleshooting.map((t, i) => `${i + 1}. **${t.step}**：${t.action}`).join('\n')}

#### 架构设计提示
${item.architectureNotes}
`}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="标准依据" text={item.rfc} />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label
                        title="安全重试建议"
                        text={item.isRetryable ? '支持幂等退避重试' : '不可盲目重试（需修参数/查单）'}
                      />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard
                    title="复制排障指南摘要"
                    content={`HTTP ${item.code} ${item.phrase}: ${item.meaning}\n${item.troubleshooting.map((t) => `- ${t.step}: ${t.action}`).join('\n')}`}
                  />
                  <Action.CopyToClipboard
                    title="仅复制状态码数字"
                    content={String(item.code)}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {category === 'port' && (
        <List.Section title={`知名网络端口与安全组基线（共 ${filteredPorts.length} 项）`}>
          {filteredPorts.map((item) => (
            <List.Item
              key={String(item.port)}
              id={String(item.port)}
              icon={Icon.Wifi}
              title={`端口 ${item.port} — ${item.service}`}
              subtitle={item.description}
              accessories={[{ tag: `${item.protocol} · ${item.category}` }]}
              detail={
                <List.Item.Detail
                  markdown={`#### 防火墙与安全组加固建议
> ${item.securityNotice}

#### 查看端口占用
Linux：
\`\`\`bash
${portCheckCommands(item).linux}
\`\`\`
macOS：
\`\`\`bash
${portCheckCommands(item).macos}
\`\`\`
Windows：
\`\`\`bat
${portCheckCommands(item).windows}
\`\`\`
`}
                />
              }
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title="复制端口号" content={String(item.port)} />
                  <Action.CopyToClipboard
                    title="复制 Linux 端口排查命令"
                    content={portCheckCommands(item).linux}
                  />
                  <Action.CopyToClipboard
                    title="复制 macOS 端口排查命令"
                    content={portCheckCommands(item).macos}
                  />
                  <Action.CopyToClipboard
                    title="复制 Windows 端口排查命令"
                    content={portCheckCommands(item).windows}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
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
