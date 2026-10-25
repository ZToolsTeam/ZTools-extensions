/**
 * 声明式插件集成测试工具
 *
 * 在 Node 中用真实的 @ztools/declarative-ui 运行时渲染插件构建产物（dist/），并模拟宿主：
 * - 插件存储（LocalStorage → 内存 KV，可注入读写失败）
 * - 剪贴板、Toast、确认弹窗、页面导航
 * - preload IPC（__ztoolsElectron.transport.methods：选文件、读写文件、剪贴板图片等，可逐个方法注入返回值或故障）
 *
 * 用法见各插件 tests/*.test.mjs。
 */
import { renderDeclarativeRoot, setDeclarativeBridge } from '@ztools/declarative-ui'

let lastHost = null

export function createHost() {
  const storage = new Map()
  const toasts = []
  const clipboard = { text: '', image: null, pasted: [] }
  const pushed = []
  const ipcCalls = []
  const ipcHandlers = {}
  const faults = { storageRead: null, storageWrite: null }
  let confirmAnswer = true
  const confirms = []

  setDeclarativeBridge({
    showToast(options) {
      toasts.push(options)
      return { id: String(toasts.length), update() {}, hide() {} }
    },
    // 与宿主一致：空内容与超过 8 MiB（UTF-8）的文本拒绝写入并抛错，插件不能据此提示“已复制”
    async copyToClipboard(text) {
      const value = String(text)
      if (value.length === 0) throw Object.assign(new Error('没有可复制的内容'), { code: 'EMPTY_CONTENT' })
      if (Buffer.byteLength(value, 'utf8') > 8 * 1024 * 1024) {
        throw Object.assign(new Error('剪贴板文本超过 8 MiB 上限'), { code: 'RESPONSE_TOO_LARGE' })
      }
      clipboard.text = value
    },
    async readClipboardText() {
      return clipboard.text
    },
    async pasteToActive(text) {
      clipboard.pasted.push(String(text))
    },
    async storageGetItem(key) {
      if (faults.storageRead) throw faults.storageRead
      return storage.has(key) ? JSON.parse(storage.get(key)) : undefined
    },
    async storageCompareAndSet(key, expected, value) {
      if (faults.storageRead) throw faults.storageRead
      if (faults.storageWrite) throw faults.storageWrite
      if (storage.get(key) !== JSON.stringify(expected)) return false
      storage.set(key, JSON.stringify(value))
      return true
    },
    async storageSetItem(key, value) {
      if (faults.storageWrite) throw faults.storageWrite
      storage.set(key, JSON.stringify(value))
    },
    async storageRemoveItem(key) {
      if (faults.storageWrite) throw faults.storageWrite
      storage.delete(key)
    },
    async confirmAlert(options) {
      confirms.push(options)
      return confirmAnswer
    },
    navigation: {
      push(target) {
        pushed.push(target)
      },
      pop() {
        pushed.pop()
      }
    }
  })

  let seq = 0
  globalThis.window = globalThis.window || globalThis
  globalThis.__ztoolsElectron = {
    transport: {
      methods: new Proxy(
        {},
        {
          get(_t, method) {
            return async (req) => {
              ipcCalls.push([method, req.params])
              seq++
              const handler = ipcHandlers[method]
              if (!handler) return { messageId: req.messageId, success: false, error: { code: 'NOT_SUPPORTED', message: `测试宿主未实现 ${method}` } }
              try {
                return { messageId: req.messageId, success: true, data: await handler(req.params) }
              } catch (err) {
                return { messageId: req.messageId, success: false, error: { code: err.code || 'FAILED', message: err.message } }
              }
            }
          }
        }
      )
    }
  }

  lastHost = {
    storage,
    toasts,
    clipboard,
    pushed,
    ipcCalls,
    ipc: ipcHandlers,
    faults,
    confirms,
    setConfirm(answer) {
      confirmAnswer = answer
    },
    lastToast() {
      return toasts[toasts.length - 1]
    },
    reset() {
      storage.clear()
      toasts.length = 0
      pushed.length = 0
      ipcCalls.length = 0
      confirms.length = 0
      clipboard.text = ''
      faults.storageRead = null
      faults.storageWrite = null
      confirmAnswer = true
      for (const k of Object.keys(ipcHandlers)) delete ipcHandlers[k]
    }
  }
  return lastHost
}

export const tick = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, visit))
    return
  }
  visit(node)
  walk(node.children, visit)
  for (const v of Object.values(node.props || {})) {
    if (v && typeof v === 'object' && (v.type || Array.isArray(v))) walk(v, visit)
    if (v && typeof v === 'object' && Array.isArray(v.items)) walk(v.items, visit)
  }
}

/**
 * 渲染一个插件命令，返回可交互的视图句柄
 */
