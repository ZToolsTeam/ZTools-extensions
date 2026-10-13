export interface MemoItem {
  id: string
  title: string
  content: string
  tag: string
  createTime: number
  updateTime: number
}

/**
 * 创建新便签
 */
export function createMemo(
  items: MemoItem[],
  title: string,
  content: string,
  tag: string = '默认'
): MemoItem[] {
  const cleanTitle = title.trim() || '无标题便签'
  const cleanContent = content.trim()
  const now = Date.now()

  const newItem: MemoItem = {
    id: `memo-${now}-${Math.floor(Math.random() * 1000)}`,
    title: cleanTitle,
    content: cleanContent,
    tag: tag.trim() || '默认',
    createTime: now,
    updateTime: now
  }

  return [newItem, ...items]
}

/**
 * 更新现有便签
 */
export function updateMemo(
  items: MemoItem[],
  id: string,
  updates: Partial<Pick<MemoItem, 'title' | 'content' | 'tag'>>
): MemoItem[] {
  return items.map(item => {
    if (item.id === id) {
      return {
        ...item,
        ...updates,
        updateTime: Date.now()
      }
    }
    return item
  })
}

/**
 * 删除便签
 */
export function deleteMemo(items: MemoItem[], id: string): MemoItem[] {
  return items.filter(item => item.id !== id)
}

/**
 * 初始样例便签
 */
export function getSampleMemos(): MemoItem[] {
  const now = Date.now()
  return [
    {
      id: 'memo-1',
      title: 'ZTools 架构设计核心准则',
      content: '1. 彻底卸下历史兼容包袱，不再维护同步转异步 Shim\n2. 纯声明式 UI，严禁插件写 CSS/HTML\n3. 全键盘极客闭环 (Enter, Esc, Ctrl+K)',
      tag: '工作',
      createTime: now - 3600000,
      updateTime: now - 3600000
    },
    {
      id: 'memo-2',
      title: '常用网络调试命令备忘',
      content: 'netstat -ano | findstr :8080\ntaskkill /F /PID 1234\nipconfig /flushdns',
      tag: '技术',
      createTime: now - 86400000,
      updateTime: now - 86400000
    },
    {
      id: 'memo-3',
      title: '周末读书清单',
      content: '《设计心理学》、《代码整洁之道》、《人月神话》',
      tag: '生活',
      createTime: now - 172800000,
      updateTime: now - 172800000
    }
  ]
}
