export interface RescueAction {
  id: string
  title: string
  command: string
  symptom: string
  recommendation: string
  requiresAdmin: boolean
}

/**
 * 获取预置的 Windows 网络急救动作列表
 */
export function getRescueActions(): RescueAction[] {
  return [
    {
      id: 'flush-dns',
      title: '刷新 DNS 解析器缓存',
      command: 'ipconfig /flushdns',
      symptom: '能上 QQ/微信但浏览器打不开网页，或域名解析指向旧 IP',
      recommendation: '清除本地 DNS 缓存并强制重新向 DNS 服务器查询',
      requiresAdmin: false
    },
    {
      id: 'reset-winsock',
      title: '重置 Winsock 网络套接字目录',
      command: 'netsh winsock reset',
      symptom: '安装或卸载代理、加速器后网络完全中断无法上网',
      recommendation: '重构并恢复 Windows 网络套接字目录至系统默认干净状态 (建议修复后重启)',
      requiresAdmin: true
    },
    {
      id: 'reset-tcpip',
      title: '重置 TCP/IP 协议栈',
      command: 'netsh int ip reset',
      symptom: '提示受限制的连接、无法获取 IPv4 地址或协议栈报错',
      recommendation: '将 TCP/IP 传输协议栈核心配置重写回注册表默认状态',
      requiresAdmin: true
    },
    {
      id: 'renew-dhcp',
      title: '重新获取 DHCP IP 租约',
      command: 'ipconfig /release && ipconfig /renew',
      symptom: '局域网 IP 冲突、或者切换 Wi-Fi/路由器后无法分配新 IP',
      recommendation: '释放现有动态 IP 并重新向路由器 DHCP 服务器申请新地址',
      requiresAdmin: false
    },
    {
      id: 'register-dns',
      title: '重新注册 DNS 名称',
      command: 'ipconfig /registerdns',
      symptom: '内网主机名或 Active Directory 域控制器解析失败',
      recommendation: '刷新所有 DHCP 租用并重新在 DNS 服务器上注册名称',
      requiresAdmin: true
    }
  ]
}

/**
 * 组装一键全面急救指令流
 */
export function getFullRescueScript(): string {
  return 'ipconfig /flushdns && netsh winsock reset && ipconfig /release && ipconfig /renew'
}
