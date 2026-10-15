import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  useState,
  useEffect,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import {
  convertTextToAllEncodings,
  type ConversionResult
} from './logic'

export default function BatchTextConvertCommand() {
  const [inputText, setInputText] = useState('你好世界 ZTools')
  const [results, setResults] = useState<ConversionResult[]>([])

  useEffect(() => {
    const list = convertTextToAllEncodings(inputText)
    setResults(list)
  }, [inputText])

  function copyResult(item: ConversionResult) {
    Clipboard.copy(item.encoded)
    showToast({
      style: Toast.Style.Success,
      title: `已复制 ${item.name}`,
      message: item.encoded
    })
  }

  return List({
    searchBarPlaceholder: '输入文本实时查看多编码转换 (Unicode, Hex, Base64, URL)...',
    onSearchTextChange: setInputText,
    children: [
      List.Section({
        title: `字符编码结果 (${results.length} 种格式)`,
        children: results.map(item =>
          List.Item({
            id: item.id,
            title: item.encoded || '(空)',
            subtitle: item.name,
            icon: {
              source: Icon.Text,
              tintColor: Color.Blue
            },
            accessories: [
              {
                text: item.description
              }
            ],
            actions: ActionPanel({
              title: item.name,
              children: [
                Action({
                  title: '复制编码结果',
                  icon: Icon.Clipboard,
                  onAction: () => copyResult(item)
                }),
                Action({
                  title: '复制格式名称',
                  icon: Icon.Document,
                  shortcut: { modifiers: ['ctrl'], key: 'c' },
                  onAction: () => {
                    Clipboard.copy(item.name)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制名称',
                      message: item.name
                    })
                  }
                })
              ]
            })
          })
        )
      })
    ]
  })
}
