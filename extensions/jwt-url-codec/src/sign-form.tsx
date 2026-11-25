import React, { Form, ActionPanel, Action, Clipboard, showToast, ToastStyle, useState, useRef, useEffect, useLocale, useNavigation } from '@ztools/declarative-ui'
import { signJwtHmacSha256, displayError } from './jwt-url-service.js'
import { t } from './i18n.js'

export function JwtSignForm({ initialPayload = '{}', onCreated }: { initialPayload?: string; onCreated: (token: string) => void }) {
  useLocale()
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
      await showToast({ style: ToastStyle.Success, title: t('toastJwtSigned') })
      if (alive.current) pop()
    } catch (error) {
      if (alive.current) await showToast({ style: ToastStyle.Failure, title: t('toastSignFailed'),
        message: error instanceof SyntaxError ? t('errPayloadHeaderJson') : displayError(error instanceof Error ? error.message : String(error)) })
    } finally {
      busy.current = false
      if (alive.current) setSaving(false)
    }
  }

  return <Form navigationTitle={t('signFormNavTitle')} isLoading={saving}
    actions={<ActionPanel><Action.SubmitForm title={t('signFormSubmitAction')} onSubmit={submit} /></ActionPanel>}>
    <Form.TextArea id="payload" title="Payload JSON" value={payload} onChange={setPayload} info={t('fieldPayloadInfo')} />
    <Form.TextArea id="header" title="Header JSON" value={header} onChange={setHeader} info={t('fieldHeaderInfo')} />
    <Form.PasswordField id="secret" title={t('fieldSecretTitle')} value={secret} onChange={setSecret} info={t('fieldSecretInfo')} />
  </Form>
}
