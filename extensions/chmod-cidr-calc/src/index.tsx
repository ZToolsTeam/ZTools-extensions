import React, {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  useState,
  useMemo,
} from '@ztools/declarative-ui'
import type { CalcMode, ChmodRoleBreakdown } from './types.js'
import { calculateIpv4Cidr, convertChmod } from './chmod-cidr-service.js'

export * from './types.js'
export * from './chmod-cidr-service.js'

const PRESET_CIDRS = [
  '192.168.1.0/24',
  '10.244.0.0/16',
  '172.16.32.0/20',
  '192.168.10.128/26',
  '10.0.0.1/31',
  '203.0.113.42/32',
]

const PRESET_CHMODS = [
  { code: '755', desc: '可执行程序 / 公开目录标准权限 (rwxr-xr-x)' },
  { code: '644', desc: '常规配置文件 / 静态资源标准权限 (rw-r--r--)' },
  { code: '600', desc: 'SSH 私钥 (~/.ssh/id_ed25519) 严格私有权限 (rw-------)' },
  { code: '700', desc: '私有目录 (~/.ssh) 仅属主可访问权限 (rwx------)' },
  { code: '777', desc: '全放开读写执行权限（存在安全风险）' },
]

/** 常用网段排除与当前计算结果同一网段的项，避免第一行结果和下面的预设重复 */
export function presetCidrsExcluding(networkAddress?: string, prefixLength?: number): string[] {
  if (!networkAddress || prefixLength === undefined) return PRESET_CIDRS
  return PRESET_CIDRS.filter((preset) => {
    try {
      const r = calculateIpv4Cidr(preset)
      return !(r.networkAddress === networkAddress && r.prefixLength === prefixLength)
    } catch {
      return true
    }
  })
}

/** 常用权限排除与当前结果相同的项 */
export function presetChmodsExcluding(octal?: string): typeof PRESET_CHMODS {
  if (!octal) return PRESET_CHMODS
  return PRESET_CHMODS.filter((item) => {
    try {
      return convertChmod(item.code).octal !== octal
    } catch {
      return true
    }
  })
}

