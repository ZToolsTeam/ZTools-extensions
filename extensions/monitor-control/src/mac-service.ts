export interface MacDisplay { id: string; name: string; isPrimary: boolean; builtIn: boolean; width: number; height: number; protocol: string; canBrightness: boolean; canContrast: boolean; brightness?: number; contrast?: number; reason?: string }
export interface DisplaySnapshot { displays: MacDisplay[]; topology: string }
interface Bridge { transport?: { methods?: Record<string, (v: unknown) => Promise<{ success?: boolean; data?: unknown; error?: { message?: string } }>> } }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const percent = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
let sequence = 0
/**
 * 等待宿主回执的时限：要比宿主结束显示器组件进程的时限多留 5 秒，避免组件仍在写入或恢复原值时界面先报超时。
 * 宿主在 Windows 上列表/熄屏 25 秒，调节按 20 秒 + 每项 6 秒（上限 120 秒）；macOS 一律 15 秒。
 */
export const MONITOR_LIST_TIMEOUT_MS = 30000
export const monitorSetTimeoutMs = (changes: number) => Math.min(125000, 25000 + 6000 * changes)
export async function monitorInvoke(method: string, params: Record<string, unknown>, timeoutMs = MONITOR_LIST_TIMEOUT_MS) {
  const fn = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.[method]
  if (!fn) throw new Error('请升级客户端后使用显示器控制')
  const reply = await fn({ messageId: `monitor_${Date.now()}_${++sequence}`, params, timeoutMs })
  if (reply?.success !== true || !record(reply.data) || reply.data.success !== true) throw new Error(reply?.error?.message || '显示器操作未确认成功，请重新扫描')
  return reply.data
}
export async function scanDisplays(): Promise<DisplaySnapshot> {
  const data = await monitorInvoke('monitor_control', { action: 'list' })
  if (!Array.isArray(data.displays) || data.displays.length > 31 || typeof data.topology !== 'string') throw new Error('显示器列表返回无效')
  const ids = new Set<string>()
  for (const d of data.displays) {
    if (!record(d) || typeof d.id !== 'string' || !d.id || ids.has(d.id) || typeof d.name !== 'string' || !d.name || !['canBrightness', 'canContrast', 'builtIn', 'isPrimary'].every(k => typeof d[k] === 'boolean') || !Number.isSafeInteger(d.width) || Number(d.width) < 1 || !Number.isSafeInteger(d.height) || Number(d.height) < 1 || typeof d.protocol !== 'string' || !['apple', 'ddcci', 'wmi', 'unsupported'].includes(d.protocol)) throw new Error('显示器信息不完整')
    for (const [key, can] of [['brightness', 'canBrightness'], ['contrast', 'canContrast']]) if ((d[key] !== undefined && !percent(d[key])) || (d[can] && !percent(d[key]))) throw new Error('显示器未返回真实控制状态')
    if (d.reason !== undefined && typeof d.reason !== 'string') throw new Error('显示器提示信息无效')
    ids.add(d.id)
  }
  return data as unknown as DisplaySnapshot
}
export async function setDisplays(snapshot: DisplaySnapshot, ids: string[], control: 'brightness' | 'contrast', value: number) {
  if (!percent(value) || ids.length === 0 || ids.length > 16 || new Set(ids).size !== ids.length) throw new Error('请输入 0 到 100 之间的数值并选择显示器')
  const changes = ids.map(id => {
    const d = snapshot.displays.find(d => d.id === id), expected = d?.[control]
    if (!d || !(control === 'brightness' ? d.canBrightness : d.canContrast) || !percent(expected)) throw new Error('所选显示器不支持此项调节，请重新扫描')
    return { id, control, value, expected }
  })
  const response = await monitorInvoke('monitor_control', { action: 'set', topology: snapshot.topology, changes }, monitorSetTimeoutMs(changes.length))
  if (!Array.isArray(response.changed) || response.changed.length !== changes.length) throw new Error('调节回执不完整，请重新扫描确认')
  const seen = new Set<string>()
  for (const c of response.changed) {
    if (!record(c) || typeof c.id !== 'string' || !ids.includes(c.id) || seen.has(c.id) || c.control !== control || !percent(c.value) || !Number.isSafeInteger(c.maximum) || Number(c.maximum) < 0 || Number(c.maximum) > 65535) throw new Error('系统读回与调节目标不一致，请重新扫描确认')
    const maximum = Number(c.maximum)
    const target = maximum ? Math.round(value * maximum / 100) * 100 / maximum : Math.fround(value / 100) * 100
    if (Math.abs(c.value - target) > (maximum ? Math.min(2, 10 / maximum) : 0.0001)) throw new Error('硬件档位与读回值不一致，请重新扫描确认')
    seen.add(c.id)
  }
}
