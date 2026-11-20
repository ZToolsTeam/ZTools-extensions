import React, {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  showToast,
  ToastStyle,
  useState,
  useMemo,
  useRef,
  useEffect,
  useLocale,
  useNavigation,
} from '@ztools/declarative-ui'
import type { CodecMode, UrlQueryParamItem } from './types.js'
import { isRealElectronHost } from './native-ipc.js'
import { JwtSignForm } from './sign-form.js'
import {
  decodeJwtToken,
  verifyJwtHmacSha256,
  parseAndInspectUrl,
  queryParamsToJson,
  fencedBlock,
  displayError,
} from './jwt-url-service.js'
import { t } from './i18n.js'

export * from './types.js'
export * from './jwt-url-service.js'

const DEFAULT_JWT_SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEwMjQiLCJuYW1lIjoiWlRvb2xzIERldmVsb3BlciIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTczNTY4OTYwMCwiZXhwIjoxOTg4MTUwNDAwfQ.4f-8h_l7mN3vR2kX9pQ1wZ5yB6cT0dG8jL4sA2eF6uI'

export function JwtUrlCodecCommand() {
  const locale = useLocale()
  const [mode, setMode] = useState<CodecMode>('jwt')
  const [rawInput, setRawInput] = useState<string>(isRealElectronHost() ? '' : DEFAULT_JWT_SAMPLE)
  const [verifyMsgOverride, setVerifyMsgOverride] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const requestVersion = useRef(0)
  const { push } = useNavigation()
  const verifyMsg = verifyMsgOverride ?? t('verifyInitial')

  function updateInput(text: string) {
    requestVersion.current++
    setRawInput(text)
    setVerifyMsgOverride(null)
  }

  useEffect(() => {
    setVerifyMsgOverride(null)
  }, [locale])

  useEffect(() => {
    if (mode !== 'jwt') return () => { requestVersion.current++ }
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => { clearInterval(timer); requestVersion.current++ }
  }, [mode])

  const jwtState = useMemo(() => {
    if (mode !== 'jwt') return null
    if (!rawInput.trim()) return { ok: false as const, empty: true as const, error: '' }
    try {
      const result = decodeJwtToken(rawInput, nowMs)
      return { ok: true as const, result }
    } catch (err) {
      return {
        ok: false as const,
        empty: false as const,
        error: displayError(err instanceof Error ? err.message : String(err)),
      }
    }
  }, [mode, rawInput, nowMs, locale])

  const urlState = useMemo(() => {
    if (mode !== 'url') return null
    if (!rawInput.trim()) return { ok: false as const, empty: true as const, error: '' }
    try {
      const result = parseAndInspectUrl(rawInput)
      return { ok: true as const, result }
    } catch (err) {
      return {
        ok: false as const,
        empty: false as const,
        error: displayError(err instanceof Error ? err.message : String(err)),
      }
    }
  }, [mode, rawInput, locale])

  const handleLoadFromClipboard = async (): Promise<void> => {
    const request = ++requestVersion.current
    try {
      const text = await Clipboard.readText()
      if (request !== requestVersion.current) return
      if (!text || !text.trim()) {
        await showToast({
          style: ToastStyle.Failure,
          title: t('toastClipboardEmpty'),
          message: t('toastClipboardEmptyMsg'),
        })
        return
      }
      const trimmed = text.trim()
      updateInput(trimmed)
      if (trimmed.split('.').length === 3 && /^eyJ/.test(trimmed.replace(/^Bearer\s+/i, ''))) {
        setMode('jwt')
      } else if (/^https?:\/\//i.test(trimmed) || trimmed.includes('?')) {
        setMode('url')
      }
      await showToast({
        style: ToastStyle.Success,
        title: t('toastLoadedFromClipboard'),
      })
    } catch (err) {
      if (request !== requestVersion.current) return
      await showToast({
        style: ToastStyle.Failure,
        title: t('toastReadClipboardFailed'),
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleVerifyFromClipboardSecret = async (): Promise<void> => {
    const request = ++requestVersion.current
    setVerifyMsgOverride(t('verifyChecking'))
    try {
      const clipSecret = await Clipboard.readText()
      if (request !== requestVersion.current) return
      if (!clipSecret) {
        setVerifyMsgOverride(t('verifyMissingSecret'))
        await showToast({
          style: ToastStyle.Failure,
          title: t('toastMissingSecretTitle'),
          message: t('toastMissingSecretMsg'),
        })
        return
      }
      const res = await verifyJwtHmacSha256(rawInput, clipSecret)
      if (request !== requestVersion.current) return
      setVerifyMsgOverride(res.verified ? t('verifyPassedStatus', { alg: res.algorithm }) : t('verifyFailedStatus', { reason: res.reason ?? '' }))
      await showToast({
        style: res.verified ? ToastStyle.Success : ToastStyle.Failure,
        title: res.verified ? t('toastVerifyPassed') : t('toastVerifyFailed'),
        message: res.reason,
      })
    } catch (err) {
      if (request !== requestVersion.current) return
      setVerifyMsgOverride(t('verifyExceptionStatus'))
      await showToast({
        style: ToastStyle.Failure,
        title: t('toastVerifyException'),
        message: displayError(err instanceof Error ? err.message : String(err)),
      })
    }
  }

  const emptySection = (
    <List.Section title={t('emptySectionTitle')}>
      <List.Item
        id="empty"
        title={mode === 'jwt' ? t('emptyJwtTitle') : t('emptyUrlTitle')}
        subtitle={mode === 'jwt' ? t('emptyJwtSub') : t('emptyUrlSub')}
        icon={mode === 'jwt' ? Icon.Key : Icon.Globe}
        actions={
          <ActionPanel>
            <Action title={t('actionReadClipboard')} icon={Icon.Clipboard} onAction={handleLoadFromClipboard} />
          </ActionPanel>
        }
      />
    </List.Section>
  )
  const activeState = mode === 'jwt' ? jwtState : urlState
  const isEmpty = Boolean(activeState && !activeState.ok && activeState.empty)

  return (
    <List
      isShowingDetail={!isEmpty}
      searchBarPlaceholder={t('searchPlaceholder')}
      searchText={rawInput}
      onSearchTextChange={updateInput}
      filterBar={mode === 'jwt' ? {
        summaryText: t('summaryJwtTool'),
        actions: [{ id: 'sign-jwt', title: t('btnSignJwt'), onAction: () => push(<JwtSignForm
          initialPayload={jwtState?.ok ? JSON.stringify(jwtState.result.payload, null, 2) : '{}'} onCreated={updateInput} />) }]
      } : undefined}
      searchBarAccessory={
        <List.Dropdown
          tooltip={t('dropdownTooltip')}
          value={mode}
          onChange={(val: string) => { requestVersion.current++; setMode(val as CodecMode); setVerifyMsgOverride(t('verifySimple')) }}
        >
          <List.Dropdown.Item title={t('modeJwtTitle')} value="jwt" />
          <List.Dropdown.Item title={t('modeUrlTitle')} value="url" />
        </List.Dropdown>
      }
    >
      {isEmpty && emptySection}

      {mode === 'jwt' && jwtState && !jwtState.ok && !jwtState.empty && (
        <List.Section title={t('jwtErrSecTitle')}>
          <List.Item
            id="jwt-error"
            title={t('jwtErrItemTitle')}
            subtitle={jwtState.error}
            icon={Icon.ExclamationMark}
            accessories={[{ tag: { value: t('jwtErrTag'), color: Color.Red } }]}
            detail={
              <List.Item.Detail
                markdown={t('jwtErrDetailMd', { block: fencedBlock(jwtState.error) })}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title={t('actionLoadTokenFromClipboard')}
                  icon={Icon.Clipboard}
                  onAction={handleLoadFromClipboard}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      {mode === 'jwt' && jwtState && jwtState.ok && (
        <List.Section title={t('jwtSecTitle')}>
          <List.Item
            id="jwt-overview"
            title={t('jwtOverviewTitle', { alg: jwtState.result.algorithm, count: Object.keys(jwtState.result.payload).length })}
            subtitle={jwtState.result.expiryCountdownText}
            icon={Icon.Key}
            accessories={[
              jwtState.result.timeStatusWarning
                ? { tag: { value: jwtState.result.timeStatus, color: Color.Red } }
                : { tag: jwtState.result.timeStatus },
            ]}
            detail={
              <List.Item.Detail
                markdown={`### Payload JSON\n${fencedBlock(JSON.stringify(jwtState.result.payload, null, 2), 'json')}\n\n### Header JSON\n${fencedBlock(JSON.stringify(jwtState.result.header, null, 2), 'json')}`}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label
                      title={t('metaAlgTitle')}
                      text={jwtState.result.algorithm}
                    />
                    <List.Item.Detail.Metadata.Label
                      title={t('metaIatTitle')}
                      text={jwtState.result.issuedAtText || t('metaUndeclared')}
                    />
                    <List.Item.Detail.Metadata.Label
                      title={t('metaNbfTitle')}
                      text={jwtState.result.notBeforeText || t('metaUndeclared')}
                    />
                    <List.Item.Detail.Metadata.Label
                      title={t('metaExpTitle')}
                      text={jwtState.result.expiresAtText || t('metaUndeclared')}
                    />
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label
                      title={t('metaLifecycleTitle')}
                      text={jwtState.result.expiryCountdownText}
                    />
                    <List.Item.Detail.Metadata.Label title={t('metaVerifyTitle')} text={verifyMsg} />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title={t('actionCopyPayload')}
                  content={JSON.stringify(jwtState.result.payload, null, 2)}
                />
                <Action.CopyToClipboard
                  title={t('actionCopyHeader')}
                  content={JSON.stringify(jwtState.result.header, null, 2)}
                />
                <Action
                  title={t('actionVerifyClipboard')}
                  icon={Icon.Shield}
                  onAction={handleVerifyFromClipboardSecret}
                />
                <Action
                  title={t('actionReloadToken')}
                  icon={Icon.Clipboard}
                  onAction={handleLoadFromClipboard}
                />
              </ActionPanel>
            }
          />
          {Object.entries(jwtState.result.payload).map(([claimKey, claimVal]) => (
            <List.Item
              key={claimKey}
              id={`claim-${claimKey}`}
              title={claimKey}
              subtitle={typeof claimVal === 'object' ? JSON.stringify(claimVal) : String(claimVal)}
              icon={Icon.Code}
              accessories={[{ tag: typeof claimVal }]}
              detail={
                <List.Item.Detail
                  markdown={t('claimDetailMd', {
                    keyBlock: fencedBlock(claimKey),
                    valBlock: fencedBlock(JSON.stringify(claimVal, null, 2), 'json')
                  })}
                />
              }
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard
                    title={t('actionCopyClaim', { key: claimKey })}
                    content={
                      typeof claimVal === 'object' ? JSON.stringify(claimVal) : String(claimVal)
                    }
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {mode === 'url' && urlState && !urlState.ok && !urlState.empty && (
        <List.Section title={t('urlErrSecTitle')}>
          <List.Item
            id="url-error"
            title={t('urlErrItemTitle')}
            subtitle={urlState.error}
            icon={Icon.ExclamationMark}
            accessories={[{ tag: { value: t('urlErrTag'), color: Color.Red } }]}
            detail={<List.Item.Detail markdown={t('urlErrDetailMd', { block: fencedBlock(urlState.error) })} />}
          />
        </List.Section>
      )}

      {mode === 'url' && urlState && urlState.ok && (
        <List.Section title={t('urlSecTitle', { count: urlState.result.queryParams.length })}>
          <List.Item
            id="url-overview"
            title={urlState.result.host !== '-' ? `${urlState.result.host}${urlState.result.pathname}` : t('urlQueryCollectionTitle')}
            subtitle={urlState.result.decodedFullUrl}
            icon={Icon.Globe}
            accessories={[{ tag: urlState.result.protocol.toUpperCase() }]}
            detail={
              <List.Item.Detail
                markdown={t('urlOverviewDetailMd', {
                  decodedBlock: fencedBlock(urlState.result.decodedFullUrl),
                  jsonBlock: fencedBlock(queryParamsToJson(urlState.result.queryParams), 'json')
                })}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title={t('metaProtocol')} text={urlState.result.protocol} />
                    <List.Item.Detail.Metadata.Label title={t('metaHost')} text={urlState.result.host} />
                    <List.Item.Detail.Metadata.Label title={t('metaPort')} text={urlState.result.port} />
                    <List.Item.Detail.Metadata.Label title={t('metaPathname')} text={urlState.result.pathname} />
                    <List.Item.Detail.Metadata.Label title={t('metaHash')} text={urlState.result.hash || t('metaNone')} />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title={t('actionCopyEncodedUrl')}
                  content={urlState.result.encodedFullUrl}
                />
                <Action.CopyToClipboard
                  title={t('actionCopyQueryJson')}
                  content={queryParamsToJson(urlState.result.queryParams)}
                />
                <Action.CopyToClipboard title={t('actionCopyDecodedUrl')} content={urlState.result.decodedFullUrl} />
              </ActionPanel>
            }
          />
          {urlState.result.queryParams.map((param: UrlQueryParamItem, idx: number) => (
            <List.Item
              key={`${param.key}-${idx}`}
              id={`param-${param.key}-${idx}`}
              title={param.key}
              subtitle={param.decodedValue}
              icon={Icon.Document}
              accessories={[
                param.isNestedUrl
                  ? { tag: t('tagNestedUrl') }
                  : param.isJsonLike
                    ? { tag: t('tagJsonPayload') }
                    : { tag: 'Query' },
              ]}
              detail={
                <List.Item.Detail
                  markdown={t('paramDetailMd', {
                    keyBlock: fencedBlock(param.key),
                    valBlock: fencedBlock(param.decodedValue),
                    rawBlock: fencedBlock(param.rawValue)
                  })}
                />
              }
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title={t('actionCopyDecodedVal')} content={param.decodedValue} />
                  <Action.CopyToClipboard
                    title={t('actionCopyRawPair')}
                    content={`${param.rawKey}=${param.rawValue}`}
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

export default JwtUrlCodecCommand
