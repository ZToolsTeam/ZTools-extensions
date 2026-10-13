export interface AdapterInfo {
  id: string
  name: string
  description: string
  ipv4: string
  ipv6: string
  mask: string
  gateway: string
  mac: string
  status: 'connected' | 'disconnected'
}

/**
 * 解析 Windows `ipconfig /all` 输出
 */
export function parseIpconfigAll(output: string): AdapterInfo[] {
  if (!output || typeof output !== 'string') return []

  const lines = output.split(/\r?\n/)
  const adapters: AdapterInfo[] = []
  let current: Partial<AdapterInfo> & { disconnected?: boolean } | null = null

  function flush() {
    if (current && current.name && (current.description || current.mac || current.ipv4)) {
      adapters.push({
        id: `adapter-${adapters.length + 1}`,
        name: current.name,
        description: current.description || current.name,
        ipv4: current.ipv4 || (current.disconnected ? '已断开' : '未分配'),
        ipv6: current.ipv6 || '未分配',
        mask: current.mask || '255.255.255.0',
        gateway: current.gateway || '无',
        mac: current.mac || '未知',
        status: current.disconnected ? 'disconnected' : (current.ipv4 ? 'connected' : 'disconnected')
      })
    }
    current = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // 检查是否为新适配器标题行
    if ((line.includes('适配器') || line.includes('adapter')) && (line.endsWith(':') || line.endsWith('：'))) {
      flush()
      current = {
        name: line.replace(/[:：]$/, '')
      }
      continue
    }

    if (!current) continue

    if (line.includes('媒体已断开') || line.includes('Media disconnected')) {
      current.disconnected = true
    }
    if (line.includes('描述') || line.includes('Description')) {
      current.description = line.split(/[:：]/)[1]?.trim() || ''
    }
    if (line.includes('物理地址') || line.includes('Physical Address')) {
      current.mac = line.split(/[:：]/)[1]?.trim() || ''
    }
    if (line.includes('IPv4 地址') || line.includes('IPv4 Address')) {
      const val = line.split(/[:：]/)[1]?.trim() || ''
      current.ipv4 = val.replace(/\(首选\)/g, '').replace(/\(Preferred\)/g, '').trim()
    }
    if (line.includes('IPv6 地址') || line.includes('IPv6 Address')) {
      const val = line.split(/[:：]/)[1]?.trim() || ''
      current.ipv6 = val.replace(/\(首选\)/g, '').replace(/\(Preferred\)/g, '').trim()
    }
    if (line.includes('子网掩码') || line.includes('Subnet Mask')) {
      current.mask = line.split(/[:：]/)[1]?.trim() || ''
    }
    if (line.includes('默认网关') || line.includes('Default Gateway')) {
      current.gateway = line.split(/[:：]/)[1]?.trim() || ''
    }
  }

  flush()
  return adapters
}

/**
 * 预设样例网卡数据
 */
export function getSampleAdapters(): AdapterInfo[] {
  return [
    {
      id: 'wlan-1',
      name: '无线局域网适配器 WLAN',
      description: 'Intel(R) Wi-Fi 6 AX201 160MHz',
      ipv4: '192.168.1.108',
      ipv6: 'fe80::b421:8471:43a1:294b%12',
      mask: '255.255.255.0',
      gateway: '192.168.1.1',
      mac: 'B4-2E-99-88-77-66',
      status: 'connected'
    },
    {
      id: 'eth-1',
      name: '以太网适配器 以太网',
      description: 'Realtek Gaming 2.5GbE Family Controller',
      ipv4: '已断开',
      ipv6: '未分配',
      mask: '255.255.255.0',
      gateway: '无',
      mac: '58-11-22-33-44-55',
      status: 'disconnected'
    },
    {
      id: 'vEthernet-1',
      name: '以太网适配器 vEthernet (WSL)',
      description: 'Hyper-V Virtual Ethernet Adapter',
      ipv4: '172.28.16.1',
      ipv6: '未分配',
      mask: '255.255.240.0',
      gateway: '无',
      mac: '00-15-5D-11-22-33',
      status: 'connected'
    }
  ]
}
