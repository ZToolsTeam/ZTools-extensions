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
  parseHosts,
  stringifyHosts,
  toggleRule,
  addRule,
  deleteRule,
  DEFAULT_HOSTS_CONTENT,
  type HostRule
} from './logic'

declare const ztools: any

const HOSTS_STORAGE_KEY = 'ztools_hosts_content'

export default function HostsCommand() {
  const [searchText, setSearchText] = useState('')
  const [rules, setRules] = useState<HostRule[]>([])
  const [loading, setLoading] = useState(true)

  // 初始化加载 hosts
  useEffect(() => {
    async function load() {
      try {
        let content = ''
        // 若宿主环境有 fs 接口则优先读系统文件
        if (typeof ztools !== 'undefined' && ztools.fs && ztools.fs.readFile) {
          try {
            content = await ztools.fs.readFile('C:\\Windows\\System32\\drivers\\etc\\hosts')
          } catch {
            // 权限或文件未读到
          }
        }
        if (!content && typeof localStorage !== 'undefined') {
          content = localStorage.getItem(HOSTS_STORAGE_KEY) || DEFAULT_HOSTS_CONTENT
        }
        if (!content) content = DEFAULT_HOSTS_CONTENT

        setRules(parseHosts(content))
      } catch (err) {
        showToast({
          style: Toast.Style.Failure,
          title: '读取 Hosts 失败',
          message: String(err)
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // 保存变更
  async function persistRules(updatedRules: HostRule[], messageText: string) {
    setRules(updatedRules)
    const content = stringifyHosts(updatedRules)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(HOSTS_STORAGE_KEY, content)
    }
    if (typeof ztools !== 'undefined' && ztools.fs && ztools.fs.writeFile) {
      try {
        await ztools.fs.writeFile('C:\\Windows\\System32\\drivers\\etc\\hosts', content)
      } catch {
        // 忽略写系统文件的权限错误
      }
    }
    showToast({
      style: Toast.Style.Success,
      title: messageText
    })
  }

  // 过滤后的规则
  const query = searchText.trim().toLowerCase()
  const filteredRules = rules.filter(r => {
    if (!query) return true
    return (
      r.domain.toLowerCase().includes(query) ||
      r.ip.toLowerCase().includes(query) ||
      r.comment.toLowerCase().includes(query)
    )
  })

  return List({
    isLoading: loading,
    searchBarPlaceholder: '搜索域名、IP 或注释...',
    onSearchTextChange: setSearchText,
    children: [
      List.Section({
        title: `系统规则 (${filteredRules.length}/${rules.length})`,
        children: filteredRules.map(rule =>
          List.Item({
            id: rule.id,
            title: rule.domain,
            subtitle: rule.ip + (rule.comment ? ` (${rule.comment})` : ''),
            icon: {
              source: rule.enabled ? Icon.CheckCircle : Icon.Circle,
              tintColor: rule.enabled ? Color.Green : Color.SecondaryText
            },
            accessories: [
              {
                tag: {
                  value: rule.enabled ? '已启用' : '已禁用',
                  color: rule.enabled ? Color.Green : Color.SecondaryText
                }
              }
            ],
            actions: ActionPanel({
              title: rule.domain,
              children: [
                Action({
                  title: rule.enabled ? '禁用规则' : '启用规则',
                  icon: rule.enabled ? Icon.XMarkCircle : Icon.CheckCircle,
                  onAction: () => {
                    const next = toggleRule(rules, rule.id)
                    persistRules(next, rule.enabled ? `已禁用 ${rule.domain}` : `已启用 ${rule.domain}`)
                  }
                }),
                Action({
                  title: '复制 IP 地址',
                  icon: Icon.Clipboard,
                  onAction: () => {
                    Clipboard.copy(rule.ip)
                    showToast({ style: Toast.Style.Success, title: '已复制 IP', message: rule.ip })
                  }
                }),
                Action({
                  title: '复制域名',
                  icon: Icon.Clipboard,
                  onAction: () => {
                    Clipboard.copy(rule.domain)
                    showToast({ style: Toast.Style.Success, title: '已复制域名', message: rule.domain })
                  }
                }),
                Action({
                  title: '删除规则',
                  icon: Icon.Trash,
                  shortcut: { modifiers: ['ctrl'], key: 'd' },
                  onAction: () => {
                    const next = deleteRule(rules, rule.id)
                    persistRules(next, `已删除 ${rule.domain}`)
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
