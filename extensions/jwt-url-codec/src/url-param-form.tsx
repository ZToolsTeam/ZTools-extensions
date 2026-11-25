import React, {
  Form,
  ActionPanel,
  Action,
  showToast,
  ToastStyle,
  useState,
  useLocale,
  useNavigation,
} from '@ztools/declarative-ui'
import { t } from './i18n.js'

export function UrlParamForm({
  initialKey = '',
  initialValue = '',
  isEdit = false,
  onSave,
}: {
  initialKey?: string
  initialValue?: string
  isEdit?: boolean
  onSave: (key: string, value: string) => Promise<void> | void
}) {
  useLocale()
  const [paramKey, setParamKey] = useState(initialKey)
  const [paramValue, setParamValue] = useState(initialValue)
  const { pop } = useNavigation()

  async function submit() {
    const cleanKey = paramKey.trim()
    if (!cleanKey) {
      await showToast({
        style: ToastStyle.Failure,
        title: t('urlParamKeyEmpty'),
      })
      return
    }
    await onSave(cleanKey, paramValue)
    pop()
  }

  return (
    <Form
      navigationTitle={isEdit ? t('urlParamFormEditTitle') : t('urlParamFormAddTitle')}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={t('urlParamFormSubmit')} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="key"
        title={t('urlParamKeyTitle')}
        placeholder={t('urlParamKeyPlaceholder')}
        value={paramKey}
        onChange={setParamKey}
      />
      <Form.TextArea
        id="value"
        title={t('urlParamValueTitle')}
        placeholder={t('urlParamValuePlaceholder')}
        value={paramValue}
        onChange={setParamValue}
      />
    </Form>
  )
}
