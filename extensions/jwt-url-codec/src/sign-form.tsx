import React, { Form, ActionPanel, Action, Clipboard, showToast, ToastStyle, useState, useRef, useEffect, useNavigation } from '@ztools/declarative-ui'
import { signJwtHmacSha256, displayError } from './jwt-url-service.js'

export function JwtSignForm({ initialPayload = '{}', onCreated }: { initialPayload?: string; onCreated: (token: string) => void }) {
  const [payload, setPayload] = useState(initialPayload)
  const [header, setHeader] = useState('{"alg":"HS256","typ":"JWT"}')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false), alive = useRef(true)
  const { pop } = useNavigation()
  useEffect(() => () => { alive.current = false }, [])

  async function submit() {
    if (!alive.current || busy.current) return
    busy.current = true; setSaving(true)
    try {
      const token = await signJwtHmacSha256(JSON.parse(payload), secret, JSON.parse(header))
      if (!alive.current) return
      await Clipboard.copy(token)
      if (!alive.current) return
      setSecret('')
      onCreated(token)
      await showToast({ style: ToastStyle.Success, title: 'JWT 已签发并复制' })
      if (alive.current) pop()
    } catch (error) {
      if (alive.current) await showToast({ style: ToastStyle.Failure, title: '未完成签发与复制',
        message: error instanceof SyntaxError ? 'Payload 和 Header 必须是合法 JSON 对象' : displayError(error instanceof Error ? error.message : String(error)) })
    } finally {
      busy.current = false
      if (alive.current) setSaving(false)
    }
  }

  return <Form navigationTitle="签发 HS256 JWT" isLoading={saving}
    actions={<ActionPanel><Action.SubmitForm title="签发并复制 JWT" onSubmit={submit} /></ActionPanel>}>
    <Form.TextArea id="payload" title="Payload JSON" value={payload} onChange={setPayload} info="按需设置 exp、nbf 等声明；签发不会自动添加有效期。" />
    <Form.TextArea id="header" title="Header JSON" value={header} onChange={setHeader} info="仅支持 HS256，不支持 crit/b64 扩展。" />
    <Form.PasswordField id="secret" title="签名密钥" value={secret} onChange={setSecret} info="保留密钥中的空格；仅在本次表单中使用，不写入存储。" />
  </Form>
}
