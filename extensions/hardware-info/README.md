# 电脑硬件信息 (hardware-info)

查看本机 CPU 型号与负载、物理内存、系统版本、磁盘容量、显示器与电源状态，给出 4 个常见场景的估算评分，并可导出 Markdown / JSON / TXT 配置报告

- **架构标准**：`@ztools/declarative-ui` 声明式 UI 视图描述符，布局一（单栏列表 + 右侧详情）
- **数据来源**：宿主通用系统接口（`system_get_hardware_summary`、`get_system_info`、`system_get_cpu_usage`、`system_get_memory_usage`、`system_get_battery_status`、`screen_get_all_displays`、`system_get_disk_usage`），不依赖原生 DLL
- **读取失败**：任一接口失败时对应字段显示「读取失败」并弹出失败提示，不使用默认值冒充真实数据；健康度与场景评分只在所需数据齐全时计算
- **暂不提供**：温度/风扇传感器、显卡、主板、内存 SPD、磁盘 SMART（宿主尚无对应的跨平台接口）