export function ChmodCidrCalcCommand() {
  const [mode, setMode] = useState<CalcMode>('cidr')
  const [queryText, setQueryText] = useState<string>('192.168.1.0/24')

  const cidrState = useMemo(() => {
    if (mode !== 'cidr') return null
    try {
      const result = calculateIpv4Cidr(queryText)
      return { ok: true as const, result }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }, [mode, queryText])

  const chmodState = useMemo(() => {
    if (mode !== 'chmod') return null
    try {
      const result = convertChmod(queryText)
      return { ok: true as const, result }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }, [mode, queryText])

  return (
    <List
      isShowingDetail={true}
      searchBarPlaceholder={
        mode === 'cidr'
          ? '输入 IPv4/CIDR（如 192.168.1.0/24、192.168.1.5 255.255.255.0）...'
          : '输入八进制权限（如 755、4755）或符号权限（如 rwxr-xr-x）...'
      }
      searchText={queryText}
      onSearchTextChange={(val: string) => {
        setQueryText(val)
        const trimmed = (val || '').trim()
        if (trimmed) {
          if (/^chmod(?:[ \t]|$)/.test(trimmed) || /^[0-7]{3,4}$/.test(trimmed) || /^(?:[dlcbps-][rwxstST-]{9}[@+.]?|[rwxstST-]{9})$/.test(trimmed)) {
            setMode('chmod')
          } else if (trimmed.includes('.') || trimmed.includes('/')) {
            setMode('cidr')

          }
        }
      }}
      searchBarAccessory={
        <List.Dropdown
          tooltip="切换计算器模式"
          value={mode}
          onChange={(val: string) => {
            const nextMode = val as CalcMode
            setMode(nextMode)
            setQueryText(nextMode === 'cidr' ? '192.168.1.0/24' : '755')
          }}
        >
          <List.Dropdown.Item title="IPv4 CIDR 子网计算器" value="cidr" />
          <List.Dropdown.Item title="Linux chmod 权限推演" value="chmod" />
        </List.Dropdown>
      }
    >
      {mode === 'cidr' && cidrState && !cidrState.ok && (
        <List.Section title="CIDR 网段格式错误">
          <List.Item
            id="cidr-error"
            title="无法解析 IPv4 CIDR"
            subtitle={cidrState.error}
            icon={Icon.ExclamationMark}
            accessories={[{ tag: '输入错误' }]}
            detail={
              <List.Item.Detail
                markdown={`### IPv4 CIDR 校验错误\n\n\`\`\`text\n${cidrState.error}\n\`\`\`\n\n示例格式：\`192.168.1.0/24\`、\`10.0.0.0/8\`、\`172.16.0.1/32\`。`}
              />
            }
          />
        </List.Section>
      )}

      {mode === 'cidr' && cidrState && cidrState.ok && (
        <List.Section title="IPv4 CIDR 子网规划计算结果">
          <List.Item
            id="cidr-main"
            title={`${cidrState.result.networkAddress}/${cidrState.result.prefixLength}`}
            subtitle={`可用 ${cidrState.result.usableHosts.toLocaleString()} 台主机`}
            icon={Icon.Wifi}
            detail={
              <List.Item.Detail
                markdown={`**${cidrState.result.addressScope}**\n\n${cidrState.result.usageHint}\n\n二进制掩码：\n\n\`\`\`text\n${cidrState.result.netmaskBinary}\n\`\`\``}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="可用范围" text={`${cidrState.result.firstUsableIp} ~ ${cidrState.result.lastUsableIp}`} />
                    <List.Item.Detail.Metadata.Label title="子网掩码" text={cidrState.result.netmask} />
                    <List.Item.Detail.Metadata.Label title="反掩码" text={cidrState.result.wildcardMask} />
                    <List.Item.Detail.Metadata.Label
                      title={cidrState.result.hasBroadcast ? "广播地址" : "范围末地址（无独立广播）"}
                      text={cidrState.result.broadcastAddress}
                    />
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label title="总地址数" text={`${cidrState.result.totalHosts.toLocaleString()} 个`} />
                    <List.Item.Detail.Metadata.Label title="输入地址" text={cidrState.result.ipAddress} />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title="复制可用 IP 范围"
                  content={`${cidrState.result.firstUsableIp} - ${cidrState.result.lastUsableIp}`}
                />
                <Action.CopyToClipboard
                  title="复制子网掩码"
                  content={cidrState.result.netmask}
                />
                <Action.CopyToClipboard
                  title="复制网络地址/CIDR"
                  content={`${cidrState.result.networkAddress}/${cidrState.result.prefixLength}`}
                />
              </ActionPanel>
            }
          />

          {presetCidrsExcluding(cidrState.result.networkAddress, cidrState.result.prefixLength).map((preset: string) => (
            <List.Item
              key={preset}
              id={`preset-cidr-${preset}`}
              title={preset}
              subtitle="常用网段 · 按回车载入"
              icon={Icon.Globe}
              actions={
                <ActionPanel>
                  <Action
                    title={`计算 ${preset}`}
                    icon={Icon.Play}
                    onAction={() => setQueryText(preset)}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {mode === 'chmod' && chmodState && !chmodState.ok && (
        <List.Section title="chmod 权限表达式错误">
          <List.Item
            id="chmod-error"
            title="无法解析 chmod 权限值"
            subtitle={chmodState.error}
            icon={Icon.ExclamationMark}
            accessories={[{ tag: '格式错误' }]}
            detail={
              <List.Item.Detail
                markdown={`### chmod 权限格式错误\n\n\`\`\`text\n${chmodState.error}\n\`\`\``}
              />
            }
          />
        </List.Section>
      )}

      {mode === 'chmod' && chmodState && chmodState.ok && (
        <List.Section title="Linux chmod 权限位双向推演">
          <List.Item
            id="chmod-main"
            title={`${chmodState.result.octal}  (${chmodState.result.lsSymbolic})`}
            subtitle={chmodState.result.chmodCommand}
            icon={chmodState.result.isWorldWritable ? Icon.ExclamationMark : Icon.Shield}
            accessories={[
              chmodState.result.isWorldWritable
                ? { tag: { value: '高危全局可写', color: Color.Red } }
                : { tag: chmodState.result.symbolic },
            ]}
            detail={
              <List.Item.Detail
                markdown={`### 权限矩阵\n\n${
                  chmodState.result.securityWarning
                    ? `> **${chmodState.result.securityWarning}**\n\n`
                    : ''
                }| 角色 | 八进制 | 符号 | 读取 (r=4) | 写入 (w=2) | 执行 (x=1) |\n| :--- | :---: | :---: | :---: | :---: | :---: |\n${chmodState.result.roles
                  .map(
                    (r: ChmodRoleBreakdown) =>
                      `| ${r.role} | \`${r.digit}\` | \`${r.symbolic}\` | ${
                        r.read ? '允许' : '-'
                      } | ${r.write ? '允许' : '-'} | ${r.execute ? '允许' : '-'} |`,
                  )
                  .join('\n')}\n\n### 终端命令\n\`\`\`bash\n${
                  chmodState.result.chmodCommand
                }\n${chmodState.result.chmodRecursiveCommand}\n\`\`\``}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="特殊权限位" text={chmodState.result.specialBits.join(" / ") || "无"} />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title="复制 chmod 命令"
                  content={chmodState.result.chmodCommand}
                />
                <Action.CopyToClipboard
                  title="复制八进制权限值"
                  content={chmodState.result.octal}
                />
                <Action.CopyToClipboard
                  title="复制符号权限值"
                  content={chmodState.result.symbolic}
                />
              </ActionPanel>
            }
          />

          {presetChmodsExcluding(chmodState.result.octal).map((item) => (
            <List.Item
              key={item.code}
              id={`preset-chmod-${item.code}`}
              title={`chmod ${item.code}`}
              subtitle={item.desc}
              icon={Icon.Key}
              // 预设列表保持灰阶，只给有风险的 777 标注；只有实际计算结果是全局可写时才用红色警示
              accessories={item.code === '777' ? [{ tag: '全局可写' }] : []}
              actions={
                <ActionPanel>
                  <Action
                    title={`查看 chmod ${item.code} 详情`}
                    icon={Icon.Play}
                    onAction={() => setQueryText(item.code)}
                  />
                  <Action.CopyToClipboard
                    title={`复制 chmod ${item.code}`}
                    content={`chmod ${item.code} `}
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

export default ChmodCidrCalcCommand
