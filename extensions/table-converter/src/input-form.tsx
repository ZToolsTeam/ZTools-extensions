import React, { Form, ActionPanel, Action, useState, useNavigation, useLocale, showToast, Toast } from '@ztools/declarative-ui'
import { detectAndParse } from './table-service.js'
import type { SourceFormat } from './types.js'
import { t } from './i18n.js'

export interface TableInput {
  text: string
  source: SourceFormat
  sqlTableName: string
}

export function TableInputForm({ initial, hasHeader, onApply }: { initial: TableInput; hasHeader: boolean; onApply: (value: TableInput) => void }) {
  useLocale()
  const [text, setText] = useState(initial.text)
  const [source, setSource] = useState<SourceFormat>(initial.source)
  const [sqlTableName, setSqlTableName] = useState(initial.sqlTableName)
  const { pop } = useNavigation()
  const apply = async () => {
    try {
      detectAndParse(text, hasHeader, source)
      if (!sqlTableName || sqlTableName.includes('\0')) throw new Error(t('errSqlTableNameInvalid'))
      onApply({ text, source, sqlTableName }); pop()
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: t('toastInputInvalid'), message: error instanceof Error ? error.message : String(error) })
    }
  }
  return <Form navigationTitle={t('formNavTitle')} actions={<ActionPanel><Action.SubmitForm title={t('formSubmitTitle')} onSubmit={apply} /></ActionPanel>}>
    <Form.TextArea id="text" title={t('formFieldText')} value={text} onChange={setText} info={t('formFieldTextInfo')} />
    <Form.Dropdown id="source" title={t('formFieldSource')} value={source} onChange={value => setSource(value as SourceFormat)}>
      <Form.Dropdown.Item value="auto" title={t('sourceAuto')} />
      <Form.Dropdown.Item value="csv" title="CSV" /><Form.Dropdown.Item value="tsv" title={t('sourceTsv')} />
      <Form.Dropdown.Item value="json" title={t('sourceJson')} /><Form.Dropdown.Item value="markdown" title={t('sourceMarkdown')} />
      <Form.Dropdown.Item value="html" title={t('sourceHtml')} /><Form.Dropdown.Item value="sql" title={t('sourceSql')} />
    </Form.Dropdown>
    <Form.TextField id="sqlTableName" title={t('formFieldSqlTable')} value={sqlTableName} onChange={setSqlTableName} info={t('formFieldSqlTableInfo')} />
  </Form>
}