export async function mount(Command, host = lastHost) {
  const root = renderDeclarativeRoot(() => Command())
  await tick()
  const api = {
    tree() {
      return root.forceRender()
    },
    items() {
      const out = []
      walk(api.tree(), (n) => {
        if (n.type === 'List.Item') out.push(n)
      })
      return out
    },
    item(predicate) {
      const found = api.items().find((it) => (typeof predicate === 'string' ? it.props.id === predicate : predicate(it)))
      if (!found) throw new Error(`找不到列表项：${predicate}；现有：${api.items().map((i) => i.props.id + '|' + i.props.title).join(', ')}`)
      return found
    },
    text() {
      return JSON.stringify(api.tree(), (k, v) => (typeof v === 'function' ? undefined : v))
    },
    async search(text) {
      const t = api.tree()
      if (typeof t.props.onSearchTextChange !== 'function') throw new Error('视图没有搜索框')
      t.props.onSearchTextChange(text)
      await tick()
    },
    async dropdown(value) {
      const acc = api.tree().props.searchBarAccessory
      acc.props.onChange(value)
      await tick()
    },
    actions(node) {
      const panel = node?.props?.actions || api.tree().props.actions
      const out = []
      walk(panel, (n) => {
        if (n.type && n.type.startsWith('Action') && n.type !== 'ActionPanel' && n.type !== 'ActionPanel.Section') out.push(n)
      })
      return out
    },
    async run(node, title) {
      const action = api.actions(node).find((a) => a.props.title === title)
      if (!action) throw new Error(`找不到动作「${title}」；现有：${api.actions(node).map((a) => a.props.title).join(', ')}`)
      // 复制、粘贴类动作由宿主渲染器执行，这里按宿主行为模拟
      if (action.type === 'Action.CopyToClipboard') {
        host.clipboard.text = String(action.props.content ?? '')
        await action.props.onCopy?.(action.props.content)
      }
      if (action.type === 'Action.Paste') host.clipboard.pasted.push(String(action.props.content ?? ''))
      await action.props.onAction?.()
      await action.props.onSubmit?.({})
      await tick()
      return action
    },
    unmount() {
      root.unmount()
    }
  }
  return api
}

/**
 * 渲染被 push 的二级视图（表单等），返回同样的句柄；表单字段可用 field(id) 读写
 */
export async function mountPushed(host) {
  const target = host.pushed[host.pushed.length - 1]
  if (!target) throw new Error('没有被 push 的视图')
  const view = await mount(typeof target === 'function' ? target : () => target, host)
  view.field = (id) => {
    let found
    walk(view.tree(), (n) => {
      if (n.props && n.props.id === id && n.type && n.type.startsWith('Form.')) found = n
    })
    if (!found) throw new Error(`找不到表单字段 ${id}`)
    return found
  }
  view.fill = async (id, value) => {
    view.field(id).props.onChange(value)
    await tick()
  }
  return view
}

/**
 * 按宿主真实行为模拟目录相关 IPC（读真实磁盘目录），用于验证插件不会把别处文件冒充为目录内容：
 * - system_search_files「dir:<路径>」：与宿主 scanDirectoryForSearch 一致，返回一级子目录 subdirs（含各自全树文件数 file_count）+ 全树文件总数 total_matches + 全树按体积降序的 Top-N 文件（含深层文件）；目录不存在返回空结果
 * - system_search_files 其他关键词：返回 globalHits（模拟 Spotlight / MFT 全盘结果）
 * - filesystem_get_directory_contents：authorized 之外的路径抛 PERMISSION_DENIED；授权路径按宿主真实结构返回 { success, files: [{ name, size, isDirectory, lastModified }] }
 */
export async function installDirectoryHost(host, { authorized = [], globalHits = [] } = {}) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const fail = (code, message) => Object.assign(new Error(message), { code })
  host.ipc.system_search_files = async ({ query, limit = 50 }) => {
    const q = String(query || '')
    if (!q.toLowerCase().startsWith('dir:')) {
      return { files: globalHits.map((p) => ({ name: path.basename(p), path: p, is_dir: false, size: 4096, mtime: 1 })), total_matches: globalHits.length }
    }
    const root = q.slice(4).trim()
    if (!fs.existsSync(root)) return { files: [], subdirs: [], total_matches: 0, total_bytes: 0 }
    const subdirs = new Map()
    const files = []
    const queue = [[root, null]]
    while (queue.length > 0) {
      const [dir, top] = queue.shift()
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name)
        const st = fs.statSync(full)
        if (st.isDirectory()) {
          if (!top) subdirs.set(ent.name, { name: ent.name, path: full, file_count: 0, total_bytes: 0, mtime: Math.round(st.mtimeMs) })
          queue.push([full, top || ent.name])
        } else {
          files.push({ name: ent.name, path: full, is_dir: false, size: st.size, mtime: Math.round(st.mtimeMs) })
          if (top) {
            subdirs.get(top).file_count++
            subdirs.get(top).total_bytes += st.size
          }
        }
      }
    }
    files.sort((a, b) => b.size - a.size)
    return {
      files: files.slice(0, limit),
      subdirs: [...subdirs.values()],
      total_matches: files.length,
      total_bytes: files.reduce((s, f) => s + f.size, 0)
    }
  }
  host.ipc.filesystem_get_directory_contents = async ({ path: target }) => {
    if (!authorized.some((a) => target === a || target.startsWith(a + path.sep))) {
      throw fail('PERMISSION_DENIED', '路径未授权')
    }
    if (!fs.existsSync(target)) throw fail('FILE_NOT_FOUND', '目录不存在')
    return {
      success: true,
      files: fs.readdirSync(target, { withFileTypes: true }).map((ent) => {
        const st = fs.statSync(path.join(target, ent.name))
        return { name: ent.name, size: ent.isDirectory() ? 0 : st.size, isDirectory: ent.isDirectory(), lastModified: st.mtime.toLocaleString(), attributes: 32 }
      })
    }
  }
}
