import React, {
  Form,
  ActionPanel,
  Action,
  showToast,
  ToastStyle,
  useState,
  useRef,
  useEffect,
  useLocale,
  useNavigation,
} from '@ztools/declarative-ui'
import type { JwtVerificationResult } from './types.js'
import { verifyJwtHmac, displayError } from './jwt-url-service.js'
import { t } from './i18n.js'

export function JwtVerifyForm({
  rawToken,
  algorithm,
  onVerified,
}: {
  rawToken: string
  algorithm: string
  onVerified: (result: JwtVerificationResult) => void
}) {
  useLocale()
  const [secret, setSecret] = useState('')
  const [verifying, setVerifying] = useState(false)
  const busy = useRef(false)
  const alive = useRef(true)
  const { pop } = useNavigation()

  useEffect(() => () => { alive.current = false }, [])

  async function submit() {
    if (!alive.current || busy.current) return
    busy.current = true
    setVerifying(true)
    try {
      const res = await verifyJwtHmac(rawToken, secret)
      if (!alive.current) return
      onVerified(res)
      await showToast({
        style: res.verified ? ToastStyle.Success : ToastStyle.Failure,
        title: res.verified
          ? t('toastVerifyPassedAlg', { alg: res.algorithm })
          : t('toastVerifyFailedAlg', { alg: res.algorithm }),
        message: res.reason,
      })
      if (res.verified && alive.current) {
        setSecret('')
        pop()
      }
    } catch (error) {
      if (alive.current) {
        await showToast({
          style: ToastStyle.Failure,
          title: t('toastVerifyException'),
          message: displayError(error instanceof Error ? error.message : String(error)),
        })
      }
    } finally {
      busy.current = false
      if (alive.current) setVerifying(false)
    }
  }

  return (
    <Form
      navigationTitle={t('verifyFormNavTitle')}
      isLoading={verifying}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={t('verifyFormSubmitAction')} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description title={t('verifyFormTokenAlgTitle')} text={algorithm} />
      <Form.PasswordField
        id="secret"
        title={t('verifyFormSecretTitle')}
        value={secret}
        onChange={setSecret}
        info={t('fieldSecretInfo')}
      />
    </Form>
  )
}
