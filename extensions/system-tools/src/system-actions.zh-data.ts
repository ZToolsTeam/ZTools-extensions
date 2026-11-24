/** 系统快捷操作的中文检索关键词表 */
export const SYSTEM_ACTION_ZH_KEYWORDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "lock-screen": ["锁屏", "锁定", "锁定屏幕"],
  "sleep": ["睡眠", "待机"],
  "hibernate": ["休眠", "深度休眠"],
  "restart": ["重启", "重新启动"],
  "shut-down": ["关机"],
  "log-out": ["注销", "登出"],
  "toggle-mute": ["静音", "恢复声音"],
  "volume-up": ["调高音量", "音量加", "大声"],
  "volume-down": ["调低音量", "音量减", "小声"],
  "toggle-hidden-files": ["隐藏文件", "显示隐藏文件"],
  "empty-trash": ["清空回收站"],
  "toggle-caffeinate": ["防休眠", "防止熄屏", "常亮"]
});
