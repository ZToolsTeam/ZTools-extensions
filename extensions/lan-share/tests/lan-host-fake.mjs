// 测试用：按客户端局域网共享处理器的行为模拟 LanSharePlugin（状态、启动 / 停止、按路径加文件、按 id 切换与移除）
// 与客户端一致：加文件时服务未运行会顺带启动；不存在的路径被跳过；按 id 找不到文件时返回失败
export function installLanHost(host, { existing = [] } = {}) {
  const state = {
    running: false,
    port: 8765,
    files: new Map(),
    dialog: { canceled: true },
    startError: null,
    existing: new Set(existing)
  }
  const status = (extra = {}) => ({
    ok: true,
    success: true,
    interfaces: [
      { name: 'WLAN', address: '192.168.1.20', family: 'IPv4', internal: false },
      { name: 'vEthernet', address: '172.20.0.1', family: 'IPv4', internal: false }
    ],
    lanIp: '192.168.1.20',
    primaryIp: '192.168.1.20',
    port: state.port,
    running: state.running,
    files: [...state.files.values()],
    ...extra
  })
  host.ipc.dllplugin_call = async ({ plugin, func, params }) => {
    if (plugin !== 'LanSharePlugin') throw new Error(`未模拟 ${plugin}`)
    switch (func) {
      case 'getLanShareStatus':
        return status()
      case 'startShareServer':
        if (state.startError) throw state.startError
        state.running = true
        return status()
      case 'stopShareServer':
        state.running = false
        return status({ running: false })
      case 'addFiles': {
        const added = []
        for (const p of params.paths || []) {
          if (!state.existing.has(p)) continue
          const id = `id${state.files.size + 1}`
          const item = { id, name: p.split('\\').pop(), path: p, size: 2048, sizeBytes: 2048, shared: true, isDirectory: false }
          state.files.set(id, item)
          added.push(item)
        }
        if (!state.running) state.running = true
        return status({ added })
      }
      case 'toggleFileShare': {
        const file = state.files.get(params.id)
        if (!file) return { ok: false, success: false, error: `未找到待切换共享状态的文件: ${params.id ?? 'unknown'}` }
        file.shared = params.shared
        return status({ updatedFile: file })
      }
      case 'removeSharedFile':
        state.files.delete(String(params.id ?? ''))
        return status()
      default:
        return { ok: false, success: false, error: `Unsupported LanSharePlugin function: ${func}` }
    }
  }
  host.ipc.window_show_open_dialog = async () => state.dialog
  return state
}
