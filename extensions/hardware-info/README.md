# 硬件信息

查看本机 CPU 型号与负载、物理内存、系统版本、磁盘容量、显示器与电源状态，给出 4 个常见场景的规格估算，并可把 Markdown / JSON / TXT 配置报告复制到剪贴板。

- **架构标准**：`@ztools/declarative-ui` 声明式 UI 视图描述符，布局一（单栏列表 + 右侧详情）
- **数据来源**：宿主通用系统接口（`system_get_hardware_summary`、`get_system_info`、`system_get_cpu_usage`、`system_get_memory_usage`、`system_get_battery_status`、`screen_get_all_displays`、`system_list_volumes`），不依赖原生 DLL
- **读取失败**：任一接口失败时对应字段显示「读取失败」并弹出失败提示，不使用默认值冒充真实数据；负载余量与场景估算只在所需数据齐全时计算
- **电源状态**：只有系统明确报告没有电池时才显示「无电池」；电量未知（系统报告 255）显示「电量未知」或「电池状态未知」；读取失败显示「电源状态读取失败」并给出原因
- **磁盘容量**：部分卷读取失败时保留读到的卷，状态栏与报告注明「部分卷读取失败」，失败原因写进提示与报告
- **负载余量**：CPU 与内存当前未占用比例的较小值，即 `100 - max(CPU 使用率, 内存使用率)`，不代表硬件寿命或故障检测。JSON 报告使用 `loadHeadroomPercent`，缺少任一使用率时为 `null`。
- **场景估算**：只按线程数与内存容量作规则估算，磁盘余量只作空间提醒。未运行性能测试，也不保证软件兼容性、游戏帧率或模型推理速度。JSON 报告用 `assessment.performanceMeasured: false` 区分估算与测量。
- **暂不提供**：温度/风扇传感器、显卡、主板、内存 SPD、磁盘 SMART（宿主尚无对应的跨平台接口）

## 平台与要求

- 支持：Windows、macOS
- 需要客户端 1.1.8.3 或更新。
- Windows 实现尚待真机复核。

## 网络与数据

- 不联网，数据只保存在本机。
