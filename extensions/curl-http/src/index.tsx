import React, {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  confirmAlert,
  showToast,
  ToastStyle,
  useState,
  useMemo,
  useRef,
  useEffect,
} from '@ztools/declarative-ui'
import type { CodeTargetLang, HttpResponseSnapshot } from './types.js'
import {
  parseCurlCommand,
  generateCodeFromCurl,
  executeCurlRequest,
} from './curl-service.js'

export * from './types.js'
export * from './curl-service.js'

export function CurlHttpCommand() {
  // 初始为空，不预填示例请求
  const [rawCurl, setRawCurl] = useState<string>('')
  const [targetLang, setTargetLang] = useState<CodeTargetLang>('fetch')
  const [responseSnap, setResponseSnap] = useState<HttpResponseSnapshot | null>(null)
  const [isSending, setIsSending] = useState<boolean>(false)
  const requestRevision = useRef(0)

  useEffect(() => () => { requestRevision.current += 1 }, [])

  const replaceRequest = (value: string): void => {
    requestRevision.current += 1
    setRawCurl(value)
    setResponseSnap(null)
  }

  const parsedState = useMemo(() => {
    try {
      const parsed = parseCurlCommand(rawCurl)
      const generatedCode = generateCodeFromCurl(parsed, targetLang)
      return { ok: true as const, parsed, generatedCode }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }, [rawCurl, targetLang])

  const handleLoadClipboard = async (): Promise<void> => {
    try {
      const clip = await Clipboard.readText()
      if (!clip || !clip.trim()) {
        await showToast({
          style: ToastStyle.Failure,
          title: '剪贴板为空',
          message: '请先从浏览器 DevTools 复制 Copy as cURL 命令',
        })
        return
      }
      replaceRequest(clip.trim())
      await showToast({
        style: ToastStyle.Success,
        title: '已载入剪贴板 cURL 命令',
      })
    } catch (err) {
      await showToast({
        style: ToastStyle.Failure,
        title: '读取剪贴板失败',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleSendRequest = async (): Promise<void> => {
    if (!parsedState.ok || isSending) return
    const { method, url } = parsedState.parsed
    // DELETE / PUT 会删除或覆盖服务器上的数据，发送前请用户确认；取消或无法确认时不发送
    if (method === 'DELETE' || method === 'PUT') {
      const confirmed = await confirmAlert({
        title: `确认发送 ${method} 请求？`,
        message: `${url}\n${method === 'DELETE' ? '可能删除服务器上的数据' : '可能覆盖服务器上的数据'}，发送后无法撤回。`,
        primaryAction: { title: `发送 ${method}`, style: 'destructive' },
        dismissAction: { title: '取消' }
      })
      if (!confirmed) return
    }
    const revision = requestRevision.current
    setIsSending(true)
    setResponseSnap(null)
    try {
      const snap = await executeCurlRequest(parsedState.parsed)
      if (revision !== requestRevision.current) return
      setResponseSnap(snap)
      await showToast({
        style: snap.ok ? ToastStyle.Success : ToastStyle.Failure,
        title: `HTTP ${snap.status} (${snap.elapsedMs}ms)`,
        message: `${snap.sizeBytes} bytes`,
      })
    } catch (err) {
      if (revision !== requestRevision.current) return
      await showToast({
        style: ToastStyle.Failure,
        title: '请求执行失败',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsSending(false)
    }
  }

  return (
    <List
      isShowingDetail={true}
      isLoading={isSending}
      searchBarPlaceholder="粘贴 cURL 命令或 HTTP URL..."
      searchText={rawCurl}
      onSearchTextChange={replaceRequest}
      searchBarAccessory={
        <List.Dropdown
          tooltip="选择目标代码语言"
          value={targetLang}
          onChange={(val: string) => setTargetLang(val as CodeTargetLang)}
        >
          <List.Dropdown.Item title="JavaScript Fetch" value="fetch" />
          <List.Dropdown.Item title="TypeScript Axios" value="axios" />
          <List.Dropdown.Item title="Python Requests" value="python" />
          <List.Dropdown.Item title="Go net/http" value="go" />
        </List.Dropdown>
      }
    >
      {!parsedState.ok && (
        <List.Section title="cURL 语法解析错误">
          <List.Item
            id="curl-parse-error"
            title="无法解析 cURL 命令"
            subtitle={parsedState.error}
            icon={Icon.ExclamationMark}
            accessories={[{ tag: { value: '语法错误', color: Color.Red } }]}
            detail={
              <List.Item.Detail
                markdown={`### cURL 解析异常\n\n\`\`\`text\n${parsedState.error}\n\`\`\`\n\n支持从 Chrome / Edge 开发者工具复制的 \`Copy as cURL (bash)\` 与 \`Copy as cURL (cmd)\`，多行命令可用 \`\\\`、\`^\` 或 PowerShell 反引号续行。`}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="从剪贴板粘贴 cURL"
                  icon={Icon.Clipboard}
                  onAction={() => void handleLoadClipboard()}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      {parsedState.ok && (
        <List.Section title="请求结构与多语言代码互转">
          <List.Item
            id="curl-overview"
            title={`${parsedState.parsed.method} ${parsedState.parsed.url}`}
            subtitle={`Headers: ${Object.keys(parsedState.parsed.headers).length} 项 · 代码目标: ${targetLang.toUpperCase()}`}
            icon={Icon.Terminal}
            accessories={[
              responseSnap
                ? responseSnap.ok
                  ? { tag: `HTTP ${responseSnap.status} · ${responseSnap.elapsedMs}ms` }
                  : {
                      tag: {
                        value: `HTTP ${responseSnap.status}`,
                        color: Color.Red,
                      },
                    }
                : { tag: parsedState.parsed.method },
            ]}
            detail={
              <List.Item.Detail
                markdown={`### 生成代码 (${targetLang.toUpperCase()})\n\`\`\`${
                  targetLang === 'python' ? 'python' : targetLang === 'go' ? 'go' : 'ts'
                }\n${parsedState.generatedCode}\n\`\`\`\n\n${
                  responseSnap
                    ? `### 实时响应结果 (HTTP ${responseSnap.status} · ${responseSnap.elapsedMs}ms)\n\`\`\`json\n${responseSnap.bodyText}\n\`\`\``
                    : '### 实时响应结果\n按回车执行「立即发起 HTTP 请求」即可在本地验证此接口并查看响应载荷。'
                }`}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label
                      title="请求方法 (Method)"
                      text={parsedState.parsed.method}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="目标地址 (URL)"
                      text={parsedState.parsed.url}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="请求头数量"
                      text={`${Object.keys(parsedState.parsed.headers).length} 项`}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="请求体 (Body)"
                      text={
                        parsedState.parsed.body
                          ? `${parsedState.parsed.body.length} 字符`
                          : '无请求体'
                      }
                    />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="立即发起 HTTP 请求"
                  icon={Icon.Play}
                  onAction={() => void handleSendRequest()}
                />
                <Action.CopyToClipboard
                  title={`复制 ${targetLang.toUpperCase()} 代码`}
                  content={parsedState.generatedCode}
                />
                {responseSnap && (
                  <Action.CopyToClipboard
                    title="复制响应 Body"
                    content={responseSnap.bodyText}
                  />
                )}
                <Action
                  title="从剪贴板载入 cURL"
                  icon={Icon.Clipboard}
                  onAction={() => void handleLoadClipboard()}
                />
              </ActionPanel>
            }
          />

          {(Object.entries(parsedState.parsed.headers) as Array<[string, string]>).map(
            ([hKey, hVal]) => (
              <List.Item
                key={hKey}
                id={`header-${hKey}`}
                title={hKey}
                subtitle={String(hVal)}
                icon={Icon.Code}
                accessories={[{ tag: 'Header' }]}
                detail={
                  <List.Item.Detail
                    markdown={`### Request Header: \`${hKey}\`\n\n\`\`\`text\n${String(hVal)}\n\`\`\``}
                  />
                }
                actions={
                  <ActionPanel>
                    <Action.CopyToClipboard
                      title={`复制 ${hKey}`}
                      content={`${hKey}: ${String(hVal)}`}
                    />
                  </ActionPanel>
                }
              />
            ),
          )}
        </List.Section>
      )}
    </List>
  )
}

export default CurlHttpCommand
