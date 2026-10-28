import React, { Action, ActionPanel, Form, Toast, showToast, useEffect, useRef, useState, useNavigation } from '@ztools/declarative-ui'
import { cancelMacNetwork, lanOperationId, readMacInterfaces, readSavedMacs, saveMac, wakeMacDevice, type MacInterface } from './mac-service.js'
export function RangeForm({ address, saved }: { address: string; saved: (value: string) => void }) {
  const [value, setValue] = useState(address), [error, setError] = useState(''), { pop } = useNavigation()
  return <Form navigationTitle="选择扫描范围" actions={<ActionPanel><Action.SubmitForm title="扫描此地址所在范围" onSubmit={() => {
    if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value.trim()) || value.trim().split('.').some(v => Number(v) > 255)) { setError('请输入所选网卡网段内的 IPv4 地址'); return }
    saved(value.trim()); pop()
  }} /></ActionPanel>}>
    <Form.TextField id="address" title="网段内任意地址" value={value} onChange={setValue} error={error} />
    <Form.Description text="每次扫描此地址所在的 /24 范围（最多 256 个地址）。更小网段按实际范围扫描；超出所选网卡网段会拒绝。" />
  </Form>
}
export function WakeForm({ initialMac = '' }: { initialMac?: string } = {}) {
  const [interfaces, setInterfaces] = useState<MacInterface[]>([]), [selected, setSelected] = useState(''), [mac, setMac] = useState(initialMac)
  const [saved, setSaved] = useState<string[]>([]), [status, setStatus] = useState('正在读取网卡'), [busy, setBusy] = useState(false)
  const pending = useRef<string | null>(null), alive = useRef(true), guard = useRef(false)
  const fail = async (e: unknown) => { if (alive.current) { const message = e instanceof Error ? e.message : String(e); setStatus(message); await showToast({ style: Toast.Style.Failure, title: message }) } }
  const load = async () => {
    try {
      const next = await readMacInterfaces()
      if (alive.current) { setInterfaces(next); setSelected(next[0]?.id ?? ''); setStatus(next.length ? '设备须启用 WOL；发送成功不代表设备已开机' : '未找到可用 IPv4 网卡') }
      const stored = await readSavedMacs(); if (alive.current) setSaved(stored)
    } catch (e) { await fail(e) }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; if (pending.current) void cancelMacNetwork(pending.current).catch(e => console.error('停止唤醒操作失败', e)) } }, [])
  const send = async () => {
    if (guard.current) return
    guard.current = true; setBusy(true)
    try {
      const iface = interfaces.find(v => v.id === selected)
      if (!iface) throw new Error('请先选择可用的网卡')
      const operationId = lanOperationId(); pending.current = operationId
      await wakeMacDevice(iface, mac, operationId)
      if (alive.current) { setStatus('已发送 102 字节唤醒包；设备是否开机需另行确认'); await showToast({ style: Toast.Style.Success, title: '唤醒包已发送，设备状态未确认' }) }
    } catch (e) { await fail(e) }
    finally { pending.current = null; guard.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle="Wake-on-LAN" isLoading={busy} actions={<ActionPanel>
    <Action.SubmitForm title="发送唤醒包" onSubmit={send} />
    <Action title="收藏此 MAC 地址" onAction={async () => { try { await saveMac(mac); if (alive.current) { setSaved(await readSavedMacs()); await showToast({ style: Toast.Style.Success, title: 'MAC 地址已收藏' }) } } catch (e) { await fail(e) } }} />
    <Action title="重新读取网卡" onAction={load} />
  </ActionPanel>}>
    <Form.Dropdown id="interface" title="发送网卡" value={selected} onChange={setSelected}>{interfaces.map(v => <Form.Dropdown.Item key={v.id} value={v.id} title={`${v.name} · ${v.subnet}`} />)}</Form.Dropdown>
    <Form.TextField id="mac" title="设备 MAC 地址" value={mac} onChange={setMac} placeholder="6 组十六进制字符，用冒号分隔" />
    {saved.length > 0 && <Form.Dropdown id="saved" title="常用设备" value="" onChange={value => { if (value) setMac(value) }}><Form.Dropdown.Item value="" title="选择已收藏的 MAC" />{saved.map(v => <Form.Dropdown.Item key={v} value={v} title={v} />)}</Form.Dropdown>}
    <Form.Description text={status} />
  </Form>
}
