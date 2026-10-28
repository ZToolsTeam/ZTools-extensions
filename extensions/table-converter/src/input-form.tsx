import React, { Form, ActionPanel, Action, useState, useNavigation, showToast, Toast } from '@ztools/declarative-ui'
import { detectAndParse } from './table-service.js'
import type { SourceFormat } from './types.js'

export interface TableInput {
  text: string
  source: SourceFormat
  sqlTableName: string
}

export function TableInputForm({ initial, hasHeader, onApply }: { initial: TableInput; hasHeader: boolean; onApply: (value: TableInput) => void }) {
  const [text, setText] = useState(initial.text)
  const [source, setSource] = useState<SourceFormat>(initial.source)
  const [sqlTableName, setSqlTableName] = useState(initial.sqlTableName)
  const { pop } = useNavigation()
  const apply = async () => {
    try {
      detectAndParse(text, hasHeader, source)
      if (!sqlTableName || sqlTableName.includes('\0')) throw new Error('请填写不含 NUL 字符的 SQL 表名。')
      onApply({ text, source, sqlTableName }); pop()
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: '输入尚不能转换，原文已保留', message: error instanceof Error ? error.message : String(error) })
    }
  }
  return <Form navigationTitle="编辑表格输入" actions={<ActionPanel><Action.SubmitForm title="应用输入" onSubmit={apply} /></ActionPanel>}>
    <Form.TextArea id="text" title="原始表格" value={text} onChange={setText} info="最多 200 万字符；Excel 请复制单元格文本，不能直接读取 xlsx 文件。" />
    <Form.Dropdown id="source" title="输入格式" value={source} onChange={value => setSource(value as SourceFormat)}>
      <Form.Dropdown.Item value="auto" title="自动识别" />
      <Form.Dropdown.Item value="csv" title="CSV" /><Form.Dropdown.Item value="tsv" title="TSV / Excel 复制文本" />
      <Form.Dropdown.Item value="json" title="JSON 数组" /><Form.Dropdown.Item value="markdown" title="Markdown 表格" />
      <Form.Dropdown.Item value="html" title="HTML 文字表格" /><Form.Dropdown.Item value="sql" title="SQLite INSERT VALUES" />
    </Form.Dropdown>
    <Form.TextField id="sqlTableName" title="输出 SQL 表名" value={sqlTableName} onChange={setSqlTableName} info="生成 SQLite INSERT 文本，不连接或执行数据库操作。" />
  </Form>
}
