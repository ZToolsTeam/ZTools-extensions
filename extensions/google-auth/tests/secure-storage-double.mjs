/**
 * 加密存储测试替身：按前端 frontend/src/declarative/pluginSecureStorage.js 的语义实现插件拿到的 SecureStorage，
 * 明文一侧直接读写测试宿主的插件 LocalStorage（host.storage），让插件的迁移流程在真实声明式运行时里跑通。
 *
 * - importFromLocalStorage：读 S → 读明文 L → L 无：not-found / kept-secure；S 无：写入 → 读回比对 → 删明文 → imported；
 *   两边都有：相同则删明文，不同返回 legacyValue 交给插件合并；任一步失败都不删明文
 * - 值 JSON 后超过 64 KiB → FILE_TOO_LARGE；加密不可用时 setItem → SECURE_STORAGE_UNAVAILABLE（绝不回落明文）
 * - faults：status / get / set / discard 可注入错误（set、discard 可传函数按 key 决定），verifyMismatch 模拟读回不一致
 */
import { getDeclarativeBridge, ZToolsHostError } from '@ztools/declarative-ui'

const MAX_BYTES = 64 * 1024

export function installSecureStorage(host, { status = { available: true } } = {}) {
  const bridge = getDeclarativeBridge()
  const secure = new Map()
  const calls = []
  const state = { status }
  const faults = { status: null, get: null, set: null, discard: null, verifyMismatch: false, statusGate: null }

  const pick = (fault, key) => (typeof fault === 'function' ? fault(key) : fault)
  const parse = (text) => {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  const readPlaintext = (key) => (host.storage.has(key) ? { found: true, value: parse(host.storage.get(key)) } : { found: false })

  const api = {
    async status() {
      calls.push(['status'])
      if (faults.statusGate) await faults.statusGate
      if (faults.status) throw faults.status
      return state.status
    },
    async getItem(key) {
      calls.push(['get', key])
      const fault = pick(faults.get, key)
      if (fault) throw fault
      return secure.has(key) ? JSON.parse(secure.get(key)) : undefined
    },
    async setItem(key, value) {
      calls.push(['set', key])
      if (!state.status.available) throw new ZToolsHostError('SECURE_STORAGE_UNAVAILABLE', '系统加密存储当前不可用，为保护数据已停止保存')
      const fault = pick(faults.set, key)
      if (fault) throw fault
      const text = JSON.stringify(value)
      if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new ZToolsHostError('FILE_TOO_LARGE', `「${key}」超过 64 KiB，无法保存到加密存储`)
      secure.set(key, text)
    },
    async removeItem(key) {
      calls.push(['remove', key])
      secure.delete(key)
    },
    async discardLocalStorage(key) {
      calls.push(['discard', key])
      const fault = pick(faults.discard, key)
      if (fault) throw fault
      host.storage.delete(key)
    },
    async importFromLocalStorage(key) {
      calls.push(['import', key])
      let current = await api.getItem(key)
      const legacy = readPlaintext(key)
      if (!legacy.found) return current === undefined ? { status: 'not-found' } : { status: 'kept-secure', value: current }
      if (current === undefined) {
        await api.setItem(key, legacy.value)
        const readBack = faults.verifyMismatch ? '__garbled__' : await api.getItem(key)
        if (JSON.stringify(readBack) !== JSON.stringify(legacy.value)) {
          throw new ZToolsHostError('MIGRATION_VERIFY_FAILED', '加密存储读回校验不一致，已保留明文')
        }
        await api.discardLocalStorage(key)
        return { status: 'imported', value: readBack }
      }
      if (JSON.stringify(current) === JSON.stringify(legacy.value)) {
        await api.discardLocalStorage(key)
        return { status: 'kept-secure', value: current }
      }
      return { status: 'kept-secure', value: current, legacyValue: legacy.value }
    }
  }

  bridge.secureStorage = api
  // 与前端 createScopedLocalStorage().allItems 一致：返回插件 LocalStorage 里的全部明文条目
  bridge.storageAll = async () => Object.fromEntries([...host.storage].map(([k, v]) => [k, parse(v)]))

  return {
    secure,
    calls,
    state,
    faults,
    read(key) {
      return secure.has(key) ? JSON.parse(secure.get(key)) : undefined
    },
    put(key, value) {
      secure.set(key, JSON.stringify(value))
    },
    writes() {
      return calls.filter(([op]) => op === 'set').map(([, key]) => key)
    },
    uninstall() {
      delete bridge.secureStorage
      delete bridge.storageAll
    }
  }
}
