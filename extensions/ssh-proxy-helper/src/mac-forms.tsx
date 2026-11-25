import React, { Action, ActionPanel, Form, useEffect, useLocale, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'
import { cancelSsh } from './mac-service.js'
const portValue = (value: string) => { if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error(t('invalidPort')); return Number(value) }
export function ConnectionForm({ title, tunnel = false, save }: { title: string; tunnel?: boolean; save: (values: { port: number; remoteHost: string; remotePort: number }, alive: () => boolean) => Promise<boolean> }) {
  useLocale()
  const [port, setPort] = useState(tunnel ? '' : '7890'), [remoteHost, setRemoteHost] = useState('localhost'), [remotePort, setRemotePort] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), alive = useRef(true), guard = useRef(false), { pop } = useNavigation()
  useEffect(() => () => { alive.current = false; if (guard.current) void cancelSsh().catch(e => console.warn(t('warnFormCancelUnconfirmed'), e)) }, [])
  const submit = async () => {
    if (guard.current) return
    guard.current = true; setBusy(true); setError('')
    try {
      const local = portValue(port.trim()), remote = tunnel ? portValue(remotePort.trim()) : 1
      if (tunnel && !/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]{0,252}|\[[A-Fa-f0-9:]{2,45}\])$/.test(remoteHost.trim())) throw new Error(t('invalidRemoteHost'))
      if (await save({ port: local, remoteHost: remoteHost.trim(), remotePort: remote }, () => alive.current) && alive.current) pop()
    } catch (e) { if (alive.current) setError(resolveErrorMessage(e, t('opFailed'))) }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle={title} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title={tunnel ? t('createTunnelInTerminal') : t('continueAction')} onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="localPort" title={tunnel ? t('localListenPort') : t('localHttpProxyPort')} value={port} onChange={setPort} placeholder={tunnel ? t('portExampleTunnel') : t('portExampleProxy')} />
    {tunnel && <Form.TextField id="remoteHost" title={t('remoteTargetHost')} value={remoteHost} onChange={setRemoteHost} />}
    {tunnel && <Form.TextField id="remotePort" title={t('remoteTargetPort')} value={remotePort} onChange={setRemotePort} placeholder={t('remotePortExample')} />}
    <Form.Description title={error ? t('incompleteLabel') : t('descriptionLabel')} text={error || (tunnel ? t('tunnelDesc') : t('proxyDesc'))} />
  </Form>
}
