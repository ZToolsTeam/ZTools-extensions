import React, { Action, ActionPanel, Form, Toast, showToast, useEffect, useLocale, useRef, useState, useNavigation } from '@ztools/declarative-ui'
import { cancelMacNetwork, lanOperationId, readMacInterfaces, readSavedMacs, saveMac, wakeMacDevice, type MacInterface } from './mac-service.js'
import { t } from './i18n.js'
export function RangeForm({ address, saved }: { address: string; saved: (value: string) => void }) {
  useLocale()
  const [value, setValue] = useState(address), [error, setError] = useState(''), { pop } = useNavigation()
  return <Form navigationTitle={t('rangeNavTitle')} actions={<ActionPanel><Action.SubmitForm title={t('rangeSubmitAction')} onSubmit={() => {
    if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value.trim()) || value.trim().split('.').some(v => Number(v) > 255)) { setError(t('rangeErrInvalidIp')); return }
    saved(value.trim()); pop()
  }} /></ActionPanel>}>
    <Form.TextField id="address" title={t('rangeFieldTitle')} value={value} onChange={setValue} error={error} />
    <Form.Description text={t('rangeDesc')} />
  </Form>
}
export function WakeForm({ initialMac = '' }: { initialMac?: string } = {}) {
  const locale = useLocale()
  const [interfaces, setInterfaces] = useState<MacInterface[]>([]), [selected, setSelected] = useState(''), [mac, setMac] = useState(initialMac)
  const [saved, setSaved] = useState<string[]>([]), [statusOverride, setStatusOverride] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const pending = useRef<string | null>(null), alive = useRef(true), guard = useRef(false)
  const status = statusOverride ?? t('wakeStatusLoading')
  useEffect(() => { setStatusOverride(null) }, [locale])
  const fail = async (e: unknown) => { if (alive.current) { const message = e instanceof Error ? e.message : String(e); setStatusOverride(message); await showToast({ style: Toast.Style.Failure, title: message }) } }
  const load = async () => {
    try {
      const next = await readMacInterfaces()
      if (alive.current) { setInterfaces(next); setSelected(next[0]?.id ?? ''); setStatusOverride(next.length ? t('wakeStatusReady') : t('wakeStatusNoNic')) }
      const stored = await readSavedMacs(); if (alive.current) setSaved(stored)
    } catch (e) { await fail(e) }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; if (pending.current) void cancelMacNetwork(pending.current).catch(e => console.error('停止唤醒操作失败', e)) } }, [])
  const send = async () => {
    if (guard.current) return
    guard.current = true; setBusy(true)
    try {
      const iface = interfaces.find(v => v.id === selected)
      if (!iface) throw new Error(t('wakeErrSelectNic'))
      const operationId = lanOperationId(); pending.current = operationId
      await wakeMacDevice(iface, mac, operationId)
      if (alive.current) { setStatusOverride(t('wakeStatusSent')); await showToast({ style: Toast.Style.Success, title: t('wakeToastSent') }) }
    } catch (e) { await fail(e) }
    finally { pending.current = null; guard.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle="Wake-on-LAN" isLoading={busy} actions={<ActionPanel>
    <Action.SubmitForm title={t('wakeSubmitAction')} onSubmit={send} />
    <Action title={t('wakeSaveMacAction')} onAction={async () => { try { await saveMac(mac); if (alive.current) { setSaved(await readSavedMacs()); await showToast({ style: Toast.Style.Success, title: t('wakeToastSavedMac') }) } } catch (e) { await fail(e) } }} />
    <Action title={t('wakeReloadNicsAction')} onAction={load} />
  </ActionPanel>}>
    <Form.Dropdown id="interface" title={t('wakeFieldNic')} value={selected} onChange={setSelected}>{interfaces.map(v => <Form.Dropdown.Item key={v.id} value={v.id} title={`${v.name} · ${v.subnet}`} />)}</Form.Dropdown>
    <Form.TextField id="mac" title={t('wakeFieldMac')} value={mac} onChange={setMac} placeholder={t('wakeFieldMacPlaceholder')} />
    {saved.length > 0 && <Form.Dropdown id="saved" title={t('wakeFieldSaved')} value="" onChange={value => { if (value) setMac(value) }}><Form.Dropdown.Item value="" title={t('wakeSavedPlaceholder')} />{saved.map(v => <Form.Dropdown.Item key={v} value={v} title={v} />)}</Form.Dropdown>}
    <Form.Description text={status} />
  </Form>
}
