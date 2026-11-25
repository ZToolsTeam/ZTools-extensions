/** 硬件遥测模块中文名称静态表（供模块计数与历史中文失败标识兼容识别；运行时展示走 i18n） */
export const TELEMETRY_MODULES = ['处理器信息', 'CPU 负载', '内存占用', '系统版本', '电源状态', '显示器', '磁盘容量'] as const

/** 磁盘模块历史失败标识（兼容旧版中文标识与英文标识） */
export const LEGACY_DISK_FAILURE_MARKERS: readonly string[] = Object.freeze(['disk', '磁盘容量', 'Disk Storage'])
