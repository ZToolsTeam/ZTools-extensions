import React, {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  useState,
  useMemo,
  useLocale,
} from '@ztools/declarative-ui'
import type { CalcMode, ChmodRoleBreakdown } from './types.js'
import { calculateIpv4Cidr, convertChmod } from './chmod-cidr-service.js'
import { t } from './i18n.js'

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

function getPresetChmods() {
  return [
    { code: '755', desc: t('preset755Desc') },
    { code: '644', desc: t('preset644Desc') },
    { code: '600', desc: t('preset600Desc') },
    { code: '700', desc: t('preset700Desc') },
    { code: '777', desc: t('preset777Desc') },
  ]
}

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
export function presetChmodsExcluding(octal?: string): Array<{ code: string; desc: string }> {
  const presets = getPresetChmods()
  if (!octal) return presets
  return presets.filter((item) => {
    try {
      return convertChmod(item.code).octal !== octal
    } catch {
      return true
    }
  })
}

export function ChmodCidrCalcCommand() {
  const locale = useLocale()
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
  }, [mode, queryText, locale])

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
  }, [mode, queryText, locale])

  return (
    <List
      isShowingDetail={true}
      searchBarPlaceholder={
        mode === 'cidr'
          ? t('searchPlaceholderCidr')
          : t('searchPlaceholderChmod')
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
          tooltip={t('dropdownTooltip')}
          value={mode}
          onChange={(val: string) => {
            const nextMode = val as CalcMode
            setMode(nextMode)
            setQueryText(nextMode === 'cidr' ? '192.168.1.0/24' : '755')
          }}
        >
          <List.Dropdown.Item title={t('modeCidrTitle')} value="cidr" />
          <List.Dropdown.Item title={t('modeChmodTitle')} value="chmod" />
        </List.Dropdown>
      }
    >
      {mode === 'cidr' && cidrState && !cidrState.ok && (
        <List.Section title={t('sectionCidrError')}>
          <List.Item
            id="cidr-error"
            title={t('cidrErrorTitle')}
            subtitle={cidrState.error}
            icon={Icon.ExclamationMark}
            accessories={[{ tag: t('tagInputError') }]}
            detail={
              <List.Item.Detail
                markdown={t('cidrErrorMd', { error: cidrState.error })}
              />
            }
          />
        </List.Section>
      )}

      {mode === 'cidr' && cidrState && cidrState.ok && (
        <List.Section title={t('sectionCidrResult')}>
          <List.Item
            id="cidr-main"
            title={`${cidrState.result.networkAddress}/${cidrState.result.prefixLength}`}
            subtitle={t('cidrUsableSub', { count: cidrState.result.usableHosts.toLocaleString() })}
            icon={Icon.Wifi}
            detail={
              <List.Item.Detail
                markdown={t('cidrDetailMd', {
                  scope: cidrState.result.addressScope,
                  hint: cidrState.result.usageHint,
                  binary: cidrState.result.netmaskBinary
                })}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title={t('metaUsableRange')} text={`${cidrState.result.firstUsableIp} ~ ${cidrState.result.lastUsableIp}`} />
                    <List.Item.Detail.Metadata.Label title={t('metaNetmask')} text={cidrState.result.netmask} />
                    <List.Item.Detail.Metadata.Label title={t('metaWildcard')} text={cidrState.result.wildcardMask} />
                    <List.Item.Detail.Metadata.Label
                      title={cidrState.result.hasBroadcast ? t('metaBroadcast') : t('metaEndAddress')}
                      text={cidrState.result.broadcastAddress}
                    />
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label title={t('metaTotalHosts')} text={t('metaTotalHostsVal', { count: cidrState.result.totalHosts.toLocaleString() })} />
                    <List.Item.Detail.Metadata.Label title={t('metaInputIp')} text={cidrState.result.ipAddress} />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title={t('actionCopyRange')}
                  content={`${cidrState.result.firstUsableIp} - ${cidrState.result.lastUsableIp}`}
                />
                <Action.CopyToClipboard
                  title={t('actionCopyNetmask')}
                  content={cidrState.result.netmask}
                />
                <Action.CopyToClipboard
                  title={t('actionCopyCidr')}
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
              subtitle={t('presetCidrSub')}
              icon={Icon.Globe}
              actions={
                <ActionPanel>
                  <Action
                    title={t('actionCalcPreset', { preset })}
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
        <List.Section title={t('sectionChmodError')}>
          <List.Item
            id="chmod-error"
            title={t('chmodErrorTitle')}
            subtitle={chmodState.error}
            icon={Icon.ExclamationMark}
            accessories={[{ tag: t('tagFormatError') }]}
            detail={
              <List.Item.Detail
                markdown={t('chmodErrorMd', { error: chmodState.error })}
              />
            }
          />
        </List.Section>
      )}

      {mode === 'chmod' && chmodState && chmodState.ok && (
        <List.Section title={t('sectionChmodResult')}>
          <List.Item
            id="chmod-main"
            title={`${chmodState.result.octal}  (${chmodState.result.lsSymbolic})`}
            subtitle={chmodState.result.chmodCommand}
            icon={chmodState.result.isWorldWritable ? Icon.ExclamationMark : Icon.Shield}
            accessories={[
              chmodState.result.isWorldWritable
                ? { tag: { value: t('tagWorldWritable'), color: Color.Red } }
                : { tag: chmodState.result.symbolic },
            ]}
            detail={
              <List.Item.Detail
                markdown={`${t('chmodMatrixHeader')}\n\n${
                  chmodState.result.securityWarning
                    ? `> **${chmodState.result.securityWarning}**\n\n`
                    : ''
                }${t('chmodTableHeader')}\n| :--- | :---: | :---: | :---: | :---: | :---: |\n${chmodState.result.roles
                  .map(
                    (r: ChmodRoleBreakdown) =>
                      `| ${r.role} | \`${r.digit}\` | \`${r.symbolic}\` | ${
                        r.read ? t('chmodAllow') : '-'
                      } | ${r.write ? t('chmodAllow') : '-'} | ${r.execute ? t('chmodAllow') : '-'} |`,
                  )
                  .join('\n')}\n\n${t('chmodCommandsTitle')}\n\`\`\`bash\n${
                  chmodState.result.chmodCommand
                }\n${chmodState.result.chmodRecursiveCommand}\n\`\`\``}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title={t('metaSpecialBits')} text={chmodState.result.specialBits.join(" / ") || t('metaNone')} />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title={t('actionCopyChmodCmd')}
                  content={chmodState.result.chmodCommand}
                />
                <Action.CopyToClipboard
                  title={t('actionCopyOctal')}
                  content={chmodState.result.octal}
                />
                <Action.CopyToClipboard
                  title={t('actionCopySymbolic')}
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
              accessories={item.code === '777' ? [{ tag: t('tagWorldWritableShort') }] : []}
              actions={
                <ActionPanel>
                  <Action
                    title={t('actionViewChmodDetail', { code: item.code })}
                    icon={Icon.Play}
                    onAction={() => setQueryText(item.code)}
                  />
                  <Action.CopyToClipboard
                    title={t('actionCopyChmodCode', { code: item.code })}
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
