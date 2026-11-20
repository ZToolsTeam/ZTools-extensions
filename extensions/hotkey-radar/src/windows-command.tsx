import React, {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Toast,
  showToast,
  useEffect,
  useLocale,
  useMemo,
  useState
} from '@ztools/declarative-ui'
import { getHighConflictPresets } from './cheatsheet-data.js'
import {
  filterCheatsheetItems,
  parseAndNormalizeHotkeyCombo,
  probeGlobalHotkeys
} from './hotkey-service.js'
import { t } from './i18n.js'
import type { HotkeyModeFilter, HotkeyProbeResultItem } from './types.js'

export * from './types.js'
export * from './cheatsheet-data.js'
export * from './hotkey-service.js'

export interface HotkeyRadarCommandProps {
  featureCode?: string
  hostOverride?: unknown
}

export function HotkeyRadarCommand(props: HotkeyRadarCommandProps = {}) {
  const locale = useLocale()
  const initialMode: HotkeyModeFilter =
    props.featureCode === 'hotkey-cheatsheet' ? 'sheet:all' : 'conflict'
  const [modeFilter, setModeFilter] = useState<HotkeyModeFilter>(initialMode)
  const [searchText, setSearchText] = useState<string>('')
  const [probedKeys, setProbedKeys] = useState<HotkeyProbeResultItem[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [probeError, setProbeError] = useState<string>('')

  const reloadConflictScan = async (customCombo?: string): Promise<boolean> => {
    setIsLoading(true)
    try {
      const results = await probeGlobalHotkeys(
        getHighConflictPresets(),
        customCombo,
        props.hostOverride
      )
      setProbedKeys(results)
      setProbeError('')
      return true
    } catch (error) {
      setProbedKeys([])
      setProbeError(error instanceof Error ? error.message : String(error))
      await showToast({ style: Toast.Style.Failure, title: t('winToastProbeFailed'), message: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void reloadConflictScan()
  }, [locale])

  const parsedCustomCombo = useMemo(() => {
    if (!searchText.includes('+')) return null
    return parseAndNormalizeHotkeyCombo(searchText)
  }, [searchText, locale])

  const filteredConflictItems = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    const normalizedSearch = parsedCustomCombo?.valid
      ? parsedCustomCombo.normalized.toLowerCase()
      : q

    return probedKeys.filter((item) => {
      if (modeFilter === 'conflict:occupied' && !item.isOccupied) {
        return false
      }
      if (!normalizedSearch) return true
      return `${item.keyCombo} ${item.title} ${item.subtitle} ${item.suspectApp ?? ''}`
        .toLowerCase()
        .includes(normalizedSearch)
    })
  }, [probedKeys, modeFilter, searchText, parsedCustomCombo])

  const filteredSheetItems = useMemo(() => {
    if (!modeFilter.startsWith('sheet:')) return []
    return filterCheatsheetItems(modeFilter, searchText)
  }, [modeFilter, searchText, locale])

  const occupiedCount = useMemo(
    () => probedKeys.filter((k) => k.isOccupied).length,
    [probedKeys]
  )

  const handleProbeSingleKey = async (combo: string) => {
    const parsed = parseAndNormalizeHotkeyCombo(combo)
    if (!parsed.valid) {
      await showToast({
        style: Toast.Style.Failure,
        title: parsed.error || t('winInvalidComboToast')
      })
      return
    }
    if (!(await reloadConflictScan(parsed.normalized))) return
    await showToast({
      style: Toast.Style.Success,
      title: t('winProbedSingleToast', { combo: parsed.normalized })
    })
  }

  const isConflictMode = modeFilter.startsWith('conflict')
  const summaryText = isConflictMode
    ? t('winSummaryConflict', { total: probedKeys.length, occupied: occupiedCount })
    : t('winSummarySheet', { count: filteredSheetItems.length })

  return (
    <List
      navigationTitle={t('winNavTitle')}
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={t('winSearchPlaceholder')}
      searchBarAccessory={
        <List.Dropdown
          value={modeFilter}
          onChange={(val) => setModeFilter(val as HotkeyModeFilter)}
          tooltip={t('winDropdownTooltip')}
        >
          <List.Dropdown.Section title={t('winDdSecConflict')}>
            <List.Dropdown.Item
              title={t('winDdAllConflict')}
              value="conflict"
              icon={Icon.Terminal}
            />
            <List.Dropdown.Item
              title={t('winDdOccupiedOnly')}
              value="conflict:occupied"
              icon={Icon.ExclamationMark}
            />
          </List.Dropdown.Section>
          <List.Dropdown.Section title={t('winDdSecSheet')}>
            <List.Dropdown.Item title={t('winDdAllSheet')} value="sheet:all" icon={Icon.Document} />
            <List.Dropdown.Item
              title={t('winDdOs')}
              value="sheet:os"
              icon={Icon.Desktop}
            />
            <List.Dropdown.Item
              title={t('winDdVscode')}
              value="sheet:vscode"
              icon={Icon.Code}
            />
            <List.Dropdown.Item
              title={t('winDdExcel')}
              value="sheet:excel"
              icon={Icon.Document}
            />
            <List.Dropdown.Item
              title={t('winDdPs')}
              value="sheet:ps"
              icon={Icon.Image}
            />
            <List.Dropdown.Item
              title={t('winDdBrowser')}
              value="sheet:browser"
              icon={Icon.Globe}
            />
          </List.Dropdown.Section>
        </List.Dropdown>
      }
      filterBar={{
        summaryText,
        actions: [
          {
            id: 'rescan',
            title: t('winBtnRescan'),
            onAction: () => {
              void reloadConflictScan(parsedCustomCombo?.valid ? parsedCustomCombo.normalized : undefined)
            }
          },
          {
            id: 'switch-sheet',
            title: isConflictMode ? t('winBtnToSheet') : t('winBtnToConflict'),
            onAction: () => {
              setModeFilter(isConflictMode ? 'sheet:all' : 'conflict')
            }
          }
        ]
      }}
    >
      {isConflictMode ? (
        <List.Section
          title={t('winSecConflict')}
          subtitle={t('winSecConflictSub')}
        >
          {parsedCustomCombo && parsedCustomCombo.valid && (
            <List.Item
              id={`probe-custom-${parsedCustomCombo.normalized}`}
              title={t('winCustomProbeTitle', { combo: parsedCustomCombo.normalized })}
              subtitle={t('winCustomProbeSub')}
              icon={Icon.Terminal}
              accessories={[{ tag: t('winCustomProbeTag') }]}
              actions={
                <ActionPanel>
                  <Action
                    title={t('winCustomProbeAction', { combo: parsedCustomCombo.normalized })}
                    icon={Icon.ArrowClockwise}
                    onAction={() => handleProbeSingleKey(parsedCustomCombo.normalized)}
                  />
                  <Action.CopyToClipboard
                    title={t('winCopyComboAction')}
                    content={parsedCustomCombo.normalized}
                  />
                </ActionPanel>
              }
            />
          )}
          {probeError && (
            <List.Item
              id="probe-error"
              icon={Icon.ExclamationMark}
              title={t('winProbeErrorTitle')}
              subtitle={probeError}
              actions={
                <ActionPanel>
                  <Action title={t('winProbeErrorRetry')} icon={Icon.ArrowClockwise} onAction={() => { void reloadConflictScan() }} />
                </ActionPanel>
              }
            />
          )}
          {filteredConflictItems.map((item) => (
            <List.Item
              key={item.id}
              id={item.id}
              title={`${item.keyCombo}  —  ${item.title}`}
              subtitle={item.subtitle}
              icon={item.isOccupied ? Icon.ExclamationMark : Icon.Terminal}
              accessories={[
                item.isOccupied
                  ? {
                      tag: {
                        value: t('winOccupiedTag', { app: item.suspectApp || t('winBackgroundProcess') }),
                        color: Color.Red
                      }
                    }
                  : { tag: item.categoryLabel },
                { text: item.statusText }
              ]}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title={t('winCopyComboAction')} content={item.keyCombo} />
                  <Action
                    title={t('winReprobeAction')}
                    icon={Icon.ArrowClockwise}
                    onAction={() => handleProbeSingleKey(item.keyCombo)}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : (
        <List.Section
          title={t('winSecSheet')}
          subtitle={t('winSecSheetSub', { count: filteredSheetItems.length })}
        >
          {filteredSheetItems.map((sheet) => (
            <List.Item
              key={sheet.id}
              id={sheet.id}
              title={`${sheet.keyCombo}  —  ${sheet.title}`}
              subtitle={sheet.subtitle}
              icon={Icon.Terminal}
              accessories={[
                { tag: sheet.categoryLabel },
                sheet.macKeyCombo ? { text: `macOS: ${sheet.macKeyCombo}` } : { text: t('winGenericHotkey') }
              ]}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title={t('winCopyComboAction')} content={sheet.keyCombo} />
                  <Action
                    title={t('winProbeSheetAction')}
                    icon={Icon.ExclamationMark}
                    onAction={() => {
                      setModeFilter('conflict')
                      void handleProbeSingleKey(sheet.keyCombo)
                    }}
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

export default HotkeyRadarCommand
