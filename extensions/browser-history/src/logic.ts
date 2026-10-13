export interface HistoryItem {
  id: string
  title: string
  url: string
  visitTime: number // 毫秒时间戳
  timeAgo: string
  browser: 'Chrome' | 'Edge' | 'Other'
}

/**
 * 相对时间格式化（刚刚、5分钟前、2小时前、昨天等）
 */
export function formatTimeAgo(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return '刚刚'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`

  return new Date(timestamp).toLocaleDateString()
}

/**
 * 预设样例历史记录
 */
export function getSampleHistoryItems(): HistoryItem[] {
  const now = Date.now()
  return [
    {
      id: 'h-1',
      title: 'GitHub - ZTools: Next Generation Desktop Productivity Hub',
      url: 'https://github.com/ztools/ztools',
      visitTime: now - 3 * 60 * 1000,
      timeAgo: '3 分钟前',
      browser: 'Chrome'
    },
    {
      id: 'h-2',
      title: 'Raycast API Reference: Declarative UI Components',
      url: 'https://developers.raycast.com/api-reference',
      visitTime: now - 25 * 60 * 1000,
      timeAgo: '25 分钟前',
      browser: 'Edge'
    },
    {
      id: 'h-3',
      title: 'Vue 3 Documentation - Composition API FAQ',
      url: 'https://vuejs.org/guide/extras/composition-api-faq.html',
      visitTime: now - 90 * 60 * 1000,
      timeAgo: '1 小时前',
      browser: 'Chrome'
    },
    {
      id: 'h-4',
      title: 'Electron 43.4.1 Release Notes and Security Guidance',
      url: 'https://www.electronjs.org/releases/stable',
      visitTime: now - 5 * 3600 * 1000,
      timeAgo: '5 小时前',
      browser: 'Chrome'
    },
    {
      id: 'h-5',
      title: 'Tailwind CSS - Rapidly build modern websites',
      url: 'https://tailwindcss.com/docs',
      visitTime: now - 24 * 3600 * 1000,
      timeAgo: '1 天前',
      browser: 'Edge'
    }
  ]
}
