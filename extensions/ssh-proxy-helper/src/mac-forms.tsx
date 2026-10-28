import React, { Action, ActionPanel, Form, useEffect, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { cancelSsh } from './mac-service.js'
const portValue = (value: string) => { if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('端口请输入 1 到 65535 的整数'); return Number(value) }
export function ConnectionForm({ title, tunnel = false, save }: { title: string; tunnel?: boolean; save: (values: { port: number; remoteHost: string; remotePort: number }, alive: () => boolean) => Promise<boolean> }) {
  const [port, setPort] = useState(tunnel ? '' : '7890'), [remoteHost, setRemoteHost] = useState('localhost'), [remotePort, setRemotePort] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), alive = useRef(true), guard = useRef(false), { pop } = useNavigation()
  useEffect(() => () => { alive.current = false; if (guard.current) void cancelSsh().catch(e => console.warn('主机表单取消未确认', e)) }, [])
  const submit = async () => {
    if (guard.current) return
    guard.current = true; setBusy(true); setError('')
    try {
      const local = portValue(port.trim()), remote = tunnel ? portValue(remotePort.trim()) : 1
      if (tunnel && !/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]{0,252}|\[[A-Fa-f0-9:]{2,45}\])$/.test(remoteHost.trim())) throw new Error('远端主机请输入域名、IPv4 或方括号内的 IPv6 地址')
      if (await save({ port: local, remoteHost: remoteHost.trim(), remotePort: remote }, () => alive.current) && alive.current) pop()
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '操作失败') }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle={title} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title={tunnel ? '在终端建立隧道' : '继续'} onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="localPort" title={tunnel ? '本机监听端口' : '本机 HTTP 代理端口'} value={port} onChange={setPort} placeholder={tunnel ? '例如 15432' : '例如 7890'} />
    {tunnel && <Form.TextField id="remoteHost" title="远端目标主机" value={remoteHost} onChange={setRemoteHost} />}
    {tunnel && <Form.TextField id="remotePort" title="远端目标端口" value={remotePort} onChange={setRemotePort} placeholder="例如 5432" />}
    <Form.Description title={error ? '未完成' : '说明'} text={error || (tunnel ? '仅在本机 127.0.0.1 监听；目标主机从 SSH 服务器访问。保持终端打开，Ctrl+C 结束。' : '请先启动对应端口的 HTTP 代理服务。设置代理地址不会代替你启动代理软件。')} />
  </Form>
}
